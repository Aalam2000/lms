"""РАЗОВЫЙ перенос: Тамерлан Туаев из Pixels в DevKids (24.10.2026).

Что делает (одна транзакция):
  1. Находит ученика (Туаев), группы Pixels и DevKids — ровно по одной, иначе стоп.
  2. Берёт персональные уроки Pixels, где он ЕДИНСТВЕННЫЙ участник,
     и переносит их в DevKids (меняется только lessons.group_id; урок остаётся
     персональным, оценки/ДЗ/файлы/чат привязаны к lesson_id и едут с ним).
  3. joined_at в DevKids = дата первого перенесённого урока
     (иначе отчёты и посещаемость считают старые уроки «до вступления»).
  4. Удаляет его запись в составе Pixels (не отчисление).

Без --apply ничего не меняет (только отчёт). После выполнения файл удалить.

Запуск на сервере (из /var/www/lms):
  cat scripts/oneoff_move_tuaev.py | docker compose -f docker-compose.prod.yml exec -T backend python -
  cat scripts/oneoff_move_tuaev.py | docker compose -f docker-compose.prod.yml exec -T backend python - --apply
На dev — то же с docker-compose.dev.yml.
"""
import asyncio
import sys
from zoneinfo import ZoneInfo

from sqlalchemy import text
from app.database import engine

APPLY = "--apply" in sys.argv
BAKU = ZoneInfo("Asia/Baku")


def fmt(d):
    return d.astimezone(BAKU).strftime("%d.%m.%Y %a %H:%M") if d else "—"


async def one(c, sql, what, **params):
    rows = (await c.execute(text(sql), params)).all()
    if len(rows) != 1:
        print(f"СТОП: {what} — найдено {len(rows)}: {rows}")
        sys.exit(1)
    return rows[0]


async def main():
    async with engine.begin() as c:
        st = await one(c, """select id, full_name, username from users
            where role='student' and (full_name ilike '%туаев%' or full_name ilike '%tuaev%')""",
            "ученик Туаев")
        px = await one(c, "select id, name from groups where name ilike 'pixels'", "группа Pixels")
        dk = await one(c, """select id, name from groups
            where replace(lower(name),' ','') in ('devkids','девкидс')""", "группа DevKids")
        sid, pid, did = st.id, px.id, dk.id
        print(f"Ученик:  {st.full_name} ({st.username}, id={sid})")
        print(f"Из:      {px.name} (id={pid})")
        print(f"В:       {dk.name} (id={did})")

        mem = await one(c, "select id, status, joined_at from group_members where group_id=:g and student_id=:s",
                        "его запись в DevKids", g=did, s=sid)
        print(f"В DevKids: статус {mem.status}, joined_at {fmt(mem.joined_at)}")
        if mem.status != "active":
            print("СТОП: в DevKids он не active"); sys.exit(1)
        px_mem = (await c.execute(text(
            "select id, status from group_members where group_id=:g and student_id=:s"), {"g": pid, "s": sid})).all()
        print(f"В Pixels записей состава: {len(px_mem)} {[tuple(r) for r in px_mem]}")

        lessons = (await c.execute(text("""
            select l.id, l.title, l.date,
              (select count(*) from lesson_marks m where m.lesson_id=l.id) marks,
              (select count(*) from homework_answers a where a.lesson_id=l.id) hw
            from lessons l
            where l.group_id=:g and l.is_personal
              and exists (select 1 from lesson_students ls where ls.lesson_id=l.id and ls.student_id=:s)
              and not exists (select 1 from lesson_students ls where ls.lesson_id=l.id and ls.student_id<>:s)
            order by l.date"""), {"g": pid, "s": sid})).all()
        print(f"\nПерсональных уроков к переносу: {len(lessons)}")
        for l in lessons:
            print(f"  id={l.id:<6} {fmt(l.date):<22} {l.title!r:<40} оценок:{l.marks} ДЗ-ответов:{l.hw}")

        shared = (await c.execute(text("""
            select l.id, l.title, l.date from lessons l
            where l.group_id=:g and l.is_personal
              and exists (select 1 from lesson_students ls where ls.lesson_id=l.id and ls.student_id=:s)
              and exists (select 1 from lesson_students ls where ls.lesson_id=l.id and ls.student_id<>:s)"""),
            {"g": pid, "s": sid})).all()
        if shared:
            print("\nВНИМАНИЕ: персональные уроки Pixels, где он НЕ один (не переносятся):")
            for l in shared:
                print(f"  id={l.id} {fmt(l.date)} {l.title!r}")

        left = (await c.execute(text("""
            select count(*) from lesson_marks m join lessons l on l.id=m.lesson_id
            where l.group_id=:g and not l.is_personal and m.student_id=:s"""), {"g": pid, "s": sid})).scalar()
        print(f"\nЕго отметок в обычных уроках Pixels (останутся в Pixels): {left}")

        if not lessons:
            print("СТОП: переносить нечего"); sys.exit(1)
        first = lessons[0].date
        print(f"joined_at в DevKids станет: {fmt(first)}")

        if not APPLY:
            print("\nDRY-RUN: ничего не изменено. Для выполнения — добавить --apply")
            return

        ids = [l.id for l in lessons]
        n = (await c.execute(text("update lessons set group_id=:d where id = any(:ids) and group_id=:p"),
                             {"d": did, "p": pid, "ids": ids})).rowcount
        await c.execute(text("update group_members set joined_at=:j where id=:id"), {"j": first, "id": mem.id})
        m = (await c.execute(text("delete from group_members where group_id=:g and student_id=:s"),
                             {"g": pid, "s": sid})).rowcount
        if n != len(ids):
            raise RuntimeError(f"перенесено {n} из {len(ids)} — откат")
        print(f"\nГОТОВО: уроков перенесено {n}, joined_at обновлён, записей Pixels удалено {m}")


asyncio.run(main())
