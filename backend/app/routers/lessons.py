import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from datetime import datetime, date as date_type, timedelta, timezone as dt_timezone
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict
from ..schemas import DURATION_MIN, DURATION_MAX
from .academy import lesson_word
from ..lesson_lock import BAKU_TZ, is_date_locked
from ..attendance import PRESENT, attendance_slots
from ..lesson_lock import aware
from ..homework_status import awaiting_review, student_homework_debts
from ..lesson_work import has_work_files, lessons_with_work_to_review
from ..lesson_teacher import can_edit_lesson, can_view_lesson, is_group_teacher
from ..days_off import (
    check_range, conflict_detail, days_off_between, ensure_lessons_allowed, find_conflicts,
    format_dates, student_days_off,
)
from ..personal import (
    is_participant, lesson_student_ids, lesson_students_condition, participant_names,
    set_participants, visible_to_student,
)
from ..database import get_db
from .. import storage
from ..models import (
    Lesson, Group, GroupMember, User, LessonMark, LessonResource, Material, Link, Quiz,
    HomeworkTask, HomeworkAnswer, HomeworkAnswerFile, LessonMessage, LessonStudent, LessonFeedback,
    LessonWorkFile, Room,
)
from ..dependencies import has_perm, require, require_teacher, get_current_user
from ..resources import RESOURCE_MODELS, RESOURCE_NOT_FOUND, fetch_resource_details, resource_exists

router = APIRouter(prefix="/lessons", tags=["lessons"])

ALLOWED_ATTENDANCE_STATUSES = {"in_person", "online", "excused", "absent"}


# Схемы прямо здесь — потом перенесём в schemas.py
class LessonCreate(BaseModel):
    group_id: int
    title: Optional[str] = None  # не задано — «Урок» на языке сектора группы (academy.lesson_word)
    order: int = 0
    date: Optional[datetime] = None
    duration_min: Optional[int] = Field(default=None, ge=DURATION_MIN, le=DURATION_MAX)  # не задано — из группы
    source: Optional[str] = "teacher"  # academy | teacher
    # Персональный урок: только для выбранных учеников этой группы (app/personal.py)
    is_personal: bool = False
    student_ids: list[int] = []

class ParticipantsIn(BaseModel):
    student_ids: list[int]

class LessonParticipantOut(BaseModel):
    id: int
    full_name: str

class LessonUpdate(BaseModel):
    title: Optional[str] = None
    order: Optional[int] = None
    date: Optional[datetime] = None
    duration_min: Optional[int] = Field(default=None, ge=DURATION_MIN, le=DURATION_MAX)
    comment: Optional[str] = None
    private_note: Optional[str] = None  # «Заметки для себя» — пишет педагог урока или админ

class LessonOut(BaseModel):
    id: int
    group_id: int
    title: str
    order: int
    date: Optional[datetime]
    duration_min: int = 120  # конец урока = date + duration_min (считает фронт)
    is_open: bool
    source: Optional[str]
    comment: Optional[str] = None
    # «Заметки для себя» (lessons.private_note) — только педагогу/админу и только
    # из GET /lessons/{id} и PATCH; имя поля другое, чтобы from_attributes не
    # подхватил заметки в списки уроков ученика.
    teacher_notes: Optional[str] = None
    created_at: datetime
    created_by: Optional[int] = None  # кто создал урок (куратор переносит свои)
    # Персональный урок и его участники (участников отдаём только педагогу/админу)
    is_personal: bool = False
    participants: list[LessonParticipantOut] = []
    # Есть ответы на ДЗ без оценки — подсветка урока в списке и календаре
    has_unreviewed_homework: bool = False
    # Есть непроверенная работа на уроке (app/lesson_work.py) — только тому, кто ведёт урок
    has_unreviewed_work: bool = False
    # Прошла полночь по Баку — нельзя удалить/перенести, менять присутствие и оценку за урок
    # (для админа всегда False)
    is_locked: bool = False
    # Только для /lessons/student: что у студента в уроке не закрыто
    hw_todo: Optional[str] = None  # pending — сдать ДЗ | returned — вернули на доработку
    new_messages: int = 0          # новые реплики педагога в диалоге
    # Только для GET /lessons/{id}: группа урока и вход в видеоконференцию
    group_name: Optional[str] = None
    # Сектор и курс группы — окно «Добавить из базы знаний» открывается на них
    group_sector: Optional[str] = None
    group_course_id: Optional[int] = None
    group_video_url: Optional[str] = None
    group_telegram: Optional[str] = None
    group_whatsapp: Optional[str] = None
    # Педагог урока (app/lesson_teacher.py) — только педагогу/админу.
    teacher_id: Optional[int] = None
    teacher_name: Optional[str] = None   # заполняется, если урок ведёт не основной педагог группы
    teacher_photo_url: Optional[str] = None  # фото этого педагога (GET /auth/photo/{teacher_id})
    # Ученику в GET /lessons/{id} — всегда педагог, который ведёт урок: teacher_id,
    # teacher_name и teacher_photo_url (фото в шапке открытого урока)
    can_edit: bool = True                # False — урок доступен только для просмотра
    can_manage: bool = True              # расписание и состав урока: основной педагог группы и админ
    # Аудитория урока: id и номер («А2» в календарях и в уроке) — только педагогу/админу/куратору
    room_id: Optional[int] = None
    room_number: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class LessonMarkIn(BaseModel):
    attendance_status: Optional[str] = None  # in_person | online | excused | absent | None
    is_late: bool = False
    score: Optional[int] = Field(default=None, ge=0, le=100)
    exam_score: Optional[int] = Field(default=None, ge=0, le=100)  # ставит препод вручную или живой квиз-"Экзамен"
    stars: Optional[int] = Field(default=None, ge=0, le=3)
    comment: Optional[str] = None


class LessonMarkBulkItem(LessonMarkIn):
    student_id: int


class LessonMarkOut(BaseModel):
    student_id: int
    full_name: Optional[str]
    photo_url: Optional[str] = None  # фото ученика (GET /auth/photo/{student_id})
    telegram_username: Optional[str] = None
    whatsapp: Optional[str] = None
    phone: Optional[str] = None   # значок WhatsApp ученика открывается по телефону
    attendance_status: Optional[str]
    is_late: bool
    score: Optional[int]
    exam_score: Optional[int]
    stars: Optional[int]
    comment: Optional[str]
    marked_at: Optional[datetime]


class MyPerformanceRowOut(BaseModel):
    lesson_id: int
    lesson_title: str
    date: Optional[datetime]
    attendance_status: Optional[str]
    is_late: bool
    score: Optional[int]
    exam_score: Optional[int]
    hw_grades: list[int] = []      # оценки за ДЗ этого урока (заданий может быть несколько)
    status_label: str = "—"        # посещаемость текстом: «Пришёл», «Онлайн», «Пропуск»…


class LessonItemOut(BaseModel):
    id: int  # lesson_resources.id
    resource_type: str  # material | quiz | link
    resource_id: int
    title: str
    content_type: Optional[str] = None   # material
    size_bytes: Optional[int] = None     # material
    template_type: Optional[str] = None  # quiz
    topic: Optional[str] = None          # quiz
    url: Optional[str] = None            # link
    added_by_name: Optional[str] = None
    added_at: Optional[datetime] = None
    # Квиз можно редактировать (кнопка-карандаш в уроке): автор или admin —
    # то же правило, что в quizzes._editable_quiz_query
    can_edit: bool = False


class LessonItemAttach(BaseModel):
    resource_type: str  # material | quiz | link
    resource_id: int


# Генератор расписания группы (claude/group-schedule-plan.md, задача 1).
# MVP: одно время на все выбранные дни недели, длина серии — количеством
# уроков (не датой окончания — так проще сочетается с шаблоном курса).
class ScheduleGenerate(BaseModel):
    group_id: int
    start_date: date_type
    start_time: str  # "HH:MM", одно и то же время для всех уроков серии
    weekdays: list[int] = Field(min_length=1)  # 0=Пн .. 6=Вс (date.weekday())
    lesson_count: int = Field(ge=1, le=200)
    # Номер первого урока серии (группа может начинать не с 1, а, например, с 10);
    # материалы шаблона и другой группы привязываются по этому же номеру
    start_order: int = Field(default=1, ge=1, le=500)
    duration_min: Optional[int] = Field(default=None, ge=DURATION_MIN, le=DURATION_MAX)  # не задано — из группы
    fill_source: Optional[str] = None  # "template" | "group"
    fill_group_id: Optional[int] = None  # обязателен при fill_source == "group"
    # Педагог сам ставит серию на свои выходные — подтвердил повторным нажатием (app/days_off.py)
    confirm_days_off: bool = False


# Дозаполнение/обновление материалов уже существующих уроков по шаблону
# курса или по другой (уже обкатанной) группе — сопоставление по
# порядковой позиции урока в серии, не по дате (claude/course-templates-plan.md).
class FillScheduleRequest(BaseModel):
    source: str  # "template" | "group"
    fill_group_id: Optional[int] = None  # обязателен при source == "group"
    range_from: int = Field(ge=1)
    range_to: int = Field(ge=1)
    mode: str = "add"  # "add" (Дополнить) | "replace" (Заменить)


# Открыть / закрыть сразу несколько уроков группы — по номерам с..по
class OpenRangeRequest(BaseModel):
    range_from: int = Field(ge=1)
    range_to: int = Field(ge=1)
    is_open: bool = True


