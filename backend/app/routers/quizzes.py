from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Quiz, User
from ..schemas import QuizCreate, QuizOut
from ..dependencies import get_current_user, require_teacher
from ..usages import ensure_not_used
from .i18n import translator
import json
import os
import re
from pathlib import Path

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quizzes", tags=["quizzes"])


def _editable_quiz_query(quiz_id: int, current_user: User):
    """Квиз, который пользователь может менять: свой или любой — для admin
    (так же, как удаление ниже)."""
    query = select(Quiz).where(Quiz.id == quiz_id)
    if current_user.role != "admin":
        query = query.where(Quiz.created_by == current_user.id)
    return query

SOURCE_LANG = os.getenv("SOURCE_LANG", "ru")
TEMPLATE_DIR = Path(__file__).parent.parent.parent / "templates" / "quiz"

def render_translated_template(template_type: str, lang: str, data: dict) -> str:
    # Сначала читаем шаблон БЕЗ перевода
    template_path = TEMPLATE_DIR / f"{template_type}.html"
    if not template_path.exists():
        raise HTTPException(status_code=400, detail=f"Template {template_type} not found")

    with open(template_path, "r", encoding="utf-8") as f:
        template_content = f.read()

    # Сначала переводим уже готовый HTML (текст, атрибуты и содержимое
    # <script>, включая шаблонные строки вида `Вопрос ${i} / ${n}`)
    if lang != SOURCE_LANG:
        try:
            template_content = translator.apply_to_html(template_content, lang)
        except Exception as e:
            logger.warning("Ошибка перевода шаблона: %s", e)

    # Потом подставляем данные
    for key, value in data.items():
        template_content = template_content.replace(f"{{{{ {key} }}}}", str(value))


    return template_content

@router.get("/", response_model=list[QuizOut])
async def get_quizzes(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Quiz).where(Quiz.created_by == current_user.id))
    return result.scalars().all()

@router.post("/", response_model=QuizOut)
async def create_quiz(quiz_data: QuizCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    template_type = quiz_data.template_type or "flash"
    questions_dict = [q.model_dump() for q in quiz_data.questions]
    data = {
        "title": quiz_data.title,
        "topic": quiz_data.topic or "Викторина",
        "questions_count": len(questions_dict),
        "questions_json": json.dumps(questions_dict, ensure_ascii=False),
    }
    html = render_translated_template(template_type, quiz_data.lang, data)

    # live/sprint — содержимое вопросов не переводится, храним структурой
    # отдельно от html_content (который остаётся только переведённой
    # обёрткой-страницей, как у flash).
    questions_data = questions_dict if template_type != "flash" else None

    new_quiz = Quiz(
        title=quiz_data.title,
        topic=quiz_data.topic,
        type=template_type,
        template_type=template_type,
        html_content=html,
        html_translations={},
        questions_data=questions_data,
        created_by=current_user.id,
    )
    db.add(new_quiz)
    await db.commit()
    await db.refresh(new_quiz)
    return new_quiz

@router.put("/{quiz_id}", response_model=QuizOut)
async def update_quiz(quiz_id: int, quiz_data: QuizCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(_editable_quiz_query(quiz_id, current_user))
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    template_type = quiz_data.template_type or "flash"
    questions_dict = [q.model_dump() for q in quiz_data.questions]
    data = {
        "title": quiz_data.title,
        "topic": quiz_data.topic or "Викторина",
        "questions_count": len(questions_dict),
        "questions_json": json.dumps(questions_dict, ensure_ascii=False),
    }
    html = render_translated_template(template_type, quiz_data.lang, data)

    quiz.title = quiz_data.title
    quiz.topic = quiz_data.topic
    quiz.template_type = template_type
    quiz.type = template_type
    quiz.html_content = html
    quiz.html_translations = {}
    quiz.questions_data = questions_dict if template_type != "flash" else None

    await db.commit()
    await db.refresh(quiz)
    return quiz

@router.delete("/{quiz_id}")
async def delete_quiz(quiz_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Удалить может автор или admin — как у файлов/ссылок в общей «Базе
    # знаний» (раньше было строго "только автор", решение Андрея 2026-09-15).
    query = select(Quiz).where(Quiz.id == quiz_id)
    if current_user.role != "admin":
        query = query.where(Quiz.created_by == current_user.id)
    result = await db.execute(query)
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    await ensure_not_used(db, "quiz", quiz_id)

    await db.delete(quiz)
    await db.commit()
    return {"detail": "Deleted"}

@router.get("/{quiz_id}/html")
async def get_quiz_html(quiz_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_teacher)):
    # Открыть квиз может любой педагог или admin: квизы в Базе знаний общие,
    # их добавляют в свои уроки разные педагоги. Раньше открыть мог только
    # автор — остальные получали 404 «Quiz not found».
    result = await db.execute(select(Quiz).where(Quiz.id == quiz_id))
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return {"html": quiz.html_content}

# Изолированный просмотр квиза (routers/view.py) — вместо document.write в
# новой вкладке: квиз открывается по ссылке /view/<токен> с CSP sandbox.
# Права — как у /{quiz_id}/html.
@router.post("/{quiz_id}/view-link")
async def quiz_view_link(quiz_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_teacher)):
    from ..security import create_view_token

    exists = (await db.execute(select(Quiz.id).where(Quiz.id == quiz_id))).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return {"token": create_view_token("quiz", quiz_id)}

@router.get("/{quiz_id}/edit")
async def get_quiz_edit_data(quiz_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(_editable_quiz_query(quiz_id, current_user))
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    if quiz.questions_data is not None:
        # live/sprint — структура хранится напрямую, разбирать html не нужно
        questions = quiz.questions_data
    else:
        match = re.search(r'const QUESTIONS\s*=\s*(\[.*?\])\s*;', quiz.html_content, re.DOTALL)
        questions = []
        if match:
            try:
                questions = json.loads(match.group(1))
            except Exception:
                pass

    return {
        "id": quiz.id,
        "title": quiz.title,
        "topic": quiz.topic,
        "template_type": quiz.template_type,
        "questions": questions
    }