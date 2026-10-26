import asyncio
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FastAPIFile, Form
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..database import get_db
from ..dependencies import require_admin, require_teacher, get_current_user
from ..models import Material, User, Lesson, LessonResource, GroupMember, HomeworkTask, Course
from ..personal import membership_visible, visible_to_student
from ..resources import clean_filename, content_hash, find_duplicate_material, find_materials_by_name, conflict
from .academy import sector_exists
from ..usages import ensure_not_used

router = APIRouter(prefix="/materials", tags=["materials"])

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 МБ — рабочий дефолт

# Форматы, для которых делаем предпросмотр через конвертацию в PDF
# (см. /materials/{id}/preview ниже). Готовый PDF кэшируется в хранилище
# (storage.preview_key) — решение Андрея, 2026-09-28, вместо «всегда заново»
# (2026-09-18): иначе класс, разом открывший презентацию, запускал десятки
# soffice и вешал сервер. Если появится редактирование этих файлов —
# сохранять правку под новым object_key (или удалять preview_key).
PREVIEW_CONVERTIBLE_EXTENSIONS = {".docx", ".xlsx", ".pptx"}


def _fetch_and_convert_to_pdf(object_key: str, ext: str) -> bytes:
    """Синхронная (блокирующая) часть — чтение из хранилища и вызов
    soffice — намеренно вынесена в отдельную функцию и гоняется через
    asyncio.to_thread в самом эндпоинте, чтобы не блокировать event loop."""
    data = b"".join(storage.stream_object(object_key))
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"src{ext}"
        src.write_bytes(data)
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, str(src)],
            check=True, timeout=60, capture_output=True,
        )
        return src.with_suffix(".pdf").read_bytes()


# Одна конвертация за раз: параллельные soffice грузят CPU/память и ещё
# конфликтуют за общий профиль LibreOffice. Остальные ждут в очереди.
_CONVERT_LOCK = asyncio.Semaphore(1)


async def _get_preview_pdf(object_key: str, ext: str) -> bytes:
    key = storage.preview_key(object_key)
    cached = await asyncio.to_thread(storage.read_object_or_none, key)
    if cached is not None:
        return cached
    async with _CONVERT_LOCK:
        # Пока ждали очереди, этот же файл мог сконвертировать другой запрос
        cached = await asyncio.to_thread(storage.read_object_or_none, key)
        if cached is not None:
            return cached
        if not storage.exists(object_key):
            raise HTTPException(status_code=404, detail="Файл не найден на диске — загрузите его заново")
        pdf_bytes = await asyncio.to_thread(_fetch_and_convert_to_pdf, object_key, ext)
        await asyncio.to_thread(storage.upload_bytes, key, pdf_bytes, "application/pdf")
        return pdf_bytes


async def _verify_student_material_access(
    db: AsyncSession, material_id: int, current_user: User
) -> None:
    """Студент может скачать/просмотреть файл, только если он реально
    привязан к открытому уроку в группе, где студент активный участник (или
    отчислен — тогда урок до дня отчисления, personal.membership_visible) —
    иначе через прямой URL можно было бы утащить любой файл из общей
    базы знаний."""
    result = await db.execute(
        select(LessonResource)
        .join(Lesson, Lesson.id == LessonResource.lesson_id)
        .join(GroupMember, GroupMember.group_id == Lesson.group_id)
        .where(
            LessonResource.resource_type == "material",
            LessonResource.resource_id == material_id,
            Lesson.is_open == True,
            GroupMember.student_id == current_user.id,
            membership_visible(),
            visible_to_student(current_user.id),  # персональный урок — только участникам
        )
    )
    if result.first() is not None:
        return
    # Файл задания ДЗ урока: общее (student_id NULL) или его персональное
    task = await db.execute(
        select(HomeworkTask.id)
        .join(Lesson, Lesson.id == HomeworkTask.lesson_id)
        .join(GroupMember, GroupMember.group_id == Lesson.group_id)
        .where(
            HomeworkTask.material_id == material_id,
            Lesson.is_open == True,
            GroupMember.student_id == current_user.id,
            membership_visible(),
            visible_to_student(current_user.id),
            or_(HomeworkTask.student_id.is_(None), HomeworkTask.student_id == current_user.id),
        )
    )
    if task.first() is None:
        raise HTTPException(status_code=403, detail="Нет доступа к файлу")


class MaterialOut(BaseModel):
    id: int
    original_filename: str
    content_type: Optional[str]
    size_bytes: int
    uploaded_by: int
    uploaded_by_name: Optional[str] = None
    created_at: datetime
    course_id: Optional[int] = None
    sector: Optional[str] = None
    template_lesson_no: Optional[str] = None
    template_status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# Ответ загрузки: тот же MaterialOut + что именно произошло с файлом