def is_lesson_locked(lesson: Lesson) -> bool:
    # Правило блокировки — в lesson_lock.py (им же пользуется посещаемость)
    return is_date_locked(lesson.date)


# После полуночи (по Баку) урок частично блокируется (решение Андрея, 2026-09-25):
#  - нельзя удалить урок и перенести его (дата, «выходной»);
#  - нельзя менять оценку за урок и присутствие (включая «опоздал»),
#    КРОМЕ «уважительной причины» у отсутствовавшего — её можно ставить/снимать всегда;
#  - оценку за урок ученику, сдавшему работу на уроке, можно ставить и менять
#    и после полуночи (работы проверяются позже, в т.ч. через «Проверку ИИ»);
#  - экзамен, звёзды, ДЗ, диалог, материалы — не блокируются.
# Админ блокировку не видит.
LOCK_DETAIL = "Прошла полночь по Баку — {what} менять нельзя"
_NOT_PRESENT = {None, "absent", "excused"}


def lesson_locked_for(lesson: Lesson, user: User) -> bool:
    return is_lesson_locked(lesson) and user.role != "admin"


def _check_mark_lock(old: Optional["LessonMark"], data: "LessonMarkIn", score_open: bool = False) -> None:
    old_status = (old.attendance_status if old else None) or None
    new_status = data.attendance_status or None
    if not score_open and (old.score if old else None) != data.score:
        raise HTTPException(status_code=403, detail=LOCK_DETAIL.format(what="оценку за урок"))
    if bool(old.is_late if old else False) != bool(data.is_late):
        raise HTTPException(status_code=403, detail=LOCK_DETAIL.format(what="опоздание"))
    if old_status != new_status and not (old_status in _NOT_PRESENT and new_status in _NOT_PRESENT):
        raise HTTPException(status_code=403, detail=LOCK_DETAIL.format(what="присутствие (можно только уважительную причину)"))


def validate_attendance_status(value: Optional[str]) -> None:
    if value is not None and value not in ALLOWED_ATTENDANCE_STATUSES:
        raise HTTPException(status_code=422, detail=f"Недопустимый статус посещаемости: {value}")


# Текстовый статус для студента — та же логика, что у полей учителя
# (attendance_status + независимый is_late), просто словами и без
# контролов. is_late осмыслен только при in_person/online — как и в форме
# учителя, где чекбокс "опоздал" задизейблен для остальных статусов.
_STATUS_LABELS = {
    "in_person": "Был",
    "online": "Онлайн",
    "excused": "Ув.прич",
    "absent": "Пропуск",
    "made_up": "Пропуск закрыт",
}


VIEW_ONLY_DETAIL = "Урок доступен только для просмотра"
MANAGE_DETAIL = "Это может сделать только основной педагог группы"


async def get_lesson_for_teacher_or_admin(
    lesson_id: int,
    db: AsyncSession,
    current_user: User,
    write: bool = True,
    manage: bool = False,
):
    """Урок для педагога/админа. write=True (по умолчанию) — для любых
    изменений в уроке; write=False — только чтение; manage=True — расписание
    и состав урока (удалить, перенести, участники): основной педагог группы
    и админ. Кто что может — lesson_teacher.py."""
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")

    group_teacher_id = (await db.execute(
        select(Group.teacher_id).where(Group.id == lesson.group_id)
    )).scalar_one_or_none()
    if group_teacher_id is None or not can_view_lesson(lesson, group_teacher_id, current_user):
        raise HTTPException(status_code=403, detail="Нет доступа")
    if manage and not is_group_teacher(group_teacher_id, current_user):
        raise HTTPException(status_code=403, detail=MANAGE_DETAIL)
    if write and not can_edit_lesson(lesson, group_teacher_id, current_user):
        raise HTTPException(status_code=403, detail=VIEW_ONLY_DETAIL)

    return lesson


async def get_accessible_group(group_id: int, db: AsyncSession, current_user: User) -> Group:
    """Доступ к группе для операций над расписанием: admin — к любой,
    teacher — только к своей. Используется генератором/дозаполнением/
    массовым удалением уроков — тот же контроль доступа, что и везде в
    этом файле, просто вынесен в одно место, чтобы не повторять запрос."""
    group_query = select(Group).where(Group.id == group_id)
    if current_user.role != "admin":
        group_query = group_query.where(Group.teacher_id == current_user.id)
    result = await db.execute(group_query)
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=403, detail="Нет доступа к этой группе")
    return group


# Номер урока в шаблоне ("5.2", "5", "Урок 5") -> (модуль, день) для
# сортировки — та же схема, что parseLessonNo на фронте (KnowledgeBasePage.jsx).
# Нераспознанное отправляем в конец, чтобы не портило сортировку остальных.
def _parse_lesson_no(value: Optional[str]) -> tuple:
    if not value:
        return (10**6, 0)
    match = re.search(r"(\d+)(?:\D+(\d+))?", value)
    if not match:
        return (10**6, 0)
    major = int(match.group(1))
    minor = int(match.group(2)) if match.group(2) else 0
    return (major, minor)


# Шаблонные материалы курса+сектора (только approved), сгруппированные по
# ПОРЯДКОВОЙ позиции в серии — не по литеральному template_lesson_no
# (см. claude/course-templates-plan.md, "как считать номер урока"):
# берём все различные template_lesson_no, сортируем, нумеруем 1..K —
# эта позиция и сопоставляется с Lesson.order при заполнении.
async def _collect_template_positions(
    db: AsyncSession, course_id: int, sector: str
) -> dict[int, list[tuple[str, int]]]:
    tagged: list[tuple[str, int, str]] = []  # (resource_type, resource_id, template_lesson_no)
    for model, resource_type in ((Material, "material"), (Link, "link"), (Quiz, "quiz")):
        rows = await db.execute(
            select(model.id, model.template_lesson_no).where(
                model.course_id == course_id,
                model.sector == sector,
                model.template_status == "approved",
                model.template_lesson_no.isnot(None),
            )
        )
        for resource_id, lesson_no in rows.all():
            tagged.append((resource_type, resource_id, lesson_no))

    distinct_numbers = sorted({lesson_no for _, _, lesson_no in tagged}, key=_parse_lesson_no)
    position_by_no = {lesson_no: i + 1 for i, lesson_no in enumerate(distinct_numbers)}

    positions: dict[int, list[tuple[str, int]]] = {}
    for resource_type, resource_id, lesson_no in tagged:
        positions.setdefault(position_by_no[lesson_no], []).append((resource_type, resource_id))
    return positions


async def _attach_resource(
    db: AsyncSession, lesson_id: int, resource_type: str, resource_id: int, current_user: User,
) -> bool:
    """Привязывает ресурс (файл / квиз / ссылка) к уроку, без commit.
    False — он уже был привязан."""
    existing = await db.execute(
        select(LessonResource).where(
            LessonResource.lesson_id == lesson_id,
            LessonResource.resource_type == resource_type,
            LessonResource.resource_id == resource_id,
        )
    )
    if existing.scalar_one_or_none():
        return False
    db.add(LessonResource(
        lesson_id=lesson_id,
        resource_type=resource_type,
        resource_id=resource_id,
        added_by=current_user.id,
        added_at=datetime.now(dt_timezone.utc),
    ))
    return True


# Раскладывает подобранные по позиции ресурсы по конкретным урокам.
# mode="replace" — сперва отвязывает всё текущее у этих уроков (Заменить),
# mode="add" — просто добавляет недостающее, существующее не трогает
# (Дополнить). lesson.id должен быть уже присвоен (после db.flush()).
async def _apply_positions_to_lessons(
    db: AsyncSession,
    lessons_by_order: dict[int, Lesson],
    positions: dict[int, list[tuple[str, int]]],
    mode: str,
    current_user: User,
) -> int:
    attached = 0
    for order, lesson in lessons_by_order.items():
        items = positions.get(order, [])
        if mode == "replace":
            await db.execute(delete(LessonResource).where(LessonResource.lesson_id == lesson.id))
        for resource_type, resource_id in items:
            attached += await _attach_resource(db, lesson.id, resource_type, resource_id, current_user)
    return attached


async def get_lesson_for_student(
    lesson_id: int,
    db: AsyncSession,
    current_user: User
) -> Lesson:
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")

    if not lesson.is_open:
        raise HTTPException(status_code=403, detail="Урок ещё не открыт")

    member = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == lesson.group_id,
            GroupMember.student_id == current_user.id,
            GroupMember.status == "active",
        )
    )
    if not member.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Нет доступа")
    # Персональный урок — только участникам
    if not await is_participant(db, lesson, current_user.id):
        raise HTTPException(status_code=403, detail="Нет доступа")

    return lesson


# ---------- ДЗ: общее для уроков (сами эндпойнты ДЗ — routers/homework.py) ----------

def _safe_delete_object(object_key: str) -> None:
    try:
        storage.delete_object(object_key)
    except Exception:
        pass


async def delete_homework_tasks(db: AsyncSession, task_ids: list[int]) -> None:
    """Задания + их персональные файлы (если больше нигде не используются).
    Ответы студентов привязаны к уроку, а не к заданию, — их не трогаем."""
    if not task_ids:
        return
    material_ids = {r[0] for r in (await db.execute(
        select(HomeworkTask.material_id).where(HomeworkTask.id.in_(task_ids))
    )).all()}
    await db.execute(delete(HomeworkTask).where(HomeworkTask.id.in_(task_ids)))
    for m in (await db.execute(
        select(Material).where(Material.id.in_(material_ids), Material.is_personal == True)
    )).scalars().all():
        still_used = (await db.execute(
            select(HomeworkTask.id).where(HomeworkTask.material_id == m.id).limit(1)
        )).first()
        if not still_used:
            _safe_delete_object(m.object_key)
            await db.delete(m)


