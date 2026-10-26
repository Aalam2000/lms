"""Присутствие в системе: пульс, «сейчас в системе», отчёт о посещениях
(claude/presence-plan.md). Правила — здесь же, в начале файла, и больше нигде:

- Открытая и видимая вкладка шлёт пульс раз в PING_INTERVAL (фронт:
  hooks/usePresencePing.js). Свёрнутая / скрытая вкладка пульс не шлёт.
- Пульс продлевает последнюю сессию, если с прошлого прошло не больше
  SESSION_GAP; иначе начинается новая сессия.
- «Сейчас в системе» — только те, у кого последний пульс не старше
  ONLINE_WINDOW и кто не закрыл вкладку: при закрытии фронт шлёт «ушёл»
  (POST /presence/bye) — человек пропадает сразу, до следующего пульса.
  «Ушёл» хранится в памяти процесса (backend в один воркер); после
  перезапуска действует только окно ONLINE_WINDOW.
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
# Решение Андрея: «сейчас в системе» — только кто онлайн сейчас: пульс раз в минуту,
# окно — 2 минуты (одна пропущенная минута в запасе)
ONLINE_WINDOW = timedelta(minutes=2)
# Кто закрыл вкладку («ушёл», POST /presence/bye): user_id → время. Снимается пульсом.
LEFT_AT: dict[int, datetime] = {}
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
    LEFT_AT.pop(current_user.id, None)  # снова на месте (вторая вкладка, перезагрузка)
    await record_ping(db, current_user.id)
    return Response(status_code=204)


# Закрыл вкладку — «ушёл» сразу (фронт: fetch keepalive при pagehide)
@router.post("/bye", status_code=204)
async def bye(current_user: User = Depends(get_current_user)):
    LEFT_AT[current_user.id] = now_utc()
    return Response(status_code=204)


class OnlineUserOut(BaseModel):
    user_id: int
    full_name: str
    role: str
    since: datetime        # начало текущей сессии
    last_seen: datetime


# «Сейчас в системе»: последний пульс не старше ONLINE_WINDOW и вкладку не закрыл
@router.get("/online", response_model=list[OnlineUserOut])
async def online(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    now = now_utc()
    rows = (await db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.last_seen_at >= now - ONLINE_WINDOW)
    )).all()
    out: dict[int, OnlineUserOut] = {}
    for s, u in rows:
        last_seen = aware(s.last_seen_at)
        left = LEFT_AT.get(u.id)
        if left and left >= last_seen:
            continue
        item = out.get(u.id)
        if item is None or last_seen > item.last_seen:
            out[u.id] = OnlineUserOut(
                user_id=u.id, full_name=u.full_name or u.username, role=u.role,
                since=aware(s.started_at), last_seen=last_seen,
            )
    return sorted(out.values(), key=lambda i: i.full_name.lower())


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