# (created — новый, replaced — заменено содержимое существующего,
# unchanged — такой файл уже есть, ничего не меняли).
class MaterialUploadOut(MaterialOut):
    upload_result: str = "created"


async def _upload_out(db: AsyncSession, material: Material, upload_result: str) -> MaterialUploadOut:
    row = (await db.execute(
        select(User.full_name, User.username).where(User.id == material.uploaded_by)
    )).first()
    item = MaterialUploadOut.model_validate(material)
    item.uploaded_by_name = (row[0] or row[1]) if row else None
    item.upload_result = upload_result
    return item


async def _stored_hash(material: Material) -> Optional[str]:
    """sha256 файла, загруженного до появления контроля дублей (content_hash
    ещё пуст). Объекта нет в хранилище — None: считаем содержимое другим."""
    try:
        data = await asyncio.to_thread(lambda: b"".join(storage.stream_object(material.object_key)))
    except Exception:
        return None
    return content_hash(data)


# Библиотека материалов — доступна teacher и admin (require_teacher пускает обоих)
@router.get("/", response_model=list[MaterialOut])
async def list_materials(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    result = await db.execute(
        select(Material, User.full_name, User.username)
        .join(User, User.id == Material.uploaded_by)
        .where(Material.is_personal == False)  # персональные ДЗ — не библиотека
        .order_by(Material.created_at.desc())
    )
    out = []
    for material, full_name, username in result.all():
        item = MaterialOut.model_validate(material)
        item.uploaded_by_name = full_name or username
        out.append(item)
    return out


# Загрузка — доступна teacher и admin. Теги шаблона курса (course_id/
# sector/template_lesson_no) может проставить только admin — см.
# claude/course-templates-plan.md, раздел "Права". Обычный teacher их
# просто не передаёт (форма "+ Файл" их не показывает); если их всё же
# передал не-admin — 403, а не молчаливое игнорирование, чтобы не
# маскировать ошибку на фронте/в прямом вызове API.
#
# Правило загрузки (решение Андрея, 2026-10-02) — имя файла уникально по
# всей Базе знаний:
#   имя новое, содержимое новое        -> новый файл (created);
#   имя новое, такое же содержимое уже
#     лежит под другим именем          -> 409 duplicate, копию не кладём;
#   имя то же, содержимое то же        -> ничего не делаем (unchanged);
#   имя то же, содержимое другое       -> заменяем содержимое ТОЙ ЖЕ записи
#     (replaced): id, привязки к урокам и теги шаблона остаются. Заменить
#     может admin или тот, кто файл загрузил; иначе 409 name_taken. При
#     загрузке пакета курса файл другого курса/сектора не заменяем — тоже
#     409 name_taken (чтобы один курс молча не перезаписал материалы другого).
@router.post("/upload", response_model=MaterialUploadOut)
async def upload_material(
    file: UploadFile = FastAPIFile(...),
    course_id: Optional[int] = Form(None),
    sector: Optional[str] = Form(None),
    template_lesson_no: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    if (course_id is not None or sector is not None or template_lesson_no is not None) \
            and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Теги шаблона курса может проставлять только администратор")

    if sector is not None and not await sector_exists(db, sector):
        raise HTTPException(status_code=400, detail="Выберите сектор из списка")

    file.filename = clean_filename(file.filename)  # имя без папок
    contents = await file.read()
    size_bytes = len(contents)
    if size_bytes == 0:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if size_bytes > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Файл слишком большой (максимум 50 МБ)")

    digest = content_hash(contents)
    is_template_upload = course_id is not None or sector is not None or template_lesson_no is not None

    # 1. То же имя и то же содержимое — ничего не делаем.
    same_name = await find_materials_by_name(db, file.filename)
    for m in same_name:
        if m.content_hash is None:
            m.content_hash = await _stored_hash(m)
    identical = next((m for m in same_name if m.content_hash == digest), None)
    if identical:
        await db.commit()  # сохранить досчитанные хэши старых файлов
        await db.refresh(identical)
        return await _upload_out(db, identical, "unchanged")

    # 2. Такое же содержимое уже лежит под другим именем — копию не кладём.
    duplicate = await find_duplicate_material(db, digest)
    if duplicate:
        existing, who = duplicate
        return conflict("duplicate", f"Такой файл уже есть в Базе знаний: «{existing.original_filename}» ({who})", existing.id)

    # 3. То же имя, другое содержимое — заменяем содержимое существующей
    #    записи (при старых дублях имени — самой новой из них).
    if same_name:
        target = same_name[0]
        if current_user.role != "admin" and target.uploaded_by != current_user.id:
            owner = (await db.execute(
                select(User.full_name, User.username).where(User.id == target.uploaded_by)
            )).first()
            who = (owner[0] or owner[1]) if owner else "—"
            return conflict(
                "name_taken",
                f"В Базе знаний уже есть файл с именем «{file.filename}» (загрузил(а) {who}). "
                "Заменить его может только автор или администратор — переименуйте свой файл.",
                target.id,
            )
        if is_template_upload and (target.course_id is not None or target.sector is not None) \
                and (target.course_id != course_id or target.sector != sector):
            course_title = None
            if target.course_id is not None:
                course_title = (await db.execute(
                    select(Course.title).where(Course.id == target.course_id)
                )).scalar_one_or_none()
            owner_label = ", ".join(x for x in (course_title, target.sector) if x) or "без курса"
            return conflict(
                "name_taken",
                f"Файл с именем «{file.filename}» уже есть в Базе знаний и относится к другому "
                f"курсу или сектору ({owner_label}). Переименуйте файл.",
                target.id,
            )

        # Новый object_key, а не перезапись старого: путь файла никогда не
        # перезаписывается (на нём держится кэш PDF-предпросмотра, см.
        # storage.preview_key). Старый объект удаляем после коммита.
        old_key = target.object_key
        new_key = storage.new_key("materials")
        storage.upload_bytes(new_key, contents, file.content_type)
        target.object_key = new_key
        target.content_type = file.content_type
        target.size_bytes = size_bytes
        target.content_hash = digest
        if is_template_upload:
            # Файл без тегов, пришедший в пакете курса, становится материалом
            # этого курса; у файла того же курса/сектора теги не меняются.
            target.course_id = course_id
            target.sector = sector
            if template_lesson_no:
                target.template_lesson_no = template_lesson_no
            if target.template_lesson_no and target.template_status is None:
                target.template_status = "draft"
        await db.commit()
        await db.refresh(target)
        try:
            storage.delete_object(old_key)
        except Exception:
            pass  # осиротевший объект в хранилище не мешает работе
        return await _upload_out(db, target, "replaced")

    # 4. Имя новое — обычная загрузка нового файла.
    object_key = storage.new_key("materials")
    storage.upload_bytes(object_key, contents, file.content_type)

    material = Material(
        object_key=object_key,
        original_filename=file.filename,
        content_type=file.content_type,
        size_bytes=size_bytes,
        content_hash=digest,
        uploaded_by=current_user.id,
        course_id=course_id,
        sector=sector,
        template_lesson_no=template_lesson_no,
        # "Шаблонность" материала — заполненность course_id+sector+
        # template_lesson_no разом (см. course-templates-plan.md). Статус
        # выставляем в draft, только если номер урока реально указан —
        # файл, у которого проставлен только курс/сектор, но нет номера
        # урока, не становится "черновиком шаблона" сам по себе.
        template_status="draft" if template_lesson_no else None,
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)

    return await _upload_out(db, material, "created")


class MaterialTemplateUpdate(BaseModel):
    course_id: Optional[int] = None
    sector: Optional[str] = None
    template_lesson_no: Optional[str] = None
    template_status: Optional[str] = None  # draft | approved | rejected


class MaterialTemplateBulkUpdate(BaseModel):
    course_id: int
    sector: str
    template_status: str  # approved | rejected


# Правка тегов шаблона курса у уже загруженного файла — только admin.
# PATCH, а не отдельные ручки: обновляем только те поля, что реально
# прислали (exclude_unset), поэтому одиночное "одобрить"/"забраковать"
# ({"template_status": "..."}) не затирает course_id/sector/номер урока.
@router.patch("/{material_id}/template", response_model=MaterialOut)
async def update_material_template(
    material_id: int,
    data: MaterialTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Material, User.full_name, User.username)
        .join(User, User.id == Material.uploaded_by)
        .where(Material.id == material_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Файл не найден")
    material, full_name, username = row

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(material, field, value)

    await db.commit()
    await db.refresh(material)

    item = MaterialOut.model_validate(material)
    item.uploaded_by_name = full_name or username
    return item


# Массовое решение по всему пакету материалов курса+сектора разом (см.
# claude/course-templates-plan.md) — меняет только template_status,
# сами course_id/sector/template_lesson_no не трогает.
@router.patch("/template/bulk")
async def bulk_update_material_template(
    data: MaterialTemplateBulkUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Material).where(Material.course_id == data.course_id, Material.sector == data.sector)
    )
    materials = result.scalars().all()
    for material in materials:
        material.template_status = data.template_status
    await db.commit()
    return {"updated": len(materials)}


def _content_disposition(filename: str, disposition: str = "attachment") -> str:
    """Имя файла может быть не-ASCII (кириллица/azeri) — HTTP-заголовки
    кодируются в latin-1, поэтому кладём его только в filename* (RFC 5987,
    UTF-8 + percent-encoding), а filename оставляем ASCII-заглушкой для
    старых клиентов."""
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "file"
    quoted = quote(filename)
    return f"{disposition}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quoted}"


# Скачивание — стримим через бэкенд
@router.get("/{material_id}/download")
async def download_material(
    material_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Файл не найден")

    if current_user.role == "student":
        await _verify_student_material_access(db, material_id, current_user)
    elif current_user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Нет доступа")

    if not storage.exists(material.object_key):
        raise HTTPException(status_code=404, detail="Файл не найден на диске — загрузите его заново")

    return StreamingResponse(
        storage.stream_object(material.object_key),
        media_type=material.content_type or "application/octet-stream",
        headers={"Content-Disposition": _content_disposition(material.original_filename)},
    )


# Изолированный просмотр (routers/view.py): HTML и SVG открываются не как
# blob: в источнике платформы, а по ссылке /view/<токен> с заголовком
# CSP sandbox — скрипт материала не видит платформу и токен входа.
# Права — те же, что у скачивания.
VIEW_EXTENSIONS = {".html", ".htm", ".xhtml", ".svg"}


def is_view_file(material: Material) -> bool:
    return Path(material.original_filename or "").suffix.lower() in VIEW_EXTENSIONS


@router.post("/{material_id}/view-link")
async def material_view_link(
    material_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from ..security import create_view_token

    material = (await db.execute(select(Material).where(Material.id == material_id))).scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Файл не найден")
    if current_user.role == "student":
        await _verify_student_material_access(db, material_id, current_user)
    elif current_user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Нет доступа")
    if not is_view_file(material):
        raise HTTPException(status_code=400, detail="Этот файл открывается обычным просмотром")
    return {"token": create_view_token("material", material_id)}


# Текст файла — для Помощника квиза (материалы урока прямо в промпт).
# Только педагог/админ. Длинный текст обрезаем: бесплатные ИИ не примут
# промпт на сотни тысяч символов.
TEXT_LIMIT = 40000


@router.get("/{material_id}/text")
async def material_text(
    material_id: int,
    limit: int = TEXT_LIMIT,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    from ..text_extract import extract_text

    material = (await db.execute(select(Material).where(Material.id == material_id))).scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Файл не найден")
    if not storage.exists(material.object_key):
        raise HTTPException(status_code=404, detail="Файл не найден на диске — загрузите его заново")
    data = await asyncio.to_thread(lambda: b"".join(storage.stream_object(material.object_key)))
    try:
        text = await asyncio.to_thread(extract_text, material.original_filename, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=422, detail=f"Не удалось прочитать текст из «{material.original_filename}»")
    limit = max(1000, min(limit, TEXT_LIMIT))
    return {
        "filename": material.original_filename,
        "text": text[:limit],
        "chars": len(text),
        "truncated": len(text) > limit,
    }


# Предпросмотр — docx/xlsx/pptx конвертируются в PDF на лету и открываются
# в браузере тем же путём, что уже работает для PDF/картинок (см.
# handleOpen/handleOpenItem на фронте). Без кэша: конвертируем заново на
# каждый запрос.
@router.get("/{material_id}/preview")
async def preview_material(
    material_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Файл не найден")

    if current_user.role == "student":
        await _verify_student_material_access(db, material_id, current_user)
    elif current_user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Нет доступа")

    ext = Path(material.original_filename).suffix.lower()
    if ext not in PREVIEW_CONVERTIBLE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Предпросмотр для этого формата не поддерживается")

    try:
        pdf_bytes = await _get_preview_pdf(material.object_key, ext)
    except subprocess.CalledProcessError:
        raise HTTPException(status_code=500, detail="Не удалось сконвертировать файл в PDF")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Конвертация заняла слишком много времени")

    return Response(content=pdf_bytes, media_type="application/pdf")


# Удаление — только admin
@router.delete("/{material_id}")
async def delete_material(
    material_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Файл не найден")

    await ensure_not_used(db, "material", material_id)

    storage.delete_object(material.object_key)
    await db.delete(material)
    await db.commit()
    return {"ok": True}
