"""Работа на уроке: ученик сдаёт файлы во время урока, педагог смотрит,
скачивает и проверяет — «Принять» или оценка. Оценка — это оценка за урок
(LessonMark.score), за урок она одна. Статусы и подсветки — app/lesson_work.py.

Ученик (вкладка «Работа на уроке»): добавляет несколько файлов и удаляет свои,
пока урок открыт, не прошла полночь по Баку и педагог ещё не проверил.
Педагог (колонка «Файлы с урока» в журнале): права — как у журнала урока.
"""
from datetime import datetime, timezone as dt_timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FastAPIFile, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..database import get_db
from ..dependencies import require_teacher, get_current_user
from ..lesson_work import work_status
from ..models import Lesson, LessonMark, LessonResource, LessonWorkFile, Material, User
from .homework import AiSourceOut, _active_students, _ensure_active_student, _read_upload, build_ai_source, file_response
from .lessons import (
    LOCK_DETAIL, _safe_delete_object, get_lesson_for_student, get_lesson_for_teacher_or_admin,
    is_lesson_locked, lesson_locked_for,
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
    lock_reason: Optional[str] = None  # reviewed | day_over


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
    lesson = await get_lesson_for_student(lesson_id, db, current_user)
    return await _my_state(db, lesson, current_user.id)


@router.post("/{lesson_id}/work/my/files", response_model=MyWorkOut)
async def upload_my_work(
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
    mark = await _mark(db, lesson_id, student_id)
    if data.grade is not None and data.grade != (mark.score if mark else None) and lesson_locked_for(lesson, current_user):
        raise HTTPException(status_code=403, detail=LOCK_DETAIL.format(what="оценку за урок"))
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
        await get_lesson_for_student(lesson_id, db, current_user)
    else:
        await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    return file_response(f.object_key, f.original_filename, f.content_type, inline)
