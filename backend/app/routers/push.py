"""Согласия на уведомления (Web Push).

Сейчас только сбор: кнопка «На рабочий стол» спрашивает разрешение и присылает
сюда подписку устройства. Рассылка — отдельная задача (будет здесь же).

Ключи — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY в .env. Открытый ключ отдаём
браузеру, подписка к нему привязана: сменить ключи = потерять все согласия.
"""
import os
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import get_current_user, require
from ..models import PushSubscription, User

router = APIRouter(prefix="/push", tags=["push"])

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY") or None


class PushKeyOut(BaseModel):
    public_key: Optional[str]


class SubKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)
    keys: SubKeys


@router.get("/key", response_model=PushKeyOut)
async def push_key():
    # Ключ не задан — фронт просто не спрашивает разрешение
    return PushKeyOut(public_key=VAPID_PUBLIC_KEY)


@router.post("/subscribe")
async def subscribe(data: SubscriptionIn, request: Request,
                    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    # Одно устройство — одна запись; вошёл другой пользователь — запись переходит к нему
    ua = (request.headers.get("user-agent") or "")[:500] or None
    sub = (await db.execute(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint))).scalar_one_or_none()
    if sub:
        sub.user_id = user.id
        sub.p256dh = data.keys.p256dh
        sub.auth = data.keys.auth
        sub.user_agent = ua
        sub.updated_at = func.now()
    else:
        db.add(PushSubscription(user_id=user.id, endpoint=data.endpoint,
                                p256dh=data.keys.p256dh, auth=data.keys.auth, user_agent=ua))
    await db.commit()
    return {"ok": True}


@router.get("/users", response_model=list[int])
async def push_users(db: AsyncSession = Depends(get_db), _: User = Depends(require("students.view"))):
    # id пользователей, разрешивших уведомления (значок 🔔 в списках)
    rows = await db.execute(select(PushSubscription.user_id).distinct())
    return [r[0] for r in rows]
