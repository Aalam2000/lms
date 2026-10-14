"""Выходные педагога (решение Андрея, 2026-10-13).

Хранятся в users.days_off (JSON):
    {"versions": [{"from": "2026-10-13", "weeks": [[5, 6], [6]]}, ...],
     "dates": {"2026-10-20": "off", "2026-10-27": "work"}}

- weeks — одна или несколько полосок дней недели (0 = Пн … 6 = Вс). Несколько
  полосок чередуются по неделям; первая полоска — неделя, в которую попала
  дата "from" этой версии.
- Версия действует с даты "from" (день, когда админ её сохранил) до начала
  следующей: выходные применяются с даты установки и дальше, прошлое при
  изменении не перекрашивается.
- dates — отдельные дни из календаря: "off" — выходной, "work" — рабочий (в том
  числе отмена постоянного выходного на эту дату). Меняются только на сегодня и
  дальше.
- Выходные бывают только у педагогов (role == "teacher"). Ставит их админ,
  педагог видит у себя в профиле.
- Урок на выходной может поставить только сам педагог; остальным — 409
  (ensure_lessons_allowed). Прошлые даты не проверяются.
"""
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .lesson_lock import BAKU_TZ, baku_day
from .models import Group, GroupMember, User

OFF = "off"
WORK = "work"
MAX_WEEKS = 4  # полосок дней недели (чередование до 4 недель)
MAX_RANGE_DAYS = 400  # самый длинный период, за который отдаются даты выходных


def today() -> date:
    return datetime.now(BAKU_TZ).date()


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _versions(cfg: Optional[dict]) -> list[dict]:
    return sorted((cfg or {}).get("versions") or [], key=lambda v: v["from"])


def _dates(cfg: Optional[dict]) -> dict:
    return dict((cfg or {}).get("dates") or {})


def is_day_off(cfg: Optional[dict], d: date) -> bool:
    mark = _dates(cfg).get(d.isoformat())
    if mark is not None:
        return mark == OFF
    version = None
    for v in _versions(cfg):
        if v["from"] <= d.isoformat():
            version = v
    if not version or not version["weeks"]:
        return False
    start = date.fromisoformat(version["from"])
    week_index = ((_monday(d) - _monday(start)).days // 7) % len(version["weeks"])
    return d.weekday() in version["weeks"][week_index]


def days_off_between(cfg: Optional[dict], start: date, end: date) -> list[date]:
    days, d = [], start
    while d <= end:
        if is_day_off(cfg, d):
            days.append(d)
        d += timedelta(days=1)
    return days


def check_range(date_from: date, date_to: date) -> None:
    if date_to < date_from or (date_to - date_from).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Период — не длиннее {MAX_RANGE_DAYS} дней")


def current_settings(cfg: Optional[dict]) -> dict:
    """То, что видит и правит админ: действующие полоски и даты с сегодняшнего дня."""
    versions = _versions(cfg)
    first_day = today().isoformat()
    return {
        "weeks": versions[-1]["weeks"] if versions else [],
        "dates": {k: v for k, v in sorted(_dates(cfg).items()) if k >= first_day},
    }


def _normalize_weeks(weeks: list[list[int]]) -> list[list[int]]:
    if len(weeks) > MAX_WEEKS:
        raise HTTPException(status_code=422, detail=f"Не больше {MAX_WEEKS} недель в чередовании")
    result = []
    for week in weeks:
        if any(day not in range(7) for day in week):
            raise HTTPException(status_code=422, detail="День недели должен быть числом от 0 (Пн) до 6 (Вс)")
        result.append(sorted(set(week)))
    # Пустые полоски в хвосте ничего не меняют — не храним; все пустые — выходных нет
    while result and not result[-1]:
        result.pop()
    return result


def apply_settings(cfg: Optional[dict], weeks: list[list[int]], dates: dict[str, str]) -> dict:
    """Новое значение users.days_off после сохранения админом."""
    first_day = today()
    weeks = _normalize_weeks(weeks)

    versions = _versions(cfg)
    current = versions[-1]["weeks"] if versions else []
    if weeks != current:
        if versions and versions[-1]["from"] >= first_day.isoformat():
            versions[-1] = {"from": first_day.isoformat(), "weeks": weeks}  # правка в тот же день
        else:
            versions.append({"from": first_day.isoformat(), "weeks": weeks})

    kept = {k: v for k, v in _dates(cfg).items() if k < first_day.isoformat()}  # прошлое не меняется
    for key, mark in dates.items():
        try:
            day = date.fromisoformat(key)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Неверная дата: {key}")
        if mark not in (OFF, WORK):
            raise HTTPException(status_code=422, detail="Отметка дня — off или work")
        if day < first_day:
            raise HTTPException(status_code=422, detail="Прошедшие дни менять нельзя")
        kept[key] = mark
    return {"versions": versions, "dates": dict(sorted(kept.items()))}


def format_dates(days: Iterable[date]) -> str:
    return ", ".join(d.strftime("%d.%m.%Y") for d in days)


async def find_conflicts(db: AsyncSession, items: Iterable[tuple[Optional[int], Optional[datetime]]]) -> list[date]:
    """Даты (с сегодняшнего дня), на которые уроки попадают в выходной своего педагога."""
    first_day = today()
    pairs = [(teacher_id, baku_day(when)) for teacher_id, when in items if teacher_id and when]
    pairs = [(teacher_id, day) for teacher_id, day in pairs if day >= first_day]
    if not pairs:
        return []
    teachers = (await db.execute(
        select(User.id, User.days_off).where(User.id.in_({t for t, _ in pairs}), User.role == "teacher")
    )).all()
    configs = {teacher_id: cfg for teacher_id, cfg in teachers}
    return sorted({day for teacher_id, day in pairs if teacher_id in configs and is_day_off(configs[teacher_id], day)})


def conflict_detail(days: list[date]) -> str:
    if len(days) == 1:
        return f"У педагога выходной {format_dates(days)} — урок на этот день может поставить только он сам"
    return f"У педагога выходные: {format_dates(days)} — уроки на эти дни может поставить только он сам"


async def ensure_lessons_allowed(
    db: AsyncSession, items: Iterable[tuple[Optional[int], Optional[datetime]]], actor: User,
) -> None:
    """409, если кто-то, кроме самого педагога, ставит урок на его выходной."""
    days = await find_conflicts(db, [(t, w) for t, w in items if t != actor.id])
    if days:
        raise HTTPException(status_code=409, detail=conflict_detail(days))


async def student_days_off(db: AsyncSession, student_id: int, date_from: date, date_to: date) -> list[date]:
    """Календарь ученика: день выходной, когда выходной у педагогов всех его
    активных групп (у ученика с одной группой — просто выходные его педагога).
    Группу ведёт админ — у него выходных нет, значит и у ученика их нет."""
    teacher_ids = (await db.execute(
        select(Group.teacher_id).join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.student_id == student_id, GroupMember.status == "active", Group.status == "active")
        .distinct()
    )).scalars().all()
    if not teacher_ids:
        return []
    teachers = (await db.execute(select(User).where(User.id.in_(teacher_ids)))).scalars().all()
    if any(t.role != "teacher" for t in teachers):
        return []
    days = days_off_between(teachers[0].days_off, date_from, date_to)
    return [d for d in days if all(is_day_off(t.days_off, d) for t in teachers[1:])]
