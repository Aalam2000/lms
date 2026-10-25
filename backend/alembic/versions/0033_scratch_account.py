"""Аккаунт ученика в классе Scratch: users.scratch_login, users.scratch_password.

Заполняются при выгрузке CSV для Scratch на странице группы.

Revision ID: 0033_scratch_account
Revises: 0032_jsonb
Create Date: 2026-10-25 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0033_scratch_account"
down_revision: Union[str, Sequence[str], None] = "0032_jsonb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("scratch_login", sa.String(), nullable=True))
    op.add_column("users", sa.Column("scratch_password", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "scratch_password")
    op.drop_column("users", "scratch_login")
