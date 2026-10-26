"""Домашние задания (claude/homework-plan.md).

ДЗ живёт в таблице «Студенты» урока:
  - «+ ДЗ всем» — задание со student_id = NULL (одна запись; видят все
    активные студенты группы, в т.ч. пришедшие позже);
  - «+ ДЗ» студенту — персональное задание.
  Файлов в ДЗ сколько угодно; ограничение — размер файла (MAX_FILE_SIZE).
Файл задания: из «Базы знаний» или новый. Новый общий → materials/ (в БЗ,
с контролем дублей); новый персональный → homework-tasks/урок/студент/
(Material.is_personal, в БЗ не попадает).

Ответ студента — один на всё ДЗ урока (homework_answers: урок + студент):
файлы (homework-answers/урок/студент/, в БЗ никогда), ОДНА оценка 0–100 и
отметка «принято». Оценка или «принято» = проверено, ответ заморожен;
«вернуть на доработку» снимает и то и другое. Полуночная блокировка урока
на ДЗ и диалог не действует.

Диалог педагог ↔ студент в строке студента (lesson_messages): только
добавление; править можно лишь своё последнее сообщение, пока на него
не ответили.
"""
import asyncio
import logging
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File as FastAPIFile, Form, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..database import get_db
from ..dependencies import require_teacher, get_current_user
from ..models import (
    Course, Group, GroupMember, HomeworkAnswer, HomeworkAnswerFile, HomeworkTask, Lesson, LessonMessage,
    LessonMessageRead, Material, Sector, User,
)
from ..text_extract import extract_text
from ..lesson_dialog import from_student, student_unread, unread_by_dialog
from ..notify import send_summaries
from ..resources import clean_filename, content_hash, find_duplicate_material, find_materials_by_name, conflict
from ..personal import is_participant, lesson_students_condition, student_lesson_access
from ..homework_status import (
    answer_status, effective_deadline as _effective_deadline, expired as _expired, task_is_for as _task_is_for,
)
from .lessons import (
    _safe_delete_object, delete_homework_tasks, get_lesson_for_student, get_lesson_for_teacher_or_admin,
)
from .materials import MAX_FILE_SIZE, _content_disposition, _stored_hash

router = APIRouter(prefix="/lessons", tags=["homework"])
logger = logging.getLogger(__name__)


# ---------- Схемы ----------

class TaskOut(BaseModel):
    id: int
    material_id: int
    title: str
    content_type: Optional[str] = None
    size_bytes: int = 0
    student_id: Optional[int] = None      # NULL — всем
    student_name: Optional[str] = None
    deadline: Optional[datetime] = None
    is_expired: bool = False


class FileOut(BaseModel):
    id: int
    original_filename: str
    content_type: Optional[str] = None
    size_bytes: int
    uploaded_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AnswerState(BaseModel):
    # none — ДЗ не выдано; pending — ждём ответ; expired — срок прошёл, ответа нет;
    # submitted — прислал, проверить; accepted — принято без оценки; graded — оценено
    status: str
    grade: Optional[int] = None
    accepted: bool = False
    deadline: Optional[datetime] = None
    is_locked: bool = False      # студенту менять ответ нельзя
    submitted_at: Optional[datetime] = None
    files: list[FileOut] = []


class LastMessage(BaseModel):
    text: str
    from_teacher: bool
    created_at: Optional[datetime] = None


class BoardRow(BaseModel):
    student_id: int
    full_name: str
    task_ids: list[int]
    answer: AnswerState
    last_message: Optional[LastMessage] = None
    messages_count: int = 0
    unread_count: int = 0  # сколько сообщений ученика текущий педагог не прочитал


class BoardOut(BaseModel):
    tasks: list[TaskOut]
    students: list[BoardRow]
    to_review: int = 0           # ответов, ждущих проверки


class MyHomeworkOut(BaseModel):
    tasks: list[TaskOut]
    answer: AnswerState


class DeadlineIn(BaseModel):
    deadline: Optional[datetime] = None


class ScopeDeadlineIn(BaseModel):
    deadline: Optional[datetime] = None
    student_id: Optional[int] = None  # NULL — срок общих заданий урока, иначе — персональных этого студента


