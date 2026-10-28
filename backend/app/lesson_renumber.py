"""Разовая перенумерация уроков: «Урок N.M» → «Урок K», K = 2N − 2 + M
(урок 12.1 → 23, 12.2 → 24). Удалить после применения.

Меняет: имена файлов Базы знаний (materials.original_filename), названия
квизов и ссылок, template_lesson_no («12.2» → «24»). Записи «Dərs …» и всё,
что не подходит под «Урок N.M» (M = 1 или 2), не трогает — только пишет в отчёт.
Повторный запуск безопасен: уже перенумерованное под шаблон не попадает.

Запуск на сервере (команда lms renumber):
  python -m app.lesson_renumber          # только отчёт, ничего не меняет
  python -m app.lesson_renumber --apply  # применить (одна транзакция)
"""
import asyncio
import hashlib
import re
import sys
from collections import Counter

from sqlalchemy import select

from . import storage
from .database import AsyncSessionLocal
from .models import Link, Material, Quiz
from .resources import attachment_usage_map

# «Урок 12.2», «урок №12.2», «Урок 12.2.docx» — номер с точкой
NAME_RE = re.compile(r"(урок\s*№?\s*)(\d+)\.(\d+)(?!\d)", re.IGNORECASE)
TEMPLATE_RE = re.compile(r"^\s*(\d+)\.(\d+)\s*$")
AZ_RE = re.compile(r"d[əƏe]rs", re.IGNORECASE)


def linear(major: int, minor: int) -> int | None:
    if minor not in (1, 2) or major < 1:
        return None
    return 2 * major - 2 + minor


def rename(name: str) -> tuple[str | None, str]:
    """(новое имя | None, причина, если не меняем)."""
    matches = list(NAME_RE.finditer(name))
    if not matches:
        return None, ""
    if len(matches) > 1:
        return None, "несколько номеров в имени"
    m = matches[0]
    k = linear(int(m.group(2)), int(m.group(3)))
    if k is None:
        return None, f"часть урока {m.group(3)} — не 1 и не 2"
    return name[:m.start()] + m.group(1) + str(k) + name[m.end():], ""


def new_template(value: str | None) -> tuple[str | None, str]:
    if not value:
        return None, ""
    m = TEMPLATE_RE.match(value)
    if not m:
        return None, "" if value.strip().isdigit() else f"номер шаблона «{value}» не распознан"
    k = linear(int(m.group(1)), int(m.group(2)))
    if k is None:
        return None, f"номер шаблона «{value}» — часть не 1 и не 2"
    return str(k), ""


def name_number(name: str) -> int | None:
    m = re.search(r"урок\s*№?\s*(\d+)(?:\.(\d+))?(?!\d)", name, re.IGNORECASE)
    if not m:
        return None
    return linear(int(m.group(1)), int(m.group(2))) if m.group(2) else int(m.group(1))


def sha256_of(m: Material) -> str:
    if m.content_hash:
        return m.content_hash
    data = storage.read_object_or_none(m.object_key)
    return hashlib.sha256(data).hexdigest() if data is not None else "нет файла на диске"


def places_text(usage: dict, key: tuple[str, int]) -> str:
    row = usage.get(key)
    if not row:
        return "не используется"
    parts = []
    for p in row["places"]:
        no = f"урок {p['lesson_no']}" if p["lesson_no"] else "доп. урок"
        parts.append(f"{p['group_name']} {no}{' (ДЗ)' if p['homework'] else ''}")
    return "; ".join(parts)


