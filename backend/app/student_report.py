"""Отчёт по ученику за период — для родителей («Студенты» → имя ученика).
Периоды — report_common.Period: месяц, с начала учебного года, с начала
обучения, произвольный.

Построен так же, как отчёт по педагогу (teacher_report.py): общий вывод,
показатели с оценкой по норме и список уроков периода. Берутся только данные,
которые уже есть в платформе: журнал урока (посещение, опоздание, оценка,
экзамен, звёзды) и домашние задания.

Отдаёт цифры и статусы (good | warn | bad | none), а не готовые фразы —
формулировки на фронте (StudentReportPage.jsx), чтобы их переводил autoi18n.
Нормы — в NORMS ниже, одно место на весь отчёт.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .attendance import ABSENT, EXCUSED, MADE_UP, PRESENT, attendance_slots
from .homework_status import student_homework
from .lesson_lock import BAKU_TZ, aware, baku_day
from .models import GroupMember, Lesson, LessonMark, User
from .personal import visible_to_student
from .report_common import Period, avg, status_max, status_min, summarize_indicators

# Нормы показателей: (норма, граница «жёлтого»). Что хуже жёлтой границы — «красный».
NORMS = {
    "attendance": (0, 1),       # пропусков без уважительной причины — не больше
    "late": (0, 1),             # опозданий — не больше
    "lesson_score": (70, 50),   # средняя оценка за урок — не меньше
    "hw_submitted": (0, 1),     # несданных заданий с истёкшим сроком — не больше
    "hw_score": (70, 50),       # средняя оценка за ДЗ — не меньше
    "exam": (70, 50),           # средний балл экзаменов — не меньше
}
HW_DONE = {"graded", "accepted", "submitted"}   # ответ прислан


async def build_student_report(
    db: AsyncSession, student: User, groups: list[dict], period: Period,
    own_lessons_of: Optional[dict[int, int]] = None,
) -> dict:
    """groups — группы ученика в области видимости того, кто смотрит отчёт:
    [{id, name, teacher_id, teacher_name, course_title}] (students._scope_group_ids).
    own_lessons_of — {группа: педагог}: в этих группах берутся только уроки
    этого педагога (он в группе не основной и видит лишь свои уроки,
    app/lesson_teacher.py)."""
    start, end = period.start, period.end
    now = datetime.now(BAKU_TZ)
    gids = [g["id"] for g in groups]
    own_lessons_of = own_lessons_of or {}

    def lesson_scope():
        """Уроки ученика в его группах в области видимости смотрящего."""
        conditions = [Lesson.group_id.in_(gids), visible_to_student(student.id)]
        for gid, teacher_id in own_lessons_of.items():
            conditions.append((Lesson.group_id != gid) | (Lesson.teacher_id == teacher_id))
        return conditions

    teachers = {}
    if groups:
        teachers = {u.id: u for u in (await db.execute(
            select(User).where(User.id.in_({g["teacher_id"] for g in groups}))
        )).scalars().all()}
    base = {
        "student": {"id": student.id, "full_name": student.full_name or student.username},
        "month": period.month,
        "period": period.out(),
        "is_current_month": period.kind == "month" and end > now,
        "norms": {k: v[0] for k, v in NORMS.items()},
        "groups": [
            {
                "name": g["name"], "course": g["course_title"], "teacher": g["teacher_name"],
                "teacher_phone": getattr(teachers.get(g["teacher_id"]), "phone", None),
            }
            for g in sorted(groups, key=lambda g: g["name"].lower())
        ],
    }
    if not gids:
        return {**base, "empty": True}

    # ---------- Уроки ученика за период (уже прошедшие) ----------
    joined = {
        gid: (joined_at, expelled_at) for gid, joined_at, expelled_at in (await db.execute(
            select(GroupMember.group_id, GroupMember.joined_at, GroupMember.expelled_at)
            .where(GroupMember.student_id == student.id, GroupMember.group_id.in_(gids), GroupMember.status != "pending")
        )).all()
    }
    group_names = {g["id"]: g["name"] for g in groups}

    def in_membership(lesson: Lesson) -> bool:
        # то же правило, что в посещаемости (attendance.py): урок не раньше дня
        # добавления в группу и раньше отчисления
        joined_at, expelled_at = joined.get(lesson.group_id, (None, None))
        if joined_at and baku_day(lesson.date) < baku_day(joined_at):
            return False
        return not (expelled_at and aware(lesson.date) >= aware(expelled_at))

    query = select(Lesson).where(*lesson_scope(), Lesson.date < end).order_by(Lesson.date, Lesson.id)
    if start is not None:
        query = query.where(Lesson.date >= start)
    lessons = [
        l for l in (await db.execute(query)).scalars().all()
        if aware(l.date) <= now and in_membership(l)
    ]
    lesson_ids = [l.id for l in lessons]
    if start is None and lessons:
        base["period"] = period.out(aware(lessons[0].date))   # «с начала обучения» — с первого урока

    marks = {}
    locked = {}
    homework = {}
    if lesson_ids:
        marks = {m.lesson_id: m for m in (await db.execute(
            select(LessonMark).where(LessonMark.lesson_id.in_(lesson_ids), LessonMark.student_id == student.id)
        )).scalars().all()}
        # Посещение заблокированных уроков — по общему правилу (нет отметки = пропуск)
        locked = {s.lesson_id: s.status for s in await attendance_slots(db, gids, [student.id], lesson_ids)}
        homework = await student_homework(db, lesson_ids, student.id)

    rows = []
    for l in lessons:
        mark = marks.get(l.id)
        attendance = locked.get(l.id)
        if attendance is None and mark is not None and (mark.attendance_status in PRESENT or mark.attendance_status == EXCUSED):
            attendance = mark.attendance_status   # сегодняшний урок: отмечен, но ещё не заблокирован
        was_present = attendance in PRESENT
        hw = homework.get(l.id, {"status": "none", "grade": None, "deadline": None})
        rows.append({
            "id": l.id,
            "date": l.date.isoformat(),
            "title": l.title,
            "group": group_names.get(l.group_id),
            "is_personal": bool(l.is_personal),
            "attendance": attendance,            # in_person | online | excused | absent | made_up | None — ещё не отмечено
            "is_late": bool(mark and mark.is_late and was_present),
            "score": mark.score if mark else None,
            "exam_score": mark.exam_score if mark else None,
            "stars": (mark.stars or 0) if mark else 0,
            "hw_status": hw["status"],
            "hw_grade": hw["grade"],
        })

    # ---------- Показатели ----------
    present = sum(1 for r in rows if r["attendance"] in PRESENT)
    absent = sum(1 for r in rows if r["attendance"] == ABSENT)
    excused = sum(1 for r in rows if r["attendance"] == EXCUSED)
    made_up = sum(1 for r in rows if r["attendance"] == MADE_UP)   # закрыты доп. уроком — в норму не входят
    late = sum(1 for r in rows if r["is_late"])
    scores = [r["score"] for r in rows if r["score"] is not None]

    hw_done = sum(1 for r in rows if r["hw_status"] in HW_DONE)
    hw_missed = sum(1 for r in rows if r["hw_status"] == "expired")
    hw_returned = sum(1 for r in rows if r["hw_status"] == "returned")
    hw_total = hw_done + hw_missed + hw_returned     # задания, срок которых ещё идёт, не считаем
    hw_grades = [r["hw_grade"] for r in rows if r["hw_grade"] is not None]

    exams = [r["exam_score"] for r in rows if r["exam_score"] is not None]
    exam_avg = avg(exams)
    # Сравнение с прошлым месяцем — только у месячного отчёта
    exam_prev = None
    previous = period.previous_month()
    if previous:
        exam_prev = avg([score for (score,) in (await db.execute(
            select(LessonMark.exam_score)
            .join(Lesson, Lesson.id == LessonMark.lesson_id)
            .where(
                *lesson_scope(), Lesson.date >= previous[0], Lesson.date < previous[1],
                LessonMark.student_id == student.id, LessonMark.exam_score.isnot(None),
            )
        )).all()])
    exam_delta = round(exam_avg - exam_prev, 1) if (exam_avg is not None and exam_prev is not None) else None

    indicators = [
        {"key": "attendance", "status": status_max(absent, NORMS["attendance"]) if (present + absent) else "none",
         "present": present, "total": present + absent, "absent": absent, "excused": excused, "made_up": made_up},
        {"key": "late", "status": status_max(late, NORMS["late"]) if present else "none", "count": late},
        {"key": "lesson_score", "status": status_min(avg(scores), NORMS["lesson_score"]), "avg": avg(scores)},
        {"key": "hw_submitted", "status": status_max(hw_missed, NORMS["hw_submitted"]) if hw_total else "none",
         "done": hw_done, "total": hw_total, "missed": hw_missed, "returned": hw_returned},
        {"key": "hw_score", "status": status_min(avg(hw_grades), NORMS["hw_score"]), "avg": avg(hw_grades)},
        {"key": "exam", "status": status_min(exam_avg, NORMS["exam"]), "avg": exam_avg, "prev": exam_prev,
         "delta": exam_delta},
    ]

    return {
        **base,
        "empty": False,
        **summarize_indicators(indicators, has_lessons=bool(rows)),
        "stars": sum(r["stars"] for r in rows),
        "indicators": indicators,
        "lessons": rows,
    }
