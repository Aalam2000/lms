"""Данные академии и секторы — вкладка «Академия» у админа.

Академия — одна запись (id = 1): название, сайт, контакты. Видит и правит
только админ; наружу (без входа) отдаётся только название — оно нужно в
заголовке вкладки браузера и на странице входа.

Секторы — направления обучения (ru, az, …). Раньше были зашиты в коде,
теперь это справочник: код, название и слово «Урок» на языке сектора
(названия уроков создаются сразу на этом языке и при показе не
переводятся). Код сектора = код языка интерфейса: языки задаются в .env
(SOURCE_LANG + AUTO_I18N_TARGET_LANGS), на каждый язык — не больше одного
сектора; когда все языки заняты, новый сектор добавить нельзя (сначала
язык добавляют в .env). Код после создания не меняется — он хранится у
групп и у материалов шаблонов курсов. Сектор, который где-то
используется, удалить нельзя.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import require, require_admin
from ..models import Academy, Group, Link, Material, Quiz, Sector, User
from .i18n import translator

router = APIRouter(tags=["academy"])

DEFAULT_ACADEMY_NAME = "Log Academy"
DEFAULT_LESSON_WORD = "Урок"


def interface_languages() -> list[str]:
    """Языки интерфейса из .env: основной + целевые (их читает autoi18n)."""
    langs = [translator.source_lang] + list(translator.get_target_langs())
    return [lang for i, lang in enumerate(langs) if lang and lang not in langs[:i]]


def _clean(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


async def get_academy(db: AsyncSession) -> Academy:
    """Единственная запись академии; если её ещё нет — создаётся."""
    academy = (await db.execute(select(Academy).order_by(Academy.id))).scalars().first()
    if academy is None:
        academy = Academy(name=DEFAULT_ACADEMY_NAME)
        db.add(academy)
        await db.flush()
    return academy


async def academy_name(db: AsyncSession) -> str:
    name = (await db.execute(select(Academy.name).order_by(Academy.id))).scalars().first()
    return name or DEFAULT_ACADEMY_NAME


async def sector_exists(db: AsyncSession, code: Optional[str]) -> bool:
    if not code:
        return False
    return (await db.execute(select(Sector.code).where(Sector.code == code))).first() is not None


async def lesson_word(db: AsyncSession, sector: Optional[str]) -> str:
    """Слово «Урок» на языке сектора группы."""
    if sector:
        word = (await db.execute(select(Sector.lesson_word).where(Sector.code == sector))).scalar_one_or_none()
        if word:
            return word
    return DEFAULT_LESSON_WORD


# ── Академия ──

class AcademyData(BaseModel):
    name: str
    website: Optional[str] = None
    telegram: Optional[str] = None
    whatsapp: Optional[str] = None
    instagram: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

    model_config = {"from_attributes": True}

    @field_validator("name")
    @classmethod
    def _check_name(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("Укажите название компании")
        return v


# Название — единственное, что видно без входа (заголовок вкладки, страница входа)
@router.get("/academy/public")
async def get_academy_public(db: AsyncSession = Depends(get_db)):
    return {"name": await academy_name(db)}


@router.get("/admin/academy", response_model=AcademyData)
async def get_academy_data(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    academy = await get_academy(db)
    await db.commit()
    return academy


@router.put("/admin/academy", response_model=AcademyData)
async def update_academy_data(
    data: AcademyData, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    academy = await get_academy(db)
    academy.name = data.name
    for field in ("website", "telegram", "whatsapp", "instagram", "address", "phone", "email"):
        setattr(academy, field, _clean(getattr(data, field)))
    await db.commit()
    await db.refresh(academy)
    return academy


# ── Секторы ──

class SectorOut(BaseModel):
    code: str
    name: str
    lesson_word: str

    model_config = {"from_attributes": True}


class SectorCreate(BaseModel):
    code: str
    name: str
    lesson_word: str


class SectorUpdate(BaseModel):
    name: str
    lesson_word: str


def _require_text(value: str, message: str) -> str:
    value = (value or "").strip()
    if not value:
        raise HTTPException(status_code=422, detail=message)
    return value


# Список секторов нужен формам группы, Базы знаний и нового ученика (право catalog.view)
@router.get("/academy/sectors", response_model=list[SectorOut])
async def list_sectors(db: AsyncSession = Depends(get_db), user: User = Depends(require("catalog.view"))):
    return (await db.execute(select(Sector).order_by(Sector.id))).scalars().all()


# Языки, для которых ещё можно создать сектор (язык интерфейса без сектора)
@router.get("/admin/sector-languages")
async def list_sector_languages(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    used = set((await db.execute(select(Sector.code))).scalars().all())
    languages = interface_languages()
    return {"languages": languages, "available": [lang for lang in languages if lang not in used]}


@router.post("/admin/sectors", response_model=SectorOut)
async def create_sector(data: SectorCreate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    code = (data.code or "").strip().lower()
    if code not in interface_languages():
        raise HTTPException(
            status_code=422,
            detail="Сектор создаётся только для языка интерфейса — сначала добавьте язык в настройках сервера",
        )
    if await sector_exists(db, code):
        raise HTTPException(status_code=409, detail=f"Сектор для языка «{code}» уже есть")
    sector = Sector(
        code=code,
        name=_require_text(data.name, "Укажите название сектора"),
        lesson_word=_require_text(data.lesson_word, "Укажите название урока в этом секторе"),
    )
    db.add(sector)
    await db.commit()
    await db.refresh(sector)
    return sector


async def _get_sector(db: AsyncSession, code: str) -> Sector:
    sector = (await db.execute(select(Sector).where(Sector.code == code))).scalar_one_or_none()
    if not sector:
        raise HTTPException(status_code=404, detail="Сектор не найден")
    return sector


# Код не меняется; новое «название урока» действует на уроки, созданные позже
@router.patch("/admin/sectors/{code}", response_model=SectorOut)
async def update_sector(
    code: str, data: SectorUpdate, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    sector = await _get_sector(db, code)
    sector.name = _require_text(data.name, "Укажите название сектора")
    sector.lesson_word = _require_text(data.lesson_word, "Укажите название урока в этом секторе")
    await db.commit()
    await db.refresh(sector)
    return sector


@router.delete("/admin/sectors/{code}")
async def delete_sector(code: str, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    sector = await _get_sector(db, code)
    used = []
    for model, label in ((Group, "группы"), (Material, "файлы"), (Link, "ссылки"), (Quiz, "квизы")):
        count = (await db.execute(select(func.count()).select_from(model).where(model.sector == code))).scalar()
        if count:
            used.append(f"{label}: {count}")
    if used:
        raise HTTPException(
            status_code=409,
            detail=f"Сектор «{sector.name}» используется ({', '.join(used)}) — удалить нельзя",
        )
    await db.delete(sector)
    await db.commit()
    return {"detail": "Удалён"}
