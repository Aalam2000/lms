"""Работа на уроке: ученик сдаёт файлы во время урока, педагог смотрит,
скачивает и проверяет — «Принять» или оценка. Оценка — это оценка за урок
(LessonMark.score), за урок она одна. Статусы и подсветки — app/lesson_work.py.

Ученик (вкладка «Работа на уроке»): добавляет несколько файлов и удаляет свои,
пока урок открыт, не прошла полночь по Баку и педагог ещё не проверил.
Педагог (колонка «Файлы с урока» в журнале): права — как у журнала урока.
"""
import asyncio
import io
import re
import zipfile
from datetime import datetime, timezone as dt_timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File as FastAPIFile, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..database import get_db
from ..dependencies import require_teacher, get_current_user
from ..lesson_work import work_status
from ..notify import send_summaries
from ..personal import student_lesson_access
from ..models import Course, Group, Lesson, LessonMark, LessonResource, LessonWorkFile, Material, Sector, User
from .homework import (
    AI_TEXT_LIMIT, AiSourceOut, _active_students, _ai_text, _ensure_active_student, _read_upload,
    build_ai_source, file_response,
)
from .materials import _content_disposition
from .lessons import (
    _safe_delete_object, get_lesson_for_student, get_lesson_for_teacher_or_admin, is_lesson_locked,
)

router = APIRouter(prefix="/lessons", tags=["lesson-work"])


class WorkFileOut(BaseModel):
    id: int
    original_filename: str
    content_type: Optional[str] = None
    size_bytes: int
    uploaded_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class WorkState(BaseModel):
    status: str                      # none | submitted | accepted | graded
    score: Optional[int] = None      # оценка за урок
    submitted_at: Optional[datetime] = None  # последний загруженный файл
    files: list[WorkFileOut] = []


class MyWorkOut(WorkState):
    is_locked: bool = False          # менять файлы нельзя
    lock_reason: Optional[str] = None  # reviewed | day_over | archived (отчислен — только просмотр)


class WorkRow(BaseModel):
    student_id: int
    full_name: str
    work: WorkState


class WorkBoardOut(BaseModel):
    students: list[WorkRow]
    to_review: int = 0


class WorkReviewIn(BaseModel):
    # Оценить: {grade: 90} — это оценка за урок; принять без оценки: {accepted: true}
    grade: Optional[int] = Field(default=None, ge=0, le=100)
    accepted: bool = False


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


async def _files(db: AsyncSession, lesson_id: int, student_id: Optional[int] = None) -> list[LessonWorkFile]:
    cond = [LessonWorkFile.lesson_id == lesson_id]
    if student_id is not None:
        cond.append(LessonWorkFile.student_id == student_id)
    return list((await db.execute(
        select(LessonWorkFile).where(*cond).order_by(LessonWorkFile.uploaded_at, LessonWorkFile.id)
    )).scalars().all())


async def _mark(db: AsyncSession, lesson_id: int, student_id: int) -> Optional[LessonMark]:
    return (await db.execute(select(LessonMark).where(
        LessonMark.lesson_id == lesson_id, LessonMark.student_id == student_id,
    ))).scalar_one_or_none()


def _state(files: list[LessonWorkFile], mark: Optional[LessonMark]) -> WorkState:
    return WorkState(
        status=work_status(bool(files), mark),
        score=mark.score if mark else None,
        submitted_at=files[-1].uploaded_at if files else None,
        files=[WorkFileOut.model_validate(f) for f in files],
    )


async def _my_state(db: AsyncSession, lesson: Lesson, student_id: int) -> MyWorkOut:
    files = await _files(db, lesson.id, student_id)
    mark = await _mark(db, lesson.id, student_id)
    state = _state(files, mark)
    reason = None
    if state.status in ("accepted", "graded"):
        reason = "reviewed"
    elif is_lesson_locked(lesson):
        reason = "day_over"
    return MyWorkOut(**state.model_dump(), is_locked=reason is not None, lock_reason=reason)


async def _student_lesson_for_change(db: AsyncSession, lesson_id: int, user: User) -> Lesson:
    lesson = await get_lesson_for_student(lesson_id, db, user)
    state = await _my_state(db, lesson, user.id)
    if state.lock_reason == "reviewed":
        raise HTTPException(status_code=403, detail="Педагог уже проверил работу — изменить нельзя")
    if state.lock_reason == "day_over":
        raise HTTPException(status_code=403, detail="День урока закончился — сдать работу уже нельзя")
    return lesson


