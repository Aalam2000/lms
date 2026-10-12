from pydantic import BaseModel, Field, field_validator, ConfigDict
from datetime import datetime
from typing import Optional, List, Dict

def clean_video_url(v: Optional[str]) -> Optional[str]:
    """Ссылка на видеоконференцию группы: пусто -> None, иначе только https://.
    Не ограничиваем meet.google.com — задел под свой сервер (Jitsi)."""
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not v.lower().startswith("https://") or " " in v or len(v) > 500:
        raise ValueError("Ссылка на видеоконференцию должна начинаться с https://")
    return v


# Длительность урока в минутах: от 15 мин до 8 ч (обычно 60/120/240)
DURATION_MIN, DURATION_MAX = 15, 480


class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    whatsapp: Optional[str] = None
    role: str = "teacher"
    created_by: Optional[int] = None

class StudentRegister(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None  # обязателен; формат и запрет повторов — app/phones.py
    invite_code: str  # код группы из QR

class UserOut(BaseModel):
    id: int
    username: str
    full_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    telegram_username: Optional[str]
    whatsapp: Optional[str]
    photo_url: Optional[str]
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class CourseCreate(BaseModel):
    title: str
    description: Optional[str] = None

class CourseOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class GroupCreate(BaseModel):
    name: str
    course_id: int
    teacher_id: int  # какому педагогу принадлежит
    telegram_chat_id: Optional[str] = None
    whatsapp: Optional[str] = None
    video_url: Optional[str] = None
    lesson_duration_min: int = Field(default=120, ge=DURATION_MIN, le=DURATION_MAX)
    # Обязателен; после создания группы не меняется (как и курс). Код из
    # справочника секторов (вкладка «Академия») — наличие проверяет роутер.
    sector: str

    @field_validator("video_url")
    @classmethod
    def _check_video_url(cls, v):
        return clean_video_url(v)

    @field_validator("sector")
    @classmethod
    def _check_sector(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("Укажите сектор группы")
        return v

class GroupOut(BaseModel):
    id: int
    name: str
    course_id: int
    teacher_id: int
    telegram_chat_id: Optional[str]
    whatsapp: Optional[str] = None
    video_url: Optional[str] = None
    lesson_duration_min: int = 120
    sector: Optional[str] = None
    status: str
    invite_code: str
    created_at: datetime
    student_count: int = 0
    teacher_name: Optional[str] = None
    homework_to_review: int = 0   # ответов на ДЗ ждут проверки (подсветка группы у педагога)
    work_to_review: int = 0       # учеников с непроверенной работой на уроке (app/lesson_work.py)
    pending_count: int = 0        # записались по QR и ждут подтверждения педагога (метка «Новые»)
    # False — педагог в группе не основной: он лишь ведёт или вёл в ней отдельные
    # уроки и видит только их (app/lesson_teacher.py); контакты и ученики не отдаются
    is_main: bool = True

    model_config = ConfigDict(from_attributes=True)

class GroupInviteOut(BaseModel):
    id: int
    name: str
    course_title: Optional[str] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    whatsapp: Optional[str] = None
    old_password: Optional[str] = None
    new_password: Optional[str] = None

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class QuestionSchema(BaseModel):
    question: str
    time: int = 60
    answer: Optional[str] = None            # flash — текст ответа
    options: Optional[List[str]] = None      # live — 4 варианта
    correct_index: Optional[int] = None      # live — индекс правильного (0..3)

class QuizCreate(BaseModel):
    title: str
    topic: Optional[str] = None
    template_type: Optional[str] = None
    questions: List[QuestionSchema]
    lang: str

class QuizOut(BaseModel):
    id: int
    title: str
    topic: Optional[str]
    type: str
    template_type: str
    created_at: datetime
    created_by: int
    html_translations: Optional[Dict[str, str]] = None

    model_config = ConfigDict(from_attributes=True)


# Новый пароль, заданный за пользователя (без старого): педагог — ученику
# (students.py), admin — любому пользователю (admin.py). Длину не
# ограничиваем — как при регистрации; пустой не принимаем.
class NewPasswordIn(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Пароль не может быть пустым")
        return v