class ReviewIn(BaseModel):
    # Поставить оценку: {grade: 90}; принять без оценки: {accepted: true};
    # вернуть на доработку: {grade: null, accepted: false}
    grade: Optional[int] = Field(default=None, ge=0, le=100)
    accepted: bool = False


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class MessageOut(BaseModel):
    id: int
    author_id: int
    author_name: str
    from_teacher: bool
    is_mine: bool
    can_edit: bool
    text: str
    created_at: Optional[datetime] = None
    edited_at: Optional[datetime] = None


# ---------- Помощники ----------

def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


# Правило статуса ДЗ (_expired, _task_is_for, _effective_deadline, answer_status) —
# в app/homework_status.py, одно на роутер и на отчёт по ученику.

def _answer_state(tasks: list[HomeworkTask], answer: Optional[HomeworkAnswer], files: list[FileOut]) -> AnswerState:
    deadline = _effective_deadline(tasks)
    status = answer_status(tasks, answer, bool(files))
    reviewed = status in ("graded", "accepted")
    return AnswerState(
        status=status,
        grade=answer.grade if answer else None,
        accepted=bool(answer and answer.accepted),
        deadline=deadline,
        # возвращённое на доработку можно править и после срока
        is_locked=reviewed or (status != "returned" and _expired(deadline)) or not tasks,
        submitted_at=answer.updated_at if (answer and files) else None,
        files=files,
    )


async def _task_out(db: AsyncSession, tasks: list[HomeworkTask]) -> dict[int, TaskOut]:
    if not tasks:
        return {}
    materials = {m.id: m for m in (await db.execute(
        select(Material).where(Material.id.in_({t.material_id for t in tasks}))
    )).scalars().all()}
    student_ids = {t.student_id for t in tasks if t.student_id}
    names = {}
    if student_ids:
        names = {uid: (fn or un) for uid, fn, un in (await db.execute(
            select(User.id, User.full_name, User.username).where(User.id.in_(student_ids))
        )).all()}
    out = {}
    for t in tasks:
        m = materials.get(t.material_id)
        out[t.id] = TaskOut(
            id=t.id, material_id=t.material_id,
            title=m.original_filename if m else "—",
            content_type=m.content_type if m else None,
            size_bytes=m.size_bytes if m else 0,
            student_id=t.student_id, student_name=names.get(t.student_id),
            deadline=t.deadline, is_expired=_expired(t.deadline),
        )
    return out


async def _lesson_tasks(db: AsyncSession, lesson_id: int) -> list[HomeworkTask]:
    return list((await db.execute(
        select(HomeworkTask).where(HomeworkTask.lesson_id == lesson_id).order_by(HomeworkTask.created_at, HomeworkTask.id)
    )).scalars().all())


async def _active_students(db: AsyncSession, lesson: Lesson) -> list[tuple[int, str]]:
    rows = (await db.execute(
        select(User.id, User.full_name, User.username)
        .join(GroupMember, GroupMember.student_id == User.id)
        .where(
            GroupMember.group_id == lesson.group_id, GroupMember.status == "active",
            lesson_students_condition(lesson),  # персональный урок — только его участники
        )
        .order_by(User.full_name)
    )).all()
    return [(uid, fn or un) for uid, fn, un in rows]


async def _ensure_active_student(db: AsyncSession, lesson: Lesson, student_id: int) -> None:
    member = (await db.execute(select(GroupMember.id).where(
        GroupMember.group_id == lesson.group_id, GroupMember.student_id == student_id,
        GroupMember.status == "active",
    ))).first()
    if not member or not await is_participant(db, lesson, student_id):
        raise HTTPException(status_code=422, detail="Студент не состоит в группе этого урока")


