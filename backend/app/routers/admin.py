from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, Field, field_validator
from datetime import date
from typing import Optional
from ..database import get_db
from ..models import User, Course, Group, GroupMember, Lesson, LessonMark
from ..usages import ensure_not_used
from ..attendance import attendance_slots, summarize, PRESENT
from ..schemas import UserCreate, UserOut, CourseCreate, CourseOut, GroupCreate, GroupOut, clean_video_url, DURATION_MIN, DURATION_MAX, NewPasswordIn, DaysOffSettings
from ..security import get_password_hash, make_login, verify_password
from ..dependencies import require, require_admin
from .academy import sector_exists
from ..phones import ensure_phone_free
from ..teacher_report import build_teacher_report
from ..report_common import resolve_period
from ..lesson_teacher import assign_teacher
from ..days_off import apply_settings, check_range, current_settings, days_off_between
import secrets

router = APIRouter(prefix="/admin", tags=["admin"])


class GroupUpdate(BaseModel):
    name: str
    course_id: int
    teacher_id: int
    telegram_chat_id: Optional[str] = None
    whatsapp: Optional[str] = None
    video_url: Optional[str] = None
    lesson_duration_min: Optional[int] = Field(default=None, ge=DURATION_MIN, le=DURATION_MAX)  # None — не менять
    sector: Optional[str] = None  # присылается формой, но менять нельзя (см. update_group)

    @field_validator("video_url")
    @classmethod
    def _check_video_url(cls, v):
        return clean_video_url(v)

class UserAdminUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    whatsapp: Optional[str] = None

class CourseUpdate(BaseModel):
    title: str
    description: Optional[str] = None

# ── ПЕДАГОГИ ──

# Списки педагогов и групп — право teachers.view / groups.all (админ, куратор)
@router.get("/teachers", response_model=list[UserOut])
async def get_teachers(db: AsyncSession = Depends(get_db), admin: User = Depends(require("teachers.view"))):
    result = await db.execute(select(User).where(User.role == "teacher"))
    return result.scalars().all()

