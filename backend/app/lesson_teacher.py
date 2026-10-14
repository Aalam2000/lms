"""Педагог урока (решение Андрея, 2026-10-06).

У группы есть основной педагог (Group.teacher_id), а у каждого урока — свой
(Lesson.teacher_id): по умолчанию основной, но админ может назначить на урок
или на отрезок уроков другого — замена на один урок, передача группы с
такого-то урока, указание, кто вёл уроки раньше. Статистика и отчёты считают
урок тому, кто у него записан педагогом.

Доступ:
  - основной педагог группы — вся группа и все её уроки, как и раньше;
  - педагог урока, не основной в группе — видит только свои уроки этой
    группы; работать в уроке может до полуночи дня урока (lesson_lock.py),
    после — только смотрит. ДЗ с такого урока проверяет основной педагог.
Назначает педагогов только админ.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .lesson_lock import aware, is_date_locked, lock_cutoff
from .models import Group, Lesson, User
from .days_off import ensure_lessons_allowed

_NO_DATE = datetime.max.replace(tzinfo=timezone.utc)


def is_group_teacher(group_teacher_id: int, user: User) -> bool:
    """Полный доступ к группе: её основной педагог или админ."""
    return user.role == "admin" or group_teacher_id == user.id


def can_view_lesson(lesson: Lesson, group_teacher_id: int, user: User) -> bool:
    return is_group_teacher(group_teacher_id, user) or lesson.teacher_id == user.id


def can_edit_lesson(lesson: Lesson, group_teacher_id: int, user: User) -> bool:
    if is_group_teacher(group_teacher_id, user):
        return True
    return lesson.teacher_id == user.id and not is_date_locked(lesson.date)


def schedule_key(lesson: Lesson):
    """Порядок уроков группы во времени; уроки без даты — в конце."""
    return (aware(lesson.date) if lesson.date else _NO_DATE, lesson.order, lesson.id)


async def assign_teacher(
    db: AsyncSession,
    group: Group,
    teacher_id: int,
    actor: User,
    from_lesson_id: Optional[int] = None,
    to_lesson_id: Optional[int] = None,
) -> int:
    """Назначить педагога на уроки группы с урока from по урок to включительно.

    from не задан — с сегодняшнего дня (уроки без даты тоже); to не задан —
    до конца: тогда педагог становится основным в группе, и новые уроки
    будут создаваться уже на него. Возвращает число изменённых уроков.
    Коммит — на вызывающем.
    """
    teacher = (await db.execute(
        select(User).where(User.id == teacher_id, User.role.in_(["teacher", "admin"]))
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=400, detail="Выберите корректного педагога")

    lessons = sorted(
        (await db.execute(select(Lesson).where(Lesson.group_id == group.id))).scalars().all(),
        key=schedule_key,
    )
    position = {lesson.id: index for index, lesson in enumerate(lessons)}
    for lesson_id in (from_lesson_id, to_lesson_id):
        if lesson_id is not None and lesson_id not in position:
            raise HTTPException(status_code=404, detail="Урок не найден в этой группе")

    if from_lesson_id is not None:
        first = position[from_lesson_id]
    else:
        today = lock_cutoff()
        first = next(
            (i for i, lesson in enumerate(lessons) if lesson.date is None or aware(lesson.date) >= today),
            len(lessons),
        )
    last = position[to_lesson_id] if to_lesson_id is not None else len(lessons) - 1
    if last < first and to_lesson_id is not None:
        raise HTTPException(status_code=400, detail="Последний урок отрезка раньше первого")

    # Урок на выходной педагога ставит только он сам (app/days_off.py)
    await ensure_lessons_allowed(
        db, [(teacher_id, l.date) for l in lessons[first:last + 1] if l.teacher_id != teacher_id], actor,
    )
    changed = 0
    for lesson in lessons[first:last + 1]:
        if lesson.teacher_id != teacher_id:
            lesson.teacher_id = teacher_id
            changed += 1
    if to_lesson_id is None:
        group.teacher_id = teacher_id
    return changed