async def _get_task(db: AsyncSession, lesson_id: int, task_id: int) -> HomeworkTask:
    task = (await db.execute(select(HomeworkTask).where(
        HomeworkTask.id == task_id, HomeworkTask.lesson_id == lesson_id,
    ))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    return task


async def _get_answer(db: AsyncSession, lesson_id: int, student_id: int) -> Optional[HomeworkAnswer]:
    return (await db.execute(select(HomeworkAnswer).where(
        HomeworkAnswer.lesson_id == lesson_id, HomeworkAnswer.student_id == student_id,
    ))).scalar_one_or_none()


async def _answer_files(db: AsyncSession, answer_ids: list[int]) -> dict[int, list[FileOut]]:
    out: dict[int, list[FileOut]] = {}
    if not answer_ids:
        return out
    for f in (await db.execute(
        select(HomeworkAnswerFile).where(HomeworkAnswerFile.answer_id.in_(answer_ids))
        .order_by(HomeworkAnswerFile.uploaded_at, HomeworkAnswerFile.id)
    )).scalars().all():
        out.setdefault(f.answer_id, []).append(FileOut.model_validate(f))
    return out


async def _state_for(db: AsyncSession, lesson_id: int, student_id: int) -> AnswerState:
    tasks = [t for t in await _lesson_tasks(db, lesson_id) if _task_is_for(t, student_id)]
    answer = await _get_answer(db, lesson_id, student_id)
    files = (await _answer_files(db, [answer.id])).get(answer.id, []) if answer else []
    return _answer_state(tasks, answer, files)


async def student_open_items(db: AsyncSession, lesson_ids: list[int], student_id: int) -> dict[int, tuple[Optional[str], int]]:
    """Что в уроке не закрыто у студента (для подсветки на его Главной), пачкой:
    урок → (hw_todo: 'pending' — ДЗ надо сдать | 'returned' — вернули на доработку | None,
             new_messages: непрочитанные сообщения педагога — app/lesson_dialog.py)."""
    out: dict[int, tuple[Optional[str], int]] = {}
    if not lesson_ids:
        return out
    tasks_by_lesson: dict[int, list[HomeworkTask]] = {}
    for t in (await db.execute(select(HomeworkTask).where(HomeworkTask.lesson_id.in_(lesson_ids)))).scalars().all():
        if _task_is_for(t, student_id):
            tasks_by_lesson.setdefault(t.lesson_id, []).append(t)
    answers = {a.lesson_id: a for a in (await db.execute(select(HomeworkAnswer).where(
        HomeworkAnswer.lesson_id.in_(lesson_ids), HomeworkAnswer.student_id == student_id,
    ))).scalars().all()}
    files = await _answer_files(db, [a.id for a in answers.values()])
    unread = await student_unread(db, student_id, lesson_ids)
    for lid in lesson_ids:
        answer = answers.get(lid)
        status = _answer_state(tasks_by_lesson.get(lid, []), answer, files.get(answer.id, []) if answer else []).status
        out[lid] = (status if status in ("pending", "returned") else None, unread.get(lid, 0))
    return out


async def _read_upload(upload: UploadFile) -> bytes:
    upload.filename = clean_filename(upload.filename)  # имя без папок
    data = await upload.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail=f"Пустой файл: {upload.filename}")
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"Файл слишком большой (максимум 50 МБ): {upload.filename}")
    return data


# ---------- Педагог: выдача ----------

