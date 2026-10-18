"""Аудитория урока — lessons.room_id (пусто — аудитория не назначена).

Revision ID: 0030_lesson_room
Revises: 0029_rooms
Create Date: 2026-10-18 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0030_lesson_room"
down_revision: Union[str, Sequence[str], None] = "0029_rooms"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lessons", sa.Column("room_id", sa.Integer(), sa.ForeignKey("rooms.id"), nullable=True))
    op.create_index("ix_lessons_room_id", "lessons", ["room_id"])


def downgrade() -> None:
    op.drop_index("ix_lessons_room_id", table_name="lessons")
    op.drop_column("lessons", "room_id")
