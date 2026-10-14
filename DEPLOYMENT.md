# Deployment Guide

> **2026-09-28: frontend moved from Create React App to Vite 8 (Node 22).**
> Build output is still `frontend/build/`, build arg is still `REACT_APP_API_URL` —
> `docker-compose.prod.yml` and nginx are unchanged. Details: README.md → «Сборка фронтенда: Vite».

## 1) Server-side Postgres, platform files and MinIO (outside app compose)

### 1.1 Postgres service
- Install Postgres on prod host using OS packages.
- Data directory: `/var/lib/postgresql/<version>/main` (default package path).
- Autostart and restart policy:
  - Enable default service: `sudo systemctl enable --now postgresql`
  - Apply restart policy from `deploy/systemd/postgresql.override.conf`:
    - `sudo systemctl edit postgresql`
    - paste content from file and save
    - `sudo systemctl daemon-reload`
    - `sudo systemctl restart postgresql`

#### Network settings (required)
- In `postgresql.conf` set:
  - `listen_addresses = '127.0.0.1,<PROD_PRIVATE_IP>'`
  - `port = 5432`
- In `pg_hba.conf` allow app access from host/private docker network only, for example:
  - `host all all 127.0.0.1/32 scram-sha-256`
  - `host all all <DOCKER_BRIDGE_CIDR> scram-sha-256`
- Reload config: `sudo systemctl reload postgresql`

### 1.2 MinIO service
- Create service user and directories:
  - `sudo useradd --system --home /var/lib/minio --shell /sbin/nologin minio`
  - `sudo mkdir -p /var/lib/minio/data /etc/minio`
  - `sudo chown -R minio:minio /var/lib/minio /etc/minio`
- Install binary to `/usr/local/bin/minio` and make it executable.
- Copy env template:
  - `sudo cp deploy/systemd/minio.env.example /etc/minio/minio.env`
  - set real values for `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`
- Install unit file:
  - `sudo cp deploy/systemd/minio.service /etc/systemd/system/minio.service`
  - `sudo systemctl daemon-reload`
  - `sudo systemctl enable --now minio`

#### Network settings (required)
- In `/etc/minio/minio.env`:
  - `MINIO_ADDRESS="0.0.0.0:9000"`
  - `MINIO_CONSOLE_ADDRESS="127.0.0.1:9001"`
- Open only port `9000` for app host/private network, keep `9001` local/admin-only.

### 1.3 Platform files folder (required before deploy)
Uploaded files are stored on the host as `<type>/<uuid>` (names only in the DB, see `backend/app/storage.py`).
The folder is mounted into the backend container at the same path. Create it once, owned by the deploy user:
- `sudo install -d -o quizadm -g quizadm -m 700 /var/lib/logacademy/data`

`scripts/deploy-prod.sh` refuses to deploy if the folder is missing or not writable; `scripts/backup.sh` archives it as `files.tar.gz`.
MinIO (1.2) is only needed until the existing files are moved to this folder: the backend moves them automatically at startup.

### 1.4 Pre-deploy health checks
- Postgres service is active:
  - `systemctl is-active postgresql`
- Postgres accepts auth:
  - `PGPASSWORD='<password>' psql -h 127.0.0.1 -U <user> -d <db> -c 'select 1;'`
- MinIO service is active:
  - `systemctl is-active minio`
- MinIO API health:
  - `curl -fsS http://127.0.0.1:9000/minio/health/live`

> If any check fails, do not deploy app containers until fixed.

## 2) Environment files (manual only)

- Local dev:
  - create and fill `.env.dev` manually
- Prod server:
  - create and fill `.env.prod` manually
- Do not store real secrets in Git.

## 3) Compose profiles

- Prod (external Postgres/MinIO on server):
  - `docker compose -f docker-compose.prod.yml up -d --build`
- Dev (local Postgres/MinIO in containers):
  - `docker compose -f docker-compose.dev.yml up -d --build`

## 4) Production deploy from Git

- Script: `scripts/deploy-prod.sh`
- Usage:
  - `chmod +x scripts/deploy-prod.sh`
  - `./scripts/deploy-prod.sh main`
- The script does:
  - `git fetch origin`
  - `git reset --hard origin/<branch>`
  - `docker compose -f docker-compose.prod.yml up -d --build --remove-orphans`
  - `docker image prune -f`, `docker volume prune -f`
  - `docker builder prune -af --filter "until=72h"` — removes only build cache unused for 3 days; layers of the current build are never removed
  - prints a warning if the disk is 80% full or more
  - `df -h /` — prints disk usage at the end

### Server log limits (one-time setup on a new server)

- Nginx login log (read by fail2ban) rotation:
  - `sudo cp deploy/logrotate/logacademy /etc/logrotate.d/logacademy`
  - check: `sudo logrotate -d /etc/logrotate.d/logacademy`
- systemd journal: `SystemMaxUse=100M` in `/etc/systemd/journald.conf`, then `sudo systemctl restart systemd-journald`
- auditd: `max_log_file_action = ROTATE` in `/etc/audit/auditd.conf` (with `keep_logs` it never deletes old files), then `sudo service auditd restart`

### Backups (DB + MinIO files)

- Script: `scripts/backup.sh` (runs as `quizadm`): `pg_dump` + all MinIO objects except `previews/` (via `python -m app.backup_minio` in the backend container).
- Output: `/var/backups/logacademy/<date>_<time>/` (`db.dump`, `minio.tar.gz`); both are verified after writing; kept 14 days (`KEEP_DAYS`).
- One line per run in `/var/backups/logacademy/backup.log` (`OK` / `FAIL` / `SKIP`).
- Setup:
  - `sudo mkdir -p /var/backups/logacademy && sudo chown quizadm:quizadm /var/backups/logacademy && sudo chmod 700 /var/backups/logacademy`
  - systemd timer (runs as quizadm, daily 03:15 Asia/Baku; cron is closed for quizadm by `/etc/cron.allow`):
    `sudo cp deploy/systemd/logacademy-backup.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now logacademy-backup.timer`
  - check: `systemctl list-timers logacademy-backup.timer`
- Restore DB: `pg_restore --clean --if-exists -d "$URL" db.dump`; files: unpack `minio.tar.gz` and upload with `mc mirror` (or the MinIO console).
- TODO: copy backups off this server (separate server / S3).

## 5) Important warnings

- `git reset --hard` deletes all local uncommitted changes on server.
- Image cleanup keeps only images required by currently running containers.
