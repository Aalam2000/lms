import asyncio
import io
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File as FastAPIFile
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from .. import storage
from ..database import get_db
from ..models import User, Group, GroupMember
from ..schemas import UserLogin, Token, UserOut, UserCreate, StudentRegister, UserUpdate, DaysOffSettings
from ..security import verify_password, get_password_hash, create_access_token, decode_token
from ..dependencies import ROLE_PERMISSIONS, get_current_user, get_optional_user, has_perm
from ..days_off import current_settings
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

# Пользователь и его права (dependencies.ROLE_PERMISSIONS) — по ним фронт
# показывает меню и кнопки
class UserMeOut(UserOut):
    permissions: list[str] = []
    ui_prefs: Optional[dict] = None  # у нового пользователя в базе NULL — отдаём {}
    # Ученик: аккаунт в классе Scratch — блок «Мой Scratch» в профиле
    scratch_login: Optional[str] = None
    scratch_password: Optional[str] = None


@router.get("/me", response_model=UserMeOut)
async def get_me(current_user: User = Depends(get_current_user)):
    out = UserMeOut.model_validate(current_user)
    out.permissions = sorted(ROLE_PERMISSIONS.get(current_user.role, ()))
    out.ui_prefs = current_user.ui_prefs or {}
    return out


# Настройки пользователя (users.ui_prefs) — всё, что он выбирает в интерфейсе.
# Приходят вместе с /auth/me; PATCH меняет только переданные ключи (null —
# удалить ключ), поэтому две вкладки не затирают друг другу настройки.
# Ключ — «страница.настройка» (groups.view, kb.folder, lang).
UI_PREF_KEY = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$|^lang$")
UI_PREFS_MAX_BYTES = 8 * 1024


@router.patch("/me/prefs")
async def update_my_prefs(
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prefs = dict(current_user.ui_prefs or {})
    for key, value in data.items():
        if not isinstance(key, str) or not UI_PREF_KEY.match(key):
            raise HTTPException(status_code=400, detail=f"Неверный ключ настройки: {key}")
        if value is None:
            prefs.pop(key, None)
        else:
            prefs[key] = value
    if len(json.dumps(prefs, ensure_ascii=False).encode("utf-8")) > UI_PREFS_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Слишком много настроек")
    current_user.ui_prefs = prefs
    await db.commit()
    return prefs


# Регистрация ученика по коду группы (QR). Сам ученик попадает в группу со
# статусом pending — «ждёт подтверждения»: пока педагог не примет, его нет в
# журнале, уроках и отчётах (везде учитываются только active). Если ученика
# заводит педагог этой группы или админ (окно «Добавить студента» у QR),
# он сразу активный и ограничение частоты на него не действует.
# Свои выходные — в профиле, только просмотр (ставит админ: routers/admin.py)
@router.get("/me/days-off", response_model=DaysOffSettings)
async def get_my_days_off(current_user: User = Depends(get_current_user)):
    return current_settings(current_user.days_off)


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

    # Сразу в группу, без подтверждения, — только тот, кто заводит учеников (students.create:
    # админ, куратор); остальные регистрации ждут подтверждения педагога группы
    by_staff = actor is not None and has_perm(actor, "students.create")
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


# ---------- Фото профиля ----------
# Каждый меняет только своё фото (PUT/DELETE /auth/me/photo). Файл любого
# формата, который понимает Pillow, приводится к квадрату 256×256 по центру
# и сохраняется лёгким WebP без EXIF; в users.photo_url — путь в хранилище
# («photos/<uuid>»). Новый снимок = новый путь, старый файл удаляется.
# Смотреть фото может любой вошедший: GET /auth/photo/{user_id}.
PHOTO_MAX_UPLOAD = 15 * 1024 * 1024   # исходник до обработки
PHOTO_SIZE = 256
PHOTO_MAX_PIXELS = 50_000_000         # защита от «картинок-бомб»


def _make_photo(data: bytes) -> bytes:
    """Синхронная обработка (гоняется через asyncio.to_thread)."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > PHOTO_MAX_PIXELS:
            raise ValueError("too big")
        img.draft("RGB", (PHOTO_SIZE * 2, PHOTO_SIZE * 2))  # JPEG: декодируем сразу уменьшенным
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert("RGB")
        img = ImageOps.fit(img, (PHOTO_SIZE, PHOTO_SIZE), Image.LANCZOS, centering=(0.5, 0.5))
        out = io.BytesIO()
        img.save(out, "WEBP", quality=82, method=6)
        return out.getvalue()
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="Не удалось прочитать фото — выберите JPG или PNG")


@router.put("/me/photo", response_model=UserOut)
async def upload_my_photo(
    file: UploadFile = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = await file.read(PHOTO_MAX_UPLOAD + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(data) > PHOTO_MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="Фото слишком большое (максимум 15 МБ)")
    webp = await asyncio.to_thread(_make_photo, data)
    key = storage.new_key("photos")
    await asyncio.to_thread(storage.upload_bytes, key, webp, "image/webp")
    old = current_user.photo_url
    current_user.photo_url = key
    await db.commit()
    await db.refresh(current_user)
    if old:
        await asyncio.to_thread(storage.delete_object, old)
    return current_user


@router.delete("/me/photo", response_model=UserOut)
async def delete_my_photo(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    old = current_user.photo_url
    current_user.photo_url = None
    await db.commit()
    await db.refresh(current_user)
    if old:
        await asyncio.to_thread(storage.delete_object, old)
    return current_user


@router.get("/photo/{user_id}")
async def get_photo(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    key = (await db.execute(select(User.photo_url).where(User.id == user_id))).scalar_one_or_none()
    data = await asyncio.to_thread(storage.read_object_or_none, key) if key else None
    if data is None:
        raise HTTPException(status_code=404, detail="Фото нет")
    return Response(content=data, media_type="image/webp",
                    headers={"Cache-Control": "private, max-age=86400"})