async def delete_lessons_homework(db: AsyncSession, lesson_ids: list[int]) -> None:
    """Вызывать перед удалением уроков: задания, ответы студентов (+ файлы
    в хранилище) и диалоги в строках студентов."""
    if not lesson_ids:
        return
    answer_ids = [r[0] for r in (await db.execute(
        select(HomeworkAnswer.id).where(HomeworkAnswer.lesson_id.in_(lesson_ids))
    )).all()]
    if answer_ids:
        for (key,) in (await db.execute(
            select(HomeworkAnswerFile.object_key).where(HomeworkAnswerFile.answer_id.in_(answer_ids))
        )).all():
            _safe_delete_object(key)
        await db.execute(delete(HomeworkAnswerFile).where(HomeworkAnswerFile.answer_id.in_(answer_ids)))
        await db.execute(delete(HomeworkAnswer).where(HomeworkAnswer.id.in_(answer_ids)))
    task_ids = [r[0] for r in (await db.execute(
        select(HomeworkTask.id).where(HomeworkTask.lesson_id.in_(lesson_ids))
    )).all()]
    await delete_homework_tasks(db, task_ids)
    await db.execute(delete(LessonMessage).where(LessonMessage.lesson_id.in_(lesson_ids)))
    # Работа на уроке: файлы в хранилище и записи
    for (key,) in (await db.execute(
        select(LessonWorkFile.object_key).where(LessonWorkFile.lesson_id.in_(lesson_ids))
    )).all():
        _safe_delete_object(key)
    await db.execute(delete(LessonWorkFile).where(LessonWorkFile.lesson_id.in_(lesson_ids)))


async def with_unreviewed_flag(db: AsyncSession, lessons: list[Lesson], user: Optional[User] = None) -> list[LessonOut]:
    out = [LessonOut.model_validate(l) for l in lessons]
    for item, l in zip(out, lessons):
        item.is_locked = lesson_locked_for(l, user) if user else is_lesson_locked(l)
    if not out:
        return out
    rows = await db.execute(
        select(HomeworkAnswer.lesson_id)
        .where(HomeworkAnswer.lesson_id.in_([l.id for l in out]), *awaiting_review())
        .distinct()
    )
    flagged = {row[0] for row in rows.all()}
    work_flagged = await lessons_with_work_to_review(db, [item.id for item in out]) if user and user.role != "student" else set()
    names = await participant_names(db, [item.id for item in out if item.is_personal])
    for item in out:
        item.has_unreviewed_homework = item.id in flagged
        item.has_unreviewed_work = item.id in work_flagged
        item.participants = names.get(item.id, [])
    if user and user.role != "student":
        await _fill_teacher_info(db, out, lessons, user)
    return out


async def _fill_teacher_info(db: AsyncSession, out: list[LessonOut], lessons: list[Lesson], user: User) -> None:
    """Педагог урока и право правки. ДЗ проверяет основной педагог группы —
    у остальных подсветка «проверить ДЗ» не показывается."""
    group_teachers = dict((await db.execute(
        select(Group.id, Group.teacher_id).where(Group.id.in_({l.group_id for l in lessons}))
    )).all())
    other_ids = {l.teacher_id for l in lessons if l.teacher_id != group_teachers.get(l.group_id)}
    names, photos = {}, {}
    if other_ids:
        for uid, full_name, username, photo_url in (await db.execute(
            select(User.id, User.full_name, User.username, User.photo_url).where(User.id.in_(other_ids))
        )).all():
            names[uid] = full_name or username
            photos[uid] = photo_url
    room_ids = {l.room_id for l in lessons if l.room_id}
    room_numbers = dict((await db.execute(
        select(Room.id, Room.number).where(Room.id.in_(room_ids))
    )).all()) if room_ids else {}
    for item, lesson in zip(out, lessons):
        item.room_number = room_numbers.get(lesson.room_id)
        group_teacher_id = group_teachers.get(lesson.group_id)
        item.teacher_name = names.get(lesson.teacher_id) if lesson.teacher_id != group_teacher_id else None
        item.teacher_photo_url = photos.get(lesson.teacher_id) if item.teacher_name else None
        item.can_edit = can_edit_lesson(lesson, group_teacher_id, user)
        item.can_manage = is_group_teacher(group_teacher_id, user)
        if not is_group_teacher(group_teacher_id, user):
            item.has_unreviewed_homework = False
        if not item.can_edit:
            item.has_unreviewed_work = False  # работу на уроке проверяет тот, кто ведёт урок


# Уроки группы
@router.get("/group/{group_id}", response_model=list[LessonOut])
async def get_group_lessons(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    # admin и основной педагог группы — все уроки; педагог, который вёл или
    # ведёт в группе отдельные уроки, — только их (lesson_teacher.py)
    group = (await db.execute(select(Group).where(Group.id == group_id))).scalar_one_or_none()
    query = select(Lesson).where(Lesson.group_id == group_id).order_by(Lesson.order)
    if group and not is_group_teacher(group.teacher_id, current_user):
        query = query.where(Lesson.teacher_id == current_user.id)
    lessons = (await db.execute(query)).scalars().all() if group else []
    if not group or (not lessons and not is_group_teacher(group.teacher_id, current_user)):
        raise HTTPException(status_code=403, detail="Нет доступа к этой группе")
    return await with_unreviewed_flag(db, lessons, current_user)


async def add_lesson(
    db: AsyncSession, group: Group, actor: User, date: Optional[datetime], *,
    title: Optional[str] = None, order: int = 0, duration_min: Optional[int] = None,
    source: Optional[str] = "teacher", is_personal: bool = False, student_ids=(),
) -> Lesson:
    """Новый урок группы (без commit): выходной педагога — отказ, если ставит не
    он сам; персональный — с участниками (app/personal.py). Его же вызывает
    «Урок» ученику из «Студентов» (routers/students.py)."""
    await ensure_lessons_allowed(db, [(group.teacher_id, date)], actor)
    lesson = Lesson(
        group_id=group.id,
        title=(title or "").strip() or await lesson_word(db, group.sector),
        order=order,
        date=date,
        duration_min=duration_min or group.lesson_duration_min,
        source=source,
        is_open=False,
        is_personal=is_personal,
        teacher_id=group.teacher_id,
        created_by=actor.id,
    )
    db.add(lesson)
    if is_personal:
        await db.flush()  # нужен id урока для списка участников
        await set_participants(db, lesson, student_ids)
    return lesson


# Создать урок
@router.post("/", response_model=LessonOut)
async def create_lesson(
    data: LessonCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    group_query = select(Group).where(Group.id == data.group_id)
    if current_user.role != "admin":
        group_query = group_query.where(Group.teacher_id == current_user.id)

    group = (await db.execute(group_query)).scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=403, detail="Нет доступа к этой группе")
    # Номер в нумерации группы ставит только расписание (schedule.edit);
    # урок педагога из «+ Урок» — всегда без номера, как доп. урок
    lesson = await add_lesson(
        db, group, current_user, data.date, title=data.title,
        order=data.order if has_perm(current_user, "schedule.edit") else 0,
        duration_min=data.duration_min, source=data.source,
        is_personal=data.is_personal, student_ids=data.student_ids,
    )
    await db.commit()
    await db.refresh(lesson)
    return (await with_unreviewed_flag(db, [lesson], current_user))[0]


# Генератор расписания (claude/group-schedule-plan.md, задача 1). Требует
# пустую группу (без уроков) — если уроки уже есть, фронт сперва спрашивает
# педагога "удалить и пересоздать или дозаполнить материалами" и в первом
# случае явно вызывает DELETE /lessons/group/{id}, во втором — не вызывает
# generate вовсе, а сразу POST /lessons/group/{id}/fill-schedule.
#
# Праздники генератор НЕ вычисляет и не пропускает — никакого справочника
# праздников в системе нет (решение Андрея: такой справочник никто не
# ведёт). Если известный заранее праздник попадает в диапазон — педагог
# просто подбирает дату/дни недели так, чтобы обойти его, либо создаёт
# серию как есть и затем правит конкретный урок кнопкой на странице
# группы (POST /{lesson_id}/mark-holiday ниже) — она двигает вперёд его и
# все последующие уроки этой же группы.
@router.post("/generate", response_model=list[LessonOut])
async def generate_schedule(
    data: ScheduleGenerate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require("schedule.edit")),
):
    group = await get_accessible_group(data.group_id, db, current_user)

    # Персональные уроки расписанию не мешают — в серию они не входят
    existing = await db.execute(select(Lesson.id).where(
        Lesson.group_id == data.group_id, Lesson.is_personal.is_(False),
    ))
    if existing.first():
        raise HTTPException(
            status_code=409,
            detail="В группе уже есть уроки — удалите их (DELETE /lessons/group/{id}) либо дозаполните материалами вместо генерации",
        )

    try:
        hh, mm = (int(part) for part in data.start_time.split(":"))
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверный формат времени, ожидается ЧЧ:ММ")

    weekday_set = set(data.weekdays)
    if not weekday_set.issubset(set(range(7))):
        raise HTTPException(status_code=422, detail="День недели должен быть числом от 0 (Пн) до 6 (Вс)")

    dates: list[datetime] = []
    cursor = data.start_date
    # Предохранитель от зацикливания при некорректных входных данных —
    # не более (запрошено уроков × 30 + год) дней вперёд.
    safety_limit = data.lesson_count * 30 + 365
    steps = 0
    while len(dates) < data.lesson_count and steps < safety_limit:
        if cursor.weekday() in weekday_set:
            dates.append(datetime(cursor.year, cursor.month, cursor.day, hh, mm, tzinfo=BAKU_TZ))
        cursor += timedelta(days=1)
        steps += 1

    if len(dates) < data.lesson_count:
        raise HTTPException(status_code=422, detail="Не удалось подобрать достаточно дат — проверьте дни недели и период")

    # Выходные педагога (app/days_off.py): другому — отказ, самому педагогу —
    # предупреждение (428), серия создаётся после повторного нажатия.
    days_off = await find_conflicts(db, [(group.teacher_id, d) for d in dates])
    if days_off:
        if current_user.id != group.teacher_id:
            raise HTTPException(status_code=409, detail=conflict_detail(days_off))
        if not data.confirm_days_off:
            raise HTTPException(
                status_code=428,
                detail=f"Уроки попадут на ваши выходные: {format_dates(days_off)}. "
                       "Нажмите «Создать уроки» ещё раз, чтобы создать их всё равно",
            )

    word = await lesson_word(db, group.sector)
    lessons_by_order: dict[int, Lesson] = {}
    for i, lesson_date in enumerate(dates, start=data.start_order):
        lesson = Lesson(
            group_id=data.group_id,
            # Название — сразу на языке сектора группы («Урок N» / «Dərs N»), при показе не переводится
            title=f"{word} {i}",
            order=i,
            date=lesson_date,
            duration_min=data.duration_min or group.lesson_duration_min,
            source="academy",
            is_open=False,
            teacher_id=group.teacher_id,
        )
        db.add(lesson)
        lessons_by_order[i] = lesson

    if data.fill_source:
        await db.flush()  # нужны id уроков для привязки ресурсов ниже
        if data.fill_source == "template":
            if not group.course_id or not group.sector:
                raise HTTPException(status_code=400, detail="У группы не указан курс или сектор — заполнение из шаблона невозможно")
            positions = await _collect_template_positions(db, group.course_id, group.sector)
        elif data.fill_source == "group":
            if not data.fill_group_id:
                raise HTTPException(status_code=422, detail="Укажите группу-источник материалов")
            source_lessons = await db.execute(select(Lesson).where(Lesson.group_id == data.fill_group_id))
            positions = {}
            for source_lesson in source_lessons.scalars().all():
                res_rows = await db.execute(
                    select(LessonResource.resource_type, LessonResource.resource_id)
                    .where(LessonResource.lesson_id == source_lesson.id)
                )
                items = res_rows.all()
                if items:
                    positions[source_lesson.order] = [(rt, rid) for rt, rid in items]
        else:
            raise HTTPException(status_code=422, detail="Недопустимый источник материалов")

        await _apply_positions_to_lessons(db, lessons_by_order, positions, mode="add", current_user=current_user)

    await db.commit()
    lessons = list(lessons_by_order.values())
    for lesson in lessons:
        await db.refresh(lesson)
    return lessons


