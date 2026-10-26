"""Отметки «прочитано» в диалоге педагог ↔ ученик: lesson_message_reads.

У каждого участника диалога (урок, ученик) своя отметка — до какого
сообщения он прочитал. Все уже существующие сообщения помечаются
прочитанными для ученика, основного педагога группы, педагога урока и
авторов сообщений — иначе после выкатки у всех появятся старые
«непрочитанные».

Revision ID: 0034_message_reads
Revises: 0033_scratch_account
Create Date: 2026-10-26 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0034_message_reads"
down_revision: Union[str, Sequence[str], None] = "0033_scratch_account"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lesson_message_reads",
        sa.Column("lesson_id", sa.Integer(), sa.ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("last_read_id", sa.Integer(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_lesson_message_reads_user_id", "lesson_message_reads", ["user_id"])
    op.execute("""
        INSERT INTO lesson_message_reads (lesson_id, student_id, user_id, last_read_id)
        SELECT d.lesson_id, d.student_id, u.user_id, d.max_id
        FROM (SELECT lesson_id, student_id, max(id) AS max_id
              FROM lesson_messages GROUP BY lesson_id, student_id) d
        JOIN lessons l ON l.id = d.lesson_id
        JOIN groups g ON g.id = l.group_id
        CROSS JOIN LATERAL (
            SELECT d.student_id UNION SELECT l.teacher_id UNION SELECT g.teacher_id
            UNION SELECT m.author_id FROM lesson_messages m
                  WHERE m.lesson_id = d.lesson_id AND m.student_id = d.student_id
        ) u(user_id)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.drop_index("ix_lesson_message_reads_user_id", table_name="lesson_message_reads")
    op.drop_table("lesson_message_reads")
