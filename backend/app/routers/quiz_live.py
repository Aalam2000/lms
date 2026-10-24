"""Живой квиз (Kahoot-style) — вся игра только в памяти процесса.

В БД ничего не пишется, пока игра идёт (см. claude/... обсуждение с
Андреем). Единственная запись в БД — по окончании игры, и только если
у квиза стоит флажок is_exam: тогда для каждого участника считается
процент правильных ответов и пишется в lesson_marks.exam_score.

Если backend перезапустится посреди игры — активная игра теряется
целиком. Это осознанно принято (см. диалог) — отказоустойчивость не
на уровне этой фичи.
"""
import secrets
import time
from datetime import datetime, timezone as dt_timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import get_current_user, require_teacher
from ..models import GroupMember, Lesson, LessonMark, Quiz, User
from .lessons import get_lesson_for_teacher_or_admin, get_lesson_for_student, _get_active_group_student_ids

router = APIRouter(prefix="/quiz-live", tags=["quiz-live"])

GAME_IDLE_TTL = 6 * 3600  # секунд — сколько держим неактивную игру в памяти
ANSWER_GRACE_SECONDS = 5  # автопереключение через N сек после ответа всех

# code -> game dict. Единственное хранилище состояния живого квиза.
GAMES: dict[str, dict] = {}


class OpenBody(BaseModel):
    lesson_id: int


class JoinBody(BaseModel):
    student_id: int


class AnswerBody(BaseModel):
    token: str
    question_index: int
    option: int


class SetExamBody(BaseModel):
    is_exam: bool


def _cleanup_stale() -> None:
    now = time.time()
    stale = [code for code, g in GAMES.items() if now - g["last_touched"] > GAME_IDLE_TTL]
    for code in stale:
        GAMES.pop(code, None)


def _get_game(code: str) -> dict:
    game = GAMES.get(code)
    if not game:
        raise HTTPException(status_code=404, detail="Игра не найдена или уже завершилась")
    return game


def _touch(game: dict) -> None:
    game["last_touched"] = time.time()


def _running_game(lesson_id: int) -> Optional[dict]:
    # На урок — одна незавершённая игра: её код ученик получает кнопкой в уроке
    for game in GAMES.values():
        if game["lesson_id"] == lesson_id and game["status"] != "finished":
            return game
    return None


def _check_all_answered(game: dict) -> None:
    if game["all_answered_at"] is not None:
        return
    participants = game["participants"]
    if not participants:
        return
    idx = game["current_question"]
    if all(idx in p["answers"] for p in participants.values()):
        game["all_answered_at"] = time.time()


async def _write_exam_score(db: AsyncSession, lesson_id: int, student_id: int, score: int, teacher_id: int) -> None:
    result = await db.execute(
        select(LessonMark).where(LessonMark.lesson_id == lesson_id, LessonMark.student_id == student_id)
    )
    mark = result.scalar_one_or_none()
    if not mark:
        mark = LessonMark(lesson_id=lesson_id, student_id=student_id)
        db.add(mark)
    mark.exam_score = score
    mark.marked_by = teacher_id
    mark.marked_at = datetime.now(dt_timezone.utc)


async def _finish_game(game: dict, db: AsyncSession) -> None:
    game["status"] = "finished"
    if game["is_exam"]:
        n = len(game["questions"]) or 1
        for student_id, p in game["participants"].items():
            score = round(100 * p["correct_count"] / n)
            await _write_exam_score(db, game["lesson_id"], student_id, score, game["teacher_id"])
        await db.commit()


async def _close_game(game: dict, db: AsyncSession) -> None:
    # Педагог закрыл квиз (или запустил в уроке другой): идущая игра
    # завершается как обычно (экзамен пишет оценки), не начатая — просто закрывается
    if game["status"] == "active":
        await _finish_game(game, db)
    else:
        game["status"] = "finished"


def _time_left(game: dict) -> int:
    idx = game["current_question"]
    q = game["questions"][idx]
    qtime = q.get("time") or 60
    elapsed = time.time() - (game["question_started_at"] or time.time())
    return max(0, round(qtime - elapsed))


def _advance(game: dict) -> str:
    game["current_question"] += 1
    if game["current_question"] >= len(game["questions"]):
        return "finish"
    game["question_started_at"] = time.time()
    game["all_answered_at"] = None
    return "next"


async def _maybe_auto_advance(game: dict, db: AsyncSession) -> None:
    if game["status"] != "active":
        return
    q = game["questions"][game["current_question"]]
    qtime = q.get("time") or 60
    now = time.time()
    started = game["question_started_at"]
    timer_due = started is not None and (now - started) >= qtime
    grace_due = game["all_answered_at"] is not None and (now - game["all_answered_at"]) >= ANSWER_GRACE_SECONDS
    if timer_due or grace_due:
        if _advance(game) == "finish":
            await _finish_game(game, db)


