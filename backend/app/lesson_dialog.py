"""Диалог педагог ↔ ученик: что человек ещё не прочитал.

Отметку «прочитано до сообщения N» (LessonMessageRead) ставит
routers/homework.py, когда человек открыл переписку или сам написал в неё.
Непрочитанное — чужие сообщения диалога с id больше отметки.

Педагогу считаются диалоги уроков, которые он ведёт, и уроков его активных
групп — основной педагог и замена видят одно и то же; только сообщения самого
ученика (реплики другого педагога в том же диалоге — не «новое») и только
с активными учениками группы (с отчисленным переписка закрыта)."""
from typing import Iterable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Group, GroupMember, Lesson, LessonMessage, LessonMessageRead


def unread_condition(user_id: int) -> tuple:
    """Условия на LessonMessage: сообщение чужое и после отметки «прочитано» этого человека."""
    last_read = select(LessonMessageRead.last_read_id).where(
        LessonMessageRead.lesson_id == LessonMessage.lesson_id,
        LessonMessageRead.student_id == LessonMessage.student_id,
        LessonMessageRead.user_id == user_id,
    ).scalar_subquery()
    return (LessonMessage.author_id != user_id, LessonMessage.id > func.coalesce(last_read, 0))


def from_student():
    """Условие на LessonMessage: сообщение написал сам ученик (для счётчиков педагога)."""
    return LessonMessage.author_id == LessonMessage.student_id


async def unread_by_dialog(db: AsyncSession, user_id: int, *where) -> dict[tuple[int, int], int]:
    """(урок, ученик) → сколько сообщений человек не прочитал (диалоги без непрочитанного не попадают)."""
    rows = await db.execute(
        select(LessonMessage.lesson_id, LessonMessage.student_id, func.count())
        .where(*unread_condition(user_id), *where)
        .group_by(LessonMessage.lesson_id, LessonMessage.student_id)
    )
    return {(lid, sid): n for lid, sid, n in rows.all()}


async def student_unread(db: AsyncSession, student_id: int, lesson_ids: Iterable[int]) -> dict[int, int]:
    """Урок → непрочитанные сообщения педагога в диалоге ученика."""
    lesson_ids = list(lesson_ids)
    if not lesson_ids:
        return {}
    unread = await unread_by_dialog(
        db, student_id, LessonMessage.student_id == student_id, LessonMessage.lesson_id.in_(lesson_ids),
    )
    return {lid: n for (lid, _), n in unread.items()}


def teacher_dialogs(teacher_id: int):
    """Запрос по LessonMessage, ограниченный диалогами педагога (см. описание модуля)."""
    return (
        select(LessonMessage)
        .join(Lesson, Lesson.id == LessonMessage.lesson_id)
        .join(Group, Group.id == Lesson.group_id)
        .join(GroupMember, and_(
            GroupMember.group_id == Lesson.group_id, GroupMember.student_id == LessonMessage.student_id,
        ))
        .where(
            Group.status == "active", GroupMember.status == "active",
            or_(Lesson.teacher_id == teacher_id, Group.teacher_id == teacher_id),
            from_student(), *unread_condition(teacher_id),
        )
    )


async def teacher_unread(db: AsyncSession, teacher_id: int) -> dict:
    """Флаг «Сообщения» в шапке педагога: count — непрочитанные сообщения учеников;
    lesson_id — урок с самым давним из них (с него начинать)."""
    q = teacher_dialogs(teacher_id)
    count = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    if not count:
        return {"count": 0, "lesson_id": None}
    lesson_id = (await db.execute(
        q.with_only_columns(LessonMessage.lesson_id)
        .order_by(LessonMessage.created_at, LessonMessage.id).limit(1)
    )).scalar()
    return {"count": count, "lesson_id": lesson_id}
