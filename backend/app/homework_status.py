"""Статус домашнего задания ученика — одно правило для всех экранов
(роутер ДЗ routers/homework.py, отчёт по ученику student_report.py).

ДЗ ученика в уроке = общие задания урока + его персональные. Ответ один на
всё ДЗ урока. Статус:
  none      — ДЗ не выдано;
  graded    — оценено; accepted — принято без оценки;
  returned  — педагог вернул на доработку (проверка была, оценки и «принято» нет);
  submitted — ответ прислан, ждёт проверки;
  expired   — ответа нет, срок прошёл; pending — ответа нет, срок не прошёл.
"""
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .lesson_lock import aware, baku_day
from .models import GroupMember, HomeworkAnswer, HomeworkAnswerFile, HomeworkTask, Lesson
from .personal import participants_by_lesson, visible_to_student


def expired(deadline: Optional[datetime]) -> bool:
    if deadline is None:
        return False
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > deadline


def task_is_for(task: HomeworkTask, student_id: int) -> bool:
    return task.student_id is None or task.student_id == student_id


def effective_deadline(tasks: list[HomeworkTask]) -> Optional[datetime]:
    """Срок всего ДЗ студента: самый поздний из сроков его заданий; если у
    какого-то задания срока нет — срока нет."""
    if not tasks or any(t.deadline is None for t in tasks):
        return None
    return max(t.deadline for t in tasks)


def answer_status(tasks: list[HomeworkTask], answer: Optional[HomeworkAnswer], has_files: bool) -> str:
    if not tasks:
        return "none"
    if answer is not None and answer.grade is not None:
        return "graded"
    if answer is not None and answer.accepted:
        return "accepted"
    if answer is not None and answer.reviewed_at is not None:
        # педагог вернул на доработку (оценки нет, «принято» нет, но проверка была);
        # снова «submitted» — когда студент загрузит новый файл
        return "returned"
    if has_files:
        return "submitted"
    return "expired" if expired(effective_deadline(tasks)) else "pending"


def awaiting_review() -> tuple:
    """Условия на HomeworkAnswer: ответ прислан (есть файл) и ждёт проверки —
    оценки нет, «принято» нет, на доработку не возвращён. По ним подсвечиваются
    урок, группа и флаг «Проверь ДЗ» у педагога, считается очередь в отчёте."""
    return (
        HomeworkAnswer.grade.is_(None),
        HomeworkAnswer.accepted == False,  # noqa: E712
        HomeworkAnswer.reviewed_at.is_(None),
        select(HomeworkAnswerFile.id).where(HomeworkAnswerFile.answer_id == HomeworkAnswer.id).exists(),
    )


async def to_review_by_group(db: AsyncSession, group_ids: Iterable[int]) -> dict[int, int]:
    """group_id → сколько ответов на ДЗ ждут проверки (группы без таких ответов не попадают)."""
    group_ids = list(group_ids)
    if not group_ids:
        return {}
    rows = await db.execute(
        select(Lesson.group_id, func.count(HomeworkAnswer.id))
        .join(Lesson, Lesson.id == HomeworkAnswer.lesson_id)
        .where(Lesson.group_id.in_(group_ids), *awaiting_review())
        .group_by(Lesson.group_id)
    )
    return {gid: count for gid, count in rows.all()}


async def oldest_lesson_to_review(db: AsyncSession, group_ids: Iterable[int]) -> Optional[int]:
    """Урок с самым давним ответом, который ждёт проверки, — с него начинать."""
    group_ids = list(group_ids)
    if not group_ids:
        return None
    row = (await db.execute(
        select(HomeworkAnswer.lesson_id)
        .join(Lesson, Lesson.id == HomeworkAnswer.lesson_id)
        .where(Lesson.group_id.in_(group_ids), *awaiting_review())
        .order_by(HomeworkAnswer.updated_at, HomeworkAnswer.id)
        .limit(1)
    )).first()
    return row[0] if row else None


