"""Отчёт по педагогу за период — для руководителя (раздел «Учителя» у админа).
Периоды — report_common.Period: месяц, с начала учебного года, с начала
преподавания, произвольный.

Показывает не только «сколько отработано» (уроки и часы), но и «как
отработано» — показатели, которые педагог не выставляет себе сам:
посещаемость и удержание учеников, вовремя ли заполнен журнал, задаются ли и
как быстро проверяются ДЗ, экзамены из live-квиза, пользуются ли ученики
платформой, как ученики оценили уроки (смайлики). Оценки за урок и звёзды
в отчёт НЕ входят: их ставит сам педагог.

Отдаёт цифры и статусы (good | warn | bad | none), а не готовые фразы —
формулировки на фронте (TeacherReportPage.jsx), чтобы их переводил autoi18n.
Нормы — в NORMS ниже, одно место на весь отчёт.
"""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .attendance import PRESENT, ABSENT, attendance_slots, summarize
from .homework_status import awaiting_review
from .lesson_lock import BAKU_TZ, aware, baku_day
from .report_common import Period, avg as _avg, pct as _pct, status_max, status_min, summarize_indicators
from .models import (
    Group, GroupMember, HomeworkAnswer, HomeworkTask, Lesson, LessonFeedback,
    LessonMark, User, UserSession,
)

# Нормы показателей: (норма, граница «жёлтого»). Что хуже жёлтой границы — «красный».
NORMS = {
    "attendance": (85, 75),      # % посещённых уроков — не меньше
    "retention": (0, 1),         # ушло учеников — не больше
    "journal": (90, 75),         # % уроков с журналом, заполненным в день урока
    "hw_assigned": (80, 60),     # % проведённых уроков с ДЗ
    "hw_review_days": (2, 4),    # дней от сдачи до проверки — не больше
    "exams": (0, -5),            # изменение среднего балла экзаменов к прошлому месяцу — не меньше
    "platform": (80, 60),        # % учеников, заходивших за последнюю неделю периода
    "feedback": (70, 50),        # % зелёных смайликов
}
ABSENCES_IN_A_ROW = 3            # столько пропусков подряд — «риск ухода»
PLATFORM_WINDOW_DAYS = 7


def _status_min(value: Optional[float], key: str) -> str:
    return status_min(value, NORMS[key])


def _status_max(value: Optional[float], key: str) -> str:
    return status_max(value, NORMS[key])


