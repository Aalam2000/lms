"""Настройки пользователя — users.ui_prefs (JSON «ключ → значение»):
вид страниц, фильтры, папка Базы знаний, язык интерфейса.

Revision ID: 0031_user_ui_prefs
Revises: 0030_lesson_room
Create Date: 2026-10-21 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0031_user_ui_prefs"
down_revision: Union[str, Sequence[str], None] = "0030_lesson_room"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ui_prefs", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "ui_prefs")
