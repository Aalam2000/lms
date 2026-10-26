"""Уведомления (Web Push): что у человека ждёт реакции и куда вести по нажатию.

На устройстве одно уведомление платформы (tag "lms"): каждое новое событие
заменяет его сводкой «что ждёт» на этот момент. По нажатию — /dashboard/next:
урок с самым давним необработанным (next_path), какое бы уведомление ни нажали.

Что ждёт реакции — существующие правила:
- педагог: ДЗ на проверку в группах, где он основной педагог (homework_status),
  работы на уроках, которые он ведёт (lesson_work), непрочитанные сообщения
  учеников (lesson_dialog);
- ученик: несданные ДЗ (student_homework_debts) и непрочитанные сообщения педагога.

Кого уведомлять о событии, решает эндпоинт события (routers/homework.py,
routers/lesson_work.py): передаёт id в send_summaries фоновой задачей после
ответа. Устройства, которые служба уведомлений отвергла (404/410), удаляются.

Напоминание: раз в час (reminder_loop, запускается при старте приложения)
тем, у кого есть необработанное и с последнего уведомления (users.push_sent_at)
прошли сутки, — та же сводка. Только днём по Баку (REMIND_HOURS).
Выключено в профиле (ui_prefs «notify.push» = false) — не шлём ничего.
Ключи — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY в .env (routers/push.py)."""
import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import AsyncSessionLocal
from .homework_status import awaiting_review, student_homework_debts, to_review_by_group
from .lesson_dialog import teacher_dialogs, teacher_unread, unread_condition
from .lesson_lock import BAKU_TZ, aware
from .lesson_work import awaiting_work_review, work_to_review_for_teacher
from .models import Academy, Group, HomeworkAnswer, HomeworkTask, Lesson, LessonMessage, LessonWorkFile, PushSubscription, User
from .personal import student_lesson_scope, visible_to_student

try:
    from pywebpush import WebPushException, webpush
except ImportError:  # библиотека не установлена — уведомления молча выключены
    webpush = None

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY") or None
NEXT_URL = "/dashboard/next"
TAG = "lms"
TTL = 24 * 3600  # телефон был выключен — получит уведомление, когда включится (в течение суток)
REMIND_AFTER = timedelta(hours=24)
REMIND_HOURS = range(9, 21)  # напоминания — с 9:00 до 21:00 по Баку
PREF_KEY = "notify.push"  # выключатель в профиле (по умолчанию включено)

# Текст сводки — на языке профиля (ключ lang); строки собирает сервер, autoi18n их не видит
TEXTS = {
    "ru": {"hw_check": "Проверить ДЗ: {}", "work_check": "Проверить работы: {}",
           "hw_due": "Несданные ДЗ: {}", "messages": "Сообщения: {}"},
    "az": {"hw_check": "Yoxlanılacaq ev tapşırıqları: {}", "work_check": "Yoxlanılacaq işlər: {}",
           "hw_due": "Təhvil verilməmiş ev tapşırıqları: {}", "messages": "Mesajlar: {}"},
    "en": {"hw_check": "Homework to check: {}", "work_check": "Work to check: {}",
           "hw_due": "Homework to hand in: {}", "messages": "Messages: {}"},
}

TEACHER_ROLES = ("teacher", "admin")


async def _active_group_ids(db: AsyncSession, teacher_id: Optional[int] = None) -> list[int]:
    q = select(Group.id).where(Group.status == "active")
    if teacher_id is not None:
        q = q.where(Group.teacher_id == teacher_id)
    return [r[0] for r in (await db.execute(q)).all()]


async def _teacher_state(db: AsyncSession, uid: int) -> tuple[list[tuple[str, int]], list[tuple[datetime, str]]]:
    """(что ждёт: [(вид, сколько)], [(время самого давнего, адрес урока)])."""
    parts, firsts = [], []
    path = lambda lid: f"/dashboard/lessons/{lid}?view=students"

    own_groups = await _active_group_ids(db, uid)
    hw = sum((await to_review_by_group(db, own_groups)).values())
    if hw:
        parts.append(("hw_check", hw))
        row = (await db.execute(
            select(HomeworkAnswer.updated_at, HomeworkAnswer.lesson_id)
            .join(Lesson, Lesson.id == HomeworkAnswer.lesson_id)
            .where(Lesson.group_id.in_(own_groups), *awaiting_review())
            .order_by(HomeworkAnswer.updated_at, HomeworkAnswer.id).limit(1)
        )).first()
        if row:
            firsts.append((aware(row[0]), path(row[1])))

    all_groups = await _active_group_ids(db)
    work = (await work_to_review_for_teacher(db, uid, all_groups))["count"]
    if work:
        parts.append(("work_check", work))
        row = (await db.execute(
            select(LessonWorkFile.uploaded_at, LessonWorkFile.lesson_id)
            .join(Lesson, Lesson.id == LessonWorkFile.lesson_id)
            .where(Lesson.group_id.in_(all_groups), Lesson.teacher_id == uid, *awaiting_work_review())
            .order_by(LessonWorkFile.uploaded_at, LessonWorkFile.id).limit(1)
        )).first()
        if row:
            firsts.append((aware(row[0]), path(row[1])))

    messages = (await teacher_unread(db, uid))["count"]
    if messages:
        parts.append(("messages", messages))
        row = (await db.execute(
            teacher_dialogs(uid).with_only_columns(LessonMessage.created_at, LessonMessage.lesson_id)
            .order_by(LessonMessage.created_at, LessonMessage.id).limit(1)
        )).first()
        if row:
            firsts.append((aware(row[0]), path(row[1])))
    return parts, firsts


