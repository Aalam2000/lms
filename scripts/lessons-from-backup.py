#!/usr/bin/env python3
"""Уроки из ночных копий базы: посмотреть и вернуть удалённый.

Запуск на сервере, от quizadm, из папки проекта:
    python3 scripts/lessons-from-backup.py 2026-10-03               один день
    python3 scripts/lessons-from-backup.py 2026-09-29 2026-10-02    интервал
Даты — по Баку, обе границы включительно.

Что делает:
  1. Читает таблицы прямо из файлов db.dump (pg_restore печатает их данные
     в поток) и показывает уроки за эти дни: время, группа, комментарий,
     кто пришёл. Для каждого урока берётся самая свежая копия, где он был.
     Копии не меняются.
  2. Если среди них есть удалённые — предлагает вернуть один в платформу.
     Без ответа «да» в рабочую базу ничего не пишется.

Возвращается всё, что платформа удаляет вместе с уроком: сам урок (с прежним
номером), участники персонального урока, отметки, оценки учеников уроку,
привязки материалов, ДЗ (задания, ответы, их файлы) и диалоги. Строки
вставляются в том виде, в каком лежат в копии, одной транзакцией: при любой
ошибке база остаётся как была.
"""
import io
import os
import re
import subprocess
import sys
import tarfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

PROJECT_DIR = Path(os.environ.get("PROJECT_DIR", "/var/www/quiz"))
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/var/backups/logacademy"))
BAKU = timezone(timedelta(hours=4))
PRESENT = {"in_person": "очно", "online": "онлайн"}

# Порядок = порядок вставки при возврате (сначала то, на что ссылаются).
RESTORED = ("materials", "lessons", "lesson_students", "lesson_marks", "lesson_feedback",
            "lesson_resources", "homework_tasks", "homework_answers",
            "homework_answer_files", "lesson_messages")
TABLES = RESTORED + ("groups", "users")
RESOURCE_TABLES = {"material": "materials", "quiz": "quizzes", "link": "links"}

COPY_HEAD = re.compile(r"^COPY (?:\w+\.)?(\w+) \((.*)\) FROM stdin;$")
ESCAPE = re.compile(r"\\(.)")
ESCAPES = {"t": "\t", "n": "\n", "r": "\r", "b": "\b", "f": "\f", "v": "\v"}
STAMP = re.compile(r"^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:\.\d+)?([+-])(\d\d)(?::?(\d\d))?")

# Выполняется в контейнере backend: кладёт файлы из tar-потока в хранилище.
UPLOAD = (
    "import sys, tarfile\n"
    "from app.storage import upload_bytes\n"
    "with tarfile.open(fileobj=sys.stdin.buffer, mode='r|') as tar:\n"
    "    for m in tar:\n"
    "        upload_bytes(m.name, tar.extractfile(m).read(), m.pax_headers.get('comment'))\n"
)


class Stop(Exception):
    """Понятная причина остановки — печатается без трассировки."""


# ---------- чтение копии ----------

def field(raw):
    if raw == r"\N":
        return None
    return ESCAPE.sub(lambda m: ESCAPES.get(m.group(1), m.group(1)), raw)


def read_dump(path):
    """{таблица: {"head": строка COPY, "rows": [словарь + "_raw"]}} из db.dump."""
    command = ["pg_restore", "--data-only", "-f", "-"]
    for table in TABLES:
        command += ["-t", table]
    out = subprocess.run(command + [str(path)], check=True, capture_output=True).stdout.decode("utf-8")
    data = {table: {"head": None, "rows": []} for table in TABLES}
    columns = rows = None
    for line in out.split("\n"):
        if columns is None:
            head = COPY_HEAD.match(line)
            if head and head.group(1) in data:
                columns = [c.strip().strip('"') for c in head.group(2).split(",")]
                data[head.group(1)]["head"] = line
                rows = data[head.group(1)]["rows"]
        elif line == "\\.":
            columns = None
        else:
            row = dict(zip(columns, map(field, line.split("\t"))))
            row["_raw"] = line
            rows.append(row)
    return data


