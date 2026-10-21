"""
Единая лента «Базы знаний» — файлы + квизы + ссылки одним списком, с
фильтром по типу/загрузчику и сортировкой по дате/названию.

Читает-только (сама привязка/отвязка/загрузка — в materials.py,
quizzes.py, links.py, routers/lessons.py). Три таблицы разной формы —
своя колонка на каждую — поэтому объединяем в Python, а не SQL UNION:
здесь это проще и понятнее, чем городить приведение типов колонок
в сыром запросе.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import require_teacher
from ..models import Course, HomeworkTask, Link, Material, Quiz, User
from ..resources import RESOURCE_MODELS, RESOURCE_NOT_FOUND, attachment_usage_map, set_folder_tags

router = APIRouter(prefix="/library", tags=["library"])


class LibraryItemOut(BaseModel):
    resource_type: str  # material | quiz | link
    id: int
    title: str
    content_type: Optional[str] = None   # material
    size_bytes: Optional[int] = None     # material
    template_type: Optional[str] = None  # quiz
    topic: Optional[str] = None          # quiz
    url: Optional[str] = None            # link
    uploaded_by: int
    uploaded_by_name: Optional[str] = None
    created_at: datetime
    attached_lessons_count: int = 0
    # Курсы, в уроках которых ресурс используется (по алфавиту) — колонка «Курс» в БЗ
    attached_courses: list[str] = []
    # Файл используется как ДЗ хотя бы в одном уроке
    is_homework: bool = False
    # Теги папки БЗ — сектор и курс (у всех типов, видны всем; ставят админ
    # и владелец — resources.set_folder_tags)
    course_id: Optional[int] = None
    course_title: Optional[str] = None
    sector: Optional[str] = None
    # Где используется — для папок БЗ: [{sector, course_id, course_title, lesson_no}],
    # lesson_no None — доп. урок (resources.attachment_usage_map)
    places: list[dict] = []
    # Номер урока шаблона и статус — только admin, только у материалов
    template_lesson_no: Optional[str] = None
    template_status: Optional[str] = None


# Папки Базы знаний строит страница (KnowledgeBasePage.jsx) из course_id,
# sector и places: используемый в нумерованном уроке — «Сектор › Курс ›
# Урок N» (сектор и курс — группы урока); только в доп. уроках или с тегами,
# но нигде не используется — «Сектор › Курс › Общее»; без тегов и нигде не
# используется — «Для всех».


async def _list_materials(db: AsyncSession, current_user: User) -> list[LibraryItemOut]:
    rows = await db.execute(
        select(Material, User.full_name, User.username)
        .join(User, User.id == Material.uploaded_by)
        .where(Material.is_personal == False)  # персональные ДЗ в «Базу знаний» не попадают
    )
    homework_ids = {row[0] for row in (await db.execute(
        select(HomeworkTask.material_id).distinct()
    )).all()}
    is_admin = current_user.role == "admin"
    items = []
    for material, full_name, username in rows.all():
        items.append(LibraryItemOut(
            resource_type="material",
            id=material.id,
            title=material.original_filename,
            content_type=material.content_type,
            size_bytes=material.size_bytes,
            uploaded_by=material.uploaded_by,
            uploaded_by_name=full_name or username,
            created_at=material.created_at,
            course_id=material.course_id,
            sector=material.sector,
            template_lesson_no=material.template_lesson_no if is_admin else None,
            template_status=material.template_status if is_admin else None,
            is_homework=material.id in homework_ids,
        ))
    return items


async def _list_quizzes(db: AsyncSession, current_user: User) -> list[LibraryItemOut]:
    rows = await db.execute(
        select(Quiz, User.full_name, User.username)
        .join(User, User.id == Quiz.created_by)
    )
    items = []
    for quiz, full_name, username in rows.all():
        items.append(LibraryItemOut(
            resource_type="quiz",
            id=quiz.id,
            title=quiz.title,
            template_type=quiz.template_type,
            topic=quiz.topic,
            uploaded_by=quiz.created_by,
            uploaded_by_name=full_name or username,
            created_at=quiz.created_at,
            course_id=quiz.course_id,
            sector=quiz.sector,
        ))
    return items


async def _list_links(db: AsyncSession, current_user: User) -> list[LibraryItemOut]:
    rows = await db.execute(
        select(Link, User.full_name, User.username)
        .join(User, User.id == Link.added_by)
    )
    items = []
    for link, full_name, username in rows.all():
        items.append(LibraryItemOut(
            resource_type="link",
            id=link.id,
            title=link.title,
            url=link.url,
            uploaded_by=link.added_by,
            uploaded_by_name=full_name or username,
            created_at=link.created_at,
            course_id=link.course_id,
            sector=link.sector,
        ))
    return items


LISTERS = {
    "material": _list_materials,
    "quiz": _list_quizzes,
    "link": _list_links,
}


# База знаний — доступна teacher и admin (как и раньше у materials.py)
@router.get("/items", response_model=list[LibraryItemOut])
async def list_library_items(
    type: Optional[str] = Query(default=None, description="material | quiz | link"),
    uploader: Optional[int] = Query(default=None),
    course_id: Optional[int] = Query(default=None, description="Фильтр по тегу курса"),
    sector: Optional[str] = Query(default=None, description="Фильтр по тегу сектора"),
    sort: str = Query(default="date", description="date | title"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    types_to_load = [type] if type in LISTERS else LISTERS.keys()

    items: list[LibraryItemOut] = []
    for resource_type in types_to_load:
        items.extend(await LISTERS[resource_type](db, current_user))

    if uploader is not None:
        items = [item for item in items if item.uploaded_by == uploader]

    if course_id is not None:
        items = [item for item in items if item.course_id == course_id]
    if sector:
        items = [item for item in items if item.sector == sector]

    usage = await attachment_usage_map(db)
    # Названия курсов — для имён папок (педагог видит и чужие курсы в режиме «Все»)
    course_titles = dict((await db.execute(select(Course.id, Course.title))).all())
    for item in items:
        item.course_title = course_titles.get(item.course_id)
        row = usage.get((item.resource_type, item.id))
        if row:
            item.attached_lessons_count = row["count"]
            item.attached_courses = row["courses"]
            item.places = [{**place, "course_title": course_titles.get(place["course_id"])} for place in row["places"]]

    if sort == "title":
        items.sort(key=lambda item: item.title.lower())
    else:
        items.sort(key=lambda item: item.created_at, reverse=True)

    return items


class FolderTagsIn(BaseModel):
    course_id: Optional[int] = None
    sector: Optional[str] = None


# Теги папки БЗ (сектор и курс) у файла, ссылки или квиза — админ и владелец.
# Номер урока шаблона и статус по-прежнему меняет только админ
# (PATCH /materials/{id}/template).
@router.patch("/{resource_type}/{resource_id}/tags")
async def update_folder_tags(
    resource_type: str,
    resource_id: int,
    data: FolderTagsIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    model = RESOURCE_MODELS.get(resource_type)
    if model is None:
        raise HTTPException(status_code=404, detail="Неизвестный тип")
    resource = (await db.execute(select(model).where(model.id == resource_id))).scalar_one_or_none()
    if resource is None or getattr(resource, "is_personal", False):
        raise HTTPException(status_code=404, detail=RESOURCE_NOT_FOUND[resource_type])
    owner_id = {"material": "uploaded_by", "quiz": "created_by", "link": "added_by"}[resource_type]
    await set_folder_tags(db, resource, getattr(resource, owner_id), current_user, data.course_id, data.sector)
    await db.commit()
    return {"course_id": resource.course_id, "sector": resource.sector}
