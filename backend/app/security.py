from werkzeug.security import generate_password_hash, check_password_hash
import random
import re
import unicodedata
import jwt
from datetime import datetime, timedelta
import os

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY не задан в окружении (.env.dev/.env.prod) — "
        "без него бэкенд не запускается, дефолтного значения больше нет."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return check_password_hash(hashed_password, plain_password)

def get_password_hash(password: str) -> str:
    return generate_password_hash(password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


# ── Логин ученика из ФИО (claude/curator-plan.md, шаг 1) ──────────────────
# Первое слово — имя целиком, второе — первые 3 буквы фамилии, через точку,
# плюс 2 случайные цифры: «Мурад Алиев» → murad.ali47; без фамилии — murad47.
# Занят — другие цифры; двузначные кончились — три цифры. Пароль нового
# ученика по умолчанию = логину. Уже существующие логины не меняются.
_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
    # азербайджанская кириллица и латиница
    "ә": "e", "ғ": "g", "ҹ": "j", "ү": "u", "һ": "h", "ө": "o", "ј": "y",
    "ə": "e", "ş": "sh", "ç": "ch", "ğ": "g", "ı": "i", "ö": "o", "ü": "u",
}


def _latin(word: str) -> str:
    word = word.replace("İ", "i").lower()
    word = "".join(_TRANSLIT.get(ch, ch) for ch in word)
    word = unicodedata.normalize("NFKD", word)
    return re.sub(r"[^a-z]", "", word)


def login_base(full_name: str) -> str:
    """Основа логина без цифр: murad.ali / murad."""
    words = [w for w in (_latin(w) for w in (full_name or "").split()) if w]
    if not words:
        return "user"
    return f"{words[0]}.{words[1][:3]}" if len(words) > 1 else words[0]


async def make_login(db, full_name: str) -> str:
    """Свободный логин по ФИО (сравнение без учёта регистра)."""
    from sqlalchemy import func, select
    from .models import User

    base = login_base(full_name)
    for low, high in ((10, 99), (100, 999), (1000, 9999)):
        for number in random.sample(range(low, high + 1), min(90, high - low + 1)):
            candidate = f"{base}{number}"
            taken = (await db.execute(
                select(User.id).where(func.lower(User.username) == candidate)
            )).first()
            if not taken:
                return candidate
    raise RuntimeError("Не удалось подобрать свободный логин")
