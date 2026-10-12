from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..usages import ensure_not_used
from ..attendance import attendance_slots, missed_last_lesson, summarize_by_student
from ..core.security import get_password_hash
from ..database import get_db
from ..homework_status import last_homework_debts
from ..schemas import NewPasswordIn
from ..dependencies import require_admin, require_teacher
from ..phones import checked_student_phone, normalize_phone, phone_key, PHONE_FORMAT_ERROR, PHONE_REQUIRED_ERROR
from ..report_common import resolve_period
from ..student_report import build_student_report
from ..models import (
    Course, Group, GroupMember, HomeworkAnswer, HomeworkAnswerFile, HomeworkTask, Lesson, LessonMark,
    LessonMessage, User, UserSession,
)

router = APIRouter(prefix="/students", tags=["students"])



class StudentGroupOut(BaseModel):
    id: int
    name: str
    teacher_id: int
    teacher_name: Optional[str] = None


class StudentStatsOut(BaseModel):
    id: int
    full_name: str
    telegram_username: Optional[str] = None
    whatsapp: Optional[str] = None
    # Три вида оценок, у каждой своя средняя (claude/homework-plan.md, «Оценки»)
    avg_score: Optional[float] = None       # за урок
    max_score: Optional[int] = None
    avg_hw_score: Optional[float] = None    # за ДЗ
    max_hw_score: Optional[int] = None
    avg_exam_score: Optional[float] = None  # экзаменационная
    max_exam_score: Optional[int] = None
    stars_total: int = 0                    # сумма звёзд за уроки
    unexcused_absences: int = 0
    # Пропустил последний урок и не был после него на доп. уроке (attendance.missed_last_lesson)
    missed_last_lesson: bool = False
    # Долг по последнему выданному ДЗ: pending | overdue | None (homework_status.last_homework_debts)
    homework_debt: Optional[str] = None
    late_count: int = 0
    # Для колонок «Телефон» и «Родитель» в таблице «Студенты»
    phone: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    last_login_at: Optional[datetime] = None  # начало последней сессии (user_sessions)
    groups: list[StudentGroupOut] = []


async def _scope_group_ids(
    db: AsyncSession,
    current_user: User,
    course_id: Optional[int] = None,
    group_id: Optional[int] = None,
    teacher_id: Optional[int] = None,
    mine: bool = False,
) -> dict[int, dict]:
    """Группы в допустимой области видимости пользователя + фильтрам.
    Возвращает {group_id: {id, name, teacher_id, teacher_name, course_id, course_title}}."""
    scope_teacher_id = None
    if current_user.role != "admin":
        scope_teacher_id = current_user.id
    elif mine:
        scope_teacher_id = current_user.id
    elif teacher_id is not None:
        scope_teacher_id = teacher_id

    query = select(Group.id, Group.name, Group.teacher_id, Group.course_id)
    if scope_teacher_id is not None:
        query = query.where(Group.teacher_id == scope_teacher_id)
    if course_id is not None:
        query = query.where(Group.course_id == course_id)
    if group_id is not None:
        query = query.where(Group.id == group_id)

    result = await db.execute(query)
    groups_by_id = {
        gid: {"id": gid, "name": name, "teacher_id": tid, "course_id": cid, "teacher_name": None, "course_title": None}
        for gid, name, tid, cid in result.all()
    }
    if not groups_by_id:
        return groups_by_id

    teacher_ids = list({g["teacher_id"] for g in groups_by_id.values()})
    teachers_result = await db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(teacher_ids))
    )
    teacher_names = {uid: (full_name or username) for uid, full_name, username in teachers_result.all()}

    course_ids = list({g["course_id"] for g in groups_by_id.values()})
    courses_result = await db.execute(select(Course.id, Course.title).where(Course.id.in_(course_ids)))
    course_titles = {cid: title for cid, title in courses_result.all()}

    for g in groups_by_id.values():
        g["teacher_name"] = teacher_names.get(g["teacher_id"])
        g["course_title"] = course_titles.get(g["course_id"])

    return groups_by_id