def baku_time(text):
    m = STAMP.match(text or "")
    if not m:
        return None
    day, clock, sign, hours, minutes = m.groups()
    offset = timedelta(hours=int(hours), minutes=int(minutes or 0))
    zone = timezone(offset if sign == "+" else -offset)
    return datetime.fromisoformat(f"{day}T{clock}").replace(tzinfo=zone).astimezone(BAKU)


def person(users, user_id):
    user = users.get(user_id) or {}
    return user.get("full_name") or user.get("username") or f"id {user_id}"


def collect(dumps, first, last):
    """Уроки за интервал: для каждого — данные из самой свежей копии с ним."""
    found = {}
    for dump in dumps:
        try:
            data = read_dump(dump)
        except subprocess.CalledProcessError:
            print(f"Копия {dump.parent.name} не читается — пропущена.")
            continue
        groups = {g["id"]: g["name"] for g in data["groups"]["rows"]}
        users = {u["id"]: u for u in data["users"]["rows"]}
        for lesson in data["lessons"]["rows"]:
            when = baku_time(lesson["date"])
            if lesson["id"] in found or when is None or not first <= when.date() <= last:
                continue
            of_lesson = lambda table: [r for r in data[table]["rows"] if r["lesson_id"] == lesson["id"]]
            came = [
                person(users, m["student_id"]) + " (" + PRESENT[m["attendance_status"]]
                + (", опоздал" if m["is_late"] == "t" else "") + ")"
                for m in of_lesson("lesson_marks") if m["attendance_status"] in PRESENT
            ]
            found[lesson["id"]] = {
                "id": lesson["id"], "when": when, "dump": dump, "data": data,
                "group_id": lesson["group_id"],
                "group": groups.get(lesson["group_id"], f"id {lesson['group_id']}"),
                "title": lesson["title"], "comment": lesson.get("comment"),
                "personal": lesson.get("is_personal") == "t",
                "members": sorted(person(users, s["student_id"]) for s in of_lesson("lesson_students")),
                "came": sorted(came),
                "homework": len(of_lesson("homework_tasks")), "answers": len(of_lesson("homework_answers")),
            }
    return sorted(found.values(), key=lambda r: (r["when"], r["group"]))


# ---------- рабочая база ----------

def database_url():
    env = (PROJECT_DIR / ".env.prod").read_text(encoding="utf-8")
    url = re.search(r"^DATABASE_URL=(.*)$", env, re.M).group(1).strip()
    return re.sub(r"@172\.18\.0\.1:", "@localhost:", url.replace("+asyncpg", ""))


def live_ids(table):
    out = subprocess.run(["psql", database_url(), "-v", "ON_ERROR_STOP=1", "-Atc", f"SELECT id FROM {table}"],
                         check=True, capture_output=True).stdout.decode()
    return set(out.split())


def live_lesson_ids():
    try:
        return live_ids("lessons")
    except Exception:
        return None


# ---------- возврат урока ----------