async def student_homework(db: AsyncSession, lesson_ids: Iterable[int], student_id: int) -> dict[int, dict]:
    """ДЗ ученика по урокам, пачкой: lesson_id → {status, grade, deadline}."""
    lesson_ids = list(lesson_ids)
    if not lesson_ids:
        return {}
    tasks_by_lesson: dict[int, list[HomeworkTask]] = {}
    for t in (await db.execute(select(HomeworkTask).where(HomeworkTask.lesson_id.in_(lesson_ids)))).scalars().all():
        if task_is_for(t, student_id):
            tasks_by_lesson.setdefault(t.lesson_id, []).append(t)
    answers = {a.lesson_id: a for a in (await db.execute(select(HomeworkAnswer).where(
        HomeworkAnswer.lesson_id.in_(lesson_ids), HomeworkAnswer.student_id == student_id,
    ))).scalars().all()}
    with_files: set[int] = set()
    if answers:
        with_files = {row[0] for row in (await db.execute(
            select(HomeworkAnswerFile.answer_id)
            .where(HomeworkAnswerFile.answer_id.in_([a.id for a in answers.values()])).distinct()
        )).all()}
    out = {}
    for lid in lesson_ids:
        tasks = tasks_by_lesson.get(lid, [])
        answer = answers.get(lid)
        out[lid] = {
            "status": answer_status(tasks, answer, bool(answer and answer.id in with_files)),
            "grade": answer.grade if answer else None,
            "deadline": effective_deadline(tasks),
        }
    return out


async def last_homework_debts(
    db: AsyncSession, group_ids: Iterable[int], student_ids: Iterable[int],
) -> dict[int, str]:
    """Долг по последнему ДЗ (подсветка имени в «Студентах»): student_id → pending | overdue.

    Последнее ДЗ — самый поздний уже начавшийся урок группы, где ученику выдано
    задание (общее или персональное). Урок до дня вступления в группу и
    персональный урок без этого ученика не в счёт. pending — ответа нет или ДЗ
    возвращено на доработку; overdue — то же, но срок сдачи прошёл. Ответ прислан,
    оценён или принят — долга нет. Групп несколько — берётся худшее."""
    group_ids, student_ids = list(group_ids), list(student_ids)
    if not group_ids or not student_ids:
        return {}

    now = datetime.now(timezone.utc)
    lessons = [
        row for row in (await db.execute(
            select(Lesson.id, Lesson.group_id, Lesson.date, Lesson.is_personal)
            .where(Lesson.group_id.in_(group_ids), Lesson.date.isnot(None))
        )).all()
        if aware(row[2]) <= now
    ]
    if not lessons:
        return {}
    tasks_by_lesson: dict[int, list[HomeworkTask]] = {}
    for t in (await db.execute(
        select(HomeworkTask).where(HomeworkTask.lesson_id.in_([row[0] for row in lessons]))
    )).scalars().all():
        tasks_by_lesson.setdefault(t.lesson_id, []).append(t)
    if not tasks_by_lesson:
        return {}

    # Уроки с заданиями — от поздних к ранним, по группам
    by_group: dict[int, list] = {}
    for lesson_id, gid, lesson_date, is_personal in sorted(lessons, key=lambda r: (aware(r[2]), r[0]), reverse=True):
        if lesson_id in tasks_by_lesson:
            by_group.setdefault(gid, []).append((lesson_id, lesson_date, is_personal))
    participants = await participants_by_lesson(
        db, [lid for rows in by_group.values() for lid, _, personal in rows if personal]
    )

    # Последний урок с ДЗ для каждой пары (ученик, группа)
    last: list[tuple[int, int, list[HomeworkTask]]] = []
    for gid, sid, joined_at in (await db.execute(
        select(GroupMember.group_id, GroupMember.student_id, GroupMember.joined_at).where(
            GroupMember.group_id.in_(list(by_group)), GroupMember.student_id.in_(student_ids),
            GroupMember.status == "active",
        )
    )).all():
        joined_day = baku_day(joined_at) if joined_at else None
        for lesson_id, lesson_date, is_personal in by_group[gid]:
            if joined_day and baku_day(lesson_date) < joined_day:
                break  # дальше только более ранние уроки
            if is_personal and sid not in participants.get(lesson_id, ()):
                continue
            tasks = [t for t in tasks_by_lesson[lesson_id] if task_is_for(t, sid)]
            if tasks:
                last.append((sid, lesson_id, tasks))
                break
    if not last:
        return {}

    answers = {(a.lesson_id, a.student_id): a for a in (await db.execute(select(HomeworkAnswer).where(
        HomeworkAnswer.lesson_id.in_({lid for _, lid, _ in last}),
        HomeworkAnswer.student_id.in_({sid for sid, _, _ in last}),
    ))).scalars().all()}
    with_files: set[int] = set()
    if answers:
        with_files = {row[0] for row in (await db.execute(
            select(HomeworkAnswerFile.answer_id)
            .where(HomeworkAnswerFile.answer_id.in_([a.id for a in answers.values()])).distinct()
        )).all()}

    out: dict[int, str] = {}
    for sid, lesson_id, tasks in last:
        answer = answers.get((lesson_id, sid))
        status = answer_status(tasks, answer, bool(answer and answer.id in with_files))
        if status not in ("pending", "expired", "returned"):
            continue
        overdue = status == "expired" or expired(effective_deadline(tasks))
        if overdue or sid not in out:
            out[sid] = "overdue" if overdue else "pending"
    return out


