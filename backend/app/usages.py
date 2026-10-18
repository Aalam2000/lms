"""Единый справочник «где используется» — основа общего контроля удаления.

Для каждого вида объекта (entity) описано, где он может встречаться. По
нему работают:
  - GET /usages/{entity}/{id}  — список мест для окна «Нельзя удалить»;
  - ensure_not_used(...)       — проверка внутри каждого DELETE: если объект
    где-то используется, сервер отвечает 409 с тем же списком.

Добавить новый вид объекта = дописать в USAGE_FINDERS одну функцию.
Архивные объекты (например, группы в архиве) — тоже использование.
"""
from typing import Awaitable, Callable

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Group, GroupMember, HomeworkAnswer, HomeworkTask, Lesson, LessonMark, LessonMessage, LessonResource,
    Link, Material, Quiz, User,
)

# Одно место использования: kind — раздел в окне («Группы», «Шаблонные файлы»…),
# title — что показать, url — куда перейти во фронтенде (может быть None).
Usage = dict


async def _course_usages(db: AsyncSession, course_id: int) -> list[Usage]:
    usages: list[Usage] = []
    for g in (await db.execute(
        select(Group).where(Group.course_id == course_id).order_by(Group.name)
    )).scalars().all():
        suffix = " (архив)" if g.status == "archived" else ""
        usages.append({"kind": "Группы", "title": f"{g.name}{suffix}", "url": f"/dashboard/groups/{g.id}"})

    for m in (await db.execute(
        select(Material).where(Material.course_id == course_id).order_by(Material.original_filename)
    )).scalars().all():
        usages.append({"kind": "Шаблонные файлы", "title": _template_title(m.original_filename, m.template_lesson_no), "url": "/dashboard/materials"})

    for l in (await db.execute(
        select(Link).where(Link.course_id == course_id).order_by(Link.title)
    )).scalars().all():
        usages.append({"kind": "Шаблонные ссылки", "title": _template_title(l.title, l.template_lesson_no), "url": "/dashboard/materials"})

    for q in (await db.execute(
        select(Quiz).where(Quiz.course_id == course_id).order_by(Quiz.title)
    )).scalars().all():
        usages.append({"kind": "Шаблонные квизы", "title": _template_title(q.title, q.template_lesson_no), "url": "/dashboard/materials"})
    return usages