async def main() -> None:
    apply = "--apply" in sys.argv
    async with AsyncSessionLocal() as db:
        usage = await attachment_usage_map(db)
        materials = (await db.execute(select(Material).order_by(Material.id))).scalars().all()
        quizzes = (await db.execute(select(Quiz).order_by(Quiz.id))).scalars().all()
        links = (await db.execute(select(Link).order_by(Link.id))).scalars().all()

        changes = []   # (тип, объект, поле имени, старое имя, новое имя | None, старый шаблон, новый шаблон | None)
        skipped = []   # (тип, id, имя, причина)
        for kind, rows, field in (("файл", materials, "original_filename"),
                                  ("квиз", quizzes, "title"),
                                  ("ссылка", links, "title")):
            for obj in rows:
                name = getattr(obj, field)
                new_name, why_name = rename(name)
                new_tpl, why_tpl = new_template(obj.template_lesson_no)
                for why in (why_name, why_tpl):
                    if why:
                        skipped.append((kind, obj.id, name, why))
                if AZ_RE.search(name) and not new_name:
                    skipped.append((kind, obj.id, name, "азербайджанский — не трогаем"))
                if new_name or new_tpl:
                    changes.append((kind, obj, field, name, new_name, obj.template_lesson_no, new_tpl))

        # Конфликты имён файлов БЗ (у личных файлов ДЗ имя не обязано быть уникальным)
        final_names = Counter()
        for m in materials:
            if m.is_personal:
                continue
            ch = next((c for c in changes if c[1] is m), None)
            final_names[(ch[4] if ch and ch[4] else m.original_filename)] += 1
        conflicts = {n for n, c in final_names.items() if c > 1}

        # Номер в имени не совпадает с номером шаблона (после перенумерации)
        mismatch = []
        for kind, rows, field in (("файл", materials, "original_filename"),
                                  ("квиз", quizzes, "title"),
                                  ("ссылка", links, "title")):
            for obj in rows:
                ch = next((c for c in changes if c[1] is obj), None)
                name = ch[4] if ch and ch[4] else getattr(obj, field)
                tpl = ch[6] if ch and ch[6] else obj.template_lesson_no
                n = name_number(name)
                if tpl and tpl.strip().isdigit() and n is not None and n != int(tpl):
                    mismatch.append((kind, obj.id, name, tpl))

        print(f"Режим: {'ПРИМЕНЕНИЕ' if apply else 'отчёт, ничего не меняется'}")
        print(f"Изменений: {len(changes)}; конфликтов имён: {len(conflicts)}; "
              f"пропущено: {len(skipped)}; номер имени ≠ шаблону: {len(mismatch)}\n")

        print("=== ИЗМЕНЕНИЯ ===")
        print("тип\tid\tстарое имя\tновое имя\tшаблон было\tшаблон стало\tличный\tsha256\tгде используется")
        for kind, obj, field, old, new, tpl_old, tpl_new in changes:
            rtype = {"файл": "material", "квиз": "quiz", "ссылка": "link"}[kind]
            personal = "да" if kind == "файл" and obj.is_personal else ""
            sha = sha256_of(obj) if kind == "файл" else ""
            print("\t".join(str(x) for x in (
                kind, obj.id, old, new or "—", tpl_old or "", tpl_new or "", personal, sha,
                places_text(usage, (rtype, obj.id)))))

        print("\n=== КОНФЛИКТЫ ИМЁН (после перенумерации одно имя у нескольких файлов) ===")
        for n in sorted(conflicts):
            ids = [m.id for m in materials if not m.is_personal and
                   ((next((c[4] for c in changes if c[1] is m and c[4]), None)) or m.original_filename) == n]
            print(f"{n}\tid: {', '.join(map(str, ids))}")

        print("\n=== ПРОПУЩЕНО ===")
        for row in skipped:
            print("\t".join(str(x) for x in row))

        print("\n=== НОМЕР В ИМЕНИ ≠ НОМЕРУ ШАБЛОНА ===")
        for row in mismatch:
            print("\t".join(str(x) for x in row))

        print("\n=== ВСЕ ФАЙЛЫ БЗ (для сверки с папками) ===")
        print("id\tимя после перенумерации\tличный\tsha256")
        for m in materials:
            ch = next((c for c in changes if c[1] is m), None)
            name = ch[4] if ch and ch[4] else m.original_filename
            print(f"{m.id}\t{name}\t{'да' if m.is_personal else ''}\t{sha256_of(m)}")

        if not apply:
            print("\nНичего не изменено. Применить: lms renumber apply")
            return
        if conflicts:
            print("\nЕсть конфликты имён — НЕ ПРИМЕНЕНО. Сначала разобрать конфликты.")
            sys.exit(1)
        for kind, obj, field, old, new, tpl_old, tpl_new in changes:
            if new:
                setattr(obj, field, new)
            if tpl_new:
                obj.template_lesson_no = tpl_new
        await db.commit()
        print(f"\nПРИМЕНЕНО: {len(changes)} записей.")


if __name__ == "__main__":
    asyncio.run(main())