def plan_restore(row):
    """Что вставлять: {таблица: [строки]}, файлы хранилища, что пропущено."""
    data, lesson_id = row["data"], row["id"]
    if row["group_id"] not in live_ids("groups"):
        raise Stop(f"Группы «{row['group']}» в платформе уже нет — урок вернуть некуда.")
    users = live_ids("users")
    names = {u["id"]: u for u in data["users"]["rows"]}
    rows = {table: [] for table in RESTORED}
    skipped, objects = [], {}

    rows["lessons"] = [r for r in data["lessons"]["rows"] if r["id"] == lesson_id]
    per_student = {"lesson_students": "участник", "lesson_marks": "отметка", "lesson_feedback": "оценка уроку",
                   "homework_answers": "ответ на ДЗ", "lesson_messages": "сообщение в диалоге"}
    for table, what in per_student.items():
        for r in data[table]["rows"]:
            if r["lesson_id"] != lesson_id:
                continue
            if r["student_id"] in users:
                rows[table].append(r)
            else:
                skipped.append(f"{what}: ученика «{person(names, r['student_id'])}» в платформе уже нет")

    existing = {kind: live_ids(table) for kind, table in RESOURCE_TABLES.items()}
    for r in data["lesson_resources"]["rows"]:
        if r["lesson_id"] != lesson_id:
            continue
        if r["resource_id"] in existing.get(r["resource_type"], ()):
            rows["lesson_resources"].append(r)
        else:
            skipped.append(f"материал урока ({r['resource_type']} {r['resource_id']}) удалён из Базы знаний")

    # Задания ДЗ: общий файл должен быть в Базе знаний; персональный файл
    # платформа удаляет вместе с уроком — его возвращаем вместе с заданием.
    old_materials = {m["id"]: m for m in data["materials"]["rows"]}
    for r in data["homework_tasks"]["rows"]:
        if r["lesson_id"] != lesson_id:
            continue
        material = old_materials.get(r["material_id"])
        if r["student_id"] is not None and r["student_id"] not in users:
            skipped.append(f"задание ДЗ: ученика «{person(names, r['student_id'])}» в платформе уже нет")
        elif r["material_id"] in existing["material"]:
            rows["homework_tasks"].append(r)
        elif material and material.get("is_personal") == "t":
            rows["homework_tasks"].append(r)
            if material["object_key"] not in objects:
                rows["materials"].append(material)
                objects[material["object_key"]] = material.get("content_type")
        else:
            skipped.append(f"задание ДЗ: файл {r['material_id']} удалён из Базы знаний")

    answers = {r["id"] for r in rows["homework_answers"]}
    for r in data["homework_answer_files"]["rows"]:
        if r["answer_id"] in answers:
            rows["homework_answer_files"].append(r)
            objects[r["object_key"]] = r.get("content_type")
    return rows, objects, skipped


def pack_objects(dump, objects):
    """tar с нужными файлами из files.tar.gz той же копии; + каких там нет."""
    packed, missing = io.BytesIO(), set(objects)
    archive = dump.parent / "files.tar.gz"
    with tarfile.open(fileobj=packed, mode="w", format=tarfile.PAX_FORMAT) as out:
        if archive.exists():
            with tarfile.open(archive, mode="r|gz") as source:
                for member in source:
                    name = member.name.removeprefix("./")  # tar -C <папка> . даёт «./materials/<uuid>»
                    if name in missing:
                        info = tarfile.TarInfo(name)
                        info.size = member.size
                        if objects[name]:
                            info.pax_headers = {"comment": objects[name]}
                        out.addfile(info, source.extractfile(member))
                        missing.discard(name)
    return packed.getvalue(), sorted(missing)


