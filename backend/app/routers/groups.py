from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from ..database import get_db
from ..models import Group, GroupMember, Lesson, User, Course
from ..schemas import GroupOut, CourseOut, GroupInviteOut, clean_video_url, DURATION_MIN, DURATION_MAX
from ..dependencies import has_perm, require, require_teacher, get_current_user
from ..homework_status import oldest_lesson_to_review, to_review_by_group
from ..lesson_work import work_to_review_by_group, work_to_review_for_teacher

router = APIRouter(prefix="/groups", tags=["groups"])


# Общая проверка доступа к группе: admin — к любой, teacher — только к
# своей. Раньше дублировалась в каждом эндпоинте отдельным select'ом —
# вынесена сюда, т.к. с добавлением эндпоинтов по участникам группы
# (members/expel/restore/available-students) дублей стало бы 6+.
async def _get_owned_group(db: AsyncSession, group_id: int, current_user: User) -> Group:
    query = select(Group).where(Group.id == group_id)
    if current_user.role != "admin":
        query = query.where(Group.teacher_id == current_user.id)
    result = await db.execute(query)
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=403, detail="Нет доступа к этой группе")
    return group


def _active_student_ids():
    """Ученики, которые сейчас активно состоят хотя бы в одной группе."""
    return select(GroupMember.student_id).where(GroupMember.status == "active")


def _guest_group_ids(user_id: int):
    """Группы, где педагог не основной, но ведёт или вёл уроки (lesson_teacher.py)."""
    return select(Lesson.group_id).where(Lesson.teacher_id == user_id).distinct()


def _guest_group_out(group: Group, teacher_name: Optional[str]) -> GroupOut:
    """Группа глазами не основного педагога: только то, что нужно для списка
    его уроков, — без контактов, кода приглашения и учеников."""
    return GroupOut(
        id=group.id, name=group.name, course_id=group.course_id, teacher_id=group.teacher_id,
        telegram_chat_id=None, lesson_duration_min=group.lesson_duration_min, sector=group.sector,
        status=group.status, invite_code="", created_at=group.created_at,
        teacher_name=teacher_name, is_main=False,
    )


# Список курсов, read-only: педагогу — только курсы его групп (чужие курсы
# ему не отдаём вообще), админу — все. Отдельно от /admin/courses, который
# остаётся только для admin.
@router.get("/courses", response_model=list[CourseOut])
async def get_courses_for_teacher(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require("catalog.view"))
):
    query = select(Course)
    if not has_perm(current_user, "groups.all"):  # видит все группы — видит и все курсы
        query = query.where(Course.id.in_(select(Group.course_id).where(
            (Group.teacher_id == current_user.id) | Group.id.in_(_guest_group_ids(current_user.id))
        )))
    result = await db.execute(query.order_by(Course.title))
    return result.scalars().all()


# Группы ученика — для плашек «группа + вход в видеоконференцию» вверху
# кабинета студента. Только активное членство в активных группах.
# Путь из двух сегментов — не пересекается с /{group_id}.
class StudentGroupOut(BaseModel):
    id: int
    name: str
    video_url: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    whatsapp: Optional[str] = None
    teacher_name: Optional[str] = None  # для подсказки «У учителя … выходной» в календаре

    model_config = ConfigDict(from_attributes=True)


@router.get("/student/my", response_model=list[StudentGroupOut])
async def get_student_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            GroupMember.student_id == current_user.id,
            GroupMember.status == "active",
            Group.status == "active",
        )
        .order_by(Group.name)
    )
    groups = result.scalars().unique().all()
    names = {uid: (fn or un) for uid, fn, un in (await db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_({g.teacher_id for g in groups}))
    )).all()} if groups else {}
    out = []
    for g in groups:
        item = StudentGroupOut.model_validate(g)
        item.teacher_name = names.get(g.teacher_id)
        out.append(item)
    return out


