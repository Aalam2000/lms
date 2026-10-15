"""Кто создал урок — lessons.created_by: куратор переносит и открывает только
свои уроки. У уже существующих уроков пусто.

Revision ID: 0027_lesson_created_by
Revises: 0026_student_course_teacher
Create Date: 2026-10-15 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0027_lesson_created_by"
down_revision: Union[str, Sequence[str], None] = "0026_student_course_teacher"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lessons", sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("lessons", "created_by")
