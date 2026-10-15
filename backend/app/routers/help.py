from pathlib import Path

import markdown
from fastapi import APIRouter, Depends, Query

from ..dependencies import get_current_user
from ..models import User
from .i18n import translator

router = APIRouter(prefix="/help", tags=["help"])

HELP_DIR = Path(__file__).parent.parent.parent / "templates" / "help"

# Файл инструкции на роль. examiner — заготовка: такой роли в системе нет.
# Родитель (parent) входит по логину и попадает на свою страницу /p/<токен>;
# его инструкция — для этой страницы. У роли без своей инструкции — заглушка,
# а не чужая справка.
#
# Инструкции — документы Markdown на русском. autoi18n (doc_paths в
# backend/autoi18n.json) переводит каждый файл ЦЕЛИКОМ и кладёт перевод
# рядом: teacher.md -> teacher.en.md, teacher.az.md (переводы лежат в git;
# папка подключена томом, чтобы переводы переживали деплой).
ROLE_FILES = {
    "admin": "admin.md",
    "teacher": "teacher.md",
    "student": "student.md",
    "examiner": "examiner.md",
    "parent": "parent.md",
    "curator": "curator.md",
}
NO_HELP_HTML = "<p>Справка для вашей роли готовится.</p>"

MD_EXTENSIONS = ["tables", "fenced_code", "sane_lists"]


def render_markdown(text: str) -> str:
    """Markdown → HTML, одни настройки для Помощи и Методики (routers/methodology.py)."""
    return markdown.markdown(text, extensions=MD_EXTENSIONS)


@router.get("")
async def get_help(
    lang: str = Query(None),
    current_user: User = Depends(get_current_user),
):
    """Инструкция для текущего пользователя — по его роли, на языке lang.
    Если перевода на lang ещё нет (воркер не успел) — отдаётся исходник."""
    lang = lang or translator.source_lang
    filename = ROLE_FILES.get(current_user.role)
    if not filename:
        return {"html": NO_HELP_HTML, "lang": lang}
    doc = translator.get_document(str(HELP_DIR / filename), lang)
    return {"html": render_markdown(doc["text"]), "lang": doc["lang"]}
