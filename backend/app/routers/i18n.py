import logging
import os
import threading

from fastapi import APIRouter, Depends, Request, Response
from autoi18n import Translator

from ..dependencies import require_admin
from ..models import User

logger = logging.getLogger("i18n-trace")

router = APIRouter(prefix="/i18n", tags=["i18n"])

# Единый экземпляр Translator для всего backend (используется также в
# routers/quizzes.py для перевода HTML-шаблонов квизов).
translator = Translator(env_path=".env")


def start_translation_worker(interval: int = 1800) -> None:
    """Фоновый поток автоперевода (запускается при старте приложения, main.py):
    раз в interval секунд пересканировать проект и перевести накопленную очередь —
    обе операции делает Translator.run_translation_loop() из autoi18n за один вызов.
    """
    threading.Thread(
        target=translator.run_translation_loop,
        kwargs={"interval": interval},
        daemon=True,
    ).start()
    logger.info("autoi18n: фоновый воркер запущен (interval=%ss)", interval)

# POST /i18n/languages дёргает библиотеку autoi18n, а она переводит СРАЗУ
# весь реестр исходного языка через OpenAI (платно, синхронно). Библиотека
# общая для разных проектов, поэтому свой порог "сколько можно отправить за
# один раз" держим тут, в проекте, а не в библиотеке. Меряем размер файла
# реестра в КБ — это быстрее и проще, чем парсить JSON и считать фразы.
# Ориентир: сейчас ~285 фраз ~= 21 КБ (~76 байт/фразу); 5000 фраз ~= 372 КБ.
# Порог берём с запасом.
MAX_REGISTRY_KB = 400


def _registry_size_kb() -> float:
    """Размер файла реестра исходного языка (translations/{source_lang}.json)
    в КБ — то, что уйдёт в библиотеку (и дальше в OpenAI) при добавлении
    нового языка."""
    path = os.path.join(translator.cache_dir, f"{translator.source_lang}.json")
    try:
        return os.path.getsize(path) / 1024
    except OSError:
        return 0.0


@router.get("/languages")
async def get_languages():
    return {
        "languages": [
            {"code": lang, "name": lang}
            for lang in [translator.source_lang] + translator.get_target_langs()
        ],
        "default": translator.source_lang,
    }


@router.get("/translations")
async def get_translations(lang: str = "ru", response: Response = None):
    """Плоский словарь {оригинальный_текст: перевод} — именно его ждёт
    клиентский рантайм (window.autoI18n.setLanguage) при смене языка.

    Cache-Control: no-store — без него Cloudflare (сидит перед nginx с
    недавнего подключения домена) может закэшировать ответ на своём эдже
    и продолжать отдавать пользователям старые переводы после деплоя,
    пока кэш сам не протухнет или его не почистить руками в дашборде."""
    response.headers["Cache-Control"] = "no-store"
    return translator.get_translations_dict(lang)


@router.get("/runtime.js")
async def get_runtime_js(request: Request, lang: str = "ru"):
    """
    Клиентский JS-рантайм для React-фронтенда — подключается один раз
    в точке входа (frontend/src/index.jsx), без правок кода компонентов.

    URL для смены языка внутри рантайма делаем host-абсолютным (но БЕЗ
    схемы, protocol-relative — "//host/...") — сам скрипт выполняется в
    контексте страницы на origin фронтенда (localhost:3000 в dev), а не
    на origin backend'а, откуда он был загружен. Относительный
    fetch('/i18n/translations...') ушёл бы на фронтенд-сервер и получил
    бы обратно его index.html вместо JSON. Хост берём прямо из входящего
    запроса (Host-заголовок, его nginx прокидывает как есть) — так
    работает и в dev, и при любой конфигурации reverse-proxy в проде.
    Схему НЕ фиксируем: request.base_url.scheme отражает протокол, по
    которому backend увидел запрос от nginx (внутри docker-сети — почти
    всегда plain http, даже когда снаружи HTTPS через Cloudflare/nginx),
    так что "чинить" через X-Forwarded-Proto пришлось бы согласовывать
    сразу в трёх местах (Cloudflare → nginx → uvicorn --proxy-headers +
    --forwarded-allow-ips). Protocol-relative URL решает это без единой
    правки нигде, кроме этой строки — браузер сам подставит тот протокол,
    на котором открыта страница (нашли на проде: https-страница дёргала
    http:// из-за этого — mixed content, браузер блокировал fetch).
    """
    host = request.base_url.netloc
    translations_url_template = f"//{host}/i18n/translations?lang={{lang}}"
    script = translator.build_runtime(
        lang,
        dynamic_dom_enabled=True,
        translations_url_template=translations_url_template,
    )
    # Cache-Control: no-store — та же причина, что у /translations выше:
    # .js-расширение Cloudflare кэширует на эдже по умолчанию, а этот
    # скрипт генерируется заново на каждый запрос.
    return Response(
        content=script,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/languages")
async def add_language(lang: str, current_user: User = Depends(require_admin)):
    """Добавить целевой язык 'на лету' (для будущей админки): дописывает
    .env и сразу переводит на него весь известный реестр фраз.

    Защита: только админ (наружу этот путь и так не выпущен — см. nginx),
    и порог по объёму реестра (MAX_REGISTRY_KB) перед передачей в библиотеку.
    Если реестр больше порога — в библиотеку не передаём вообще (не будет
    синхронного платного вызова OpenAI), пишем тревогу в лог, дальше решает
    администратор."""
    size_kb = _registry_size_kb()
    if size_kb > MAX_REGISTRY_KB:
        logger.error(
            f"🚨[i18n-guard] POST /i18n/languages?lang={lang} ЗАБЛОКИРОВАН: "
            f"реестр исходного языка {size_kb:.1f} КБ превышает лимит {MAX_REGISTRY_KB} КБ. "
            f"В библиотеку не передано, OpenAI не вызывался. Инициатор: {current_user.username}."
        )
        return {"added": 0, "translated": 0, "blocked": True, "registry_kb": round(size_kb, 1)}
    return translator.add_target_lang(lang)
