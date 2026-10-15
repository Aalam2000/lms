"""Ученик без группы: курс, сектор и педагог, к которому его направили
(куратор добавляет ученика с курсом; педагог потом записывает его в группу).

Revision ID: 0026_student_course_teacher
Revises: 0025_teacher_days_off
Create Date: 2026-10-15 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0026_student_course_teacher"
down_revision: Union[str, Sequence[str], None] = "0025_teacher_days_off"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="SET NULL"), nullable=True))
    op.add_column("users", sa.Column("sector", sa.String(), nullable=True))
    op.add_column("users", sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_users_teacher_id", "users", ["teacher_id"])


def downgrade() -> None:
    op.drop_index("ix_users_teacher_id", table_name="users")
    op.drop_column("users", "teacher_id")
    op.drop_column("users", "sector")
    op.drop_column("users", "course_id")
