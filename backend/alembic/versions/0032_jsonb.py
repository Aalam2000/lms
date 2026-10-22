"""JSON-поля → JSONB: users.days_off, users.ui_prefs,
quizzes.html_translations, quizzes.questions_data.

JSONB хранится разобранным (компактнее, быстрее читается, по нему можно
строить индексы). Порядок ключей внутри объекта JSONB не сохраняет.

Revision ID: 0032_jsonb
Revises: 0031_user_ui_prefs
Create Date: 2026-10-22 00:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0032_jsonb"
down_revision: Union[str, Sequence[str], None] = "0031_user_ui_prefs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    ("users", "days_off"),
    ("users", "ui_prefs"),
    ("quizzes", "html_translations"),
    ("quizzes", "questions_data"),
]


def upgrade() -> None:
    for table, column in COLUMNS:
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE jsonb USING "{column}"::jsonb')


def downgrade() -> None:
    for table, column in COLUMNS:
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE json USING "{column}"::json')
