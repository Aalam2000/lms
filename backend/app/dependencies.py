from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from .database import get_db
from .models import User
from .core.security import decode_token

security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    # Кэш на время одного HTTP-запроса: get_current_user вызывается
    # несколько раз (напрямую в роутере и через require_teacher/require_admin),
    # но SELECT users должен выполниться один раз.
    cached = getattr(request.state, "current_user", None)
    if cached is not None:
        return cached

    token = credentials.credentials
    username = decode_token(token)
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    request.state.current_user = user
    return user

async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(optional_security),
    db: AsyncSession = Depends(get_db),
):
    """Пользователь, если запрос пришёл с действующим токеном, иначе None —
    для публичных роутов, которые ведут себя иначе для своих (регистрация
    по QR: ученик, которого заводит педагог, не ждёт подтверждения)."""
    if credentials is None:
        return None
    try:
        return await get_current_user(request, credentials, db)
    except HTTPException:
        return None


# Dependency для роутов только для admin
async def require_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Только для администратора")
    return current_user

# Dependency для роутов только для teacher (и admin тоже может)
async def require_teacher(current_user: User = Depends(get_current_user)):
    if current_user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Только для преподавателя")
    return current_user