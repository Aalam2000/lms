import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import notify
from .routers import auth, quizzes, i18n, admin, groups, lessons, materials, links, library, students, quiz_live, help, usages, homework, lesson_work, presence, methodology, csp, academy, parent, push, view
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Отчёты CSP приходят пачками (десятки на одну загрузку страницы) и уже
# дедуплицируются в таблице csp_reports — в access-лог uvicorn их не пишем.
class _SkipCspReportAccess(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "/csp-report" not in record.getMessage()


logging.getLogger("uvicorn.access").addFilter(_SkipCspReportAccess())

# Фоновые задачи при старте приложения (lifespan вместо устаревшего
# @app.on_event("startup"), удалённого в новых Starlette): автоперевод и
# ежечасная проверка напоминаний-уведомлений (app/notify.py).
@asynccontextmanager
async def lifespan(app: FastAPI):
    i18n.start_translation_worker(interval=1800)
    reminders = asyncio.create_task(notify.reminder_loop())
    yield
    reminders.cancel()


app = FastAPI(lifespan=lifespan)

# Явный список origin вместо "*" — раньше CORS был открыт полностью, а в
# связке с allow_credentials=True это означало доверие ЛЮБОМУ сайту в
# интернете (Starlette при wildcard+credentials отражает Origin запроса
# вместо "*"). credentials выключены — auth тут не на куках, токен только
# в заголовке Authorization из localStorage, credentials-режим CORS не нужен.
#
# localhost:3000 — dev-фронтенд (свой порт, кросс-origin к backend:8000).
# 192.168.0.9 — прод: фронтенд и backend теперь за одним nginx на 80,
# для самого сайта это same-origin, список тут скорее подстраховка от
# чужих сайтов. Когда появится публичный домен — добавить его сюда
# отдельной строкой (например "https://logacademy.az") и передеплоить.
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://192.168.0.9",
    "https://quiz.logacademy.online",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(quizzes.router)
app.include_router(i18n.router)
app.include_router(admin.router)
app.include_router(groups.router)
app.include_router(lessons.router)
app.include_router(materials.router)
app.include_router(links.router)
app.include_router(library.router)
app.include_router(students.router)
app.include_router(quiz_live.router)
app.include_router(help.router)
app.include_router(methodology.router)
app.include_router(usages.router)
app.include_router(homework.router)
app.include_router(lesson_work.router)
app.include_router(presence.router)
app.include_router(csp.router)
app.include_router(academy.router)
app.include_router(parent.router)
app.include_router(push.router)
app.include_router(view.router)