async def _user_usages(db: AsyncSession, user_id: int) -> list[Usage]:
    """Пользователь (педагог/админ): всё, где он записан автором или
    владельцем. Любая такая ссылка в БД не даст удалить запись пользователя."""
    usages: list[Usage] = []

    for g in (await db.execute(
        select(Group).where(Group.teacher_id == user_id).order_by(Group.name)
    )).scalars().all():
        suffix = " (архив)" if g.status == "archived" else ""
        usages.append({"kind": "Группы педагога", "title": f"{g.name}{suffix}", "url": f"/dashboard/groups/{g.id}"})

    for m in (await db.execute(
        select(Material).where(Material.uploaded_by == user_id).order_by(Material.original_filename)
    )).scalars().all():
        kind = "Персональные файлы ДЗ" if m.is_personal else "Загруженные файлы"
        usages.append({"kind": kind, "title": m.original_filename, "url": None if m.is_personal else "/dashboard/materials"})

    for l in (await db.execute(select(Link).where(Link.added_by == user_id).order_by(Link.title))).scalars().all():
        usages.append({"kind": "Добавленные ссылки", "title": l.title, "url": "/dashboard/materials"})

    for q in (await db.execute(select(Quiz).where(Quiz.created_by == user_id).order_by(Quiz.title))).scalars().all():
        usages.append({"kind": "Созданные квизы", "title": q.title, "url": "/dashboard/materials"})

    # Уроки, которые он ведёт или вёл в чужих группах (в своих — уже есть «Группы педагога»)
    for lesson_id, title, group_name in (await db.execute(
        select(Lesson.id, Lesson.title, Group.name)
        .join(Group, Group.id == Lesson.group_id)
        .where(Lesson.teacher_id == user_id, Group.teacher_id != user_id)
        .order_by(Group.name, Lesson.order)
    )).all():
        usages.append({"kind": "Уроки педагога в других группах", "title": f"{group_name}: {title}", "url": f"/dashboard/lessons/{lesson_id}"})

    # Действия в уроках — по одному пункту на урок
    async def lessons_where(kind: str, lesson_ids_query):
        rows = (await db.execute(
            select(Lesson.id, Lesson.title, Group.name)
            .join(Group, Group.id == Lesson.group_id)
            .where(Lesson.id.in_(lesson_ids_query))
            .order_by(Group.name, Lesson.order)
        )).all()
        for lesson_id, title, group_name in rows:
            usages.append({"kind": kind, "title": f"{group_name}: {title}", "url": f"/dashboard/lessons/{lesson_id}"})

    await lessons_where("Уроки, куда добавлял материалы",
                        select(LessonResource.lesson_id).where(LessonResource.added_by == user_id))
    await lessons_where("Уроки, где ставил оценки",
                        select(LessonMark.lesson_id).where(LessonMark.marked_by == user_id))

    await _lessons_where(db, usages, "Уроки, где выдавал ДЗ",
        select(HomeworkTask.lesson_id).where(HomeworkTask.created_by == user_id))
    await _lessons_where(db, usages, "Уроки, где проверял ДЗ",
        select(HomeworkAnswer.lesson_id).where(HomeworkAnswer.reviewed_by == user_id))
    await _lessons_where(db, usages, "Уроки, где писал в диалогах",
        select(LessonMessage.lesson_id).where(LessonMessage.author_id == user_id, LessonMessage.student_id != user_id))

    for gid, gname in (await db.execute(
        select(Group.id, Group.name).join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.expelled_by == user_id).distinct().order_by(Group.name)
    )).all():
        usages.append({"kind": "Группы, где отчислял студентов", "title": gname, "url": f"/dashboard/groups/{gid}"})

    for u in (await db.execute(select(User).where(User.created_by == user_id).order_by(User.full_name))).scalars().all():
        usages.append({"kind": "Созданные пользователи", "title": u.full_name or u.username, "url": None})
    return usages


async def _student_usages(db: AsyncSession, student_id: int) -> list[Usage]:
    """Студент: группы (в т.ч. отчисленные и архивные — это тоже
    использование), его оценки/посещаемость, решения ДЗ, персональные ДЗ."""
    usages: list[Usage] = []

    for g, member_status in (await db.execute(
        select(Group, GroupMember.status).join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.student_id == student_id).order_by(Group.name)
    )).all():
        notes = []
        if member_status == "expelled":
            notes.append("отчислен")
        if g.status == "archived":
            notes.append("группа в архиве")
        suffix = f" ({', '.join(notes)})" if notes else ""
        usages.append({"kind": "Группы", "title": f"{g.name}{suffix}", "url": f"/dashboard/groups/{g.id}"})

    for gid, gname, cnt in (await db.execute(
        select(Group.id, Group.name, func.count(LessonMark.id))
        .join(Lesson, Lesson.group_id == Group.id)
        .join(LessonMark, LessonMark.lesson_id == Lesson.id)
        .where(LessonMark.student_id == student_id)
        .group_by(Group.id, Group.name).order_by(Group.name)
    )).all():
        usages.append({"kind": "Оценки и посещаемость", "title": f"{gname} — уроков: {cnt}", "url": f"/dashboard/groups/{gid}"})

    await _lessons_where(db, usages, "Ответы на ДЗ",
        select(HomeworkAnswer.lesson_id).where(HomeworkAnswer.student_id == student_id))
    await _lessons_where(db, usages, "Персональные ДЗ",
        select(HomeworkTask.lesson_id).where(HomeworkTask.student_id == student_id))
    await _lessons_where(db, usages, "Диалоги в уроках",
        select(LessonMessage.lesson_id).where(LessonMessage.student_id == student_id))
    return usages