async def _student_state(db: AsyncSession, uid: int) -> tuple[list[tuple[str, int]], list[tuple[datetime, str]]]:
    parts, firsts = [], []
    path = lambda lid: f"/dashboard/student-lessons/{lid}"

    debts = await student_homework_debts(db, uid)
    if debts["count"]:
        parts.append(("hw_due", debts["count"]))
        given = (await db.execute(
            select(func.min(HomeworkTask.created_at)).where(
                HomeworkTask.lesson_id == debts["lesson_id"],
                (HomeworkTask.student_id.is_(None)) | (HomeworkTask.student_id == uid),
            )
        )).scalar()
        if given:
            firsts.append((aware(given), path(debts["lesson_id"])))

    # Сообщения — в уроках, которые ученик видит на Главной (открытые уроки его групп)
    lessons = select(Lesson.id).where(student_lesson_scope(uid), visible_to_student(uid), Lesson.is_open == True)  # noqa: E712
    unread = (
        select(LessonMessage.created_at, LessonMessage.lesson_id)
        .where(*unread_condition(uid), LessonMessage.student_id == uid, LessonMessage.lesson_id.in_(lessons))
    )
    messages = (await db.execute(select(func.count()).select_from(unread.subquery()))).scalar() or 0
    if messages:
        parts.append(("messages", messages))
        row = (await db.execute(unread.order_by(LessonMessage.created_at, LessonMessage.id).limit(1))).first()
        if row:
            firsts.append((aware(row[0]), path(row[1])))
    return parts, firsts


async def _state(db: AsyncSession, user: User):
    if user.role in TEACHER_ROLES:
        return await _teacher_state(db, user.id)
    if user.role == "student":
        return await _student_state(db, user.id)
    return [], []


async def next_path(db: AsyncSession, user: User) -> str:
    """Куда вести по нажатию на уведомление: урок с самым давним необработанным; нет — «Главная»."""
    _, firsts = await _state(db, user)
    return min(firsts)[1] if firsts else "/dashboard"


def _send(sub: PushSubscription, payload: str, subject: str) -> Optional[int]:
    """Отправка на одно устройство (блокирующая — вызывать через to_thread). → код ответа службы."""
    try:
        r = webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=payload, vapid_private_key=VAPID_PRIVATE_KEY, vapid_claims={"sub": subject}, ttl=TTL,
        )
        return r.status_code
    except WebPushException as e:
        code = e.response.status_code if e.response is not None else None
        if code not in (404, 410):
            logger.warning("push: устройство %s — %s", sub.id, e)
        return code
    except Exception:
        logger.exception("push: устройство %s", sub.id)
        return None


async def send_summaries(user_ids: Iterable[Optional[int]]) -> None:
    """Каждому — сводка «что ждёт» на все его устройства (фоновая задача после ответа)."""
    ids = {i for i in user_ids if i}
    if not ids or webpush is None or not VAPID_PRIVATE_KEY:
        return
    try:
        async with AsyncSessionLocal() as db:
            academy = (await db.execute(select(Academy).limit(1))).scalar_one_or_none()
            title = (academy.name if academy else None) or "LMS"
            subject = f"mailto:{academy.email}" if academy and academy.email else "mailto:admin@localhost"
            for uid in ids:
                subs = (await db.execute(select(PushSubscription).where(PushSubscription.user_id == uid))).scalars().all()
                user = await db.get(User, uid) if subs else None
                if not user or (user.ui_prefs or {}).get(PREF_KEY) is False:
                    continue
                parts, _ = await _state(db, user)
                if not parts:
                    continue
                lang = (user.ui_prefs or {}).get("lang")
                texts = TEXTS.get(lang) or TEXTS["ru"]
                payload = json.dumps({
                    "title": title, "body": " · ".join(texts[kind].format(n) for kind, n in parts),
                    "url": NEXT_URL, "tag": TAG,
                })
                codes = [await asyncio.to_thread(_send, sub, payload, subject) for sub in subs]
                dead = [sub.id for sub, code in zip(subs, codes) if code in (404, 410)]
                if dead:
                    await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead)))
                if any(code and 200 <= code < 300 for code in codes):
                    user.push_sent_at = datetime.now(timezone.utc)
                await db.commit()
    except Exception:
        logger.exception("push: рассылка не удалась")


async def send_reminders() -> None:
    """Напоминание тем, кому сутки ничего не приходило (сводка уйдёт, только если что-то ждёт)."""
    if datetime.now(BAKU_TZ).hour not in REMIND_HOURS:
        return
    since = datetime.now(timezone.utc) - REMIND_AFTER
    async with AsyncSessionLocal() as db:
        ids = [r[0] for r in (await db.execute(
            select(User.id).where(
                User.id.in_(select(PushSubscription.user_id)),
                or_(User.push_sent_at.is_(None), User.push_sent_at < since),
            )
        )).all()]
    await send_summaries(ids)


async def reminder_loop(interval: int = 3600) -> None:
    """Фоновая проверка напоминаний (main.py, lifespan). Первая — через 5 минут после старта."""
    await asyncio.sleep(300)
    while True:
        try:
            await send_reminders()
        except Exception:
            logger.exception("push: напоминания не удались")
        await asyncio.sleep(interval)
