"""Выходные педагога — users.days_off (формат и правила — app/days_off.py).

Revision ID: 0025_teacher_days_off
Revises: 0024_lesson_work
Create Date: 2026-10-13 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0025_teacher_days_off"
down_revision: Union[str, Sequence[str], None] = "0024_lesson_work"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("days_off", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "days_off")
