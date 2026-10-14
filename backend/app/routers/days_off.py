"""Выходные педагога (правила и формат — app/days_off.py).

- настройки (полоски дней недели и отдельные даты): смотрит админ и сам
  педагог, меняет только админ;
- предпросмотр: какие дни выходят выходными при несохранённых настройках —
  для маленького календаря в редакторе (правило считается только здесь,
  на фронте оно не повторяется);
- даты выходных за период — для заливки дней в календарях.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..days_off import apply_settings, current_settings, days_off_between, is_day_off
from ..dependencies import get_current_user, require_admin, require_teacher
from ..models import Group, GroupMember, User

router = APIRouter(prefix="/days-off", tags=["days-off"])

MAX_RANGE_DAYS = 400


class DaysOffSettings(BaseModel):
    weeks: list[list[int]] = []
    dates: dict[str, str] = {}  # "YYYY-MM-DD": "off" | "work"


class DaysOffDates(BaseModel):
    dates: list[date]


class DaysOffPreviewIn(DaysOffSettings):
    date_from: date
    date_to: date


class DaysOffPreview(DaysOffDates):
    pattern: list[date]  # выходные только по полоскам, без отдельных дат


async def _teacher(db: AsyncSession, teacher_id: int) -> User:
    teacher = (await db.execute(
        select(User).where(User.id == teacher_id, User.role == "teacher")
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(status_code=404, detail="Педагог не найден")
    return teacher


def _check_range(date_from: date, date_to: date) -> None:
    if date_to < date_from or (date_to - date_from).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Период — не длиннее {MAX_RANGE_DAYS} дней")


def _check_owner_or_admin(user: User, teacher_id: int) -> None:
    if user.role != "admin" and user.id != teacher_id:
        raise HTTPException(status_code=403, detail="Выходные педагога видит только он сам и админ")


@router.get("/teacher/{teacher_id}/settings", response_model=DaysOffSettings)
async def get_settings(teacher_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_teacher)):
    _check_owner_or_admin(user, teacher_id)
    return current_settings((await _teacher(db, teacher_id)).days_off)


@router.post("/teacher/{teacher_id}/preview", response_model=DaysOffPreview)
async def preview_settings(
    teacher_id: int, data: DaysOffPreviewIn,
    db: AsyncSession = Depends(get_db), user: User = Depends(require_teacher),
):
    _check_owner_or_admin(user, teacher_id)
    _check_range(data.date_from, data.date_to)
    saved = (await _teacher(db, teacher_id)).days_off
    draft = apply_settings(saved, data.weeks, data.dates)
    pattern = apply_settings(saved, data.weeks, {})
    return {
        "dates": days_off_between(draft, data.date_from, data.date_to),
        "pattern": days_off_between(pattern, data.date_from, data.date_to),
    }


@router.put("/teacher/{teacher_id}/settings", response_model=DaysOffSettings)
async def save_settings(
    teacher_id: int, data: DaysOffSettings,
    db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin),
):
    teacher = await _teacher(db, teacher_id)
    teacher.days_off = apply_settings(teacher.days_off, data.weeks, data.dates)
    await db.commit()
    return current_settings(teacher.days_off)


@router.get("/teacher/{teacher_id}", response_model=DaysOffDates)
async def teacher_days(
    teacher_id: int, date_from: date, date_to: date,
    db: AsyncSession = Depends(get_db), user: User = Depends(require_teacher),
):
    _check_range(date_from, date_to)
    teacher = (await db.execute(select(User).where(User.id == teacher_id))).scalar_one_or_none()
    if not teacher or teacher.role != "teacher":
        return {"dates": []}  # у админа в роли педагога выходных нет
    return {"dates": days_off_between(teacher.days_off, date_from, date_to)}


# Календарь ученика: день красный, когда выходной у педагогов всех его групп
# (у ученика с одной группой — просто выходные его педагога).
@router.get("/student", response_model=DaysOffDates)
async def student_days(
    date_from: date, date_to: date,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    _check_range(date_from, date_to)
    if user.role != "student":
        return {"dates": []}
    teacher_ids = (await db.execute(
        select(Group.teacher_id).join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.student_id == user.id, GroupMember.status == "active", Group.status == "active")
        .distinct()
    )).scalars().all()
    if not teacher_ids:
        return {"dates": []}
    teachers = (await db.execute(select(User).where(User.id.in_(teacher_ids)))).scalars().all()
    if any(t.role != "teacher" for t in teachers):
        return {"dates": []}  # группу ведёт админ — у него выходных нет
    days = days_off_between(teachers[0].days_off, date_from, date_to)
    return {"dates": [d for d in days if all(is_day_off(t.days_off, d) for t in teachers[1:])]}