def _host_view(game: dict) -> dict:
    base = {
        "status": game["status"],
        "title": game["title"],
        "topic": game["topic"],
        "total_questions": len(game["questions"]),
        "is_exam": game["is_exam"],
        "lesson_id": game["lesson_id"],
    }
    if game["status"] == "waiting":
        base["participants"] = [{"name": p["name"]} for p in game["participants"].values()]
        return base

    if game["status"] == "active":
        idx = game["current_question"]
        q = game["questions"][idx]
        base.update({
            "current_question": idx,
            "question": q["question"],
            "options": q["options"],
            "time_left": _time_left(game),
            "all_answered": game["all_answered_at"] is not None,
            "participants": [
                {"name": p["name"], "answered": idx in p["answers"]}
                for p in game["participants"].values()
            ],
        })
        return base

    # finished
    results = sorted(
        (
            {"name": p["name"], "correct_count": p["correct_count"]}
            for p in game["participants"].values()
        ),
        key=lambda r: -r["correct_count"],
    )
    base["results"] = results
    return base


def _participant_view(game: dict, participant: dict) -> dict:
    if game["status"] == "waiting":
        return {"status": "waiting", "title": game["title"], "topic": game["topic"]}

    if game["status"] == "active":
        idx = game["current_question"]
        if idx in participant["answers"]:
            return {"status": "answered", "current_question": idx}
        q = game["questions"][idx]
        return {
            "status": "question",
            "current_question": idx,
            "total_questions": len(game["questions"]),
            "question": q["question"],
            "options": q["options"],
            "time_left": _time_left(game),
        }

    # finished — разбор по каждому вопросу с 1 по последний
    review = []
    for idx, q in enumerate(game["questions"]):
        given = participant["answers"].get(idx)
        review.append({
            "index": idx,
            "question": q["question"],
            "correct_option": q["options"][q["correct_index"]],
            "correct": bool(given and given["correct"]),
        })
    return {
        "status": "finished",
        "correct_count": participant["correct_count"],
        "total_questions": len(game["questions"]),
        "review": review,
    }


# ---------- Препод ----------