# ---------- Ученик ----------

@router.get("/{lesson_id}/work/my", response_model=MyWorkOut)
async def get_my_work(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lesson = await get_lesson_for_student(lesson_id, db, current_user, write=False)
    state = await _my_state(db, lesson, current_user.id)
    if not state.is_locked and await student_lesson_access(db, lesson, current_user.id) == "readonly":
        # отчислен из группы (архив) — только просмотр
        state.is_locked, state.lock_reason = True, "archived"
    return state


@router.post("/{lesson_id}/work/my/files", response_model=MyWorkOut)
async def upload_my_work(
    background: BackgroundTasks,
    lesson_id: int,
    files: list[UploadFile] = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lesson = await _student_lesson_for_change(db, lesson_id, current_user)
    payloads = [(u, await _read_upload(u)) for u in files]
    for upload, data in payloads:
        key = storage.new_key("lesson-work")
        storage.upload_bytes(key, data, upload.content_type)
        db.add(LessonWorkFile(
            lesson_id=lesson_id, student_id=current_user.id, object_key=key,
            original_filename=upload.filename, content_type=upload.content_type,
            size_bytes=len(data), uploaded_at=_now(),
        ))
    await db.commit()
    background.add_task(send_summaries, [lesson.teacher_id])  # работу проверяет тот, кто ведёт урок
    return await _my_state(db, lesson, current_user.id)


@router.delete("/{lesson_id}/work/my/files/{file_id}", response_model=MyWorkOut)
async def delete_my_work_file(
    lesson_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lesson = await _student_lesson_for_change(db, lesson_id, current_user)
    f = (await db.execute(select(LessonWorkFile).where(
        LessonWorkFile.id == file_id, LessonWorkFile.lesson_id == lesson_id,
        LessonWorkFile.student_id == current_user.id,
    ))).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Файл не найден")
    _safe_delete_object(f.object_key)
    await db.delete(f)
    await db.commit()
    return await _my_state(db, lesson, current_user.id)


# ---------- Педагог ----------

@router.get("/{lesson_id}/work", response_model=WorkBoardOut)
async def get_work_board(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    by_student: dict[int, list[LessonWorkFile]] = {}
    for f in await _files(db, lesson_id):
        by_student.setdefault(f.student_id, []).append(f)
    marks = {m.student_id: m for m in (await db.execute(
        select(LessonMark).where(LessonMark.lesson_id == lesson_id)
    )).scalars().all()}
    rows = []
    for sid, name in await _active_students(db, lesson):
        state = _state(by_student.get(sid, []), marks.get(sid))
        rows.append(WorkRow(student_id=sid, full_name=name, work=state))
    return WorkBoardOut(students=rows, to_review=sum(r.work.status == "submitted" for r in rows))


# «Принять» или оценка (= оценка за урок). Оценку за урок после полуночи меняет
# только админ — то же правило, что в журнале.
@router.put("/{lesson_id}/work/{student_id}/review", response_model=WorkState)
async def review_work(
    lesson_id: int,
    student_id: int,
    data: WorkReviewIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    await _ensure_active_student(db, lesson, student_id)
    if data.grade is None and not data.accepted:
        raise HTTPException(status_code=422, detail="Поставьте оценку или примите работу")
    files = await _files(db, lesson_id, student_id)
    if not files:
        raise HTTPException(status_code=400, detail="Ученик ещё ничего не сдал")
    # Оценку за сданную работу можно ставить и после полуночи (правило — routers/lessons.py)
    mark = await _mark(db, lesson_id, student_id)
    if mark is None:
        mark = LessonMark(lesson_id=lesson_id, student_id=student_id)
        db.add(mark)
    now = _now()
    if data.grade is not None:
        mark.score = data.grade
        mark.marked_by = current_user.id
        mark.marked_at = now
    mark.work_reviewed_at = now
    mark.work_reviewed_by = current_user.id
    await db.commit()
    return _state(files, mark)


# Данные для промпта «Проверка с ИИ» (homework.build_ai_source): задание —
# материалы урока и комментарий педагога к уроку, ответ — файлы работы ученика.
@router.get("/{lesson_id}/work/{student_id}/ai-source", response_model=AiSourceOut)
async def work_ai_source(
    lesson_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    await _ensure_active_student(db, lesson, student_id)
    materials = (await db.execute(
        select(Material)
        .join(LessonResource, (LessonResource.resource_id == Material.id) & (LessonResource.resource_type == "material"))
        .where(LessonResource.lesson_id == lesson_id)
        .order_by(LessonResource.id)
    )).scalars().all()
    items = [("task", m.id, m.original_filename, m.content_type, m.object_key) for m in materials]
    items += [("answer", f.id, f.original_filename, f.content_type, f.object_key) for f in await _files(db, lesson_id, student_id)]
    return await build_ai_source(db, lesson, items, "work")


# ---------- «Проверка ИИ»: пакет на всю группу ----------
# Временный вариант до API: педагог отмечает материалы-задание, скачивает ZIP
# (промпт.md + материалы/ + ученики/<id>_<имя>/), отдаёт его ИИ и вставляет
# ответ — JSON-массив [{"id","good","bad","score"}] — в окно «Проверка ИИ».
# Из данных ученика в пакет идут только id и имя (без фамилии и контактов).

_LANG_NAMES = {"ru": "русский", "az": "азербайджанский", "en": "английский"}


def _safe_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    return name or "file"


def _ai_pack_prompt(lang: str, course: Optional[str], lesson: Lesson, materials: list[tuple[str, Optional[str], bool]],
                    students: list[tuple[int, str, str]]) -> str:
    """materials — (имя файла, текст | None, сокращён); students — (id, имя, папка)."""
    lines = [
        "# Проверка работ, сданных на уроке",
        "",
        "Ты — преподаватель детской IT-академии (ученики 8–14 лет). В этом архиве — задание урока и работы "
        "учеников, которые они сделали и сдали на уроке. Проверь работу КАЖДОГО ученика.",
        "",
        *([f"Курс: {course}."] if course else []),
        f"Урок: {lesson.title}.",
        f"Язык комментариев: {lang}. Пиши \"good\" и \"bad\" только на этом языке.",
        "",
        "## Что в архиве",
        "- `промпт.md` — этот файл; ниже — текст задания.",
        "- `материалы/` — файлы задания как есть (если в задании есть картинки — они там).",
        "- `ученики/<id>_<имя>/` — все файлы одного ученика; id — число в начале имени папки.",
        "",
        "## Как проверять",
        "- Открой файлы каждого ученика и сравни с заданием: что выполнено, что нет, есть ли ошибки.",
        "- Пиши коротко, доброжелательно и понятно ребёнку, обращайся к ученику по имени и на «ты».",
        "- \"good\" — что получилось хорошо, 1–3 конкретные вещи.",
        "- \"bad\" — что плохо или не сделано и как это исправить. Готовое решение за ученика не пиши. "
        "Если замечаний нет — так и напиши.",
        "- \"score\" — целое число от 0 до 100: насколько полно и правильно выполнено задание.",
        "- Если работа не относится к заданию — \"score\": 0, причину напиши в \"bad\".",
        "- Оценивай каждого независимо, не сравнивай учеников между собой.",
        "",
        "## Ученики",
        *[f"- id {sid} — {name} (папка `ученики/{folder}/`)" for sid, name, folder in students],
        "",
        "## Задание",
    ]
    if lesson.comment and lesson.comment.strip():
        lines += ["=== Комментарий педагога к уроку ===", lesson.comment.strip(), ""]
    for name, text, truncated in materials:
        if text:
            lines += [f"=== {name}{' (текст сокращён)' if truncated else ''} ===", text, ""]
        else:
            lines += [f"=== {name} === (текста нет — смотри файл в папке `материалы/`)", ""]
    if not materials and not (lesson.comment and lesson.comment.strip()):
        lines += ["(задание не дано — оцени по работам и названию урока)", ""]
    lines += [
        "## Формат ответа",
        "Ответь ТОЛЬКО одним JSON-массивом — по объекту на каждого ученика из списка, без пояснений, "
        "без markdown и без ```. Строго в таком формате:",
        '[{"id":35,"good":"что получилось хорошо","bad":"что плохо и как исправить","score":85}]',
    ]
    return "\n".join(lines)


@router.get("/{lesson_id}/work/ai-pack")
async def work_ai_pack(
    lesson_id: int,
    material_id: list[int] = Query(default=[]),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    group = await db.get(Group, lesson.group_id)
    course = await db.get(Course, group.course_id) if group else None
    sector = None
    if group and group.sector:
        sector = (await db.execute(select(Sector).where(Sector.code == group.sector))).scalar_one_or_none()
    code = group.sector if group else None
    lang = _LANG_NAMES.get(code) or (sector.name if sector else None) or code or "русский"

    # Отмеченные материалы — только из этого урока
    materials = []
    if material_id:
        materials = list((await db.execute(
            select(Material)
            .join(LessonResource, (LessonResource.resource_id == Material.id) & (LessonResource.resource_type == "material"))
            .where(LessonResource.lesson_id == lesson_id, Material.id.in_(material_id))
            .order_by(LessonResource.id)
        )).scalars().all())

    names = dict(await _active_students(db, lesson))
    files_by_student: dict[int, list[LessonWorkFile]] = {}
    for f in await _files(db, lesson_id):
        if f.student_id in names:
            files_by_student.setdefault(f.student_id, []).append(f)
    if not files_by_student:
        raise HTTPException(status_code=400, detail="На уроке никто не сдал работу")
    # Без задания ИИ оценит «вообще» — такой пакет не отдаём
    if not materials and not (lesson.comment or "").strip():
        raise HTTPException(status_code=400, detail="Задание не выбрано: отметьте материалы урока, которые были заданием")

    def read(key: str) -> Optional[bytes]:
        try:
            return storage.read_object_or_none(key)
        except Exception:
            return None

    mat_data = {m.id: await asyncio.to_thread(read, m.object_key) for m in materials}
    lost = [m.original_filename for m in materials if mat_data[m.id] is None]
    if lost:
        raise HTTPException(
            status_code=400,
            detail=f"Не удалось прочитать: {', '.join(lost)} — отметьте другой файл или снимите отметку",
        )

    def build() -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            budget = AI_TEXT_LIMIT
            mat_texts = []
            used = set()
            for m in materials:
                data = mat_data[m.id]
                name = _safe_name(m.original_filename)
                arc = name if name not in used else f"{m.id}_{name}"
                used.add(arc)
                z.writestr(f"материалы/{arc}", data)
                text = (_ai_text("task", m.original_filename, m.content_type, data) or "").strip()
                truncated = len(text) > budget
                text = text[:max(budget, 0)]
                budget -= len(text)
                mat_texts.append((m.original_filename, text or None, truncated))
            students = []
            for sid in sorted(files_by_student, key=lambda i: names[i]):
                first = (names[sid] or "").split()[0] if (names[sid] or "").split() else str(sid)
                folder = _safe_name(f"{sid}_{first}")
                students.append((sid, first, folder))
                seen = set()
                for f in files_by_student[sid]:
                    data = read(f.object_key)
                    if data is None:
                        continue
                    name = _safe_name(f.original_filename)
                    if name in seen:
                        name = f"{f.id}_{name}"
                    seen.add(name)
                    z.writestr(f"ученики/{folder}/{name}", data)
            z.writestr("промпт.md", _ai_pack_prompt(lang, course.title if course else None, lesson, mat_texts, students))
        return buf.getvalue()

    data = await asyncio.to_thread(build)
    return StreamingResponse(
        iter([data]),
        media_type="application/zip",
        headers={"Content-Disposition": _content_disposition(_safe_name(f"{lesson.title} — проверка ИИ.zip"))},
    )


# Файл работы: ученик — свой, педагог/админ — в доступном уроке.
# inline=1 — посмотреть в браузере, без него — скачать (homework.file_response).
@router.get("/{lesson_id}/work/files/{file_id}/download")
async def download_work_file(
    lesson_id: int,
    file_id: int,
    inline: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = (await db.execute(select(LessonWorkFile).where(
        LessonWorkFile.id == file_id, LessonWorkFile.lesson_id == lesson_id,
    ))).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Файл не найден")
    if current_user.role == "student":
        if f.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нет доступа к файлу")
        await get_lesson_for_student(lesson_id, db, current_user, write=False)
    else:
        await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    return file_response(f.object_key, f.original_filename, f.content_type, inline)
