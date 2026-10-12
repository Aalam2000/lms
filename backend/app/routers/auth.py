from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import User, Group, GroupMember
from ..schemas import UserLogin, Token, UserOut, UserCreate, StudentRegister, UserUpdate
from ..core.security import verify_password, get_password_hash, create_access_token, decode_token
from ..dependencies import get_current_user, get_optional_user
from ..phones import checked_student_phone, ensure_phone_free, normalize_phone, PHONE_REQUIRED_ERROR

router = APIRouter()

# Самостоятельная регистрация по QR: не больше стольких новых учеников в одну
# группу за час — защита от массового заведения аккаунтов
REGISTRATIONS_PER_HOUR = 30

# Регистрация педагога админом
@router.post("/register", response_model=UserOut)
async def register(
        user_data: UserCreate,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user)  # только admin
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Только администратор")

    result = await db.execute(select(User).where(User.username == user_data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")

    user = User(
        username=user_data.username,
        hashed_password=get_password_hash(user_data.password),
        email=user_data.email,
        role=user_data.role,
        created_by=current_user.id
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

@router.post("/login", response_model=Token)
async def login(user_data: UserLogin, db: AsyncSession = Depends(get_db)):
    # Ищем пользователя
    result = await db.execute(select(User).where(User.username == user_data.username))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    # Проверяем пароль
    if not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(data={"sub": user.username})
    return {"access_token": token}

@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# Регистрация ученика по коду группы (QR). Сам ученик попадает в группу со
# статусом pending — «ждёт подтверждения»: пока педагог не примет, его нет в
# журнале, уроках и отчётах (везде учитываются только active). Если ученика
# заводит педагог этой группы или админ (окно «Добавить студента» у QR),
# он сразу активный и ограничение частоты на него не действует.
@router.post("/register/student", response_model=UserOut)
async def register_student(
    data: StudentRegister,
    db: AsyncSession = Depends(get_db),
    actor: Optional[User] = Depends(get_optional_user),
):
    # Проверяем invite_code; в архивную группу не регистрируем
    result = await db.execute(select(Group).where(Group.invite_code == data.invite_code))
    group = result.scalar_one_or_none()
    if not group or group.status != "active":
        raise HTTPException(status_code=404, detail="Приглашение недействительно")

    by_staff = actor is not None and (actor.role == "admin" or (actor.role == "teacher" and group.teacher_id == actor.id))
    if not by_staff:
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        recent = (await db.execute(
            select(func.count(GroupMember.id))
            .join(User, User.id == GroupMember.student_id)
            .where(GroupMember.group_id == group.id, User.created_at >= since)
        )).scalar() or 0
        if recent >= REGISTRATIONS_PER_HOUR:
            raise HTTPException(status_code=429, detail="Слишком много регистраций в эту группу — попробуйте позже")

    # Проверяем уникальность username
    result = await db.execute(select(User).where(User.username == data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")

    # Телефон обязателен: азербайджанский формат, один телефон — один ученик
    phone = await checked_student_phone(db, data.phone)

    # Создаём студента
    student = User(
        username=data.username,
        hashed_password=get_password_hash(data.password),
        email=data.email,
        full_name=data.full_name,
        phone=phone,
        role="student"
    )
    db.add(student)
    await db.flush()  # получаем id до commit

    # Привязываем к группе: сам — ждёт подтверждения педагога, завёл педагог — сразу в группе
    member = GroupMember(group_id=group.id, student_id=student.id, status="active" if by_staff else "pending")
    db.add(member)
    await db.commit()
    await db.refresh(student)
    return student

@router.put("/me", response_model=UserOut)
async def update_me(
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if data.full_name is not None:        current_user.full_name = data.full_name
    if data.email is not None:            current_user.email = data.email
    if data.phone is not None:
        # Телефон обязателен у всех — стереть его нельзя
        if not data.phone.strip():
            raise HTTPException(status_code=422, detail=PHONE_REQUIRED_ERROR)
        # У ученика телефон проверяется так же, как при регистрации
        if current_user.role == "student":
            current_user.phone = await checked_student_phone(
                db, data.phone, exclude_user_id=current_user.id, current=current_user.phone,
            )
        else:
            await ensure_phone_free(db, data.phone, exclude_user_id=current_user.id)
            current_user.phone = normalize_phone(data.phone) or data.phone.strip()
    if data.telegram_username is not None: current_user.telegram_username = data.telegram_username
    if data.whatsapp is not None:         current_user.whatsapp = data.whatsapp
    if data.new_password:
        if not verify_password(data.old_password or '', current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Неверный текущий пароль")
        current_user.hashed_password = get_password_hash(data.new_password)
    await db.commit()
    await db.refresh(current_user)
    return current_user