async def _compute_stats(db: AsyncSession, student_ids: list[int], group_ids: list[int]) -> dict[int, dict]:
    """Средний/макс балл и опоздания — по отметкам (LessonMark), пропуски —
    по общему правилу посещаемости (attendance.py) в пределах заданных групп."""
    stats = {sid: {"scores": [], "exam_scores": [], "hw_scores": [], "stars": 0, "unexcused": 0, "late": 0} for sid in student_ids}
    if not student_ids or not group_ids:
        return stats

    marks_result = await db.execute(
        select(
            LessonMark.student_id, LessonMark.score, LessonMark.exam_score,
            LessonMark.is_late, LessonMark.stars,
        )
        .join(Lesson, Lesson.id == LessonMark.lesson_id)
        .where(Lesson.group_id.in_(group_ids), LessonMark.student_id.in_(student_ids))
    )
    for student_id, score, exam_score, is_late, stars in marks_result.all():
        row = stats[student_id]
        if score is not None:
            row["scores"].append(score)
        if exam_score is not None:
            row["exam_scores"].append(exam_score)
        if is_late:
            row["late"] += 1
        if stars:
            row["stars"] += stars

    for sid, summary in summarize_by_student(await attendance_slots(db, group_ids, student_ids)).items():
        if sid in stats:
            stats[sid]["unexcused"] = summary.absent

    # Оценки за ДЗ — по заданиям уроков этих групп
    hw_result = await db.execute(
        select(HomeworkAnswer.student_id, HomeworkAnswer.grade)
        .join(Lesson, Lesson.id == HomeworkAnswer.lesson_id)
        .where(
            Lesson.group_id.in_(group_ids),
            HomeworkAnswer.student_id.in_(student_ids),
            HomeworkAnswer.grade.isnot(None),
        )
    )
    for student_id, grade in hw_result.all():
        stats[student_id]["hw_scores"].append(grade)
    return stats


