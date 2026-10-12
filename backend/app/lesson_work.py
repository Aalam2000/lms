"""Работа на уроке — одно правило статуса для роутера (routers/lesson_work.py),
журнала урока, списка уроков и групп и флага «Проверь работы» в шапке педагога.

Ученик сдаёт файлы во время урока (LessonWorkFile). Оценка за них — это оценка
за урок (LessonMark.score): за урок одна оценка. Статус ученика в уроке:
  none      — файлов нет;
  submitted — файлы есть, педагог ещё не проверил;
  accepted  — проверено без оценки за урок;
  graded    — проверено, оценка за урок стоит.
Проверка = LessonMark.work_reviewed_at: «Принять» или оценка в окне проверки,
или оценка, поставленная в колонке «Оценка», когда файлы уже есть. После
проверки файлы заморожены; до проверки ученик добавляет и удаляет их, пока урок
открыт и не прошла полночь по Баку. «Вернуть на доработку» нет.
"""
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import GroupMember, Lesson, LessonMark, LessonWorkFile


def work_status(has_files: bool, mark: Optional[LessonMark]) -> str:
    if not has_files:
        return "none"
    if mark is None or mark.work_reviewed_at is None:
        return "submitted"
    return "graded" if mark.score is not None else "accepted"


def awaiting_work_review() -> tuple:
    """Условия на LessonWorkFile (запрос с join Lesson): файл ждёт проверки —
    проверки ещё не было, ученик всё ещё в группе урока."""
    reviewed = select(LessonMark.id).where(
        LessonMark.lesson_id == LessonWorkFile.lesson_id,
        LessonMark.student_id == LessonWorkFile.student_id,
        LessonMark.work_reviewed_at.isnot(None),
    ).exists()
    active = select(GroupMember.id).where(
        GroupMember.group_id == Lesson.group_id,
        GroupMember.student_id == LessonWorkFile.student_id,
        GroupMember.status == "active",
    ).exists()
    return (~reviewed, active)


async def _pending_pairs(db: AsyncSession, *where) -> list[tuple[int, int, int]]:
    """(group_id, lesson_id, student_id) — ученики, чья работа на уроке ждёт проверки."""
    return [tuple(row) for row in (await db.execute(
        select(Lesson.group_id, LessonWorkFile.lesson_id, LessonWorkFile.student_id)
        .join(Lesson, Lesson.id == LessonWorkFile.lesson_id)
        .where(*where, *awaiting_work_review())
        .distinct()
    )).all()]


async def work_to_review_by_group(db: AsyncSession, group_ids: Iterable[int]) -> dict[int, int]:
    """group_id → сколько учеников ждут проверки работы на уроке (группы без таких не попадают)."""
    group_ids = list(group_ids)
    if not group_ids:
        return {}
    out: dict[int, int] = {}
    for gid, _, _ in await _pending_pairs(db, Lesson.group_id.in_(group_ids)):
        out[gid] = out.get(gid, 0) + 1
    return out


async def lessons_with_work_to_review(db: AsyncSession, lesson_ids: Iterable[int]) -> set[int]:
    lesson_ids = list(lesson_ids)
    if not lesson_ids:
        return set()
    return {lid for _, lid, _ in await _pending_pairs(db, LessonWorkFile.lesson_id.in_(lesson_ids))}


async def work_to_review_for_teacher(db: AsyncSession, teacher_id: int, group_ids: Iterable[int]) -> dict:
    """Флаг «Проверь работы» в шапке: уроки, которые ведёт этот педагог, в его
    активных группах. count — сколько учеников ждут проверки; lesson_id — урок
    с самым давним непроверенным файлом (с него начинать)."""
    group_ids = list(group_ids)
    if not group_ids:
        return {"count": 0, "lesson_id": None}
    where = (Lesson.group_id.in_(group_ids), Lesson.teacher_id == teacher_id)
    count = len(await _pending_pairs(db, *where))
    if not count:
        return {"count": 0, "lesson_id": None}
    row = (await db.execute(
        select(LessonWorkFile.lesson_id)
        .join(Lesson, Lesson.id == LessonWorkFile.lesson_id)
        .where(*where, *awaiting_work_review())
        .order_by(LessonWorkFile.uploaded_at, LessonWorkFile.id)
        .limit(1)
    )).first()
    return {"count": count, "lesson_id": row[0] if row else None}


async def has_work_files(db: AsyncSession, lesson_id: int, student_id: int) -> bool:
    return (await db.execute(select(LessonWorkFile.id).where(
        LessonWorkFile.lesson_id == lesson_id, LessonWorkFile.student_id == student_id,
    ).limit(1))).first() is not None
