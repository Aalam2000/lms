"""Проверка прод-БД перед выкаткой миграций (ничего не меняет).

Текущая выкатка: 0033_scratch_account (аккаунт ученика в классе Scratch).
Перед следующей выкаткой с миграциями — поправить EXPECTED_* ниже.

Запуск на сервере (работает и на СТАРОМ образе бэкенда):
  git fetch origin && git show origin/master:scripts/prod_precheck.py | \
    docker compose -f docker-compose.prod.yml exec -T backend python -
"""
import asyncio
from sqlalchemy import text
from app.database import engine

EXPECTED_REVISION = "0032_jsonb"   # последняя уже выкаченная
NEW_TABLES = []
NEW_COLUMNS = [("users", "scratch_login"), ("users", "scratch_password")]
NEW_INDEXES = []
# Поля, тип которых меняет миграция
TYPE_COLUMNS = []


async def main():
    async with engine.connect() as c:
        ver = (await c.execute(text("select version_num from alembic_version"))).scalar()
        print(f"alembic: {ver}   (ожидаем {EXPECTED_REVISION})")
        cols = {(r[0], r[1]) for r in await c.execute(text(
            "select table_name, column_name from information_schema.columns where table_schema='public'"))}
        tables = {r[0] for r in await c.execute(text(
            "select table_name from information_schema.tables where table_schema='public'"))}
        idx = {r[0] for r in await c.execute(text(
            "select indexname from pg_indexes where schemaname='public'"))}
        bad = [t for t in NEW_TABLES if t in tables] + [f"{t}.{col}" for t, col in NEW_COLUMNS if (t, col) in cols] + [i for i in NEW_INDEXES if i in idx]
        print("уроков:", (await c.execute(text("select count(*) from lessons"))).scalar(),
              "| групп:", (await c.execute(text("select count(*) from groups"))).scalar())
        print("УЖЕ ЕСТЬ (мешает миграции):", ", ".join(bad) if bad else "нет — ОК")
        types = {(r[0], r[1]): r[2] for r in await c.execute(text(
            "select table_name, column_name, data_type from information_schema.columns where table_schema='public'"))}
        for t, col in TYPE_COLUMNS:
            print(f"тип {t}.{col}: {types.get((t, col))}")

asyncio.run(main())