@router.post("/teachers", response_model=UserOut)
async def create_teacher(data: UserCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.username == data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")
    await ensure_phone_free(db, data.phone)  # номер в базе не повторяется
    user = User(
        username=data.username,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        email=data.email,
        phone=data.phone,
        telegram_username=data.telegram_username,
        whatsapp=data.whatsapp,
        role="teacher",
        created_by=admin.id
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

@router.patch("/teachers/{user_id}", response_model=UserOut)
async def update_teacher(
    user_id: int,
    data: UserAdminUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(User).where(User.id == user_id, User.role == "teacher"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Педагог не найден")
    await ensure_phone_free(db, data.phone, exclude_user_id=user.id)  # номер в базе не повторяется
    user.full_name = data.full_name
    user.email = data.email
    user.phone = data.phone
    user.telegram_username = data.telegram_username
    user.whatsapp = data.whatsapp
    await db.commit()
    await db.refresh(user)
    return user

# Выходные педагога (правила — app/days_off.py). Ставит только админ; сам
# педагог видит их в профиле (GET /auth/me/days-off).
class DaysOffPreviewIn(DaysOffSettings):
    date_from: date
    date_to: date


class DaysOffPreviewOut(BaseModel):
    dates: list[date]
    pattern: list[date]  # выходные только по полоскам, без отдельных дат


async def _teacher_or_404(db: AsyncSession, user_id: int) -> User:
    teacher = (await db.execute(select(User).where(User.id == user_id, User.role == "teacher"))).scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Педагог не найден")
    return teacher


@router.get("/teachers/{user_id}/days-off", response_model=DaysOffSettings)
async def get_teacher_days_off(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    return current_settings((await _teacher_or_404(db, user_id)).days_off)


@router.put("/teachers/{user_id}/days-off", response_model=DaysOffSettings)
async def save_teacher_days_off(
    user_id: int, data: DaysOffSettings,
    db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin),
):
    teacher = await _teacher_or_404(db, user_id)
    teacher.days_off = apply_settings(teacher.days_off, data.weeks, data.dates)
    await db.commit()
    return current_settings(teacher.days_off)


# Какие дни выйдут выходными при несохранённых настройках — для календаря в
# редакторе: правило считается только на бэкенде, на фронте не повторяется.
@router.post("/teachers/{user_id}/days-off/preview", response_model=DaysOffPreviewOut)
async def preview_teacher_days_off(
    user_id: int, data: DaysOffPreviewIn,
    db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin),
):
    check_range(data.date_from, data.date_to)
    saved = (await _teacher_or_404(db, user_id)).days_off
    return {
        "dates": days_off_between(apply_settings(saved, data.weeks, data.dates), data.date_from, data.date_to),
        "pattern": days_off_between(apply_settings(saved, data.weeks, {}), data.date_from, data.date_to),
    }


@router.delete("/teachers/{user_id}")
async def delete_teacher(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.id == user_id, User.role == "teacher"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Педагог не найден")
    # Используется где-либо (группы, в т.ч. архивные; материалы, оценки…) —
    # 409 со списком мест, см. app/usages.py
    await ensure_not_used(db, "user", user_id)
    await db.delete(user)
    await db.commit()
    return {"detail": "Удалён"}

class TeacherStatsOut(BaseModel):
    id: int
    full_name: str
    group_count: int
    student_count: int
    attendance_pct: Optional[float] = None
    avg_score: Optional[float] = None
    lessons_held: int = 0  # проведённые уроки: урок открыт и на нём был хотя бы один студент


# Справочник преподов: по каждому — кол-во активных групп, уникальных
# активных студентов, % посещаемости и средний балл.
# Группы и студенты — по группам, где он основной педагог; проведённые уроки,
# посещаемость и балл — по урокам, которые вёл он сам (Lesson.teacher_id,
# app/lesson_teacher.py): уроки замены и уроки до передачи группы считаются
# тому, кто их вёл. В список попадают все, кто основной педагог хотя бы одной
# активной группы или вёл в ней урок (это может быть и admin).
@router.get("/teachers/directory", response_model=list[TeacherStatsOut])
async def get_teachers_directory(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    groups_result = await db.execute(
        select(Group.id, Group.teacher_id).where(Group.status == "active")
    )
    groups_by_teacher: dict[int, list[int]] = {}
    all_group_ids: list[int] = []
    for gid, tid in groups_result.all():
        groups_by_teacher.setdefault(tid, []).append(gid)
        all_group_ids.append(gid)

    if not groups_by_teacher:
        return []

    lesson_teacher = dict((await db.execute(
        select(Lesson.id, Lesson.teacher_id).where(Lesson.group_id.in_(all_group_ids))
    )).all())
    teacher_ids = list(set(groups_by_teacher) | set(lesson_teacher.values()))
    users_result = await db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(teacher_ids))
    )
    names = {uid: (full_name or username) for uid, full_name, username in users_result.all()}

    members_result = await db.execute(
        select(GroupMember.group_id, GroupMember.student_id)
        .where(GroupMember.group_id.in_(all_group_ids), GroupMember.status == "active")
    )
    students_by_group: dict[int, set[int]] = {}
    for gid, sid in members_result.all():
        students_by_group.setdefault(gid, set()).add(sid)

    marks_result = await db.execute(
        select(Lesson.teacher_id, LessonMark.score)
        .join(Lesson, Lesson.id == LessonMark.lesson_id)
        .where(Lesson.group_id.in_(all_group_ids), LessonMark.score.isnot(None))
    )
    scores_by_teacher: dict[int, list[int]] = {}
    for tid, score in marks_result.all():
        scores_by_teacher.setdefault(tid, []).append(score)

    # Проведённый урок — открыт педагогом и на нём отмечен хотя бы один
    # присутствовавший студент (очно или онлайн). Считается по активным
    # группам, как и остальные колонки справочника.
    held_result = await db.execute(
        select(Lesson.teacher_id, func.count(func.distinct(Lesson.id)))
        .join(LessonMark, LessonMark.lesson_id == Lesson.id)
        .where(
            Lesson.group_id.in_(all_group_ids),
            Lesson.is_open == True,
            LessonMark.attendance_status.in_(PRESENT),
        )
        .group_by(Lesson.teacher_id)
    )
    held_by_teacher = {tid: cnt for tid, cnt in held_result.all()}

    # Посещаемость — по общему правилу (attendance.py): пропуск = урок
    # заблокирован, ученик был в группе, а «был/онлайн/уважительная» нет.
    slots_by_teacher: dict[int, list] = {}
    for slot in await attendance_slots(db, all_group_ids):
        slots_by_teacher.setdefault(lesson_teacher.get(slot.lesson_id), []).append(slot)

    out = []
    for tid in teacher_ids:
        gids = groups_by_teacher.get(tid, [])
        student_ids: set[int] = set()
        for gid in gids:
            student_ids |= students_by_group.get(gid, set())
        scores = scores_by_teacher.get(tid, [])

        out.append(TeacherStatsOut(
            id=tid,
            full_name=names.get(tid, f"#{tid}"),
            group_count=len(gids),
            student_count=len(student_ids),
            attendance_pct=summarize(slots_by_teacher.get(tid, [])).pct,
            avg_score=round(sum(scores) / len(scores), 1) if scores else None,
            lessons_held=held_by_teacher.get(tid, 0),
        ))

    out.sort(key=lambda t: t.full_name.lower())
    return out


# Отчёт по педагогу за месяц (страница «Учителя» → клик по педагогу):
# сколько отработано и как — показатели качества, которые педагог не
# выставляет себе сам. Правила и нормы — app/teacher_report.py.
# Период — report_common.resolve_period: period=month (по умолчанию; month=ГГГГ-ММ,
# не задан — текущий) | year | all | custom (date_from, date_to — ГГГГ-ММ-ДД).
@router.get("/teachers/{user_id}/report")
async def get_teacher_report(
    user_id: int,
    period: Optional[str] = None,
    month: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    report_period = resolve_period(period, month, date_from, date_to)
    teacher = (await db.execute(
        select(User).where(User.id == user_id, User.role.in_(["teacher", "admin"]))
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Педагог не найден")
    return await build_teacher_report(db, teacher, report_period)


# ── АДМИНЫ ──

@router.get("/admins", response_model=list[UserOut])
async def get_admins(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.role == "admin"))
    return result.scalars().all()

@router.post("/admins", response_model=UserOut)
async def create_admin(data: UserCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.username == data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")
    await ensure_phone_free(db, data.phone)  # номер в базе не повторяется
    user = User(
        username=data.username,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        email=data.email,
        phone=data.phone,
        telegram_username=data.telegram_username,
        whatsapp=data.whatsapp,
        role="admin",
        created_by=admin.id
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

# Смена пароля любому пользователю (педагог, админ, ученик) — только admin,
# без старого пароля. Уже выданный токен пользователя действует до своего
# срока. Ученикам пароль меняет и педагог — см. students.py.
@router.put("/users/{user_id}/password", status_code=204)
async def set_user_password(
    user_id: int,
    data: NewPasswordIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user.hashed_password = get_password_hash(data.new_password)
    await db.commit()
    return Response(status_code=204)


class RoleIn(BaseModel):
    role: str  # teacher | admin


# Смена роли педагог ⇄ админ — только admin. Себе менять нельзя (так в
# системе всегда остаётся хотя бы один админ). Учеников не трогает. Группы,
# материалы и квизы остаются за пользователем: группу может вести и админ.
@router.put("/users/{user_id}/role", response_model=UserOut)
async def set_user_role(
    user_id: int,
    data: RoleIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    if data.role not in ("teacher", "admin"):
        raise HTTPException(status_code=400, detail="Недопустимая роль")
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Нельзя сменить роль самому себе")
    result = await db.execute(select(User).where(User.id == user_id, User.role.in_(["teacher", "admin"])))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user.role = data.role
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/admins/{user_id}", response_model=UserOut)
async def update_admin(
    user_id: int,
    data: UserAdminUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(User).where(User.id == user_id, User.role == "admin"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Админ не найден")
    await ensure_phone_free(db, data.phone, exclude_user_id=user.id)  # номер в базе не повторяется
    user.full_name = data.full_name
    user.email = data.email
    user.phone = data.phone
    user.telegram_username = data.telegram_username
    user.whatsapp = data.whatsapp
    await db.commit()
    await db.refresh(user)
    return user

@router.delete("/admins/{user_id}")
async def delete_admin(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.id == user_id, User.role == "admin"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Админ не найден")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    await ensure_not_used(db, "user", user_id)
    await db.delete(user)
    await db.commit()
    return {"detail": "Удалён"}

# ── КУРАТОРЫ (claude/curator-plan.md, шаг 3) ──
# Логин генерируется из ФИО (security.make_login), пароль = логину; админ
# выдаёт их куратору кнопками «Скопировать / Отправить». Телефон в базе не
# повторяется. Сброс пароля — общий PUT /users/{id}/password.

class CuratorCreate(BaseModel):
    full_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram_username: Optional[str] = None
    whatsapp: Optional[str] = None


class CuratorOut(UserOut):
    password_is_login: bool = False


def _curator_out(user: User) -> CuratorOut:
    out = CuratorOut.model_validate(user)
    out.password_is_login = verify_password(user.username, user.hashed_password)
    return out


@router.get("/curators", response_model=list[CuratorOut])
async def get_curators(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.role == "curator").order_by(User.full_name))
    return [_curator_out(u) for u in result.scalars().all()]


@router.post("/curators", response_model=CuratorOut)
async def create_curator(data: CuratorCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    full_name = (data.full_name or "").strip()
    if not full_name:
        raise HTTPException(status_code=422, detail="Укажите имя и фамилию куратора")
    phone = (data.phone or "").strip() or None
    await ensure_phone_free(db, phone)  # номер в базе не повторяется
    username = await make_login(db, full_name)
    user = User(
        username=username,
        hashed_password=get_password_hash(username),
        full_name=full_name,
        email=(data.email or "").strip() or None,
        phone=phone,
        telegram_username=(data.telegram_username or "").strip() or None,
        whatsapp=(data.whatsapp or "").strip() or None,
        role="curator",
        created_by=admin.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _curator_out(user)


@router.patch("/curators/{user_id}", response_model=CuratorOut)
async def update_curator(
    user_id: int,
    data: UserAdminUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(User).where(User.id == user_id, User.role == "curator"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Куратор не найден")
    await ensure_phone_free(db, data.phone, exclude_user_id=user.id)  # номер в базе не повторяется
    user.full_name = data.full_name
    user.email = data.email
    user.phone = data.phone
    user.telegram_username = data.telegram_username
    user.whatsapp = data.whatsapp
    await db.commit()
    await db.refresh(user)
    return _curator_out(user)


@router.delete("/curators/{user_id}")
async def delete_curator(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(User).where(User.id == user_id, User.role == "curator"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Куратор не найден")
    await ensure_not_used(db, "user", user_id)
    await db.delete(user)
    await db.commit()
    return {"detail": "Удалён"}

# ── КУРСЫ ──

@router.get("/courses", response_model=list[CourseOut])
async def get_courses(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(Course))
    return result.scalars().all()

@router.post("/courses", response_model=CourseOut)
async def create_course(data: CourseCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    course = Course(title=data.title, description=data.description)
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return course

@router.patch("/courses/{course_id}", response_model=CourseOut)
async def update_course(
    course_id: int,
    data: CourseUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Курс не найден")
    course.title = data.title
    course.description = data.description
    await db.commit()
    await db.refresh(course)
    return course

@router.delete("/courses/{course_id}")
async def delete_course(course_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Курс не найден")
    # Используется где-либо (группы, в т.ч. архивные; шаблонные материалы) —
    # 409 со списком мест, см. app/usages.py
    await ensure_not_used(db, "course", course_id)
    await db.delete(course)
    await db.commit()
    return {"detail": "Удалён"}

# ── ГРУППЫ ──

@router.get("/groups", response_model=list[GroupOut])
async def get_groups(db: AsyncSession = Depends(get_db), admin: User = Depends(require("groups.all"))):
    result = await db.execute(select(Group))
    groups = result.scalars().all()
    if not groups:
        return []

    group_ids = [g.id for g in groups]

    # Количество активных учеников по группам
    counts_result = await db.execute(
        select(GroupMember.group_id, func.count(GroupMember.id))
        .where(GroupMember.group_id.in_(group_ids), GroupMember.status == "active")
        .group_by(GroupMember.group_id)
    )
    counts = {gid: cnt for gid, cnt in counts_result.all()}

    # Имена преподавателей — раньше не подставлялись вообще (в отличие от
    # /groups/my), из-за чего в StudentsPage фильтр «Препод» показывал
    # «#<id>» вместо имени.
    teacher_ids = list({g.teacher_id for g in groups})
    teachers_result = await db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(teacher_ids))
    )
    teachers = {uid: (full_name or username) for uid, full_name, username in teachers_result.all()}

    out = []
    for g in groups:
        item = GroupOut.model_validate(g)
        item.student_count = counts.get(g.id, 0)
        item.teacher_name = teachers.get(g.teacher_id)
        out.append(item)
    return out

@router.post("/groups", response_model=GroupOut)
async def create_group(data: GroupCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    teacher_result = await db.execute(
        select(User).where(User.id == data.teacher_id, User.role.in_(["teacher", "admin"]))
    )
    if not teacher_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Выберите корректного педагога")

    if not await sector_exists(db, data.sector):
        raise HTTPException(status_code=400, detail="Выберите сектор группы")

    invite_code = secrets.token_urlsafe(8)
    group = Group(
        name=data.name,
        course_id=data.course_id,
        teacher_id=data.teacher_id,
        invite_code=invite_code,
        telegram_chat_id=data.telegram_chat_id,
        whatsapp=data.whatsapp,
        video_url=data.video_url,
        lesson_duration_min=data.lesson_duration_min,
        sector=data.sector
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: int,
    data: GroupUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    group_result = await db.execute(select(Group).where(Group.id == group_id))
    group = group_result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    teacher_result = await db.execute(
        select(User).where(User.id == data.teacher_id, User.role.in_(["teacher", "admin"]))
    )
    if not teacher_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Выберите корректного педагога")

    # Курс и сектор задаются при создании группы и не меняются: на них
    # держатся привязка материалов шаблона и язык названий уроков.
    if data.course_id != group.course_id:
        raise HTTPException(status_code=400, detail="Курс группы изменить нельзя")
    if data.sector is not None and data.sector != group.sector:
        raise HTTPException(status_code=400, detail="Сектор группы изменить нельзя")

    group.name = data.name
    # Смена педагога в карточке группы — передача с сегодняшнего дня: прошедшие
    # уроки остаются за тем, кто их вёл (app/lesson_teacher.py)
    if data.teacher_id != group.teacher_id:
        await assign_teacher(db, group, data.teacher_id, admin)
    group.telegram_chat_id = data.telegram_chat_id
    group.whatsapp = data.whatsapp
    group.video_url = data.video_url
    if data.lesson_duration_min is not None:
        group.lesson_duration_min = data.lesson_duration_min
    await db.commit()
    await db.refresh(group)
    return group

# Педагог уроков группы: замена на один урок, передача группы с такого-то
# урока, указание прежнего педагога. Отрезок — с урока по урок включительно;
# to_lesson_id не задан — до конца, и педагог становится основным в группе.
# Правила — app/lesson_teacher.py.
class AssignTeacherIn(BaseModel):
    teacher_id: int
    from_lesson_id: int
    to_lesson_id: Optional[int] = None


@router.post("/groups/{group_id}/assign-teacher")
async def assign_group_teacher(
    group_id: int,
    data: AssignTeacherIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    group = (await db.execute(select(Group).where(Group.id == group_id))).scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    changed = await assign_teacher(db, group, data.teacher_id, admin, data.from_lesson_id, data.to_lesson_id)
    await db.commit()
    return {"changed": changed, "teacher_id": group.teacher_id}


# Архив группы: активную группу нельзя удалить — только отправить в архив.
# Группа в архиве видна только по кнопке «Архив» (фильтр на фронте по status).
async def _set_group_status(db: AsyncSession, group_id: int, status: str) -> Group:
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    group.status = status
    await db.commit()
    await db.refresh(group)
    return group


@router.post("/groups/{group_id}/archive", response_model=GroupOut)
async def archive_group(group_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    return await _set_group_status(db, group_id, "archived")


@router.post("/groups/{group_id}/restore", response_model=GroupOut)
async def restore_group(group_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    return await _set_group_status(db, group_id, "active")


@router.delete("/groups/{group_id}")
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    if group.status != "archived":
        raise HTTPException(status_code=400, detail="Активную группу удалить нельзя — сначала отправьте её в архив")
    # Проверяем студентов
    members = await db.execute(select(GroupMember).where(GroupMember.group_id == group_id))
    if members.scalars().first():
        raise HTTPException(status_code=400, detail="Нельзя удалить — в группе есть студенты")
    # Проверяем уроки
    lessons = await db.execute(select(Lesson).where(Lesson.group_id == group_id))
    if lessons.scalars().first():
        raise HTTPException(status_code=400, detail="Нельзя удалить — в группе есть уроки")
    await db.delete(group)
    await db.commit()
    return {"detail": "Удалена"}