def _avg(values: list[int]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


def _stats_summary(stats_row: dict) -> dict:
    scores = stats_row["scores"]
    exam_scores = stats_row["exam_scores"]
    hw_scores = stats_row["hw_scores"]
    return {
        "avg_score": _avg(scores),
        "max_score": max(scores) if scores else None,
        "avg_hw_score": _avg(hw_scores),
        "max_hw_score": max(hw_scores) if hw_scores else None,
        "hw_count": len(hw_scores),
        "avg_exam_score": _avg(exam_scores),
        "max_exam_score": max(exam_scores) if exam_scores else None,
        "exams_count": len(exam_scores),
        "stars_total": stats_row.get("stars", 0),
        "unexcused_absences": stats_row["unexcused"],
        "late_count": stats_row["late"],
    }


# Табличка «Студенты»: у teacher — только свои (через принадлежность к его
# группам), у admin — все по умолчанию, с возможностью сузить фильтрами.
@router.get("", response_model=list[StudentStatsOut])
async def list_students(
    course_id: Optional[int] = Query(None),
    group_id: Optional[int] = Query(None),
    teacher_id: Optional[int] = Query(None),  # фильтр «Препод» — учитывается только для admin
    mine: bool = Query(False),                # admin: считать только свои группы (кнопка «Моё»)
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    groups_by_id = await _scope_group_ids(db, current_user, course_id, group_id, teacher_id, mine)
    group_ids = list(groups_by_id.keys())
    if not group_ids:
        return []

    members_result = await db.execute(
        select(GroupMember.student_id, GroupMember.group_id)
        .where(GroupMember.group_id.in_(group_ids), GroupMember.status == "active")
    )
    student_ids = []
    student_groups = {}
    for student_id, gid in members_result.all():
        if student_id not in student_groups:
            student_groups[student_id] = []
            student_ids.append(student_id)
        student_groups[student_id].append(groups_by_id[gid])
    if not student_ids:
        return []

    users_result = await db.execute(
        select(
            User.id, User.full_name, User.username, User.telegram_username, User.whatsapp,
            User.phone, User.parent_name, User.parent_phone,
        )
        .where(User.id.in_(student_ids))
    )
    users = {
        uid: {
            "full_name": full_name or username, "telegram_username": telegram_username, "whatsapp": whatsapp,
            "phone": phone, "parent_name": parent_name, "parent_phone": parent_phone,
        }
        for uid, full_name, username, telegram_username, whatsapp, phone, parent_name, parent_phone in users_result.all()
    }

    stats = await _compute_stats(db, student_ids, group_ids)
    missed_last = await missed_last_lesson(db, group_ids, student_ids)
    homework_debts = await last_homework_debts(db, group_ids, student_ids)

    # Последний вход — начало самой свежей сессии ученика (app/presence.py)
    logins_result = await db.execute(
        select(UserSession.user_id, func.max(UserSession.started_at))
        .where(UserSession.user_id.in_(student_ids))
        .group_by(UserSession.user_id)
    )
    last_logins = {uid: started for uid, started in logins_result.all()}

    out = []
    for sid in student_ids:
        u = users.get(sid, {"full_name": f"#{sid}"})
        out.append(StudentStatsOut(
            id=sid,
            full_name=u["full_name"],
            telegram_username=u.get("telegram_username"),
            whatsapp=u.get("whatsapp"),
            phone=u.get("phone"),
            parent_name=u.get("parent_name"),
            parent_phone=u.get("parent_phone"),
            last_login_at=last_logins.get(sid),
            missed_last_lesson=sid in missed_last,
            homework_debt=homework_debts.get(sid),
            groups=[StudentGroupOut(**{k: v for k, v in g.items() if k in ("id", "name", "teacher_id", "teacher_name")}) for g in student_groups[sid]],
            **_stats_summary(stats[sid]),
        ))

    # По имени; любую другую сортировку делает таблица в браузере (клик по шапке столбца)
    out.sort(key=lambda s: s.full_name.lower())

    return out


# Общая проверка доступа к конкретному студенту (отчёт, смена пароля, данные):
# admin — к любому, teacher — только к активному ученику своих групп, то же
# разграничение видимости, что и в списке /students. Возвращает студента,
# его группы в области видимости и справочник этих групп.
async def _get_accessible_student(
    db: AsyncSession, student_id: int, current_user: User
) -> tuple[User, list[int], dict[int, dict]]:
    student_result = await db.execute(select(User).where(User.id == student_id, User.role == "student"))
    student = student_result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    groups_by_id = await _scope_group_ids(db, current_user)
    member_result = await db.execute(
        select(GroupMember.group_id)
        .where(GroupMember.student_id == student_id, GroupMember.status == "active")
    )
    member_group_ids = {row[0] for row in member_result.all()}
    matched_group_ids = [gid for gid in member_group_ids if gid in groups_by_id]

    if current_user.role != "admin" and not matched_group_ids:
        raise HTTPException(status_code=403, detail="Этот студент не в ваших группах")
    return student, matched_group_ids, groups_by_id


# Отчёт по ученику за период — для родителей (правила и нормы — app/student_report.py).
# admin — по любому ученику; teacher — по ученику своих групп и только по ним.
# Педагог, который в группе не основной (вёл в ней уроки — app/lesson_teacher.py),
# получает отчёт только по своим урокам с этим учеником.
# Период — report_common.resolve_period: period=month (по умолчанию; month=ГГГГ-ММ,
# не задан — текущий) | year | all | custom (date_from, date_to — ГГГГ-ММ-ДД).
@router.get("/{student_id}/report")
async def get_student_report(
    student_id: int,
    period: Optional[str] = None,
    month: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    report_period = resolve_period(period, month, date_from, date_to)
    student = (await db.execute(
        select(User).where(User.id == student_id, User.role == "student")
    )).scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    groups_by_id = await _scope_group_ids(db, current_user)
    member_group_ids = {row[0] for row in (await db.execute(
        select(GroupMember.group_id)
        .where(GroupMember.student_id == student_id, GroupMember.status == "active")
    )).all()}
    groups = [groups_by_id[gid] for gid in member_group_ids if gid in groups_by_id]

    own_lessons_of: dict[int, int] = {}
    if current_user.role != "admin" and member_group_ids:
        for gid, name, course_title in (await db.execute(
            select(Group.id, Group.name, Course.title)
            .join(Course, Course.id == Group.course_id)
            .where(
                Group.id.in_(member_group_ids), Group.teacher_id != current_user.id,
                Group.id.in_(select(Lesson.group_id).where(Lesson.teacher_id == current_user.id)),
            )
        )).all():
            # в отчёте педагогом записан он сам: это отчёт по его урокам
            groups.append({
                "id": gid, "name": name, "course_title": course_title, "teacher_id": current_user.id,
                "teacher_name": current_user.full_name or current_user.username,
            })
            own_lessons_of[gid] = current_user.id
    if current_user.role != "admin" and not groups:
        raise HTTPException(status_code=403, detail="Этот студент не в ваших группах")
    return await build_student_report(db, student, groups, report_period, own_lessons_of)


# Смена пароля ученика педагогом (ученик забыл пароль): без старого пароля.
# Педагог — только ученикам своих групп, admin — любому ученику; пароль
# педагога/админа этим путём сменить нельзя (_get_accessible_student ищет
# только роль student). Уже выданный токен ученика действует до своего срока.
@router.put("/{student_id}/password", status_code=204)
async def set_student_password(
    student_id: int,
    data: NewPasswordIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    student, _, _ = await _get_accessible_student(db, student_id, current_user)
    student.hashed_password = get_password_hash(data.new_password)
    await db.commit()
    return Response(status_code=204)


# Данные ученика для правки педагогом/админом (окно «Ученики» группы):
# имя, телефон ученика, родитель и телефон родителя. Педагог — только
# ученикам своих групп, admin — любому (_get_accessible_student).
class StudentProfile(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram_username: Optional[str] = None
    whatsapp: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None


class StudentProfileOut(StudentProfile):
    id: int
    username: str
    groups: list[str] = []  # названия активных групп ученика — только для показа


class StudentCreate(StudentProfile):
    username: str
    password: str
    group_id: int


def _clean(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def _parent_phone(raw: Optional[str], current: Optional[str] = None) -> Optional[str]:
    # Телефон родителя: тот же формат, что у ученика, но повторяться может (братья и сёстры).
    # Уже записанный номер, если его не меняли, не перепроверяем (app/phones.py).
    raw = (raw or "").strip()
    if not raw:
        return None
    if current and phone_key(raw) == phone_key(current):
        return current
    normalized = normalize_phone(raw)
    if not normalized:
        raise HTTPException(status_code=422, detail=PHONE_FORMAT_ERROR)
    return normalized


async def _profile_out(db: AsyncSession, student: User) -> StudentProfileOut:
    group_names = [row[0] for row in (await db.execute(
        select(Group.name).join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.student_id == student.id, GroupMember.status == "active")
        .order_by(Group.name)
    )).all()]
    return StudentProfileOut(
        id=student.id, username=student.username, full_name=student.full_name,
        phone=student.phone, email=student.email,
        telegram_username=student.telegram_username, whatsapp=student.whatsapp,
        parent_name=student.parent_name, parent_phone=student.parent_phone,
        groups=group_names,
    )


# Новый ученик сразу в группу — заводит админ (секретарь) или педагог в свою
# группу. Те же правила, что при регистрации по QR: логин не занят, телефон
# обязателен и в базе не повторяется (app/phones.py).
@router.post("", response_model=StudentProfileOut)
async def create_student(
    data: StudentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    groups_by_id = await _scope_group_ids(db, current_user)
    if data.group_id not in groups_by_id:
        raise HTTPException(status_code=403, detail="Нет доступа к этой группе")
    username = data.username.strip()
    if not username or not data.password:
        raise HTTPException(status_code=422, detail="Укажите логин и пароль")
    if (await db.execute(select(User.id).where(User.username == username))).first():
        raise HTTPException(status_code=400, detail="Пользователь с таким логином уже существует")

    student = User(
        username=username,
        hashed_password=get_password_hash(data.password),
        role="student",
        full_name=_clean(data.full_name),
        phone=await checked_student_phone(db, data.phone),
        email=_clean(data.email),
        telegram_username=_clean(data.telegram_username),
        whatsapp=_clean(data.whatsapp),
        parent_name=_clean(data.parent_name),
        parent_phone=_parent_phone(data.parent_phone),
        created_by=current_user.id,
    )
    db.add(student)
    await db.flush()
    db.add(GroupMember(group_id=data.group_id, student_id=student.id))
    await db.commit()
    await db.refresh(student)
    return await _profile_out(db, student)


@router.get("/{student_id}/profile", response_model=StudentProfileOut)
async def get_student_profile(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    student, _, _ = await _get_accessible_student(db, student_id, current_user)
    return await _profile_out(db, student)


@router.put("/{student_id}/profile", response_model=StudentProfileOut)
async def update_student_profile(
    student_id: int,
    data: StudentProfile,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    student, _, _ = await _get_accessible_student(db, student_id, current_user)

    student.full_name = (data.full_name or "").strip() or None

    # Телефон ученика: формат и запрет повторов — как при регистрации. Стереть
    # уже указанный нельзя; если его ещё нет и поле пустое — не трогаем
    # (ученик сам заполнит при входе).
    phone = (data.phone or "").strip()
    if phone:
        student.phone = await checked_student_phone(db, phone, exclude_user_id=student.id, current=student.phone)
    elif (student.phone or "").strip():
        raise HTTPException(status_code=422, detail=PHONE_REQUIRED_ERROR)

    student.email = _clean(data.email)
    student.telegram_username = _clean(data.telegram_username)
    student.whatsapp = _clean(data.whatsapp)
    student.parent_name = _clean(data.parent_name)
    student.parent_phone = _parent_phone(data.parent_phone, current=student.parent_phone)

    await db.commit()
    await db.refresh(student)
    return await _profile_out(db, student)


# Удалить ученика — только admin. Общий контроль удаления (app/usages.py):
# если ученик где-либо есть — группы (в т.ч. отчислен / архив), оценки,
# решения ДЗ, персональные ДЗ — 409 со списком мест, ничего не удаляется.
async def _purge_student_data(db: AsyncSession, student_id: int) -> None:
    from .lessons import _safe_delete_object, delete_homework_tasks  # lessons.py тянет много — импорт по месту

    answer_ids = [r[0] for r in (await db.execute(
        select(HomeworkAnswer.id).where(HomeworkAnswer.student_id == student_id)
    )).all()]
    if answer_ids:
        for (key,) in (await db.execute(
            select(HomeworkAnswerFile.object_key).where(HomeworkAnswerFile.answer_id.in_(answer_ids))
        )).all():
            _safe_delete_object(key)
        await db.execute(delete(HomeworkAnswerFile).where(HomeworkAnswerFile.answer_id.in_(answer_ids)))
        await db.execute(delete(HomeworkAnswer).where(HomeworkAnswer.id.in_(answer_ids)))

    task_ids = [r[0] for r in (await db.execute(
        select(HomeworkTask.id).where(HomeworkTask.student_id == student_id)
    )).all()]
    await delete_homework_tasks(db, task_ids)

    await db.execute(delete(LessonMessage).where(LessonMessage.student_id == student_id))
    await db.execute(delete(LessonMark).where(LessonMark.student_id == student_id))
    await db.execute(delete(GroupMember).where(GroupMember.student_id == student_id))


@router.delete("/{student_id}")
async def delete_student(
    student_id: int,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Без force — только если студент нигде не используется (иначе 409 со списком).
    force=true (админ видел список и подтвердил) — удаляем студента вместе со
    всеми его данными: членство в группах, оценки/посещаемость, ответы на ДЗ
    (+ файлы в MinIO), персональные ДЗ (+ файлы), диалоги в уроках."""
    result = await db.execute(select(User).where(User.id == student_id, User.role == "student"))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")

    if not force:
        await ensure_not_used(db, "student", student_id)
    else:
        await _purge_student_data(db, student_id)
    await db.delete(student)
    await db.commit()
    return {"ok": True}
