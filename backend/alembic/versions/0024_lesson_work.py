"""Работа на уроке и заметки для себя.

- lesson_work_files — файлы, которые ученик сдаёт на уроке;
- lesson_marks.work_reviewed_at / work_reviewed_by — работа проверена
  (принята или оценена оценкой за урок);
- lessons.private_note — «Заметки для себя» (только педагог и админ).

Revision ID: 0024_lesson_work
Revises: 0023_parent_links
Create Date: 2026-10-12 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0024_lesson_work"
down_revision: Union[str, Sequence[str], None] = "0023_parent_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lesson_work_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("lesson_id", sa.Integer(), sa.ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("object_key", sa.String(), nullable=False),
        sa.Column("original_filename", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("object_key", name="uq_lesson_work_files_object_key"),
    )
    op.create_index("ix_lesson_work_files_lesson_student", "lesson_work_files", ["lesson_id", "student_id"])
    op.add_column("lesson_marks", sa.Column("work_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("lesson_marks", sa.Column(
        "work_reviewed_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_lesson_marks_work_reviewed_by"), nullable=True,
    ))
    op.add_column("lessons", sa.Column("private_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("lessons", "private_note")
    op.drop_constraint("fk_lesson_marks_work_reviewed_by", "lesson_marks", type_="foreignkey")
    op.drop_column("lesson_marks", "work_reviewed_by")
    op.drop_column("lesson_marks", "work_reviewed_at")
    op.drop_index("ix_lesson_work_files_lesson_student", table_name="lesson_work_files")
    op.drop_table("lesson_work_files")
