"""
Методические материалы для педагогов и администраторов (раздел «Методика»).

Структура — просто папки и файлы Markdown, без базы данных:

    templates/methodology/
        01-pedagogy/                 раздел (номер в начале — порядок в меню)
            _section.md              название раздела (# Заголовок)
            pedagogy-basics.md       материал; название — его первый заголовок
            pedagogy-basics.en.md    перевод (создаёт autoi18n, коммитится в git)

Переводит всё autoi18n: папка указана в doc_paths (backend/autoi18n.json),
каждый .md, включая _section.md, переводится целиком и кладётся рядом.
Здесь только читаем нужную языковую версию и отдаём HTML.
"""
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import require_teacher
from ..models import User
from .help import render_markdown
from .i18n import translator

router = APIRouter(prefix="/methodology", tags=["methodology"])

ROOT = Path(__file__).parent.parent.parent / "templates" / "methodology"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def _title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        m = re.match(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", line)
        if m:
            return m.group(1)
    return fallback


def _doc(path: Path, lang: str) -> dict:
    return translator.get_document(str(path), lang)


def _sources(folder: Path):
    """Исходники материалов раздела: *.md без языкового суффикса и без _section."""
    return sorted(
        p for p in folder.glob("*.md")
        if "." not in p.stem and not p.stem.startswith("_") and SLUG_RE.match(p.stem)
    )


@router.get("")
async def get_tree(lang: str = Query(None), current_user: User = Depends(require_teacher)):
    """Дерево «разделы → материалы» с названиями на языке lang."""
    lang = lang or translator.source_lang
    sections = []
    if ROOT.is_dir():
        for folder in sorted(p for p in ROOT.iterdir() if p.is_dir() and SLUG_RE.match(p.name)):
            section_file = folder / "_section.md"
            title = _title(_doc(section_file, lang)["text"], folder.name) if section_file.exists() else folder.name
            materials = [
                {"slug": p.stem, "title": _title(_doc(p, lang)["text"], p.stem)}
                for p in _sources(folder)
            ]
            sections.append({"slug": folder.name, "title": title, "materials": materials})
    return {"sections": sections}


@router.get("/{section}/{slug}")
async def get_material(section: str, slug: str, lang: str = Query(None),
                       current_user: User = Depends(require_teacher)):
    """Материал на языке lang (или исходник, если перевода ещё нет) — как HTML."""
    if not SLUG_RE.match(section) or not SLUG_RE.match(slug) or slug.startswith("_"):
        raise HTTPException(status_code=404, detail="Материал не найден")
    path = ROOT / section / f"{slug}.md"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Материал не найден")
    doc = _doc(path, lang or translator.source_lang)
    return {
        "title": _title(doc["text"], slug),
        "html": render_markdown(doc["text"]),
        "lang": doc["lang"],
    }
