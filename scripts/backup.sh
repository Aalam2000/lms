#!/usr/bin/env bash
# Ночной бэкап: база (pg_dump) + файлы платформы + файлы MinIO -> BACKUP_DIR/<дата>/.
# Хранит KEEP_DAYS дней, каждый архив проверяется после записи.
# Запуск: systemd-таймер deploy/systemd/logacademy-backup.timer
# (каждый день 03:15 по Баку, от имени quizadm). Вручную: bash scripts/backup.sh
# Итог каждого запуска — одна строка в BACKUP_DIR/backup.log.
set -euo pipefail

# Время в именах папок и в backup.log — по Баку (сервер в UTC),
# одинаково и для ручного запуска, и для таймера.
export TZ="${TZ:-Asia/Baku}"

PROJECT_DIR="${PROJECT_DIR:-/var/www/quiz}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/logacademy}"
KEEP_DAYS="${KEEP_DAYS:-14}"
FILES_DIR="${FILES_DIR:-/var/lib/logacademy/data}"
COMPOSE="docker compose -f $PROJECT_DIR/docker-compose.prod.yml"

STAMP="$(date +%F_%H%M)"
DEST="$BACKUP_DIR/$STAMP"
LOG="$BACKUP_DIR/backup.log"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# Повторный запуск, пока идёт предыдущий, — пропускаем.
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { log "SKIP: предыдущий бэкап ещё идёт"; exit 0; }

# Ошибка на любом шаге -> строка FAIL в логе, недоделанная папка удаляется.
trap 'log "FAIL: $STAMP (строка $LINENO)"; rm -rf "$DEST"' ERR

mkdir -p "$DEST"
cd "$PROJECT_DIR"

# --- база ---
URL="$(grep '^DATABASE_URL=' .env.prod | cut -d= -f2- \
      | sed 's/+asyncpg//; s/@172\.18\.0\.1:/@localhost:/')"
pg_dump "$URL" -Fc -f "$DEST/db.dump"
pg_restore -l "$DEST/db.dump" > /dev/null          # дамп читается целиком

# --- файлы платформы (app/storage.py); previews/ — кэш, пересоздаётся сам ---
tar -czf "$DEST/files.tar.gz" -C "$FILES_DIR" --exclude=./previews --exclude="*.tmp" .
tar -tzf "$DEST/files.tar.gz" > /dev/null          # архив не битый
FILES_COUNT="$(tar -tzf "$DEST/files.tar.gz" | grep -vc '/$' || true)"

# --- файлы MinIO (пока идёт переезд на диск) ---
$COMPOSE exec -T backend python -m app.backup_minio \
    > "$DEST/minio.tar.gz" 2> "$DEST/minio.txt"
tar -tzf "$DEST/minio.tar.gz" > /dev/null          # архив не битый

# --- ротация: удаляем папки старше KEEP_DAYS ---
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' \
     -mtime +"$KEEP_DAYS" -exec rm -rf {} +

log "OK: $STAMP db=$(du -h "$DEST/db.dump" | cut -f1) files: $FILES_COUNT шт $(du -h "$DEST/files.tar.gz" | cut -f1), $(cat "$DEST/minio.txt"), всего $(du -sh "$DEST" | cut -f1)"
