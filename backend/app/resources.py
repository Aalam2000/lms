"""
Общая логика вокруг полиморфного ресурса урока (файл/квиз/ссылка) —
переиспользуется в routers/lessons.py (привязка/отвязка к уроку),
library.py и контроле дублей. Запрет удаления привязанного к урокам —
теперь общий механизм app/usages.py.

Не роутер — просто общие функции, чтобы не дублировать одну и ту же
проверку в трёх местах.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Course, Group, HomeworkTask, Lesson, Link, LessonResource, Material, Quiz, Sector, User

RESOURCE_MODELS = {
    "material": Material,
    "quiz": Quiz,
    "link": Link,
}

RESOURCE_NOT_FOUND = {
    "material": "Файл не найден",
    "quiz": "Квиз не найден",
    "link": "Ссылка не найдена",
}


async def resource_exists(db: AsyncSession, resource_type: str, resource_id: int) -> bool:
    model = RESOURCE_MODELS[resource_type]
    result = await db.execute(select(model.id).where(model.id == resource_id))
    return result.scalar_one_or_none() is not None


async def count_attachments_map(db: AsyncSession) -> dict[tuple[str, int], int]:
    # Одним запросом — счётчики привязок сразу для всех ресурсов
    # (используется в library.py, чтобы не гонять запрос на каждую строку).
    result = await db.execute(
        select(
            LessonResource.resource_type,
            LessonResource.resource_id,
            func.count(),
        ).group_by(LessonResource.resource_type, LessonResource.resource_id)
    )
    return {(resource_type, resource_id): cnt for resource_type, resource_id, cnt in result.all()}


# Где ресурс используется — для ленты «Базы знаний»: число уроков, к
# которым он привязан, курсы этих уроков (курс группы урока, по алфавиту без
# повторов) и места для папок БЗ — сектор и курс группы урока и номер урока
# (None — доп. урок). Файл, выданный как ДЗ, тоже считается используемым в
# уроке. Двумя запросами сразу для всех ресурсов.
async def attachment_usage_map(db: AsyncSession) -> dict[tuple[str, int], dict]:
    lesson_cols = (Lesson.id, Lesson.order, Lesson.is_personal, Group.sector, Group.course_id, Course.title)
    attached = await db.execute(
        select(LessonResource.resource_type, LessonResource.resource_id, *lesson_cols)
        .join(Lesson, Lesson.id == LessonResource.lesson_id)
        .join(Group, Group.id == Lesson.group_id)
        .join(Course, Course.id == Group.course_id)
    )
    homework = await db.execute(
        select(literal("material"), HomeworkTask.material_id, *lesson_cols)
        .join(Lesson, Lesson.id == HomeworkTask.lesson_id)
        .join(Group, Group.id == Lesson.group_id)
        .join(Course, Course.id == Group.course_id)
        .distinct()
    )
    usage: dict[tuple[str, int], dict] = {}
    for resource_type, resource_id, lesson_id, order, is_personal, sector, course_id, course_title in (
        list(attached.all()) + list(homework.all())
    ):
        row = usage.setdefault((resource_type, resource_id), {"lessons": set(), "courses": set(), "places": set()})
        row["lessons"].add(lesson_id)
        row["courses"].add(course_title)
        lesson_no = order if (not is_personal and order and order > 0) else None
        row["places"].add((sector, course_id, lesson_no))
    for row in usage.values():
        row["count"] = len(row.pop("lessons"))
        row["courses"] = sorted(row["courses"], key=str.lower)
        row["places"] = [
            {"sector": sector, "course_id": course_id, "lesson_no": lesson_no}
            for sector, course_id, lesson_no in sorted(row["places"], key=lambda p: (p[0] or "", p[1] or 0, p[2] or 0))
        ]
    return usage


# Теги папки Базы знаний — сектор и курс файла, ссылки или квиза. Ставят
# админ и владелец ресурса (тот, кто загрузил/создал). Пустое значение —
# тег снят. Сектор и курс ставятся вместе: оба или ни одного.
async def set_folder_tags(db: AsyncSession, resource, owner_id: int, user: User,
                          course_id: Optional[int], sector: Optional[str]) -> None:
    if user.role != "admin" and owner_id != user.id:
        raise HTTPException(status_code=403, detail="Теги ставят админ и владелец")
    sector = (sector or "").strip() or None
    if bool(course_id) != bool(sector):
        raise HTTPException(status_code=400, detail="Сектор и курс ставятся вместе")
    if course_id and (await db.execute(select(Course.id).where(Course.id == course_id))).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Курс не найден")
    if sector and (await db.execute(select(Sector.id).where(Sector.code == sector))).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Сектор не найден")
    resource.course_id = course_id or None
    resource.sector = sector


# Единая форма "деталей ресурса" вне зависимости от таблицы-источника —
# используется и в library.py (вся лента), и в lessons.py (только
# привязанное к уроку, через ids=...). owner_id/owner_name/owner_created_at —
# это "кто загрузил/создал и когда" (не путать с added_by/added_at
# привязки к уроку — это про другое действие и считается отдельно, в
# lessons.py, из LessonResource).
async def fetch_resource_details(
    db: AsyncSession,
    resource_type: str,
    ids: Optional[set[int]] = None,
) -> list[dict]:
    if resource_type == "material":
        query = select(Material, User.full_name, User.username).join(User, User.id == Material.uploaded_by)
        if ids is not None:
            query = query.where(Material.id.in_(ids))
        rows = await db.execute(query)
        return [
            {
                "resource_type": "material",
                "id": m.id,
                "title": m.original_filename,
                "content_type": m.content_type,
                "size_bytes": m.size_bytes,
                "template_type": None,
                "topic": None,
                "url": None,
                "owner_id": m.uploaded_by,
                "owner_name": full_name or username,
                "owner_created_at": m.created_at,
            }
            for m, full_name, username in rows.all()
        ]

    if resource_type == "quiz":
        query = select(Quiz, User.full_name, User.username).join(User, User.id == Quiz.created_by)
        if ids is not None:
            query = query.where(Quiz.id.in_(ids))
        rows = await db.execute(query)
        return [
            {
                "resource_type": "quiz",
                "id": q.id,
                "title": q.title,
                "content_type": None,
                "size_bytes": None,
                "template_type": q.template_type,
                "topic": q.topic,
                "url": None,
                "owner_id": q.created_by,
                "owner_name": full_name or username,
                "owner_created_at": q.created_at,
            }
            for q, full_name, username in rows.all()
        ]

    # link
    query = select(Link, User.full_name, User.username).join(User, User.id == Link.added_by)
    if ids is not None:
        query = query.where(Link.id.in_(ids))
    rows = await db.execute(query)
    return [
        {
            "resource_type": "link",
            "id": l.id,
            "title": l.title,
            "content_type": None,
            "size_bytes": None,
            "template_type": None,
            "topic": None,
            "url": l.url,
            "owner_id": l.added_by,
            "owner_name": full_name or username,
            "owner_created_at": l.created_at,
        }
        for l, full_name, username in rows.all()
    ]


# ---------- Контроль дублей в «Базе знаний» ----------
# Файл — по содержимому (sha256), ссылка — по нормализованному адресу.
# Персональные файлы ДЗ (Material.is_personal) в проверке не участвуют.

import hashlib
from urllib.parse import urlsplit, urlunsplit

from fastapi.responses import JSONResponse


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_url(url: str) -> str:
    """Без пробелов, схема/домен в нижнем регистре, без '/' в конце пути."""
    raw = (url or "").strip()
    try:
        parts = urlsplit(raw)
    except ValueError:
        return raw.rstrip("/")
    path = parts.path.rstrip("/")
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, parts.fragment))


def _who_when(full_name, username, created_at) -> str:
    who = full_name or username or "—"
    when = created_at.strftime("%d.%m.%Y") if created_at else ""
    return f"{who}, {when}" if when else who


async def find_duplicate_material(db: AsyncSession, digest: str) -> Optional[tuple[Material, str]]:
    row = (await db.execute(
        select(Material, User.full_name, User.username)
        .join(User, User.id == Material.uploaded_by)
        .where(Material.content_hash == digest, Material.is_personal == False)
        .order_by(Material.id)
        .limit(1)
    )).first()
    if not row:
        return None
    material, full_name, username = row
    return material, _who_when(full_name, username, material.created_at)


async def find_materials_by_name(db: AsyncSession, filename: str) -> list[Material]:
    """Все библиотечные файлы с таким именем, самый новый — первым.
    Имя файла уникально по всей Базе знаний (правило загрузки — см.
    routers/materials.py, upload_material); больше одного здесь может
    оказаться только из-за дублей, загруженных до этого правила."""
    rows = (await db.execute(
        select(Material)
        .where(Material.original_filename == filename, Material.is_personal == False)
        .order_by(Material.id.desc())
    )).scalars().all()
    return list(rows)


async def material_name_exists(db: AsyncSession, filename: str) -> bool:
    row = (await db.execute(
        select(Material.id).where(Material.original_filename == filename, Material.is_personal == False).limit(1)
    )).first()
    return row is not None


async def find_duplicate_link(db: AsyncSession, url: str) -> Optional[tuple[Link, str]]:
    target = normalize_url(url)
    rows = (await db.execute(
        select(Link, User.full_name, User.username).join(User, User.id == Link.added_by).order_by(Link.id)
    )).all()
    for link, full_name, username in rows:
        if normalize_url(link.url) == target:
            return link, _who_when(full_name, username, link.created_at)
    return None


def clean_filename(name: Optional[str]) -> str:
    """Имя файла без папок. При загрузке папкой браузер присылает путь
    («LESSONS/Урок 1/Урок 1.1.docx») — храним и сравниваем только имя."""
    return (name or "").replace("\\", "/").rsplit("/", 1)[-1].strip() or "file"


def conflict(code: str, detail: str, existing_id: Optional[int] = None) -> JSONResponse:
    """409 с понятным текстом (detail) + code (duplicate | same_name) и id
    уже существующего ресурса — фронт в уроке привязывает его вместо копии."""
    return JSONResponse(status_code=409, content={"detail": detail, "code": code, "existing_id": existing_id})