async def _lessons_where(db: AsyncSession, usages: list[Usage], kind: str, lesson_ids_query) -> None:
    """По одному пункту на урок: «Группа: Урок» со ссылкой на урок."""
    for lesson_id, title, group_name in (await db.execute(
        select(Lesson.id, Lesson.title, Group.name)
        .join(Group, Group.id == Lesson.group_id)
        .where(Lesson.id.in_(lesson_ids_query))
        .order_by(Group.name, Lesson.order)
    )).all():
        usages.append({"kind": kind, "title": f"{group_name}: {title}", "url": f"/dashboard/lessons/{lesson_id}"})


def _resource_usages(resource_type: str):
    """Файл/ссылка/квиз «Базы знаний»: уроки, к которым привязан (ДЗ — с пометкой)."""
    async def finder(db: AsyncSession, resource_id: int) -> list[Usage]:
        usages: list[Usage] = []

        async def add(kind: str, lesson_ids_query):
            for lesson_id, title, group_name, group_status in (await db.execute(
                select(Lesson.id, Lesson.title, Group.name, Group.status)
                .join(Group, Group.id == Lesson.group_id)
                .where(Lesson.id.in_(lesson_ids_query))
                .order_by(Group.name, Lesson.order)
            )).all():
                suffix = " (группа в архиве)" if group_status == "archived" else ""
                usages.append({"kind": kind, "title": f"{group_name}: {title}{suffix}", "url": f"/dashboard/lessons/{lesson_id}"})

        await add("Материалы уроков", select(LessonResource.lesson_id).where(
            LessonResource.resource_type == resource_type, LessonResource.resource_id == resource_id))
        if resource_type == "material":
            await add("Домашние задания", select(HomeworkTask.lesson_id).where(HomeworkTask.material_id == resource_id))
        return usages
    return finder


def _template_title(title: str, lesson_no) -> str:
    return f"{title} — урок {lesson_no}" if lesson_no else title


# entity -> (кто может смотреть/удалять, функция поиска, как называть в сообщении)
async def _room_usages(db: AsyncSession, room_id: int) -> list[Usage]:
    """Аудитория: уроки, записанные в неё."""
    usages: list[Usage] = []
    for lesson_id, title, group_name in (await db.execute(
        select(Lesson.id, Lesson.title, Group.name)
        .join(Group, Group.id == Lesson.group_id)
        .where(Lesson.room_id == room_id)
        .order_by(Lesson.date)
    )).all():
        usages.append({"kind": "Уроки", "title": f"{group_name} — {title}", "url": f"/dashboard/lessons/{lesson_id}"})
    return usages


USAGE_FINDERS: dict[str, tuple[set[str], Callable[[AsyncSession, int], Awaitable[list[Usage]]], str]] = {
    "course": ({"admin"}, _course_usages, "Курс"),
    "user": ({"admin"}, _user_usages, "Пользователь"),
    "student": ({"admin"}, _student_usages, "Студент"),
    # Удалить файл/ссылку может admin, квиз — автор или admin (проверка автора — в самом DELETE)
    "material": ({"admin"}, _resource_usages("material"), "Файл"),
    "link": ({"admin"}, _resource_usages("link"), "Ссылка"),
    "quiz": ({"teacher", "admin"}, _resource_usages("quiz"), "Квиз"),
    "room": ({"admin", "curator"}, _room_usages, "Аудитория"),
}


def check_access(entity: str, role: str) -> None:
    if entity not in USAGE_FINDERS:
        raise HTTPException(status_code=404, detail="Неизвестный тип объекта")
    if role not in USAGE_FINDERS[entity][0]:
        raise HTTPException(status_code=403, detail="Нет доступа")


async def find_usages(db: AsyncSession, entity: str, entity_id: int) -> list[Usage]:
    return await USAGE_FINDERS[entity][1](db, entity_id)


async def ensure_not_used(db: AsyncSession, entity: str, entity_id: int) -> None:
    """Вызывать в DELETE перед удалением: если используется — 409 со списком."""
    usages = await find_usages(db, entity, entity_id)
    if usages:
        label = USAGE_FINDERS[entity][2]
        raise HTTPException(
            status_code=409,
            detail={"message": f"{label} используется — удалить нельзя", "usages": usages},
        )