# Группы, куда ученик записался по QR и ждёт подтверждения педагога (Главная ученика)
@router.get("/student/pending")
async def get_student_pending_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rows = (await db.execute(
        select(Group.id, Group.name)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.student_id == current_user.id, GroupMember.status == "pending", Group.status == "active")
        .order_by(Group.name)
    )).all()
    return [{"id": gid, "name": name} for gid, name in rows]


# Настройки группы, которые может менять сам педагог (своей группы; admin —
# любой): название, контакты, ссылка на видеоконференцию, длительность
# урока по умолчанию (на уже созданные уроки не влияет). Курс, педагог и
# сектор — только через /admin/groups.
class GroupSettingsIn(BaseModel):
    name: str
    telegram_chat_id: Optional[str] = None
    whatsapp: Optional[str] = None
    video_url: Optional[str] = None
    lesson_duration_min: Optional[int] = Field(default=None, ge=DURATION_MIN, le=DURATION_MAX)  # None — не менять

    @field_validator("name")
    @classmethod
    def _check_name(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("Название группы не может быть пустым")
        return v

    @field_validator("telegram_chat_id", "whatsapp")
    @classmethod
    def _strip(cls, v):
        v = (v or "").strip()
        return v or None

    @field_validator("video_url")
    @classmethod
    def _check_video_url(cls, v):
        return clean_video_url(v)


@router.patch("/{group_id}/settings", response_model=GroupOut)
async def update_group_settings(
    group_id: int,
    data: GroupSettingsIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    group = await _get_owned_group(db, group_id, current_user)
    group.name = data.name
    group.telegram_chat_id = data.telegram_chat_id
    group.whatsapp = data.whatsapp
    group.video_url = data.video_url
    if data.lesson_duration_min is not None:
        group.lesson_duration_min = data.lesson_duration_min
    await db.commit()
    await db.refresh(group)
    return await get_group_detail(group.id, db, current_user)


# Мои группы — с количеством учеников и именем преподавателя.
# У admin, в отличие от teacher, есть выбор области видимости (тот же
# смысл, что и в /students — см. _scope_group_ids в students.py):
# teacher_id=<id> — группы конкретного препода, mine=true — только свои,
# ни то ни другое — вообще все группы.
# with_guest=true — ещё и группы, где педагог не основной, но ведёт или вёл
# отдельные уроки (is_main=False, без контактов и учеников): нужны страницам
# «Мои группы» и «Группа», остальным потребителям списка — нет.
@router.get("/my", response_model=list[GroupOut])
async def get_my_groups(
    teacher_id: Optional[int] = None,
    mine: bool = False,
    with_guest: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    query = select(Group)
    if current_user.role != "admin":
        query = query.where(Group.teacher_id == current_user.id)
    elif mine:
        query = query.where(Group.teacher_id == current_user.id)
    elif teacher_id is not None:
        query = query.where(Group.teacher_id == teacher_id)

    result = await db.execute(query)
    groups = result.scalars().all()

    # admin видит любую группу целиком и так — «гостевой» вид только у педагога
    guest_groups = []
    if with_guest and current_user.role != "admin":
        guest_groups = (await db.execute(
            select(Group).where(Group.id.in_(_guest_group_ids(current_user.id)), Group.teacher_id != current_user.id)
        )).scalars().all()
    if not groups and not guest_groups:
        return []

    group_ids = [g.id for g in groups]

    # Количество активных учеников по группам
    counts_result = await db.execute(
        select(GroupMember.group_id, func.count(GroupMember.id))
        .where(GroupMember.group_id.in_(group_ids), GroupMember.status == "active")
        .group_by(GroupMember.group_id)
    )
    counts = {gid: cnt for gid, cnt in counts_result.all()}

    # Имена преподавателей
    teacher_ids = list({g.teacher_id for g in [*groups, *guest_groups]})
    teachers_result = await db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(teacher_ids))
    )
    teachers = {uid: (full_name or username) for uid, full_name, username in teachers_result.all()}
    to_review = await to_review_by_group(db, group_ids)
    work_to_review = await work_to_review_by_group(db, group_ids)
    pending = dict((await db.execute(
        select(GroupMember.group_id, func.count(GroupMember.id))
        .where(GroupMember.group_id.in_(group_ids), GroupMember.status == "pending")
        .group_by(GroupMember.group_id)
    )).all())

    out = []
    for g in groups:
        item = GroupOut.model_validate(g)
        item.student_count = counts.get(g.id, 0)
        item.teacher_name = teachers.get(g.teacher_id)
        item.homework_to_review = to_review.get(g.id, 0)
        item.work_to_review = work_to_review.get(g.id, 0)
        item.pending_count = pending.get(g.id, 0)
        out.append(item)
    out += [_guest_group_out(g, teachers.get(g.teacher_id)) for g in guest_groups]
    return out


# Флаг «Проверь ДЗ» в шапке педагога: сколько ответов ждут проверки в его
# активных группах и с какого урока начать (самый давний ответ). У админа —
# только по группам, где он сам педагог.
@router.get("/homework-to-review")
async def get_homework_to_review(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    group_ids = [row[0] for row in (await db.execute(
        select(Group.id).where(Group.teacher_id == current_user.id, Group.status == "active")
    )).all()]
    counts = await to_review_by_group(db, group_ids)
    return {
        "count": sum(counts.values()),
        "lesson_id": await oldest_lesson_to_review(db, list(counts)),
    }


# Флаг «Проверь работы» в шапке педагога: ученики, сдавшие работу на уроке,
# который ведёт этот педагог (в его активных группах, в т.ч. замена), и урок,
# с которого начать (самый давний непроверенный файл).
@router.get("/work-to-review")
async def get_work_to_review(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    group_ids = [row[0] for row in (await db.execute(
        select(Group.id).where(Group.status == "active")
    )).all()]
    return await work_to_review_for_teacher(db, current_user.id, group_ids)

# Данные одной группы (teacher — только свою, admin — любую)
@router.get("/{group_id}", response_model=GroupOut)
async def get_group_detail(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    group_query = select(Group).where(Group.id == group_id)
    if current_user.role != "admin":
        group_query = group_query.where(Group.teacher_id == current_user.id)

    result = await db.execute(group_query)
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    count_result = await db.execute(
        select(func.count(GroupMember.id))
        .where(GroupMember.group_id == group.id, GroupMember.status == "active")
    )
    student_count = count_result.scalar() or 0

    teacher_result = await db.execute(
        select(User.full_name, User.username).where(User.id == group.teacher_id)
    )
    row = teacher_result.first()
    teacher_name = (row[0] or row[1]) if row else None

    item = GroupOut.model_validate(group)
    item.student_count = student_count
    item.teacher_name = teacher_name
    item.pending_count = (await db.execute(
        select(func.count(GroupMember.id))
        .where(GroupMember.group_id == group.id, GroupMember.status == "pending")
    )).scalar() or 0
    return item

class GroupMemberOut(BaseModel):
    id: int  # id ученика (User.id) — как и раньше, фронт ждёт это поле
    full_name: Optional[str] = None
    username: str
    phone: Optional[str] = None  # телефон ученика — колонка в окне «Ученики»
    created_at: datetime
    membership_id: int  # id самой записи group_members — нужен для expel/restore
    status: str
    expel_reason: Optional[str] = None
    expelled_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AddMemberIn(BaseModel):
    student_id: int


class ExpelMemberIn(BaseModel):
    reason: str


# Участники группы — по умолчанию активные, ?status=expelled — архив
# (отчисленные, с причиной и датой), ?status=pending — новые: записались по
# QR и ждут подтверждения.
@router.get("/{group_id}/students", response_model=list[GroupMemberOut])
async def get_group_students(
    group_id: int,
    status: str = "active",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    if status not in ("active", "expelled", "pending"):
        raise HTTPException(status_code=400, detail="status должен быть active, expelled или pending")
    await _get_owned_group(db, group_id, current_user)

    result = await db.execute(
        select(User, GroupMember)
        .join(GroupMember, GroupMember.student_id == User.id)
        .where(GroupMember.group_id == group_id, GroupMember.status == status)
        .order_by(User.full_name, User.username)
    )
    out = []
    for user, member in result.all():
        out.append(GroupMemberOut(
            id=user.id,
            full_name=user.full_name,
            username=user.username,
            phone=user.phone,
            created_at=user.created_at,
            membership_id=member.id,
            status=member.status,
            expel_reason=member.expel_reason,
            expelled_at=member.expelled_at,
        ))
    return out


# Поиск учеников для добавления в группу — по имени/логину, исключая тех,
# кто уже состоит в ней активно (повторно отчисленного добавить можно —
# POST /members сам поймёт, что это восстановление, см. ниже).
@router.get("/{group_id}/available-students", response_model=list[GroupMemberOut])
async def search_available_students(
    group_id: int,
    q: str = "",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await _get_owned_group(db, group_id, current_user)

    already_active = select(GroupMember.student_id).where(
        GroupMember.group_id == group_id, GroupMember.status == "active"
    )
    query = select(User).where(User.role == "student", User.id.notin_(already_active))
    # Ученика, который уже учится в другой группе, записывает только админ (students.move)
    if not has_perm(current_user, "students.move"):
        query = query.where(User.id.notin_(_active_student_ids()))
    q = q.strip()
    if q:
        like = f"%{q}%"
        query = query.where(or_(User.full_name.ilike(like), User.username.ilike(like)))
    query = query.order_by(User.full_name, User.username).limit(20)

    result = await db.execute(query)
    out = []
    for user in result.scalars().all():
        out.append(GroupMemberOut(
            id=user.id, full_name=user.full_name, username=user.username,
            created_at=user.created_at, membership_id=0, status="",
        ))
    return out


# Добавить существующего ученика в группу (не через инвайт-код — тот
# создаёт НОВОГО пользователя, тут ученик уже есть). Если он уже был в
# этой группе и отчислен — это восстановление того же членства, а не
# новая запись (иначе задвоили бы историю group_members на одного и того
# же ученика в одной группе).
@router.post("/{group_id}/members", response_model=GroupMemberOut)
async def add_group_member(
    group_id: int,
    data: AddMemberIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await _get_owned_group(db, group_id, current_user)

    student_result = await db.execute(
        select(User).where(User.id == data.student_id, User.role == "student")
    )
    student = student_result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")
    if not has_perm(current_user, "students.move"):
        busy = (await db.execute(
            select(GroupMember.id).where(GroupMember.student_id == student.id, GroupMember.status == "active")
        )).first()
        if busy:
            raise HTTPException(status_code=403, detail="Ученик уже учится в другой группе — перевести его может только администратор")

    existing_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.student_id == data.student_id
        )
    )
    member = existing_result.scalar_one_or_none()
    if member and member.status == "active":
        raise HTTPException(status_code=400, detail="Ученик уже в этой группе")

    if member:
        # Повторное добавление отчисленного: новая дата вступления — уроки
        # между отчислением и возвращением не считаются пропусками
        # (attendance.py). «Восстановить» (restore) дату не трогает — это
        # отмена ошибочного отчисления.
        member.status = "active"
        member.joined_at = datetime.now(timezone.utc)
        member.expel_reason = None
        member.expelled_at = None
        member.expelled_by = None
    else:
        member = GroupMember(group_id=group_id, student_id=data.student_id, status="active")
        db.add(member)

    await db.commit()
    await db.refresh(member)
    return GroupMemberOut(
        id=student.id, full_name=student.full_name, username=student.username,
        created_at=student.created_at, membership_id=member.id, status=member.status,
    )


# Отчислить из ЭТОЙ группы — комментарий обязателен (не молчаливое
# "куда-то делся", а видимая причина: не оплатил, закончил курс и т.д.).
# Ученик остаётся активным в других своих группах, если они есть.
@router.post("/{group_id}/members/{student_id}/expel", response_model=GroupMemberOut)
async def expel_group_member(
    group_id: int,
    student_id: int,
    data: ExpelMemberIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await _get_owned_group(db, group_id, current_user)

    reason = data.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину отчисления")

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.student_id == student_id,
            GroupMember.status == "active",
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Ученик не найден среди активных участников группы")

    member.status = "expelled"
    member.expel_reason = reason
    member.expelled_at = datetime.now(timezone.utc)
    member.expelled_by = current_user.id
    await db.commit()

    student_result = await db.execute(select(User).where(User.id == student_id))
    student = student_result.scalar_one()
    return GroupMemberOut(
        id=student.id, full_name=student.full_name, username=student.username,
        created_at=student.created_at, membership_id=member.id, status=member.status,
        expel_reason=member.expel_reason, expelled_at=member.expelled_at,
    )


# Вернуть из архива — ученик мог пропустить месяц (за неуплату и т.п.) и
# вернуться; причину/дату отчисления не храним, "чистое" восстановление.
@router.post("/{group_id}/members/{student_id}/restore", response_model=GroupMemberOut)
async def restore_group_member(
    group_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await _get_owned_group(db, group_id, current_user)

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.student_id == student_id,
            GroupMember.status == "expelled",
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Ученик не найден в архиве этой группы")

    member.status = "active"
    member.expel_reason = None
    member.expelled_at = None
    member.expelled_by = None
    await db.commit()

    student_result = await db.execute(select(User).where(User.id == student_id))
    student = student_result.scalar_one()
    return GroupMemberOut(
        id=student.id, full_name=student.full_name, username=student.username,
        created_at=student.created_at, membership_id=member.id, status=member.status,
    )

async def _pending_member(db: AsyncSession, group_id: int, student_id: int) -> tuple[GroupMember, User]:
    row = (await db.execute(
        select(GroupMember, User).join(User, User.id == GroupMember.student_id).where(
            GroupMember.group_id == group_id, GroupMember.student_id == student_id,
            GroupMember.status == "pending",
        )
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Заявка не найдена — ученик уже принят или отклонён")
    return row[0], row[1]


# Принять нового ученика (записался по QR): с этого момента он в группе —
# дата вступления = сегодня, более ранние уроки ему не в счёт (attendance.py).
@router.post("/{group_id}/members/{student_id}/accept", response_model=GroupMemberOut)
async def accept_group_member(
    group_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await _get_owned_group(db, group_id, current_user)
    member, student = await _pending_member(db, group_id, student_id)
    member.status = "active"
    member.joined_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(member)
    return GroupMemberOut(
        id=student.id, full_name=student.full_name, username=student.username, phone=student.phone,
        created_at=student.created_at, membership_id=member.id, status=member.status,
    )


# Отклонить заявку. Ученик больше нигде не состоит — аккаунт удаляется целиком
# (телефон освобождается); есть другие группы — убирается только эта запись.
@router.post("/{group_id}/members/{student_id}/decline")
async def decline_group_member(
    group_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await _get_owned_group(db, group_id, current_user)
    member, student = await _pending_member(db, group_id, student_id)
    other = (await db.execute(select(GroupMember.id).where(
        GroupMember.student_id == student_id, GroupMember.id != member.id,
    ).limit(1))).first()
    await db.delete(member)
    if other is None and student.role == "student":
        await db.delete(student)
    await db.commit()
    return {"ok": True, "account_deleted": other is None}


# Публичный: данные группы по invite-коду (для страницы регистрации)
@router.get("/invite/{invite_code}", response_model=GroupInviteOut)
async def get_group_by_invite(
    invite_code: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Group).where(Group.invite_code == invite_code))
    group = result.scalar_one_or_none()
    if not group or group.status != "active":  # архивная группа учеников не принимает
        raise HTTPException(status_code=404, detail="Приглашение недействительно")

    course_result = await db.execute(select(Course).where(Course.id == group.course_id))
    course = course_result.scalar_one_or_none()

    return GroupInviteOut(
        id=group.id,
        name=group.name,
        course_title=course.title if course else None
    )