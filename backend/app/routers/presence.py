"""Присутствие в системе: пульс, «сейчас в системе», отчёт о посещениях
(claude/presence-plan.md). Правила — здесь же, в начале файла, и больше нигде:

- Открытая и видимая вкладка шлёт пульс раз в PING_INTERVAL (фронт:
  hooks/usePresencePing.js). Свёрнутая / скрытая вкладка пульс не шлёт.
- Пульс продлевает последнюю сессию, если с прошлого прошло не больше
  SESSION_GAP; иначе начинается новая сессия.
- «Сегодня в системе» — все, у кого сегодня (по Баку) была сессия; зелёный
  флажок «сейчас здесь» — последний пульс не старше ONLINE_WINDOW.
- Время сессии = last_seen - started + PING_INTERVAL (последняя минута
  после последнего пульса тоже была проведена в системе).
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import get_current_user, require_admin
from ..lesson_lock import BAKU_TZ, aware, baku_day
from ..models import Group, GroupMember, User, UserSession

router = APIRouter(prefix="/presence", tags=["presence"])

PING_INTERVAL = timedelta(seconds=60)
SESSION_GAP = timedelta(minutes=5)
ONLINE_WINDOW = timedelta(minutes=10)  # решение Андрея: «сейчас здесь» = активен за 10 мин
# Несколько вкладок одного пользователя шлют пульсы независимо — чаще раза
# в THROTTLE базу не трогаем.
THROTTLE = timedelta(seconds=20)
RETENTION_DAYS = 365


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def session_minutes(started_at: datetime, last_seen_at: datetime) -> float:
    return ((last_seen_at - started_at) + PING_INTERVAL).total_seconds() / 60


async def record_ping(db: AsyncSession, user_id: int) -> None:
    now = now_utc()
    last = (await db.execute(
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.last_seen_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    last_seen = aware(last.last_seen_at) if last else None
    if last_seen and last_seen >= now - THROTTLE:
        return
    if last_seen and last_seen >= now - SESSION_GAP:
        last.last_seen_at = now
    else:
        db.add(UserSession(user_id=user_id, started_at=now, last_seen_at=now))
    await db.commit()


async def purge_old(db: AsyncSession) -> None:
    """Срок хранения: сессии старше RETENTION_DAYS удаляются (вызывается из отчёта)."""
    await db.execute(delete(UserSession).where(
        UserSession.last_seen_at < now_utc() - timedelta(days=RETENTION_DAYS)
    ))
    await db.commit()


ROLES = ("admin", "teacher", "curator", "student")
MAX_REPORT_DAYS = 366


@router.post("/ping", status_code=204)
async def ping(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await record_ping(db, current_user.id)
    return Response(status_code=204)


class TodayUserOut(BaseModel):
    user_id: int
    full_name: str
    role: str
    first_seen: datetime   # первый вход сегодня
    last_seen: datetime
    minutes: int           # время в системе сегодня
    is_online: bool        # последний пульс не старше ONLINE_WINDOW (зелёный флажок)


# «Сегодня в системе»: все, кто заходил сегодня (день по Баку), с флажком
# «сейчас здесь». Сначала те, кто сейчас в системе, потом по последней активности.
@router.get("/today", response_model=list[TodayUserOut])
async def today(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    now = now_utc()
    day_start = datetime.combine(baku_day(now), time.min, tzinfo=BAKU_TZ)
    rows = (await db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.last_seen_at >= day_start)
    )).all()
    out: dict[int, TodayUserOut] = {}
    for s, u in rows:
        started = max(aware(s.started_at), day_start)  # сессия с прошлого дня — считаем с полуночи
        minutes = round(session_minutes(started, aware(s.last_seen_at)))
        item = out.get(u.id)
        if item is None:
            out[u.id] = TodayUserOut(
                user_id=u.id, full_name=u.full_name or u.username, role=u.role,
                first_seen=started, last_seen=aware(s.last_seen_at), minutes=minutes, is_online=False,
            )
        else:
            item.first_seen = min(item.first_seen, started)
            item.last_seen = max(item.last_seen, aware(s.last_seen_at))
            item.minutes += minutes
    for item in out.values():
        item.is_online = item.last_seen >= now - ONLINE_WINDOW
    return sorted(out.values(), key=lambda i: (not i.is_online, -i.last_seen.timestamp()))


class DayRowOut(BaseModel):
    user_id: int
    full_name: str
    role: str
    date: date            # день по Баку (по началу сессии)
    first_seen: datetime
    last_seen: datetime
    minutes: int
    sessions: int


class TotalRowOut(BaseModel):
    user_id: int
    full_name: str
    role: str
    days: int             # дней, когда заходил
    minutes: int
    sessions: int
    last_seen: Optional[datetime] = None


class PresenceReportOut(BaseModel):
    days: list[DayRowOut]
    totals: list[TotalRowOut]


async def _scope_users(db: AsyncSession, role: Optional[str], group_id: Optional[int]) -> dict[int, User]:
    """Пользователи отчёта: фильтр по роли и/или группе (её педагог + все ученики,
    включая отчисленных — их прошлые посещения тоже нужны)."""
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if group_id is not None:
        group = (await db.execute(select(Group).where(Group.id == group_id))).scalar_one_or_none()
        if not group:
            raise HTTPException(status_code=404, detail="Группа не найдена")
        member_ids = select(GroupMember.student_id).where(GroupMember.group_id == group_id)
        query = query.where((User.id.in_(member_ids)) | (User.id == group.teacher_id))
    return {u.id: u for u in (await db.execute(query)).scalars().all()}


@router.get("/report", response_model=PresenceReportOut)
async def report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    role: Optional[str] = Query(None),
    group_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if role and role not in ROLES:
        raise HTTPException(status_code=400, detail="Неизвестная роль")
    if date_to < date_from or (date_to - date_from).days > MAX_REPORT_DAYS:
        raise HTTPException(status_code=400, detail="Период: от 1 дня до года")

    await purge_old(db)
    users = await _scope_users(db, role, group_id)
    if not users:
        return PresenceReportOut(days=[], totals=[])

    start = datetime.combine(date_from, time.min, tzinfo=BAKU_TZ)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=BAKU_TZ)
    sessions = (await db.execute(
        select(UserSession)
        .where(UserSession.user_id.in_(list(users)), UserSession.started_at >= start, UserSession.started_at < end)
        .order_by(UserSession.started_at)
    )).scalars().all()

    by_day: dict[tuple[int, date], DayRowOut] = {}
    for s in sessions:
        u = users[s.user_id]
        key = (u.id, baku_day(s.started_at))
        row = by_day.get(key)
        minutes = session_minutes(s.started_at, s.last_seen_at)
        if row is None:
            by_day[key] = DayRowOut(
                user_id=u.id, full_name=u.full_name or u.username, role=u.role, date=key[1],
                first_seen=s.started_at, last_seen=s.last_seen_at, minutes=0, sessions=0,
            )
            row = by_day[key]
        row.last_seen = max(row.last_seen, s.last_seen_at)
        row.minutes += round(minutes)
        row.sessions += 1

    # Итого — по всем пользователям фильтра, включая тех, кто не заходил ни разу
    totals = {uid: TotalRowOut(user_id=uid, full_name=u.full_name or u.username, role=u.role,
                               days=0, minutes=0, sessions=0) for uid, u in users.items()}
    for row in by_day.values():
        t = totals[row.user_id]
        t.days += 1
        t.minutes += row.minutes
        t.sessions += row.sessions
        t.last_seen = max(t.last_seen, row.last_seen) if t.last_seen else row.last_seen

    days = sorted(by_day.values(), key=lambda r: (r.date, r.full_name.lower()), reverse=False)
    days.sort(key=lambda r: r.date, reverse=True)
    return PresenceReportOut(
        days=days,
        totals=sorted(totals.values(), key=lambda t: (-t.minutes, t.full_name.lower())),
    )