async def student_homework_debts(db: AsyncSession, student_id: int) -> dict:
    """Несданные ДЗ студента (полоса под шапкой его кабинета).

    Уроки — те же, что студент видит на Главной: открытые уроки его активных
    групп, персональные — только свои. Долг — ответа нет или ДЗ возвращено на
    доработку; просрочен — срок сдачи прошёл. ДЗ с уроков до прихода ученика в
    группу (joined_at) долгом не считаются — сдаст их, оценка пойдёт в плюс
    (решение Андрея 15.10). Показываем один урок: просроченный
    (самый давний), иначе с ближайшим сроком, иначе самый ранний."""
    empty = {"count": 0, "overdue": False, "lesson_id": None, "lesson_title": None, "deadline": None}
    joined = {gid: (baku_day(at) if at else None) for gid, at in (await db.execute(
        select(GroupMember.group_id, GroupMember.joined_at)
        .where(GroupMember.student_id == student_id, GroupMember.status == "active")
    )).all()}
    group_ids = list(joined)
    if not group_ids:
        return empty
    lessons = {l.id: l for l in (await db.execute(
        select(Lesson).where(
            Lesson.group_id.in_(group_ids), Lesson.is_open == True,  # noqa: E712
            visible_to_student(student_id),
        )
    )).scalars().all()}

    far = datetime.max.replace(tzinfo=timezone.utc)
    when = lambda l: aware(l.date) if l.date else far
    debts = []  # (просрочен, урок, срок)
    for lesson_id, hw in (await student_homework(db, list(lessons), student_id)).items():
        if hw["status"] not in ("pending", "expired", "returned"):
            continue
        lesson = lessons[lesson_id]
        joined_day = joined.get(lesson.group_id)
        if joined_day and lesson.date and baku_day(lesson.date) < joined_day:
            continue  # урок был до прихода ученика в группу
        overdue = hw["status"] == "expired" or expired(hw["deadline"])
        debts.append((overdue, lesson, hw["deadline"]))
    if not debts:
        return empty

    late = [d for d in debts if d[0]]
    if late:
        overdue, lesson, deadline = min(late, key=lambda d: (when(d[1]), d[1].id))
    else:
        overdue, lesson, deadline = min(debts, key=lambda d: (aware(d[2]) if d[2] else far, when(d[1]), d[1].id))
    return {
        "count": len(debts), "overdue": overdue, "lesson_id": lesson.id,
        "lesson_title": lesson.title, "deadline": deadline,
    }
