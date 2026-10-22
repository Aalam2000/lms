"""Изолированный просмотр HTML-материалов и квизов.

Ссылку выдают POST /materials/{id}/view-link и POST /quizzes/{id}/view-link
(с обычными проверками прав), здесь она открывается без входа: токен в пути
(security.create_view_token, срок 4 часа).

Ответ идёт с заголовком CSP sandbox без allow-same-origin: документ получает
«чужой» (непрозрачный) источник — его скрипты работают (встроенные скрипты,
Google Fonts, внешние картинки — можно всё), но не видят платформу:
localStorage с токеном входа, cookies, страницы платформы. Поэтому же урок
не помнит слайд между открытиями — всегда открывается с начала.
"""
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..database import get_db
from ..models import Material, Quiz
from ..security import decode_view_token
from .materials import is_view_file

router = APIRouter(prefix="/view", tags=["view"])

# allow-popups-to-escape-sandbox — ссылки из урока (target="_blank") открывают
# внешние сайты обычными вкладками. frame-ancestors не ставим: превью в Базе
# знаний показывает материал во фрейме, а на деве страница (:3000) и API
# (:8000) — разные адреса.
SANDBOX_CSP = (
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox "
    "allow-modals allow-forms allow-downloads; "
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'"
)

HEADERS = {
    "Content-Security-Policy": SANDBOX_CSP,
    # токен — в адресе: не отдавать его внешним сайтам в Referer
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}

MEDIA_TYPES = {".svg": "image/svg+xml", ".xhtml": "application/xhtml+xml"}

MISSING_PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Log Academy</title></head>
<body style="font-family:sans-serif;color:#201E1D;padding:32px;line-height:1.6">
<p>Файл не найден на сервере — загрузите его заново.</p>
<p>Fayl serverdə tapılmadı — onu yenidən yükləyin.</p>
<p>The file was not found on the server — upload it again.</p>
</body></html>"""

EXPIRED_PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Log Academy</title></head>
<body style="font-family:sans-serif;color:#201E1D;padding:32px;line-height:1.6">
<p>Ссылка устарела — откройте материал заново из платформы.</p>
<p>Keçid köhnəlib — materialı platformadan yenidən açın.</p>
<p>This link has expired — open the material again from the platform.</p>
</body></html>"""


def _not_available() -> Response:
    return HTMLResponse(EXPIRED_PAGE, status_code=410, headers=HEADERS)


@router.get("/{token}")
async def view(token: str, db: AsyncSession = Depends(get_db)):
    parsed = decode_view_token(token)
    if not parsed:
        return _not_available()
    kind, obj_id = parsed

    if kind == "quiz":
        quiz = (await db.execute(select(Quiz).where(Quiz.id == obj_id))).scalar_one_or_none()
        if not quiz:
            return _not_available()
        return HTMLResponse(quiz.html_content, headers=HEADERS)

    material = (await db.execute(select(Material).where(Material.id == obj_id))).scalar_one_or_none()
    if not material or not is_view_file(material):
        return _not_available()
    if not storage.exists(material.object_key):
        return HTMLResponse(MISSING_PAGE, status_code=404, headers=HEADERS)
    ext = Path(material.original_filename).suffix.lower()
    return StreamingResponse(
        storage.stream_object(material.object_key),
        media_type=MEDIA_TYPES.get(ext, "text/html; charset=utf-8"),
        headers=HEADERS,
    )