def restore(row, rows, objects):
    missing = []
    if objects:
        packed, missing = pack_objects(row["dump"], objects)
        if len(missing) < len(objects):
            done = subprocess.run(
                ["docker", "compose", "-f", str(PROJECT_DIR / "docker-compose.prod.yml"),
                 "exec", "-T", "backend", "python", "-c", UPLOAD],
                input=packed, capture_output=True)
            if done.returncode != 0:
                raise Stop("Файлы в хранилище вернуть не удалось, база не тронута:\n"
                           + done.stderr.decode(errors="replace").strip())

    script = ["BEGIN;"]
    for table in RESTORED:
        if rows[table]:
            script += [row["data"][table]["head"], *(r["_raw"] for r in rows[table]), "\\."]
    script.append("COMMIT;")
    done = subprocess.run(["psql", database_url(), "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                          input="\n".join(script).encode("utf-8") + b"\n", capture_output=True)
    if done.returncode != 0:
        raise Stop("База урок не приняла, ничего не изменено:\n" + done.stderr.decode(errors="replace").strip())
    return missing


def offer_restore(deleted):
    if not sys.stdin.isatty():
        return
    print()
    answer = input("Вернуть удалённый урок в платформу? Его номер в списке (Enter — ничего не делать): ").strip()
    if not answer:
        return
    if not answer.isdigit() or not 1 <= int(answer) <= len(deleted):
        raise Stop("Такого номера в списке нет. Ничего не сделано.")
    row = deleted[int(answer) - 1]
    rows, objects, skipped = plan_restore(row)

    print()
    print(f"Возвращаем: {row['when']:%d.%m.%Y %H:%M}   {row['group']}   «{row['title']}»   (копия {row['dump'].parent.name})")
    labels = (("lesson_students", "участников"), ("lesson_marks", "отметок"), ("lesson_feedback", "оценок уроку от учеников"),
              ("lesson_resources", "материалов урока"), ("homework_tasks", "заданий ДЗ"),
              ("homework_answers", "ответов на ДЗ"), ("homework_answer_files", "файлов ответов"),
              ("lesson_messages", "сообщений в диалогах"))
    print("  " + ", ".join(f"{label}: {len(rows[table])}" for table, label in labels))
    for line in skipped:
        print(f"  не вернётся — {line}")
    if input("Возвращаем? (да/нет): ").strip().lower() not in ("да", "д", "yes", "y"):
        print("Ничего не сделано.")
        return
    missing = restore(row, rows, objects)
    print("Готово: урок снова в платформе.")
    for key in missing:
        print(f"  файла нет в копии, в платформе он не откроется: {key}")


# ---------- запуск ----------

def show(row, number, live):
    state = ""
    if live is not None:
        state = f"   [УДАЛЁН — № {number}]" if number else "   [есть в платформе]"
    kind = "персональный урок" if row["personal"] else "урок группы"
    comment = (row["comment"] or "—").strip().replace("\n", "\n" + " " * 15)
    print()
    print(f"{row['when']:%d.%m.%Y %H:%M}   {row['group']}   «{row['title']}»   {kind}{state}")
    print(f"  Комментарий: {comment}")
    if row["personal"]:
        print(f"  Участники:   {', '.join(row['members']) or '—'}")
    print(f"  Пришли:      {', '.join(row['came']) or '—'}")
    if row["homework"] or row["answers"]:
        print(f"  ДЗ:          заданий {row['homework']}, ответов {row['answers']}")
    print(f"  Копия:       {row['dump'].parent.name}")


def main():
    days = sys.argv[1:3]
    try:
        first, last = date.fromisoformat(days[0]), date.fromisoformat(days[-1])
    except (IndexError, ValueError):
        sys.exit("Запуск: python3 scripts/lessons-from-backup.py ГГГГ-ММ-ДД [ГГГГ-ММ-ДД]")

    dumps = sorted(BACKUP_DIR.glob("20*/db.dump"), reverse=True)  # от свежей копии к старой
    if not dumps:
        sys.exit(f"В {BACKUP_DIR} копий нет")

    found = collect(dumps, first, last)
    live = live_lesson_ids()
    deleted = [] if live is None else [row for row in found if row["id"] not in live]

    print(f"Копий просмотрено: {len(dumps)} ({dumps[-1].parent.name} … {dumps[0].parent.name})")
    print(f"Уроков с {first:%d.%m.%Y} по {last:%d.%m.%Y}: {len(found)}, из них удалено: "
          + ("неизвестно" if live is None else str(len(deleted))))
    if live is None:
        print("Рабочую базу прочитать не удалось — что удалено, не отмечено, вернуть урок нельзя.")
    numbers = {row["id"]: number for number, row in enumerate(deleted, 1)}
    for row in found:
        show(row, numbers.get(row["id"], 0), live)

    if deleted:
        try:
            offer_restore(deleted)
        except Stop as reason:
            sys.exit(str(reason))


if __name__ == "__main__":
    main()
