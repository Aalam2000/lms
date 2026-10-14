FROM python:3.12-slim

WORKDIR /app

# Node.js обязателен для autoi18n — сканирование JS/JSX/TSX идёт через
# настоящий AST-парсер (Babel), не через регулярки (см. README autoi18n).
# libreoffice-writer/calc/impress (тянут libreoffice-core с бинарём soffice) —
# для headless-конвертации docx/xlsx/pptx в PDF при предпросмотре файла
# (см. /materials/{id}/preview в routers/materials.py). Готовый PDF
# кэшируется в хранилище, конвертации идут по одной (решение Андрея, 2026-09-28).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl fonts-dejavu-core \
       libreoffice-writer libreoffice-calc libreoffice-impress \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Зависимости JS-моста autoi18n (@babel/parser, @babel/traverse) ставятся
# отдельно — pip их не устанавливает, это npm-пакет внутри самой библиотеки.
RUN AUTOI18N_DIR=$(python -c "import autoi18n, os; print(os.path.join(os.path.dirname(autoi18n.__file__), 'extractor', 'js_bridge'))") \
    && cd "$AUTOI18N_DIR" && npm install --omit=dev

COPY . .

# Непривилегированный пользователь для рантайма (не root — меньше ущерба
# при уязвимости в LibreOffice, см. routers/materials.py).
# UID/GID задаются при сборке и совпадают с пользователем, который деплоит
# (на проде — quizadm, см. scripts/deploy-prod.sh): тогда файлы проекта на
# хосте (frontend/src, backend/templates/help, translations, .env.prod) и
# файлы, которые создаёт контейнер, принадлежат одному пользователю —
# никаких chmod/chown не нужно. Без аргументов (дев) — 1000.
# -m создаёт домашнюю директорию — она нужна LibreOffice под свой профиль.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd -o -g "$APP_GID" appuser \
    && useradd -o -m -u "$APP_UID" -g appuser appuser \
    && chown -R appuser:appuser /app \
    && mkdir -p /var/lib/logacademy/data \
    && chown appuser:appuser /var/lib/logacademy/data
# /var/lib/logacademy/data — файлы платформы (app/storage.py): в деве — том
# Docker, на проде — папка сервера с тем же путём (владелец quizadm).
USER appuser
ENV HOME=/home/appuser

# exec: uvicorn заменяет собой оболочку и сам получает сигнал остановки от
# Docker. Без exec сигнал получала sh, не передавала его дальше, и Docker
# ждал 10 секунд, а потом убивал процесс — каждый деплой давал лишний простой.
CMD ["sh", "-c", "python -m app.migrate_bootstrap && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]