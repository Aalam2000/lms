"""Персональные уроки — единое правило «кто ученики этого урока».

Персональный урок (Lesson.is_personal) остаётся уроком своей группы, но у него
свой список участников (lesson_students). Отсюда:
  - видят урок только участники (плюс педагог группы и админ);
  - журнал, посещаемость, ДЗ и live-квиз считают учениками только участников —
    остальным ученикам группы пропуск не ставится;
  - в нумерацию «Урок N» и массовые действия (заполнить материалами, открыть
    с № по №, удалить расписание, «выходной») такие уроки не входят.
Обычный урок: ученики = активные участники группы, как раньше.

Все проверки «кто ученик урока» идут через этот модуль — в роутерах своих
вариантов не пишем.
"""
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import and_, delete, exists, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from .models import GroupMember, HomeworkAnswer, Lesson, LessonMark, LessonStudent, LessonWorkFile, User


def visible_to_student(student_id: int):
    """Условие для запросов по Lesson: обычный урок или персональный, где ученик — участник."""
    return or_(
        Lesson.is_personal.is_(False),
        Lesson.id.in_(select(LessonStudent.lesson_id).where(LessonStudent.student_id == student_id)),
    )


def membership_visible():
    """Условие на GroupMember (вместе с Lesson): ученик видит урок группы, если он
    в ней активен или отчислен (архив) — тогда только уроки до отчисления и только
    для просмотра: сдавать, писать и оценивать урок отчисленный не может."""
    return or_(
        GroupMember.status == "active",
        and_(
            GroupMember.status == "expelled",
            GroupMember.expelled_at.isnot(None),
            Lesson.date < GroupMember.expelled_at,
        ),
    )


def student_lesson_scope(student_id: int):
    """Условие для запросов по Lesson: уроки групп ученика, которые он может смотреть."""
    return exists().where(
        GroupMember.group_id == Lesson.group_id,
        GroupMember.student_id == student_id,
        membership_visible(),
    )


async def student_lesson_access(db: AsyncSession, lesson: Lesson, student_id: int):
    """"active" — ученик группы урока; "readonly" — отчислен, урок до отчисления
    (только просмотр); None — урок ему недоступен. Персональный — отдельно (is_participant)."""
    member = (await db.execute(select(GroupMember.status, GroupMember.expelled_at).where(
        GroupMember.group_id == lesson.group_id, GroupMember.student_id == student_id,
        GroupMember.status.in_(("active", "expelled")),
    ))).first()
    if not member:
        return None
    status, expelled_at = member
    if status == "active":
        return "active"
    if expelled_at and lesson.date and lesson.date < expelled_at:
        return "readonly"
    return None


def lesson_students_condition(lesson: Lesson):
    """Условие на User.id для запросов «ученики урока» (в дополнение к активному членству в группе)."""
    if not lesson.is_personal:
        return true()
    return User.id.in_(select(LessonStudent.student_id).where(LessonStudent.lesson_id == lesson.id))


async def is_participant(db: AsyncSession, lesson: Lesson, student_id: int) -> bool:
    """Может ли ученик видеть урок (членство в группе проверяется отдельно)."""
    if not lesson.is_personal:
        return True
    row = await db.execute(select(LessonStudent.lesson_id).where(
        LessonStudent.lesson_id == lesson.id, LessonStudent.student_id == student_id,
    ))
    return row.first() is not None


async def participants_by_lesson(db: AsyncSession, lesson_ids: Iterable[int]) -> dict[int, set[int]]:
    """lesson_id → id участников (только для переданных уроков; обычных уроков в ответе нет)."""
    lesson_ids = list(lesson_ids)
    out: dict[int, set[int]] = {}
    if not lesson_ids:
        return out
    rows = await db.execute(
        select(LessonStudent.lesson_id, LessonStudent.student_id).where(LessonStudent.lesson_id.in_(lesson_ids))
    )
    for lesson_id, student_id in rows.all():
        out.setdefault(lesson_id, set()).add(student_id)
    return out


async def lesson_student_ids(db: AsyncSession, lesson: Lesson) -> set[int]:
    """Id учеников урока: активные участники группы; у персонального — только его участники."""
    rows = await db.execute(
        select(User.id)
        .join(GroupMember, GroupMember.student_id == User.id)
        .where(
            GroupMember.group_id == lesson.group_id,
            GroupMember.status == "active",
            lesson_students_condition(lesson),
        )
    )
    return {row[0] for row in rows.all()}


async def participant_names(db: AsyncSession, lesson_ids: Iterable[int]) -> dict[int, list[dict]]:
    """lesson_id → [{id, full_name}] по алфавиту — подпись персонального урока у педагога."""
    lesson_ids = list(lesson_ids)
    out: dict[int, list[dict]] = {}
    if not lesson_ids:
        return out
    rows = await db.execute(
        select(LessonStudent.lesson_id, User.id, User.full_name, User.username)
        .join(User, User.id == LessonStudent.student_id)
        .where(LessonStudent.lesson_id.in_(lesson_ids))
        .order_by(User.full_name, User.username)
    )
    for lesson_id, uid, full_name, username in rows.all():
        out.setdefault(lesson_id, []).append({"id": uid, "full_name": full_name or username})
    return out


async def set_participants(db: AsyncSession, lesson: Lesson, student_ids: Iterable[int]) -> None:
    """Задать состав участников персонального урока (без commit).

    Участники — только активные ученики группы урока, хотя бы один. Убрать
    ученика, у которого в этом уроке уже есть отметка, решение ДЗ или работа на уроке, нельзя.
    """
    wanted = set(student_ids)
    if not wanted:
        raise HTTPException(status_code=422, detail="Выберите хотя бы одного ученика")

    active = {row[0] for row in (await db.execute(
        select(GroupMember.student_id).where(
            GroupMember.group_id == lesson.group_id, GroupMember.status == "active",
        )
    )).all()}
    if not wanted.issubset(active):
        raise HTTPException(status_code=422, detail="Участником может быть только ученик этой группы")

    current = (await participants_by_lesson(db, [lesson.id])).get(lesson.id, set()) if lesson.id else set()
    removed = current - wanted
    if removed:
        has_marks = (await db.execute(select(LessonMark.student_id).where(
            LessonMark.lesson_id == lesson.id, LessonMark.student_id.in_(removed),
        ))).first()
        has_answers = (await db.execute(select(HomeworkAnswer.student_id).where(
            HomeworkAnswer.lesson_id == lesson.id, HomeworkAnswer.student_id.in_(removed),
        ))).first()
        has_work = (await db.execute(select(LessonWorkFile.student_id).where(
            LessonWorkFile.lesson_id == lesson.id, LessonWorkFile.student_id.in_(removed),
        ))).first()
        if has_marks or has_answers or has_work:
            raise HTTPException(
                status_code=409,
                detail="Нельзя убрать ученика: у него в этом уроке уже есть отметка, решение ДЗ или работа на уроке",
            )
        await db.execute(delete(LessonStudent).where(
            LessonStudent.lesson_id == lesson.id, LessonStudent.student_id.in_(removed),
        ))
    for student_id in wanted - current:
        db.add(LessonStudent(lesson_id=lesson.id, student_id=student_id))