# Выдать задание: всем (student_id не передан) или одному студенту.
# Файл — material_id из «Базы знаний» ИЛИ новый file.
@router.post("/{lesson_id}/homework", response_model=TaskOut)
async def create_task(
    background: BackgroundTasks,
    lesson_id: int,
    student_id: Optional[int] = Form(None),
    deadline: Optional[datetime] = Form(None),
    material_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = FastAPIFile(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    if student_id is not None:
        await _ensure_active_student(db, lesson, student_id)
    if (material_id is None) == (file is None):
        raise HTTPException(status_code=422, detail="Выберите файл из Базы знаний или загрузите новый")

    old_key = None  # объект, заменённый новым содержимым, — удалить после коммита
    if material_id is not None:
        material = await db.get(Material, material_id)
        if not material or material.is_personal:
            raise HTTPException(status_code=404, detail="Файл не найден в Базе знаний")
    else:
        data = await _read_upload(file)
        digest = content_hash(data)
        if student_id is None:
            # Общее ДЗ — файл в «Базу знаний» по тому же правилу, что и
            # обычная загрузка (routers/materials.py): имя и содержимое
            # уникальны. То же содержимое — берём существующий файл; то же
            # имя с новым содержимым — заменяем содержимое (админ или автор).
            same_name = await find_materials_by_name(db, file.filename)
            for m in same_name:
                if m.content_hash is None:
                    m.content_hash = await _stored_hash(m)
            identical = next((m for m in same_name if m.content_hash == digest), None)
            duplicate = None if identical else await find_duplicate_material(db, digest)
            if identical:
                material = identical
            elif duplicate:
                material = duplicate[0]
            elif same_name:
                material = same_name[0]
                if current_user.role != "admin" and material.uploaded_by != current_user.id:
                    owner = (await db.execute(
                        select(User.full_name, User.username).where(User.id == material.uploaded_by)
                    )).first()
                    who = (owner[0] or owner[1]) if owner else "—"
                    return conflict(
                        "name_taken",
                        f"В Базе знаний уже есть файл с именем «{file.filename}» (загрузил(а) {who}). "
                        "Заменить его может только автор или администратор — переименуйте свой файл.",
                        material.id,
                    )
                old_key = material.object_key
                material.object_key = storage.new_key("materials")
                storage.upload_bytes(material.object_key, data, file.content_type)
                material.content_type = file.content_type
                material.size_bytes = len(data)
                material.content_hash = digest
            else:
                object_key = storage.new_key("materials")
                storage.upload_bytes(object_key, data, file.content_type)
                material = Material(
                    object_key=object_key, original_filename=file.filename, content_type=file.content_type,
                    size_bytes=len(data), content_hash=digest, uploaded_by=current_user.id,
                )
                db.add(material)
                await db.flush()
        else:
            # Персональное ДЗ — личная папка студента, в «Базу знаний» не попадает
            object_key = storage.new_key("homework-tasks")
            storage.upload_bytes(object_key, data, file.content_type)
            material = Material(
                object_key=object_key, original_filename=file.filename, content_type=file.content_type,
                size_bytes=len(data), content_hash=digest, uploaded_by=current_user.id, is_personal=True,
            )
            db.add(material)
            await db.flush()

    # Срок один на все общие задания урока (и один на персональные задания
    # студента): не передан — берём уже установленный
    if deadline is None:
        deadline = await _scope_deadline(db, lesson_id, student_id)
    # Первое персональное задание без срока — берёт срок общих заданий,
    # иначе у студента ДЗ стало бы бессрочным
    if deadline is None and student_id is not None:
        deadline = await _scope_deadline(db, lesson_id, None)

    task = HomeworkTask(
        lesson_id=lesson_id, material_id=material.id, student_id=student_id,
        deadline=deadline, created_by=current_user.id, created_at=_now(),
    )
    db.add(task)
    await db.commit()
    # уведомление: персональное — одному ученику, общее — всем активным ученикам урока
    background.add_task(send_summaries, [student_id] if student_id is not None else [sid for sid, _ in await _active_students(db, lesson)])
    if old_key:
        try:
            storage.delete_object(old_key)
        except Exception:
            pass  # осиротевший объект в хранилище не мешает работе
    return (await _task_out(db, [task]))[task.id]


def _scope_filter(lesson_id: int, student_id: Optional[int]):
    cond = [HomeworkTask.lesson_id == lesson_id]
    cond.append(HomeworkTask.student_id.is_(None) if student_id is None else HomeworkTask.student_id == student_id)
    return cond


async def _scope_deadline(db: AsyncSession, lesson_id: int, student_id: Optional[int]) -> Optional[datetime]:
    row = (await db.execute(
        select(HomeworkTask.deadline).where(*_scope_filter(lesson_id, student_id), HomeworkTask.deadline.isnot(None)).limit(1)
    )).first()
    return row[0] if row else None


# Срок сразу для всех общих заданий урока (student_id не передан) или для
# всех персональных заданий одного студента.
@router.put("/{lesson_id}/homework/deadline")
async def set_scope_deadline(
    lesson_id: int,
    data: ScopeDeadlineIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    for task in (await db.execute(select(HomeworkTask).where(*_scope_filter(lesson_id, data.student_id)))).scalars().all():
        task.deadline = data.deadline
    await db.commit()
    return {"ok": True}


@router.patch("/{lesson_id}/homework/{task_id}", response_model=TaskOut)
async def set_task_deadline(
    lesson_id: int,
    task_id: int,
    data: DeadlineIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    task = await _get_task(db, lesson_id, task_id)
    task.deadline = data.deadline
    await db.commit()
    return (await _task_out(db, [task]))[task.id]


# Снять задание (с ответами и их файлами; фронт спрашивает подтверждение)
@router.delete("/{lesson_id}/homework/{task_id}")
async def delete_task(
    lesson_id: int,
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    await _get_task(db, lesson_id, task_id)
    await delete_homework_tasks(db, [task_id])
    await db.commit()
    return {"ok": True}


# ---------- Педагог: таблица «Студенты» ----------

@router.get("/{lesson_id}/homework", response_model=BoardOut)
async def get_board(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    tasks = await _lesson_tasks(db, lesson_id)
    tasks_out = await _task_out(db, tasks)

    answers = {a.student_id: a for a in (await db.execute(
        select(HomeworkAnswer).where(HomeworkAnswer.lesson_id == lesson_id)
    )).scalars().all()}
    files = await _answer_files(db, [a.id for a in answers.values()])

    msgs_by_student: dict[int, list[LessonMessage]] = {}
    for m in (await db.execute(
        select(LessonMessage).where(LessonMessage.lesson_id == lesson_id)
        .order_by(LessonMessage.created_at, LessonMessage.id)
    )).scalars().all():
        msgs_by_student.setdefault(m.student_id, []).append(m)
    unread = await unread_by_dialog(db, current_user.id, LessonMessage.lesson_id == lesson_id, from_student())

    rows = []
    to_review = 0
    for sid, name in await _active_students(db, lesson):
        mine = [t for t in tasks if _task_is_for(t, sid)]
        a = answers.get(sid)
        state = _answer_state(mine, a, files.get(a.id, []) if a else [])
        to_review += state.status == "submitted"
        thread = msgs_by_student.get(sid, [])
        last = thread[-1] if thread else None
        rows.append(BoardRow(
            student_id=sid, full_name=name, task_ids=[t.id for t in mine], answer=state,
            last_message=LastMessage(text=last.text, from_teacher=last.author_id != sid, created_at=last.created_at) if last else None,
            messages_count=len(thread), unread_count=unread.get((lesson_id, sid), 0),
        ))
    return BoardOut(tasks=[tasks_out[t.id] for t in tasks], students=rows, to_review=to_review)


# Поставить оценку / принять без оценки / вернуть на доработку — одна
# оценка на всё ДЗ студента в уроке.
@router.put("/{lesson_id}/homework/answers/{student_id}/review", response_model=AnswerState)
async def review_answer(
    lesson_id: int,
    student_id: int,
    data: ReviewIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    await _ensure_active_student(db, lesson, student_id)
    answer = await _get_answer(db, lesson_id, student_id)
    returning = data.grade is None and not data.accepted
    if not returning:
        files = (await _answer_files(db, [answer.id])).get(answer.id, []) if answer else []
        if not files:
            raise HTTPException(status_code=400, detail="Студент ещё ничего не прислал")
    if answer is not None:
        answer.grade = data.grade
        answer.accepted = data.accepted or data.grade is not None
        # при возврате reviewed_at остаётся — это и есть метка «вернули на доработку»
        answer.reviewed_by = current_user.id
        answer.reviewed_at = _now()
        await db.commit()
    return await _state_for(db, lesson_id, student_id)


# ---------- Студент ----------

@router.get("/{lesson_id}/homework/my", response_model=MyHomeworkOut)
async def get_my_homework(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lesson = await get_lesson_for_student(lesson_id, db, current_user, write=False)
    tasks = [t for t in await _lesson_tasks(db, lesson_id) if _task_is_for(t, current_user.id)]
    tasks_out = await _task_out(db, tasks)
    answer = await _state_for(db, lesson_id, current_user.id)
    if await student_lesson_access(db, lesson, current_user.id) == "readonly":
        answer.is_locked = True  # отчислен из группы (архив) — только просмотр
    return MyHomeworkOut(tasks=[tasks_out[t.id] for t in tasks], answer=answer)


@router.post("/{lesson_id}/homework/my/files", response_model=MyHomeworkOut)
async def upload_my_files(
    background: BackgroundTasks,
    lesson_id: int,
    files: list[UploadFile] = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lesson = await get_lesson_for_student(lesson_id, db, current_user)
    state = await _state_for(db, lesson_id, current_user.id)
    if state.is_locked:
        raise HTTPException(status_code=403, detail="Ответ уже проверен или срок сдачи истёк — изменить нельзя")
    payloads = [(u, await _read_upload(u)) for u in files]
    answer = await _get_answer(db, lesson_id, current_user.id)
    if answer is None:
        answer = HomeworkAnswer(lesson_id=lesson_id, student_id=current_user.id)
        db.add(answer)
        await db.flush()
    for upload, data in payloads:
        key = storage.new_key("homework-answers")
        storage.upload_bytes(key, data, upload.content_type)
        db.add(HomeworkAnswerFile(
            answer_id=answer.id, object_key=key, original_filename=upload.filename,
            content_type=upload.content_type, size_bytes=len(data), uploaded_at=_now(),
        ))
    answer.updated_at = _now()
    # новый файл после возврата — ответ снова ждёт проверки
    answer.reviewed_by = None
    answer.reviewed_at = None
    await db.commit()
    # ДЗ проверяет основной педагог группы — уведомление ему
    background.add_task(send_summaries, [(await db.get(Group, lesson.group_id)).teacher_id])
    return await get_my_homework(lesson_id, db, current_user)


@router.delete("/{lesson_id}/homework/my/files/{file_id}", response_model=MyHomeworkOut)
async def delete_my_file(
    lesson_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_lesson_for_student(lesson_id, db, current_user)
    state = await _state_for(db, lesson_id, current_user.id)
    if state.is_locked:
        raise HTTPException(status_code=403, detail="Ответ уже проверен или срок сдачи истёк — изменить нельзя")
    answer = await _get_answer(db, lesson_id, current_user.id)
    f = None
    if answer:
        f = (await db.execute(select(HomeworkAnswerFile).where(
            HomeworkAnswerFile.id == file_id, HomeworkAnswerFile.answer_id == answer.id,
        ))).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Файл не найден")
    _safe_delete_object(f.object_key)
    await db.delete(f)
    await db.commit()
    return await get_my_homework(lesson_id, db, current_user)


# Файлы, которые браузер может показать как текст (код, заметки)
_TEXT_EXT = {".py", ".txt", ".md", ".csv", ".json", ".js", ".ts", ".css", ".html", ".htm", ".xml",
             ".java", ".c", ".cpp", ".h", ".cs", ".php", ".rb", ".go", ".sql", ".sh", ".yml", ".yaml", ".ini", ".log"}


def file_response(object_key: str, filename: str, content_type: Optional[str], inline: bool) -> StreamingResponse:
    """Файл ученика (ответ на ДЗ, работа на уроке). inline=True — для просмотра
    в браузере (панель проверки, новая вкладка): картинки и PDF отдаются как
    есть, код/текст — как text/plain (чтобы чужой HTML/JS никогда не
    исполнялся), остальное — обычным скачиванием. inline=False — скачать."""
    if not storage.exists(object_key):
        raise HTTPException(status_code=404, detail="Файл не найден на диске — загрузите его заново")
    media_type = content_type or "application/octet-stream"
    disposition = "attachment"
    if inline:
        ext = Path(filename).suffix.lower()
        if media_type.startswith("image/") and media_type != "image/svg+xml" or media_type == "application/pdf":
            disposition = "inline"
        elif ext in _TEXT_EXT or media_type.startswith("text/"):
            media_type, disposition = "text/plain; charset=utf-8", "inline"
    return StreamingResponse(
        storage.stream_object(object_key),
        media_type=media_type,
        headers={"Content-Disposition": _content_disposition(filename, disposition)},
    )


# Файл ответа: студент — свой, педагог/admin — в своём уроке (просмотр или скачать — file_response).
@router.get("/{lesson_id}/homework/answer-files/{file_id}/download")
async def download_answer_file(
    lesson_id: int,
    file_id: int,
    inline: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(HomeworkAnswerFile, HomeworkAnswer.student_id)
        .join(HomeworkAnswer, HomeworkAnswer.id == HomeworkAnswerFile.answer_id)
        .where(HomeworkAnswerFile.id == file_id, HomeworkAnswer.lesson_id == lesson_id)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Файл не найден")
    f, owner_id = row
    if current_user.role == "student":
        if owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нет доступа к файлу")
        await get_lesson_for_student(lesson_id, db, current_user, write=False)
    else:
        await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    return file_response(f.object_key, f.original_filename, f.content_type, inline)


# ---------- Педагог: данные для промпта «Проверка с ИИ» ----------
# Одно на ДЗ и на работу на уроке (routers/lesson_work.py — build_ai_source).
# Без трат на API (как Помощник квиза): фронт собирает из этих данных промпт,
# педагог сам отдаёт его любому ИИ и вставляет ответ-JSON обратно. Имя
# студента в промпт не идёт. Картинки и PDF ответа текста не дают — их
# педагог скачивает и прикладывает к запросу сам (text = None).

AI_TEXT_LIMIT = 40000  # всего символов текста в промпте: бесплатные ИИ не примут больше


class AiFileOut(BaseModel):
    kind: str                     # task — файл задания (id = material_id) | answer — файл ответа (id файла)
    id: int
    filename: str
    content_type: Optional[str] = None
    text: Optional[str] = None    # None — текст не достать, файл прикладывается к запросу вручную
    truncated: bool = False


class AiSourceOut(BaseModel):
    mode: str = "homework"        # homework — ответ на ДЗ | work — работа на уроке (задание — материалы урока)
    lang: Optional[str] = None    # код сектора группы — на этом языке пишется комментарий
    sector_name: Optional[str] = None
    course: Optional[str] = None
    lesson_title: str
    lesson_comment: Optional[str] = None  # комментарий педагога к уроку (работа на уроке)
    files: list[AiFileOut]


def _ai_text(kind: str, filename: str, content_type: Optional[str], data: bytes) -> Optional[str]:
    ext = Path(filename).suffix.lower()
    ctype = content_type or ""
    if ctype.startswith("image/"):
        return None
    if ext == ".pdf" and kind == "answer":
        return None  # PDF ответа (часто скан) — приложить к запросу
    # HTML задания — только суть (text_extract); HTML ответа — код целиком, его и проверяем
    if ext in (".docx", ".pptx", ".pdf") or (kind == "task" and ext in (".html", ".htm")):
        try:
            return extract_text(filename, data)
        except Exception:
            return None
    if ext in _TEXT_EXT or ctype.startswith("text/"):
        return data.decode("utf-8", errors="replace")
    return None


# items — (kind, id, имя, content_type, object_key): задания и ответ. Лимит
# текста тратится сначала на ответ ученика, остаток — на задание.
async def build_ai_source(db: AsyncSession, lesson: Lesson, items: list[tuple], mode: str) -> AiSourceOut:
    group = await db.get(Group, lesson.group_id)
    course = await db.get(Course, group.course_id) if group else None
    sector = None
    if group and group.sector:
        sector = (await db.execute(select(Sector).where(Sector.code == group.sector))).scalar_one_or_none()

    budget = AI_TEXT_LIMIT
    by_index: dict[int, AiFileOut] = {}
    order = sorted(range(len(items)), key=lambda i: items[i][0] != "answer")
    for i in order:
        kind, fid, name, ctype, key = items[i]
        # Файл не читается (нет на диске, путь старого формата) — промпт всё
        # равно собирается, файл просто попадает в список «приложить вручную»
        try:
            data = await asyncio.to_thread(storage.read_object_or_none, key)
            text = (await asyncio.to_thread(_ai_text, kind, name, ctype, data) or "").strip() if data else ""
        except Exception:
            logger.warning("ai-source: файл %s (%s) не прочитан", name, key, exc_info=True)
            text = ""
        truncated = False
        if text and len(text) > budget:
            text, truncated = text[:max(budget, 0)], True
        budget -= len(text)
        by_index[i] = AiFileOut(kind=kind, id=fid, filename=name, content_type=ctype, text=text or None, truncated=truncated)
    return AiSourceOut(
        mode=mode,
        lang=group.sector if group else None,
        sector_name=sector.name if sector else None,
        course=course.title if course else None,
        lesson_title=lesson.title,
        lesson_comment=(lesson.comment or "").strip() or None if mode == "work" else None,
        files=[by_index[i] for i in range(len(items))],
    )


@router.get("/{lesson_id}/homework/answers/{student_id}/ai-source", response_model=AiSourceOut)
async def ai_source(
    lesson_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    await _ensure_active_student(db, lesson, student_id)
    tasks = [t for t in await _lesson_tasks(db, lesson_id) if _task_is_for(t, student_id)]
    materials = {m.id: m for m in (await db.execute(
        select(Material).where(Material.id.in_({t.material_id for t in tasks}))
    )).scalars().all()} if tasks else {}
    items = []
    seen = set()
    for t in tasks:
        m = materials.get(t.material_id)
        if m and m.id not in seen:
            seen.add(m.id)
            items.append(("task", m.id, m.original_filename, m.content_type, m.object_key))
    answer = await _get_answer(db, lesson_id, student_id)
    if answer:
        for f in (await db.execute(
            select(HomeworkAnswerFile).where(HomeworkAnswerFile.answer_id == answer.id)
            .order_by(HomeworkAnswerFile.uploaded_at, HomeworkAnswerFile.id)
        )).scalars().all():
            items.append(("answer", f.id, f.original_filename, f.content_type, f.object_key))
    return await build_ai_source(db, lesson, items, "homework")


# ---------- Диалог педагог ↔ студент в строке студента ----------

async def _thread_access(db: AsyncSession, lesson_id: int, student_id: int, user: User, write: bool = True) -> None:
    if user.role == "student":
        if student_id != user.id:
            raise HTTPException(status_code=403, detail="Нет доступа")
        await get_lesson_for_student(lesson_id, db, user, write=write)
    else:
        lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, user, write=write)
        await _ensure_active_student(db, lesson, student_id)


async def _thread(db: AsyncSession, lesson_id: int, student_id: int) -> list[LessonMessage]:
    return list((await db.execute(
        select(LessonMessage).where(LessonMessage.lesson_id == lesson_id, LessonMessage.student_id == student_id)
        .order_by(LessonMessage.created_at, LessonMessage.id)
    )).scalars().all())


async def _mark_read(db: AsyncSession, lesson_id: int, student_id: int, user_id: int, last_id: int) -> None:
    """Диалог прочитан человеком до сообщения last_id (отметка только растёт)."""
    stmt = pg_insert(LessonMessageRead).values(
        lesson_id=lesson_id, student_id=student_id, user_id=user_id, last_read_id=last_id, read_at=_now(),
    )
    await db.execute(stmt.on_conflict_do_update(
        index_elements=[LessonMessageRead.lesson_id, LessonMessageRead.student_id, LessonMessageRead.user_id],
        set_={"last_read_id": func.greatest(LessonMessageRead.last_read_id, stmt.excluded.last_read_id),
              "read_at": stmt.excluded.read_at},
    ))


async def _thread_out(db: AsyncSession, thread: list[LessonMessage], student_id: int, user: User) -> list[MessageOut]:
    author_ids = {m.author_id for m in thread}
    names = {}
    if author_ids:
        names = {uid: (fn or un) for uid, fn, un in (await db.execute(
            select(User.id, User.full_name, User.username).where(User.id.in_(author_ids))
        )).all()}
    last_id = thread[-1].id if thread else None
    return [MessageOut(
        id=m.id, author_id=m.author_id, author_name=names.get(m.author_id, "—"),
        from_teacher=m.author_id != student_id, is_mine=m.author_id == user.id,
        can_edit=m.author_id == user.id and m.id == last_id,
        text=m.text, created_at=m.created_at, edited_at=m.edited_at,
    ) for m in thread]


@router.get("/{lesson_id}/messages/{student_id}", response_model=list[MessageOut])
async def get_messages(
    lesson_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _thread_access(db, lesson_id, student_id, current_user, write=False)
    thread = await _thread(db, lesson_id, student_id)
    if thread:  # открыл переписку — прочитал всё, что в ней есть
        await _mark_read(db, lesson_id, student_id, current_user.id, thread[-1].id)
        await db.commit()
    return await _thread_out(db, thread, student_id, current_user)


@router.post("/{lesson_id}/messages/{student_id}", response_model=list[MessageOut])
async def add_message(
    background: BackgroundTasks,
    lesson_id: int,
    student_id: int,
    data: MessageIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _thread_access(db, lesson_id, student_id, current_user)
    text = data.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Пустое сообщение")
    msg = LessonMessage(lesson_id=lesson_id, student_id=student_id, author_id=current_user.id, text=text, created_at=_now())
    db.add(msg)
    await db.flush()
    await _mark_read(db, lesson_id, student_id, current_user.id, msg.id)  # написал — значит, видел всё до этого
    await db.commit()
    # уведомление: написал ученик — основному педагогу группы и ведущему урок; педагог — ученику
    if current_user.id == student_id:
        lesson = await db.get(Lesson, lesson_id)
        recipients = [(await db.get(Group, lesson.group_id)).teacher_id, lesson.teacher_id]
    else:
        recipients = [student_id]
    background.add_task(send_summaries, [uid for uid in recipients if uid != current_user.id])
    return await _thread_out(db, await _thread(db, lesson_id, student_id), student_id, current_user)


# Править можно только своё последнее сообщение, пока на него не ответили
@router.patch("/{lesson_id}/messages/{student_id}/{message_id}", response_model=list[MessageOut])
async def edit_message(
    lesson_id: int,
    student_id: int,
    message_id: int,
    data: MessageIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _thread_access(db, lesson_id, student_id, current_user)
    thread = await _thread(db, lesson_id, student_id)
    if not thread or thread[-1].id != message_id or thread[-1].author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Править можно только своё последнее сообщение, пока на него не ответили")
    text = data.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Пустое сообщение")
    thread[-1].text = text
    thread[-1].edited_at = _now()
    await db.commit()
    return await _thread_out(db, thread, student_id, current_user)
