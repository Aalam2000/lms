"""Аудитории — таблица rooms: номер аудитории и количество мест для учеников.

Revision ID: 0029_rooms
Revises: 0028_push_subscriptions
Create Date: 2026-10-18 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0029_rooms"
down_revision: Union[str, Sequence[str], None] = "0028_push_subscriptions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rooms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False, unique=True),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.CheckConstraint("number > 0", name="ck_rooms_number_positive"),
        sa.CheckConstraint("capacity > 0", name="ck_rooms_capacity_positive"),
    )


def downgrade() -> None:
    op.drop_table("rooms")