async def build_teacher_report(db: AsyncSession, teacher: User, period: Period) -> dict:
    now = datetime.now(BAKU_TZ)
    start, end = period.start, period.end
    if start is None:
        # «С начала преподавания» — с первого урока педагога
        first = (await db.execute(
            select(func.min(Lesson.date)).where(Lesson.teacher_id == teacher.id)
        )).scalar()
        start = aware(first) if first else now
    period_end = min(end, now)   # период ещё идёт — считаем по сегодня

    # Уроки считаются тому, кто их вёл (Lesson.teacher_id, app/lesson_teacher.py):
    # замены и уроки до передачи группы — не основному педагогу группы.
    # Показатели по ученикам группы (удержание, очередь ДЗ, платформа, риск
    # ухода) — только по группам, где педагог основной (gids).
    lessons = (await db.execute(
        select(Lesson).where(Lesson.teacher_id == teacher.id, Lesson.date >= start, Lesson.date < end)
        .order_by(Lesson.date)
    )).scalars().all()
    groups = {
        g.id: g for g in (await db.execute(select(Group).where(
            (Group.teacher_id == teacher.id) | Group.id.in_(list({l.group_id for l in lessons}))
        ))).scalars().all()
    }
    gids = [gid for gid, g in groups.items() if g.teacher_id == teacher.id]
    base = {
        "teacher": {"id": teacher.id, "full_name": teacher.full_name or teacher.username},
        "month": period.month,
        "period": period.out(start),
        "norms": {k: v[0] for k, v in NORMS.items()},
    }
    if not groups:
        return {**base, "empty": True}

    # ---------- Уроки месяца ----------
    lesson_ids = [l.id for l in lessons]
    due = [l for l in lessons if aware(l.date) <= now]   # уже должны были пройти

    present_lessons: set[int] = set()
    first_mark_at: dict[int, datetime] = {}
    exam_scores: dict[int, list[int]] = {}
    if lesson_ids:
        for lid, status, created_at, exam in (await db.execute(
            select(LessonMark.lesson_id, LessonMark.attendance_status, LessonMark.created_at, LessonMark.exam_score)
            .where(LessonMark.lesson_id.in_(lesson_ids))
        )).all():
            if status in PRESENT:
                present_lessons.add(lid)
            if created_at and (lid not in first_mark_at or created_at < first_mark_at[lid]):
                first_mark_at[lid] = created_at
            if exam is not None:
                exam_scores.setdefault(lid, []).append(exam)

    # Проведён = открыт, и на нём был хотя бы один ученик (правило из справочника «Учителя»)
    held = [l for l in due if l.is_open and l.id in present_lessons]
    held_ids = {l.id for l in held}
    planned_due = [l for l in due if not l.is_personal]
    planned_held = [l for l in held if not l.is_personal]
    personal_held = [l for l in held if l.is_personal]
    not_held = [l for l in planned_due if l.id not in held_ids]

    # ---------- Посещаемость ----------
    slots = await attendance_slots(db, list(groups), lesson_ids=lesson_ids) if lesson_ids else []
    attendance_pct = summarize(slots).pct

    # ---------- Удержание ----------
    members = (await db.execute(
        select(GroupMember, User.full_name, User.username)
        .join(User, User.id == GroupMember.student_id)
        .where(GroupMember.group_id.in_(gids), GroupMember.status != "pending")  # не принятые педагогом — не в счёт
    )).all()
    base_members, left = [], []
    for m, full_name, username in members:
        joined = aware(m.joined_at) if m.joined_at else start
        expelled = aware(m.expelled_at) if (m.status == "expelled" and m.expelled_at) else None
        if joined >= period_end or (expelled and expelled < start):
            continue  # пришёл после периода или ушёл до него
        base_members.append(m)
        if expelled and expelled < end:
            left.append({
                "name": full_name or username, "group": groups[m.group_id].name, "group_id": m.group_id,
                "date": expelled.isoformat(), "reason": m.expel_reason,
            })
    active_students = {m.student_id for m, _, _ in members if m.status == "active"}

    # ---------- Журнал в день урока ----------
    journal_on_time = sum(
        1 for l in held if l.id in first_mark_at and baku_day(first_mark_at[l.id]) == baku_day(l.date)
    )

    # ---------- Домашние задания ----------
    lessons_with_hw: set[int] = set()
    if held_ids:
        lessons_with_hw = {row[0] for row in (await db.execute(
            select(HomeworkTask.lesson_id).where(HomeworkTask.lesson_id.in_(held_ids)).distinct()
        )).all()}

    # Срок проверки: работы, проверенные в этом месяце (от последней сдачи до проверки)
    review_days = []
    for updated_at, reviewed_at in (await db.execute(
        select(HomeworkAnswer.updated_at, HomeworkAnswer.reviewed_at)
        .join(Lesson, Lesson.id == HomeworkAnswer.lesson_id)
        .where(Lesson.group_id.in_(gids), HomeworkAnswer.reviewed_at >= start, HomeworkAnswer.reviewed_at < end)
    )).all():
        if updated_at and reviewed_at and aware(reviewed_at) >= aware(updated_at):
            review_days.append((aware(reviewed_at) - aware(updated_at)).total_seconds() / 86400)
    hw_review_days = _avg(review_days)

    # Очередь: сданные и ещё не проверенные работы — на сейчас, не за месяц
    queue = (await db.execute(
        select(HomeworkAnswer.updated_at, Lesson.group_id)
        .join(Lesson, Lesson.id == HomeworkAnswer.lesson_id)
        .where(Lesson.group_id.in_(gids), *awaiting_review())
        .order_by(HomeworkAnswer.updated_at)
    )).all()
    hw_queue = {"count": len(queue), "oldest_days": None, "group": None}
    if queue and queue[0][0]:
        hw_queue["oldest_days"] = max(0, (now - aware(queue[0][0])).days)
        hw_queue["group"] = groups[queue[0][1]].name

    # ---------- Экзамены: за период; сравнение с прошлым месяцем — только у месячного отчёта ----------
    exam_now = _avg([s for scores in exam_scores.values() for s in scores])
    prev_rows = []
    previous = period.previous_month()
    if previous:
        prev_rows = (await db.execute(
            select(Lesson.group_id, LessonMark.exam_score)
            .join(Lesson, Lesson.id == LessonMark.lesson_id)
            .where(
                Lesson.teacher_id == teacher.id, Lesson.date >= previous[0], Lesson.date < previous[1],
                LessonMark.exam_score.isnot(None),
            )
        )).all()
    exam_prev = _avg([score for _, score in prev_rows])
    exam_delta = round(exam_now - exam_prev, 1) if (exam_now is not None and exam_prev is not None) else None

    # ---------- Пользуются ли ученики платформой ----------
    window_start = period_end - timedelta(days=PLATFORM_WINDOW_DAYS)
    platform_active = 0
    if active_students:
        platform_active = (await db.execute(
            select(func.count(func.distinct(UserSession.user_id))).where(
                UserSession.user_id.in_(active_students),
                UserSession.last_seen_at >= window_start, UserSession.started_at < period_end,
            )
        )).scalar() or 0

    # ---------- Смайлики учеников ----------
    feedback = {3: 0, 2: 0, 1: 0}
    if lesson_ids:
        for rating, count in (await db.execute(
            select(LessonFeedback.rating, func.count()).where(LessonFeedback.lesson_id.in_(lesson_ids))
            .group_by(LessonFeedback.rating)
        )).all():
            feedback[rating] = count
    feedback_total = sum(feedback.values())

    # ---------- Показатели ----------
    journal_pct = _pct(journal_on_time, len(held))
    hw_assigned_pct = _pct(len(lessons_with_hw), len(held))
    platform_pct = _pct(platform_active, len(active_students))
    feedback_pct = _pct(feedback[3], feedback_total)
    indicators = [
        {"key": "attendance", "status": _status_min(attendance_pct, "attendance"), "pct": attendance_pct},
        {"key": "retention", "status": _status_max(len(left), "retention") if base_members else "none",
         "stayed": len(base_members) - len(left), "total": len(base_members), "left": len(left)},
        {"key": "journal", "status": _status_min(journal_pct, "journal"), "pct": journal_pct,
         "done": journal_on_time, "total": len(held)},
        {"key": "hw_assigned", "status": _status_min(hw_assigned_pct, "hw_assigned"), "pct": hw_assigned_pct,
         "done": len(lessons_with_hw), "total": len(held)},
        {"key": "hw_review_days", "status": _status_max(hw_review_days, "hw_review_days"),
         "days": hw_review_days, "queue": hw_queue["count"]},
        {"key": "exams", "status": _status_min(exam_delta, "exams"), "avg": exam_now, "prev": exam_prev, "delta": exam_delta},
        {"key": "platform", "status": _status_min(platform_pct, "platform"), "pct": platform_pct,
         "done": platform_active, "total": len(active_students)},
        {"key": "feedback", "status": _status_min(feedback_pct, "feedback"), "pct": feedback_pct,
         "green": feedback[3], "yellow": feedback[2], "red": feedback[1]},
    ]
    verdict = summarize_indicators(indicators, has_lessons=bool(due))

    # ---------- По группам ----------
    slots_by_group: dict[int, list] = {}
    for s in slots:
        slots_by_group.setdefault(s.group_id, []).append(s)
    prev_by_group: dict[int, list[int]] = {}
    for gid, score in prev_rows:
        prev_by_group.setdefault(gid, []).append(score)
    by_group = []
    for gid, g in groups.items():
        g_lessons = [l for l in lessons if l.group_id == gid]
        g_students = sum(1 for m, _, _ in members if m.group_id == gid and m.status == "active")
        if (g.status != "active" or g.teacher_id != teacher.id) and not g_lessons:
            continue  # архивная или чужая группа без его уроков в этом месяце
        g_exam = _avg([s for l in g_lessons for s in exam_scores.get(l.id, [])])
        g_prev = _avg(prev_by_group.get(gid, []))
        by_group.append({
            "id": gid, "name": g.name, "students": g_students,
            "held": sum(1 for l in planned_held if l.group_id == gid),
            "planned": sum(1 for l in planned_due if l.group_id == gid),
            "personal": sum(1 for l in personal_held if l.group_id == gid),
            "attendance_pct": summarize(slots_by_group.get(gid, [])).pct,
            "exam_avg": g_exam,
            "exam_delta": round(g_exam - g_prev, 1) if (g_exam is not None and g_prev is not None) else None,
            "left": sum(1 for item in left if item["group_id"] == gid),
        })
    by_group.sort(key=lambda row: row["name"].lower())

    # ---------- Риск ухода: N пропусков подряд на последних уроках ----------
    at_risk = []
    active_gids = [gid for gid in gids if groups[gid].status == "active"]
    if active_gids and active_students:
        all_slots = await attendance_slots(db, active_gids, student_ids=active_students)
        dates = dict((await db.execute(
            select(Lesson.id, Lesson.date).where(Lesson.id.in_({s.lesson_id for s in all_slots}))
        )).all()) if all_slots else {}
        per_student: dict[tuple[int, int], list] = {}
        for s in all_slots:
            per_student.setdefault((s.student_id, s.group_id), []).append(s)
        names = {m.student_id: (full_name or username) for m, full_name, username in members}
        active_pairs = {(m.student_id, m.group_id) for m, _, _ in members if m.status == "active"}
        for (sid, gid), items in per_student.items():
            if (sid, gid) not in active_pairs:
                continue
            last = sorted(items, key=lambda s: aware(dates[s.lesson_id]), reverse=True)[:ABSENCES_IN_A_ROW]
            if len(last) == ABSENCES_IN_A_ROW and all(s.status == ABSENT for s in last):
                at_risk.append({"name": names.get(sid, f"#{sid}"), "group": groups[gid].name})
        at_risk.sort(key=lambda row: (row["group"].lower(), row["name"].lower()))

    return {
        **base,
        "empty": False,
        "is_current_month": period.kind == "month" and end > now,
        "groups": [groups[gid].name for gid in gids if groups[gid].status == "active"],
        "students": len(active_students),
        **verdict,
        "work": {
            "planned_held": len(planned_held),
            "planned_due": len(planned_due),
            "personal_held": len(personal_held),
            "hours": round(sum(l.duration_min for l in held) / 60, 1),
            "not_held": len(not_held),
        },
        "indicators": indicators,
        "by_group": by_group,
        "attention": {
            "hw_queue": hw_queue,
            "at_risk": at_risk,
            "left": left,
            "not_held": [
                {"title": l.title, "date": l.date.isoformat(), "group": groups[l.group_id].name} for l in not_held
            ],
        },
    }
