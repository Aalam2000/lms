# Deployment Guide

> **2026-09-28: frontend moved from Create React App to Vite 8 (Node 22).**
> Build output is still `frontend/build/`, build arg is still `REACT_APP_API_URL` —
> `docker-compose.prod.yml` and nginx are unchanged. Details: README.md → «Сборка фронтенда: Vite».

## 1) Server-side Postgres and platform files (outside app compose)

### 1.1 Postgres service
- PostgreSQL 18 everywhere (prod host and the dev container `postgres:18`).
- Install on prod host from the official PostgreSQL APT repository (`/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh`), package `postgresql-18`, port 5433.
- Data directory: `/var/lib/postgresql/18/main`.
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
  - `port = 5433`
- In `pg_hba.conf` allow app access from host/private docker network only, for example:
  - `host all all 127.0.0.1/32 scram-sha-256`
  - `host all all 172.18.0.0/16 scram-sha-256` — the platform's Docker network (`lms_default`, fixed in `docker-compose.prod.yml`: bridge `br-lms`, subnet `172.18.0.0/16`)
- Reload config: `sudo systemctl reload postgresql`
- Firewall: allow the database (and the NetDiag report) only from the platform's Docker bridge:
  - `sudo ufw allow in on br-lms to any port 5433`
  - `sudo ufw allow in on br-lms to any port 8090 proto tcp`

#### Memory settings
- `sudo pg_conftool 18 main set shared_buffers 512MB` (restart required)
- `sudo pg_conftool 18 main set effective_cache_size 2GB`

### 1.2 Platform files folder (required before deploy)
Uploaded files are stored on the host as `<type>/<uuid>` (names only in the DB, see `backend/app/storage.py`).
The folder is mounted into the backend container at the same path. Create it once, owned by the deploy user:
- `sudo install -d -o quizadm -g quizadm -m 700 /var/lib/logacademy/data`

`lms deploy` (`scripts/lms.sh`) refuses to deploy if the folder is missing or not writable; `scripts/backup.sh` archives it as `files.tar.gz`.

### 1.3 Pre-deploy health checks
- Postgres service is active:
  - `systemctl is-active postgresql`
- Postgres accepts auth:
  - `PGPASSWORD='<password>' psql -h 127.0.0.1 -U <user> -d <db> -c 'select 1;'`
- Platform files folder exists and is writable by the deploy user:
  - `test -w /var/lib/logacademy/data && echo ok`

> If any check fails, do not deploy app containers until fixed.

## 2) Environment files (manual only)

- Local dev:
  - create and fill `.env.dev` manually
- Prod server:
  - create and fill `.env.prod` manually
- Do not store real secrets in Git.

## 3) Compose profiles

- Prod (external Postgres and files folder on server):
  - `docker compose -f docker-compose.prod.yml up -d --build`
- Dev (local Postgres 18 in a container, files in the `files_dev_data` volume):
  - `docker compose -f docker-compose.dev.yml up -d --build`

## 4) Production deploy from Git

- Script: `scripts/lms.sh` — server control command; `lms` without arguments lists all commands (deploy, status, log, restart, precheck, backup, csp, load).
- Install once (works from any folder, Tab-completes):
  - `chmod +x /var/www/lms/scripts/lms.sh`
  - `sudo ln -sfn /var/www/lms/scripts/lms.sh /usr/local/bin/lms`
  - Tab completion of commands and services: `echo 'eval "$(/usr/local/bin/lms completion)"' | sudo tee /etc/bash_completion.d/lms` (takes effect on next login)
- Deploy: `lms deploy` (branch `master` by default, `lms deploy <branch>` for another)
- `lms deploy` does:
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

### Backups (DB + platform files)

- Script: `scripts/backup.sh` (runs as `quizadm`): `pg_dump` + the files folder `/var/lib/logacademy/data` except `previews/`.
- Output: `/var/backups/logacademy/<date>_<time>/` (`db.dump`, `files.tar.gz`); both are verified after writing; kept 14 days (`KEEP_DAYS`).
- One line per run in `/var/backups/logacademy/backup.log` (`OK` / `FAIL` / `SKIP`).
- Setup:
  - `sudo mkdir -p /var/backups/logacademy && sudo chown quizadm:quizadm /var/backups/logacademy && sudo chmod 700 /var/backups/logacademy`
  - systemd timer (runs as quizadm, daily 03:15 Asia/Baku; cron is closed for quizadm by `/etc/cron.allow`):
    `sudo cp deploy/systemd/logacademy-backup.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now logacademy-backup.timer`
  - check: `systemctl list-timers logacademy-backup.timer`
- Restore DB: `pg_restore --clean --if-exists -d "$URL" db.dump`; files: `tar -xzf files.tar.gz -C /var/lib/logacademy/data` (as `quizadm`).
- TODO: copy backups off this server (separate server / S3).

## 5) Important warnings

- `git reset --hard` deletes all local uncommitted changes on server.
- Image cleanup keeps only images required by currently running containers.