@router.post("/{quiz_id}/open")
async def open_game(
    quiz_id: int,
    body: OpenBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    _cleanup_stale()

    quiz_result = await db.execute(select(Quiz).where(Quiz.id == quiz_id))
    quiz = quiz_result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Квиз не найден")
    if quiz.template_type != "live" or not quiz.questions_data:
        raise HTTPException(status_code=400, detail="Это не живой квиз")

    lesson = await get_lesson_for_teacher_or_admin(body.lesson_id, db, current_user)

    # В уроке идёт только один квиз: тот же — возвращаем его (вкладку хоста
    # открыли заново), другой — прежний закрывается
    running = _running_game(lesson.id)
    if running:
        if running["quiz_id"] == quiz.id:
            _touch(running)
            return {"code": running["code"]}
        await _close_game(running, db)

    code = secrets.token_urlsafe(6)
    while code in GAMES:
        code = secrets.token_urlsafe(6)

    GAMES[code] = {
        "code": code,
        "quiz_id": quiz.id,
        "lesson_id": lesson.id,
        "teacher_id": current_user.id,
        "title": quiz.title,
        "topic": quiz.topic or "",
        "questions": quiz.questions_data,
        "is_exam": False,  # препод включает сам на титулке запущенного квиза (см. /set-exam)
        "status": "waiting",
        "current_question": -1,
        "question_started_at": None,
        "all_answered_at": None,
        "participants": {},   # student_id -> {name, token, answers, correct_count}
        "tokens": {},          # token -> student_id
        "created_at": time.time(),
        "last_touched": time.time(),
    }
    return {"code": code}


@router.get("/{code}/host")
async def get_host_state(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    game = _get_game(code)
    if current_user.role != "admin" and game["teacher_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    await _maybe_auto_advance(game, db)
    _touch(game)
    return _host_view(game)


@router.post("/{code}/start")
async def start_game(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    game = _get_game(code)
    if current_user.role != "admin" and game["teacher_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if game["status"] != "waiting":
        raise HTTPException(status_code=400, detail="Игра уже идёт")
    game["status"] = "active"
    game["current_question"] = 0
    game["question_started_at"] = time.time()
    game["all_answered_at"] = None
    _touch(game)
    return _host_view(game)


@router.post("/{code}/next")
async def next_question(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    game = _get_game(code)
    if current_user.role != "admin" and game["teacher_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if game["status"] != "active":
        raise HTTPException(status_code=400, detail="Игра не активна")
    if _advance(game) == "finish":
        await _finish_game(game, db)
    _touch(game)
    return _host_view(game)


@router.post("/{code}/set-exam")
async def set_exam(
    code: str,
    body: SetExamBody,
    current_user: User = Depends(require_teacher),
):
    # Решение "это экзамен или нет" — за конкретный запуск, препод ставит
    # его на титулке запущенного квиза, пока идёт регистрация (не при
    # создании квиза — тот же квиз можно провести и как экзамен, и просто
    # так, в разные разы).
    game = _get_game(code)
    if current_user.role != "admin" and game["teacher_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if game["status"] != "waiting":
        raise HTTPException(status_code=400, detail="Можно менять только до начала игры")
    game["is_exam"] = body.is_exam
    _touch(game)
    return _host_view(game)


@router.post("/{code}/close")
async def close_game(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    game = _get_game(code)
    if current_user.role != "admin" and game["teacher_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if game["status"] != "finished":
        await _close_game(game, db)
    _touch(game)
    return _host_view(game)


# ---------- Ученик в платформе: кнопка «Войти в квиз» в уроке ----------

@router.get("/lesson/{lesson_id}/active")
async def get_lesson_active_game(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Идёт ли сейчас квиз в этом уроке: {code, title} или null
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Нет доступа")
    lesson = await get_lesson_for_student(lesson_id, db, current_user)
    game = _running_game(lesson.id)
    if game:
        await _maybe_auto_advance(game, db)
    if not game or game["status"] == "finished":
        return None
    if current_user.id not in await _get_active_group_student_ids(lesson, db):
        return None
    return {"code": game["code"], "title": game["title"]}


@router.post("/{code}/join-me")
async def join_game_me(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Вход ученика под своим логином — без выбора имени из списка
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Войти в квиз может только ученик")
    game = _get_game(code)
    return await _join(game, current_user.id, db)


# ---------- Ученик (без логина — по коду игры и токену участника) ----------

@router.get("/{code}/roster")
async def get_roster(code: str, db: AsyncSession = Depends(get_db)):
    game = _get_game(code)
    if game["status"] == "finished":
        raise HTTPException(status_code=400, detail="Игра уже завершена")
    _touch(game)

    lesson_result = await db.execute(select(Lesson).where(Lesson.id == game["lesson_id"]))
    lesson = lesson_result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")

    student_ids = await _get_active_group_student_ids(lesson, db)
    registered = set(game["participants"].keys())
    remaining_ids = student_ids - registered
    if not remaining_ids:
        available = []
    else:
        users_result = await db.execute(
            select(User.id, User.full_name, User.username).where(User.id.in_(remaining_ids))
        )
        available = [
            {"id": uid, "full_name": full_name or username}
            for uid, full_name, username in users_result.all()
        ]

    return {
        "status": game["status"],
        "title": game["title"],
        "topic": game["topic"],
        "available": available,
    }


@router.post("/{code}/join")
async def join_game(code: str, body: JoinBody, db: AsyncSession = Depends(get_db)):
    game = _get_game(code)
    return await _join(game, body.student_id, db)


async def _join(game: dict, student_id: int, db: AsyncSession) -> dict:
    if game["status"] == "finished":
        raise HTTPException(status_code=400, detail="Игра уже завершена")

    existing = game["participants"].get(student_id)
    if existing:
        _touch(game)
        return {"token": existing["token"], "name": existing["name"]}

    lesson_result = await db.execute(select(Lesson).where(Lesson.id == game["lesson_id"]))
    lesson = lesson_result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")
    student_ids = await _get_active_group_student_ids(lesson, db)
    if student_id not in student_ids:
        raise HTTPException(status_code=403, detail="Этот ученик не из группы этого урока")

    user_result = await db.execute(select(User).where(User.id == student_id))
    student = user_result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")

    token = secrets.token_urlsafe(16)
    name = student.full_name or student.username
    game["participants"][student_id] = {
        "name": name,
        "token": token,
        "answers": {},
        "correct_count": 0,
    }
    game["tokens"][token] = student_id
    _touch(game)
    return {"token": token, "name": name}


def _get_participant(game: dict, token: str) -> dict:
    student_id = game["tokens"].get(token)
    if student_id is None:
        raise HTTPException(status_code=404, detail="Неверный токен участника")
    return game["participants"][student_id]


@router.get("/{code}/state")
async def get_participant_state(code: str, token: str, db: AsyncSession = Depends(get_db)):
    game = _get_game(code)
    await _maybe_auto_advance(game, db)
    participant = _get_participant(game, token)
    _touch(game)
    return _participant_view(game, participant)


@router.post("/{code}/answer")
async def submit_answer(code: str, body: AnswerBody, db: AsyncSession = Depends(get_db)):
    game = _get_game(code)
    await _maybe_auto_advance(game, db)
    participant = _get_participant(game, body.token)

    if game["status"] != "active" or body.question_index != game["current_question"]:
        raise HTTPException(status_code=400, detail="Этот вопрос уже закрыт")
    if body.question_index in participant["answers"]:
        raise HTTPException(status_code=400, detail="Вы уже отвечали на этот вопрос")

    q = game["questions"][body.question_index]
    correct = body.option == q["correct_index"]
    participant["answers"][body.question_index] = {"option": body.option, "correct": correct}
    if correct:
        participant["correct_count"] += 1

    _check_all_answered(game)
    _touch(game)
    return {"ok": True}