# Дозаполнение/обновление материалов существующих уроков — отдельно от
# генерации: и как её необязательный последний шаг (см. выше), и как
# самостоятельная кнопка «Обновить материалы» (материалы готовятся
# пачками уже после того, как расписание создано).
@router.post("/group/{group_id}/fill-schedule")
async def fill_group_schedule(
    group_id: int,
    data: FillScheduleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    group = await get_accessible_group(group_id, db, current_user)

    if data.range_from > data.range_to:
        raise HTTPException(status_code=422, detail="Некорректный диапазон уроков")
    if data.mode not in ("add", "replace"):
        raise HTTPException(status_code=422, detail="Недопустимый режим заполнения")

    target_result = await db.execute(
        select(Lesson).where(
            Lesson.group_id == group_id,
            Lesson.order >= data.range_from,
            Lesson.order <= data.range_to,
        )
    )
    lessons_by_order = {lesson.order: lesson for lesson in target_result.scalars().all()}
    if not lessons_by_order:
        raise HTTPException(status_code=404, detail="В указанном диапазоне нет уроков")

    if data.source == "template":
        if not group.course_id or not group.sector:
            raise HTTPException(status_code=400, detail="У группы не указан курс или сектор — заполнение из шаблона невозможно")
        positions = await _collect_template_positions(db, group.course_id, group.sector)
    elif data.source == "group":
        if not data.fill_group_id:
            raise HTTPException(status_code=422, detail="Укажите группу-источник материалов")
        source_lessons = await db.execute(select(Lesson).where(Lesson.group_id == data.fill_group_id))
        positions = {}
        for source_lesson in source_lessons.scalars().all():
            res_rows = await db.execute(
                select(LessonResource.resource_type, LessonResource.resource_id)
                .where(LessonResource.lesson_id == source_lesson.id)
            )
            items = res_rows.all()
            if items:
                positions[source_lesson.order] = [(rt, rid) for rt, rid in items]
    else:
        raise HTTPException(status_code=422, detail="Недопустимый источник материалов")

    attached = await _apply_positions_to_lessons(db, lessons_by_order, positions, data.mode, current_user)
    await db.commit()
    return {"ok": True, "attached": attached}


# ── Аудитории группы по дням недели ──
# В «Расписание и материалы»: будущие уроки группы (без персональных)
# раскладываются по дням недели (по Баку); на каждый день выбирается аудитория,
# и она записывается во все будущие уроки группы в этот день. Прошлые не трогаем.

class RoomChoiceOut(BaseModel):
    id: int
    number: int
    capacity: int
    busy_count: int      # сколько уроков этого дня пересекаются с уроками других групп в этой аудитории


class RoomDayOut(BaseModel):
    weekday: int                  # 0 — понедельник … 6 — воскресенье
    lesson_count: int
    times: list[str]              # «10:00–12:00»
    room_id: Optional[int] = None # у всех уроков дня одна аудитория; иначе None
    mixed: bool = False           # у уроков дня разные аудитории / часть без аудитории
    rooms: list[RoomChoiceOut]


class RoomDaysOut(BaseModel):
    group_size: int
    days: list[RoomDayOut]


class RoomDayIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    room_id: int


async def _future_lessons_by_weekday(db: AsyncSession, group_id: int) -> dict[int, list[Lesson]]:
    now = datetime.now(dt_timezone.utc)
    lessons = (await db.execute(
        select(Lesson).where(
            Lesson.group_id == group_id,
            Lesson.is_personal.is_(False),
            Lesson.date > now,
        ).order_by(Lesson.date)
    )).scalars().all()
    by_day: dict[int, list[Lesson]] = {}
    for l in lessons:
        by_day.setdefault(aware(l.date).astimezone(BAKU_TZ).weekday(), []).append(l)
    return by_day


def _lesson_span(l: Lesson) -> tuple[datetime, datetime]:
    start = aware(l.date)
    return start, start + timedelta(minutes=l.duration_min or 0)


@router.get("/group/{group_id}/room-days", response_model=RoomDaysOut)
async def get_group_room_days(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    await get_accessible_group(group_id, db, current_user)
    by_day = await _future_lessons_by_weekday(db, group_id)
    rooms = (await db.execute(select(Room).order_by(Room.number))).scalars().all()
    group_size = (await db.execute(
        select(func.count()).select_from(GroupMember)
        .where(GroupMember.group_id == group_id, GroupMember.status == "active")
    )).scalar() or 0

    # Уроки других групп в аудиториях — для отметки «занята»
    others: list[Lesson] = []
    all_lessons = [l for ls in by_day.values() for l in ls]
    if all_lessons:
        first = _lesson_span(all_lessons[0])[0]
        last = max(_lesson_span(l)[1] for l in all_lessons)
        others = (await db.execute(
            select(Lesson).where(
                Lesson.group_id != group_id,
                Lesson.room_id.is_not(None),
                Lesson.date < last,
                Lesson.date > first - timedelta(days=1),
            )
        )).scalars().all()

    days = []
    for weekday in sorted(by_day):
        ls = by_day[weekday]
        spans = [_lesson_span(l) for l in ls]
        times = sorted({
            f"{a.astimezone(BAKU_TZ):%H:%M}–{b.astimezone(BAKU_TZ):%H:%M}" for a, b in spans
        })
        room_ids = {l.room_id for l in ls}
        choices = []
        for r in rooms:
            busy = 0
            for a, b in spans:
                if any(o.room_id == r.id and _lesson_span(o)[0] < b and a < _lesson_span(o)[1] for o in others):
                    busy += 1
            choices.append(RoomChoiceOut(id=r.id, number=r.number, capacity=r.capacity, busy_count=busy))
        single = next(iter(room_ids)) if len(room_ids) == 1 else None
        days.append(RoomDayOut(
            weekday=weekday, lesson_count=len(ls), times=times,
            room_id=single, mixed=len(room_ids) > 1, rooms=choices,
        ))
    return RoomDaysOut(group_size=group_size, days=days)


@router.put("/group/{group_id}/room-days")
async def set_group_room_day(
    group_id: int,
    data: RoomDayIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require("schedule.edit")),
):
    await get_accessible_group(group_id, db, current_user)
    if not await db.get(Room, data.room_id):
        raise HTTPException(status_code=404, detail="Аудитория не найдена")
    ls = (await _future_lessons_by_weekday(db, group_id)).get(data.weekday, [])
    for l in ls:
        l.room_id = data.room_id
    await db.commit()
    return {"ok": True, "updated": len(ls)}


# Открыть / закрыть доступ сразу к нескольким урокам группы (по номерам
# с..по). Полуночная блокировка на доступ не действует — как и у
# открытия одного урока (PATCH /{lesson_id}/open).
@router.post("/group/{group_id}/open-range")
async def open_group_lessons_range(
    group_id: int,
    data: OpenRangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    await get_accessible_group(group_id, db, current_user)
    if data.range_from > data.range_to:
        raise HTTPException(status_code=422, detail="Некорректный диапазон уроков")
    group_lessons = (await db.execute(
        select(Lesson).where(
            Lesson.group_id == group_id,
            Lesson.order >= data.range_from,
            Lesson.order <= data.range_to,
        )
    )).scalars().all()
    if not group_lessons:
        raise HTTPException(status_code=404, detail="В указанном диапазоне нет уроков")
    changed = 0
    for lesson in group_lessons:
        if lesson.is_open != data.is_open:
            lesson.is_open = data.is_open
            changed += 1
    await db.commit()
    return {"ok": True, "changed": changed, "lesson_ids": [l.id for l in group_lessons], "is_open": data.is_open}


# Массовое удаление всех уроков группы — шаг "удалить и пересоздать
# заново" в диалоге генератора (см. generate_schedule выше). Отдельный
# явный вызов с фронта, а не часть generate, чтобы не удалить уроки молча.
@router.delete("/group/{group_id}")
async def delete_group_lessons(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require("schedule.edit")),
):
    await get_accessible_group(group_id, db, current_user)

    # Персональные уроки не трогаем — «удалить и создать заново» касается только расписания группы
    group_lessons = (await db.execute(select(Lesson).where(
        Lesson.group_id == group_id, Lesson.is_personal.is_(False),
    ))).scalars().all()
    if any(lesson_locked_for(l, current_user) for l in group_lessons):
        raise HTTPException(status_code=403, detail="В группе есть прошедшие уроки — после полуночи их удалять нельзя")
    lesson_ids = [l.id for l in group_lessons]
    if lesson_ids:
        await delete_lessons_homework(db, lesson_ids)
        await db.execute(delete(LessonMark).where(LessonMark.lesson_id.in_(lesson_ids)))
        await db.execute(delete(LessonResource).where(LessonResource.lesson_id.in_(lesson_ids)))
        await db.execute(delete(Lesson).where(Lesson.id.in_(lesson_ids)))
        await db.commit()
    return {"ok": True, "deleted": len(lesson_ids)}


# Все уроки педагога (для главной страницы и календаря на /groups).
# У admin — тот же выбор области видимости, что и в /groups/my:
# teacher_id=<id> — уроки групп конкретного препода, mine=true — только
# своих (если они у админа есть), ни то ни другое — уроки вообще всех групп.
# Выходные для заливки дней в календарях уроков (правила — app/days_off.py)
class DaysOffDatesOut(BaseModel):
    dates: list[date_type]


def _require_calendar(user: User) -> None:
    """Календарь уроков: педагог (свой) или право calendars.all (любой педагог)."""
    if user.role not in ("teacher", "admin") and not has_perm(user, "calendars.all"):
        raise HTTPException(status_code=403, detail="Недостаточно прав")


@router.get("/days-off", response_model=DaysOffDatesOut)
async def get_teacher_days_off_dates(
    teacher_id: int, date_from: date_type, date_to: date_type,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    _require_calendar(current_user)
    check_range(date_from, date_to)
    teacher = (await db.execute(select(User).where(User.id == teacher_id))).scalar_one_or_none()
    if not teacher or teacher.role != "teacher":
        return {"dates": []}  # у админа в роли педагога выходных нет
    return {"dates": days_off_between(teacher.days_off, date_from, date_to)}


@router.get("/student/days-off", response_model=DaysOffDatesOut)
async def get_student_days_off_dates(
    date_from: date_type, date_to: date_type,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    check_range(date_from, date_to)
    if current_user.role != "student":
        return {"dates": []}
    return {"dates": await student_days_off(db, current_user.id, date_from, date_to)}


@router.get("/my", response_model=list[LessonOut])
async def get_my_lessons(
    teacher_id: Optional[int] = None,
    mine: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Уроки педагога = все уроки групп, где он основной, + уроки других
    # групп, которые ведёт он сам (замены, уроки до передачи группы).
    # Чужие календари (teacher_id) — с правом calendars.all (админ, куратор).
    _require_calendar(current_user)
    scope_teacher_id = teacher_id
    if not has_perm(current_user, "calendars.all") or mine:
        scope_teacher_id = current_user.id
    query = select(Lesson).order_by(Lesson.date)
    if scope_teacher_id is not None:
        query = query.where(
            Lesson.group_id.in_(select(Group.id).where(Group.teacher_id == scope_teacher_id))
            | (Lesson.teacher_id == scope_teacher_id)
        )
    result = await db.execute(query)
    return await with_unreviewed_flag(db, result.scalars().all(), current_user)


# Уроки студента — только открытые
# ВАЖНО: должен идти раньше маршрутов с /{lesson_id} ниже — иначе FastAPI
# сопоставляет "/lessons/student" с /{lesson_id} (lesson_id="student"),
# который требует роль teacher/admin, и студент получает 403.
# include_closed=1 — ещё и закрытые педагогом уроки (только дата/тема — для
# календаря студента; открыть закрытый урок студент по-прежнему не может)
@router.get("/student", response_model=list[LessonOut])
async def get_student_lessons(
    include_closed: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Находим группы студента
    members_result = await db.execute(
        select(GroupMember).where(
            GroupMember.student_id == current_user.id,
            GroupMember.status == "active"
        )
    )
    group_ids = [m.group_id for m in members_result.scalars().all()]
    if not group_ids:
        return []
    result = await db.execute(
        select(Lesson)
        .where(
            Lesson.group_id.in_(group_ids),
            visible_to_student(current_user.id),  # персональные — только свои
            *([] if include_closed else [Lesson.is_open == True]),
        )
        .order_by(Lesson.date.desc())
    )
    from .homework import student_open_items  # homework.py сам импортирует lessons.py
    out = [LessonOut.model_validate(l) for l in result.scalars().all()]
    flags = await student_open_items(db, [l.id for l in out], current_user.id)
    for item in out:
        item.hw_todo, item.new_messages = flags.get(item.id, (None, 0))
    return out


# Успеваемость студента: оценки/экзамены/комменты и посещаемость по всем
# открытым урокам его групп, одним запросом (вместо /marks/me на каждый
# урок) — для раздела «Успеваемость» в личном кабинете. ДОЛЖЕН идти раньше
# /{lesson_id}/marks ниже — та же причина, что и у /student выше.
@router.get("/student/marks", response_model=list[MyPerformanceRowOut])
async def get_student_marks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Только для студента")

    members_result = await db.execute(
        select(GroupMember).where(
            GroupMember.student_id == current_user.id,
            GroupMember.status == "active",
        )
    )
    group_ids = [m.group_id for m in members_result.scalars().all()]
    if not group_ids:
        return []

    rows = await db.execute(
        select(Lesson, LessonMark)
        .outerjoin(
            LessonMark,
            (LessonMark.lesson_id == Lesson.id) & (LessonMark.student_id == current_user.id),
        )
        .where(Lesson.group_id.in_(group_ids), Lesson.is_open == True, visible_to_student(current_user.id))
        .order_by(Lesson.date.desc())
    )

    rows = rows.all()
    # Пропуск на заблокированном уроке без отметки — по общему правилу (attendance.py)
    slot_status = {
        s.lesson_id: s.status
        for s in await attendance_slots(db, group_ids, [current_user.id], [lesson.id for lesson, _ in rows])
    }
    hw_by_lesson: dict[int, list[int]] = {}
    lesson_ids = [lesson.id for lesson, _ in rows]
    if lesson_ids:
        for lesson_id, grade in (await db.execute(
            select(HomeworkAnswer.lesson_id, HomeworkAnswer.grade)
            .where(
                HomeworkAnswer.lesson_id.in_(lesson_ids),
                HomeworkAnswer.student_id == current_user.id,
                HomeworkAnswer.grade.isnot(None),
            )
        )).all():
            hw_by_lesson.setdefault(lesson_id, []).append(grade)

    def status_of(lesson, mark):
        return slot_status.get(lesson.id, mark.attendance_status if mark else None)

    return [
        MyPerformanceRowOut(
            lesson_id=lesson.id,
            lesson_title=lesson.title,
            date=lesson.date,
            attendance_status=status_of(lesson, mark),
            is_late=mark.is_late if mark else False,
            score=mark.score if mark else None,
            exam_score=mark.exam_score if mark else None,
            hw_grades=hw_by_lesson.get(lesson.id, []),
            status_label=_STATUS_LABELS.get(status_of(lesson, mark), "—"),
        )
        for lesson, mark in rows
    ]


class GradeItemOut(BaseModel):
    date: Optional[datetime] = None
    lesson_title: str
    title: Optional[str] = None   # для ДЗ — название задания
    grade: int


class GradeGroupOut(BaseModel):
    avg: Optional[float] = None
    max: Optional[int] = None
    items: list[GradeItemOut] = []


class MyGradesOut(BaseModel):
    lesson: GradeGroupOut     # оценка за урок
    homework: GradeGroupOut   # оценка за ДЗ
    exam: GradeGroupOut       # экзаменационная


def _grade_group(items: list[GradeItemOut]) -> GradeGroupOut:
    grades = [i.grade for i in items]
    return GradeGroupOut(
        avg=round(sum(grades) / len(grades), 1) if grades else None,
        max=max(grades) if grades else None,
        items=items,
    )


# Звёзды студента для шапки его кабинета («У тебя уже есть N ★»): сумма
# всех звёзд за уроки за всё время, по всем группам, включая прошлые
# (решение Андрея). ДОЛЖЕН идти раньше маршрутов с /{lesson_id}.
class MyStarsOut(BaseModel):
    stars: int


@router.get("/student/stars", response_model=MyStarsOut)
async def get_student_stars(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Только для студента")
    total = (await db.execute(
        select(func.coalesce(func.sum(LessonMark.stars), 0)).where(LessonMark.student_id == current_user.id)
    )).scalar()
    return MyStarsOut(stars=int(total or 0))


# Несданные ДЗ студента — полоса под шапкой его кабинета (правило —
# homework_status.student_homework_debts). ДОЛЖЕН идти раньше маршрутов с /{lesson_id}.
class MyHomeworkDebtsOut(BaseModel):
    count: int = 0
    overdue: bool = False
    lesson_id: Optional[int] = None
    lesson_title: Optional[str] = None
    deadline: Optional[datetime] = None


@router.get("/student/homework-debts", response_model=MyHomeworkDebtsOut)
async def get_student_homework_debts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Только для студента")
    return await student_homework_debts(db, current_user.id)


# Три вида оценок студента (за урок / за ДЗ / экзаменационная) — каждая со
# своей средней и списком «дата — оценка». Открытые уроки активных групп,
# как и /student/marks. ДОЛЖЕН идти раньше маршрутов с /{lesson_id}.
@router.get("/student/grades", response_model=MyGradesOut)
async def get_student_grades(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Только для студента")

    group_ids = [r[0] for r in (await db.execute(
        select(GroupMember.group_id).where(
            GroupMember.student_id == current_user.id, GroupMember.status == "active",
        )
    )).all()]
    lesson_items: list[GradeItemOut] = []
    exam_items: list[GradeItemOut] = []
    hw_items: list[GradeItemOut] = []
    if group_ids:
        for lesson, mark in (await db.execute(
            select(Lesson, LessonMark)
            .join(LessonMark, (LessonMark.lesson_id == Lesson.id) & (LessonMark.student_id == current_user.id))
            .where(Lesson.group_id.in_(group_ids), Lesson.is_open == True, visible_to_student(current_user.id))
            .order_by(Lesson.date.desc())
        )).all():
            if mark.score is not None:
                lesson_items.append(GradeItemOut(date=lesson.date, lesson_title=lesson.title, grade=mark.score))
            if mark.exam_score is not None:
                exam_items.append(GradeItemOut(date=lesson.date, lesson_title=lesson.title, grade=mark.exam_score))

        for lesson, answer in (await db.execute(
            select(Lesson, HomeworkAnswer)
            .join(HomeworkAnswer, HomeworkAnswer.lesson_id == Lesson.id)
            .where(
                Lesson.group_id.in_(group_ids), Lesson.is_open == True, visible_to_student(current_user.id),
                HomeworkAnswer.student_id == current_user.id, HomeworkAnswer.grade.isnot(None),
            )
            .order_by(Lesson.date.desc())
        )).all():
            hw_items.append(GradeItemOut(
                date=answer.reviewed_at or lesson.date, lesson_title=lesson.title, grade=answer.grade,
            ))

    return MyGradesOut(
        lesson=_grade_group(lesson_items),
        homework=_grade_group(hw_items),
        exam=_grade_group(exam_items),
    )


# Открыть / закрыть доступ к уроку
@router.patch("/{lesson_id}/open")
async def toggle_lesson_open(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)

    lesson.is_open = not lesson.is_open
    await db.commit()
    return {"is_open": lesson.is_open}


# "Это выходной" — для непредвиденного праздника (не учтённого при
# генерации, никакого справочника праздников в системе нет — см.
# claude/group-schedule-plan.md). Действует только на ЭТУ группу: сам
# урок и его материалы/оценки не трогаем — просто сдвигаем даты у него и
# у всех последующих уроков этой серии на одну позицию вперёд (по тому же
# шагу, что был между последними двумя уроками серии), а в конце
# добавляется одна новая дата по этому же шагу.
@router.post("/{lesson_id}/mark-holiday", response_model=list[LessonOut])
async def mark_lesson_as_holiday(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, manage=True)
    if lesson.date is None:
        raise HTTPException(status_code=400, detail="У урока не задана дата")
    if lesson_locked_for(lesson, current_user):
        raise HTTPException(status_code=403, detail="Прошла полночь по Баку — прошедший урок переносить нельзя")
    if lesson.is_personal:
        raise HTTPException(status_code=400, detail="Персональный урок не входит в расписание группы — перенесите его дату вручную")

    tail_result = await db.execute(
        select(Lesson)
        .where(
            Lesson.group_id == lesson.group_id, Lesson.order >= lesson.order,
            Lesson.is_personal.is_(False),  # персональные уроки сдвиг не затрагивает
        )
        .order_by(Lesson.order)
    )
    tail = tail_result.scalars().all()

    old_dates = [l.date for l in tail]
    step = (old_dates[-1] - old_dates[-2]) if len(tail) >= 2 else timedelta(days=7)
    new_dates = old_dates[1:] + [old_dates[-1] + step]
    await ensure_lessons_allowed(db, [(l.teacher_id, d) for l, d in zip(tail, new_dates)], current_user)

    for l, d in zip(tail, new_dates):
        l.date = d

    await db.commit()
    for l in tail:
        await db.refresh(l)
    return tail


async def _get_active_group_student_ids(lesson: Lesson, db: AsyncSession) -> set[int]:
    # Ученики урока: активные участники группы, у персонального — только его участники (personal.py)
    return await lesson_student_ids(db, lesson)


async def _upsert_mark(
    db: AsyncSession,
    lesson_id: int,
    student_id: int,
    data: LessonMarkIn,
    current_user: User,
    locked: bool = False,
) -> tuple[LessonMark, bool]:
    """Сохраняет отметку. Второе значение — ученик только что отмечен пришедшим
    (был «не пришёл» или без отметки, стал «очно» / «онлайн»)."""
    validate_attendance_status(data.attendance_status)

    result = await db.execute(
        select(LessonMark).where(
            LessonMark.lesson_id == lesson_id,
            LessonMark.student_id == student_id,
        )
    )
    mark = result.scalar_one_or_none()
    if locked:
        _check_mark_lock(mark, data, score_open=await has_work_files(db, lesson_id, student_id))
    if not mark:
        mark = LessonMark(lesson_id=lesson_id, student_id=student_id)
        db.add(mark)
    arrived = data.attendance_status in PRESENT and mark.attendance_status not in PRESENT
    # Оценка за урок, поставленная в журнале, когда ученик уже сдал работу на
    # уроке, — это и есть проверка работы (app/lesson_work.py)
    if (data.score is not None and data.score != mark.score and mark.work_reviewed_at is None
            and await has_work_files(db, lesson_id, student_id)):
        mark.work_reviewed_at = datetime.now(dt_timezone.utc)
        mark.work_reviewed_by = current_user.id

    mark.attendance_status = data.attendance_status
    mark.is_late = data.is_late
    mark.score = data.score
    mark.exam_score = data.exam_score
    mark.stars = data.stars
    mark.comment = data.comment
    mark.marked_by = current_user.id
    mark.marked_at = datetime.now(dt_timezone.utc)
    return mark, arrived


def _open_on_arrival(lesson: Lesson, arrived: bool) -> None:
    """Закрытый урок открывается сам, когда в нём отмечают пришедшего ученика:
    урок начался — ученики должны его видеть. Срабатывает только на новую
    отметку «пришёл»; если педагог потом закрыл урок вручную, правка оценок
    или звёзд его снова не откроет."""
    if arrived and not lesson.is_open:
        lesson.is_open = True


# Табличка урока: посещаемость/оценка/звёзды по всем студентам группы
# (включая тех, у кого ещё нет ни одной записи — пустые поля).
@router.get("/{lesson_id}/marks")
async def get_lesson_marks(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    group_teacher_id = (await db.execute(select(Group.teacher_id).where(Group.id == lesson.group_id))).scalar_one()
    can_edit = can_edit_lesson(lesson, group_teacher_id, current_user)

    rows = await db.execute(
        select(User, LessonMark)
        .join(GroupMember, GroupMember.student_id == User.id)
        .outerjoin(
            LessonMark,
            (LessonMark.lesson_id == lesson_id) & (LessonMark.student_id == User.id),
        )
        .where(
            GroupMember.group_id == lesson.group_id, GroupMember.status == "active",
            lesson_students_condition(lesson),  # персональный урок — только его участники
        )
        .order_by(User.full_name)
    )

    students = []
    for user, mark in rows.all():
        students.append(LessonMarkOut(
            student_id=user.id,
            full_name=user.full_name or user.username,
            photo_url=user.photo_url,
            # контакты учеников — только тому, кто сейчас работает в уроке
            telegram_username=user.telegram_username if can_edit else None,
            whatsapp=user.whatsapp if can_edit else None,
            phone=user.phone if can_edit else None,
            attendance_status=mark.attendance_status if mark else None,
            is_late=mark.is_late if mark else False,
            score=mark.score if mark else None,
            exam_score=mark.exam_score if mark else None,
            stars=mark.stars if mark else None,
            comment=mark.comment if mark else None,
            marked_at=mark.marked_at if mark else None,
        ))

    return {
        "locked": is_lesson_locked(lesson) and current_user.role != "admin",
        "can_edit": can_edit,
        "students": students,
    }


# «Как тебе урок?» — оценка урока учеником тремя смайликами: 3 зелёный,
# 2 жёлтый, 1 красный. Оценить можно урок, который уже начался; оценку можно
# поменять. Педагог отдельных оценок не видит — сводка идёт в отчёт по
# педагогу у админа (app/teacher_report.py).
class LessonFeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=3)


class LessonFeedbackOut(BaseModel):
    rating: Optional[int] = None   # None — ещё не оценил
    can_rate: bool = False         # урок уже начался


def _lesson_started(lesson: Lesson) -> bool:
    if lesson.date is None:
        return False
    started = lesson.date if lesson.date.tzinfo else lesson.date.replace(tzinfo=dt_timezone.utc)
    return started <= datetime.now(dt_timezone.utc)


@router.get("/{lesson_id}/feedback/me", response_model=LessonFeedbackOut)
async def get_my_lesson_feedback(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Только для студента")
    lesson = await get_lesson_for_student(lesson_id, db, current_user)
    rating = (await db.execute(select(LessonFeedback.rating).where(
        LessonFeedback.lesson_id == lesson_id, LessonFeedback.student_id == current_user.id,
    ))).scalar_one_or_none()
    return LessonFeedbackOut(rating=rating, can_rate=_lesson_started(lesson))


@router.put("/{lesson_id}/feedback/me", response_model=LessonFeedbackOut)
async def save_my_lesson_feedback(
    lesson_id: int,
    data: LessonFeedbackIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Только для студента")
    lesson = await get_lesson_for_student(lesson_id, db, current_user)
    if not _lesson_started(lesson):
        raise HTTPException(status_code=400, detail="Оценить урок можно после его начала")
    feedback = (await db.execute(select(LessonFeedback).where(
        LessonFeedback.lesson_id == lesson_id, LessonFeedback.student_id == current_user.id,
    ))).scalar_one_or_none()
    now = datetime.now(dt_timezone.utc)
    if feedback is None:
        db.add(LessonFeedback(lesson_id=lesson_id, student_id=current_user.id, rating=data.rating, created_at=now, updated_at=now))
    else:
        feedback.rating = data.rating
        feedback.updated_at = now
    await db.commit()
    return LessonFeedbackOut(rating=data.rating, can_rate=True)


# Сохранить отметку одного студента (автосохранение по полю на фронте)
@router.put("/{lesson_id}/marks/{student_id}")
async def save_lesson_mark(
    lesson_id: int,
    student_id: int,
    data: LessonMarkIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)

    active_ids = await _get_active_group_student_ids(lesson, db)
    if student_id not in active_ids:
        raise HTTPException(status_code=404, detail="Студент не найден в группе урока")

    mark, arrived = await _upsert_mark(db, lesson_id, student_id, data, current_user, locked=lesson_locked_for(lesson, current_user))
    _open_on_arrival(lesson, arrived)
    await db.commit()
    await db.refresh(mark)
    return {"ok": True, "marked_at": mark.marked_at, "is_open": lesson.is_open}


# Сохранить всю табличку разом («Сохранить» — подстраховка к автосохранению)
@router.put("/{lesson_id}/marks")
async def save_lesson_marks_bulk(
    lesson_id: int,
    data: list[LessonMarkBulkItem],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    locked = lesson_locked_for(lesson, current_user)

    active_ids = await _get_active_group_student_ids(lesson, db)
    unknown = [item.student_id for item in data if item.student_id not in active_ids]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Студенты не найдены в группе урока: {unknown}")

    for item in data:
        _, arrived = await _upsert_mark(db, lesson_id, item.student_id, item, current_user, locked=locked)
        _open_on_arrival(lesson, arrived)

    await db.commit()
    return {"ok": True, "saved": len(data), "is_open": lesson.is_open}


# Материалы урока: всё привязанное (файл/квиз/ссылка) из общей «Базы
# знаний» — группировка фиксированная: файлы → ссылки → квизы, внутри
# группы — по дате привязки.
_TYPE_ORDER = {"material": 0, "link": 1, "quiz": 2}


@router.get("/{lesson_id}/items", response_model=list[LessonItemOut])
async def get_lesson_items(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        await get_lesson_for_student(lesson_id, db, current_user)
    else:
        await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)

    rows = await db.execute(
        select(LessonResource, User.full_name, User.username)
        .outerjoin(User, User.id == LessonResource.added_by)
        .where(LessonResource.lesson_id == lesson_id)
    )
    attachments = rows.all()

    ids_by_type: dict[str, set[int]] = {}
    for attachment, _, _ in attachments:
        ids_by_type.setdefault(attachment.resource_type, set()).add(attachment.resource_id)

    details: dict[tuple[str, int], dict] = {}
    for resource_type, ids in ids_by_type.items():
        for row in await fetch_resource_details(db, resource_type, ids):
            details[(resource_type, row["id"])] = row

    items = []
    for attachment, full_name, username in attachments:
        detail = details.get((attachment.resource_type, attachment.resource_id))
        if not detail:
            continue  # ресурс удалён из библиотеки, привязка осиротела

        items.append(LessonItemOut(
            id=attachment.id,
            resource_type=detail["resource_type"],
            resource_id=detail["id"],
            title=detail["title"],
            content_type=detail["content_type"],
            size_bytes=detail["size_bytes"],
            template_type=detail["template_type"],
            topic=detail["topic"],
            url=detail["url"],
            added_by_name=full_name or username,
            added_at=attachment.added_at,
            can_edit=detail["resource_type"] == "quiz" and (
                current_user.role == "admin" or detail["owner_id"] == current_user.id
            ),
        ))

    items.sort(key=lambda i: (_TYPE_ORDER[i.resource_type], i.added_at or datetime.min))
    if current_user.role == "student":
        items = [item for item in items if item.resource_type != "quiz"]
    return items


# Привязать ресурс (файл/квиз/ссылка) из библиотеки к уроку — общий
# эндпойнт вместо трёх отдельных под каждый тип.
@router.post("/{lesson_id}/items")
async def attach_lesson_item(
    lesson_id: int,
    data: LessonItemAttach,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)

    if data.resource_type not in RESOURCE_MODELS:
        raise HTTPException(status_code=422, detail="Недопустимый тип ресурса")
    if not await resource_exists(db, data.resource_type, data.resource_id):
        raise HTTPException(status_code=404, detail=RESOURCE_NOT_FOUND[data.resource_type])

    if await _attach_resource(db, lesson_id, data.resource_type, data.resource_id, current_user):
        await db.commit()
    return {"ok": True}


# «Из урока»: подтянуть в урок материалы другого урока той же группы — нужно
# для дополнительного (персонального) урока, на котором проходят пропущенное.
# Список: обычные уроки группы до сегодняшнего дня включительно; у каждого —
# сколько в нём материалов и кто из учеников ЭТОГО урока его пропустил
# (пропуск или уважительная причина, по общему правилу посещаемости).
@router.get("/{lesson_id}/sources")
async def get_lesson_sources(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    now = datetime.now(dt_timezone.utc)
    sources = [
        l for l in (await db.execute(
            select(Lesson)
            .where(
                Lesson.group_id == lesson.group_id, Lesson.id != lesson.id,
                Lesson.is_personal == False, Lesson.date.isnot(None),  # noqa: E712
            )
            .order_by(Lesson.date.desc(), Lesson.id.desc())
        )).scalars().all()
        if aware(l.date) <= now
    ]
    if not sources:
        return []
    source_ids = [l.id for l in sources]

    counts = dict((await db.execute(
        select(LessonResource.lesson_id, func.count(LessonResource.id))
        .where(LessonResource.lesson_id.in_(source_ids))
        .group_by(LessonResource.lesson_id)
    )).all())

    student_ids = await lesson_student_ids(db, lesson)
    names = {}
    if student_ids:
        names = {uid: (full_name or username) for uid, full_name, username in (await db.execute(
            select(User.id, User.full_name, User.username).where(User.id.in_(student_ids))
        )).all()}
    missed: dict[int, list[str]] = {}
    for slot in await attendance_slots(db, [lesson.group_id], student_ids, source_ids):
        if slot.status not in PRESENT:
            missed.setdefault(slot.lesson_id, []).append(names.get(slot.student_id, f"#{slot.student_id}"))

    return [
        {
            "id": l.id, "title": l.title, "date": l.date,
            "items_count": counts.get(l.id, 0),
            "missed_by": sorted(missed.get(l.id, []), key=str.lower),
        }
        for l in sources
    ]


@router.post("/{lesson_id}/items/copy-from/{source_id}")
async def copy_lesson_items(
    lesson_id: int,
    source_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)
    source = (await db.execute(
        select(Lesson).where(Lesson.id == source_id, Lesson.group_id == lesson.group_id, Lesson.id != lesson.id)
    )).scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Урок-источник не найден в этой группе")

    rows = (await db.execute(
        select(LessonResource.resource_type, LessonResource.resource_id)
        .where(LessonResource.lesson_id == source.id)
        .order_by(LessonResource.added_at, LessonResource.id)
    )).all()
    attached = 0
    for resource_type, resource_id in rows:
        attached += await _attach_resource(db, lesson.id, resource_type, resource_id, current_user)
    await db.commit()
    return {"ok": True, "attached": attached, "total": len(rows)}


# Отвязать ресурс от урока (сам ресурс остаётся в библиотеке)
@router.delete("/{lesson_id}/items/{resource_type}/{resource_id}")
async def detach_lesson_item(
    lesson_id: int,
    resource_type: str,
    resource_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    await get_lesson_for_teacher_or_admin(lesson_id, db, current_user)

    result = await db.execute(
        select(LessonResource).where(
            LessonResource.lesson_id == lesson_id,
            LessonResource.resource_type == resource_type,
            LessonResource.resource_id == resource_id,
        )
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="Ресурс не привязан к этому уроку")

    await db.delete(attachment)
    await db.commit()
    return {"ok": True}


# ── Аудитория одного урока ──
# В открытом уроке: список аудиторий на время урока (свободна / какой группой
# занята, мест) и смена аудитории только у этого урока. Меняет тот, кто
# управляет расписанием урока (основной педагог группы, админ).

class LessonRoomOptionOut(BaseModel):
    id: int
    number: int
    capacity: int
    busy_with: list[str] = []   # группы, чьи уроки в это время в этой аудитории


class LessonRoomsOut(BaseModel):
    people: int
    room_id: Optional[int] = None
    rooms: list[LessonRoomOptionOut]


class LessonRoomIn(BaseModel):
    room_id: Optional[int] = None   # None — снять аудиторию


@router.get("/{lesson_id}/rooms", response_model=LessonRoomsOut)
async def get_lesson_rooms(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    rooms = (await db.execute(select(Room).order_by(Room.number))).scalars().all()
    busy: dict[int, list[str]] = {}
    if lesson.date:
        start, end = _lesson_span(lesson)
        rows = (await db.execute(
            select(Lesson, Group.name)
            .join(Group, Group.id == Lesson.group_id)
            .where(
                Lesson.id != lesson.id,
                Lesson.room_id.is_not(None),
                Lesson.date < end,
                Lesson.date > start - timedelta(days=1),
            )
        )).all()
        for other, gname in rows:
            a, b = _lesson_span(other)
            if a < end and start < b:
                busy.setdefault(other.room_id, []).append(gname)
    people = len(await lesson_student_ids(db, lesson))
    return LessonRoomsOut(
        people=people,
        room_id=lesson.room_id,
        rooms=[LessonRoomOptionOut(id=r.id, number=r.number, capacity=r.capacity, busy_with=busy.get(r.id, []))
               for r in rooms],
    )


@router.put("/{lesson_id}/room")
async def set_lesson_room(
    lesson_id: int,
    data: LessonRoomIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False, manage=True)
    room = None
    if data.room_id is not None:
        room = await db.get(Room, data.room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Аудитория не найдена")
    lesson.room_id = room.id if room else None
    await db.commit()
    return {"room_id": lesson.room_id, "room_number": room.number if room else None}


@router.get("/{lesson_id}", response_model=LessonOut)
async def get_lesson(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == "student":
        lesson = await get_lesson_for_student(lesson_id, db, current_user)
    else:
        lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, write=False)
    out = LessonOut.model_validate(lesson)
    out.is_locked = lesson_locked_for(lesson, current_user)
    group_row = (await db.execute(
        select(Group.name, Group.video_url, Group.telegram_chat_id, Group.whatsapp, Group.sector, Group.course_id)
        .where(Group.id == lesson.group_id)
    )).first()
    if group_row:
        (out.group_name, out.group_video_url, out.group_telegram, out.group_whatsapp,
         out.group_sector, out.group_course_id) = group_row
    if current_user.role != "student":
        if lesson.is_personal:
            out.participants = (await participant_names(db, [lesson.id])).get(lesson.id, [])
        await _fill_teacher_info(db, [out], [lesson], current_user)
        out.teacher_notes = lesson.private_note
        if not out.can_edit:
            # только просмотр — без входа в конференцию и чатов группы
            out.group_video_url = out.group_telegram = out.group_whatsapp = None
    elif lesson.teacher_id:
        row = (await db.execute(
            select(User.full_name, User.username, User.photo_url).where(User.id == lesson.teacher_id)
        )).first()
        if row:
            out.teacher_id = lesson.teacher_id
            out.teacher_name = row[0] or row[1]
            out.teacher_photo_url = row[2]
    return out


# Состав участников персонального урока. Убрать ученика с отметкой или
# решением ДЗ в этом уроке нельзя (personal.set_participants).
@router.put("/{lesson_id}/participants", response_model=LessonOut)
async def update_lesson_participants(
    lesson_id: int,
    data: ParticipantsIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, manage=True)
    if not lesson.is_personal:
        raise HTTPException(status_code=400, detail="Это не персональный урок")
    await set_participants(db, lesson, data.student_ids)
    await db.commit()
    await db.refresh(lesson)
    return (await with_unreviewed_flag(db, [lesson], current_user))[0]


# Свой урок (lessons.created_by) — перенести и открыть/закрыть, без доступа
# внутрь урока: право lessons.own (куратор). Полночь и выходные педагога — как у всех.
class OwnLessonIn(BaseModel):
    date: Optional[datetime] = None
    is_open: Optional[bool] = None


@router.patch("/{lesson_id}/own")
async def update_own_lesson(
    lesson_id: int,
    data: OwnLessonIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not has_perm(current_user, "lessons.own"):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    lesson = (await db.execute(select(Lesson).where(Lesson.id == lesson_id))).scalar_one_or_none()
    if not lesson or lesson.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Урок не найден")
    if data.date is not None and data.date != lesson.date:
        if lesson_locked_for(lesson, current_user):
            raise HTTPException(status_code=403, detail=LOCK_DETAIL.format(what="дату урока"))
        await ensure_lessons_allowed(db, [(lesson.teacher_id, data.date)], current_user)
        lesson.date = data.date
    if data.is_open is not None:
        lesson.is_open = data.is_open
    await db.commit()
    return {"id": lesson.id, "date": lesson.date, "is_open": lesson.is_open}


@router.patch("/{lesson_id}", response_model=LessonOut)
async def update_lesson(
    lesson_id: int,
    data: LessonUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    update_data = data.model_dump(exclude_unset=True)
    # Заметки по уроку пишет тот, кто его ведёт; название, дата и длительность — расписание группы
    lesson = await get_lesson_for_teacher_or_admin(
        lesson_id, db, current_user, manage=bool(set(update_data) - {"comment", "private_note"}),
    )
    if update_data.get("duration_min", 0) is None:
        del update_data["duration_min"]  # колонка NOT NULL — null не пишем
    if "date" in update_data and update_data["date"] != lesson.date and lesson_locked_for(lesson, current_user):
        raise HTTPException(status_code=403, detail=LOCK_DETAIL.format(what="дату урока"))
    if "date" in update_data and update_data["date"] != lesson.date:
        await ensure_lessons_allowed(db, [(lesson.teacher_id, update_data["date"])], current_user)
    for field, value in update_data.items():
        setattr(lesson, field, value)

    await db.commit()
    await db.refresh(lesson)
    out = LessonOut.model_validate(lesson)
    out.is_locked = lesson_locked_for(lesson, current_user)
    out.teacher_notes = lesson.private_note
    await _fill_teacher_info(db, [out], [lesson], current_user)
    return out


@router.delete("/{lesson_id}")
async def delete_lesson(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    lesson = await get_lesson_for_teacher_or_admin(lesson_id, db, current_user, manage=True)
    if lesson_locked_for(lesson, current_user):
        raise HTTPException(status_code=403, detail="Прошла полночь по Баку — урок удалить нельзя")

    # lesson_marks/lesson_resources ссылаются на lessons.id без ON DELETE
    # CASCADE (и без ORM-relationship с каскадом) — без этого удаление
    # урока с уже проставленными оценками или привязанными материалами
    # падало на ограничении внешнего ключа. Сами материалы/квизы/ссылки
    # в «Базе знаний» не трогаем — удаляем только привязки этого урока.
    # ДЗ урока (задания, ответы, их файлы в хранилище) и диалоги — тоже данные
    # внутри урока, удаляются вместе с ним.
    await delete_lessons_homework(db, [lesson_id])
    await db.execute(delete(LessonMark).where(LessonMark.lesson_id == lesson_id))
    await db.execute(delete(LessonResource).where(LessonResource.lesson_id == lesson_id))

    await db.execute(delete(LessonStudent).where(LessonStudent.lesson_id == lesson_id))  # участники персонального урока
    await db.delete(lesson)
    await db.commit()
    return {"ok": True}


# Копировать урок в другую группу
@router.post("/{lesson_id}/copy")
async def copy_lesson(
    lesson_id: int,
    target_group_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")

    # Для admin доступ к любой группе, для teacher — только к своей
    group_query = select(Group).where(Group.id == target_group_id)
    if current_user.role != "admin":
        group_query = group_query.where(Group.teacher_id == current_user.id)

    group = (await db.execute(group_query)).scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=403, detail="Нет доступа к целевой группе")

    new_lesson = Lesson(
        group_id=target_group_id,
        title=lesson.title,
        order=lesson.order,
        date=None,  # дату копируем пустой — педагог назначит
        duration_min=lesson.duration_min,
        source=lesson.source,
        is_open=False,
        teacher_id=group.teacher_id,
    )
    db.add(new_lesson)
    await db.commit()
    await db.refresh(new_lesson)
    return new_lesson
