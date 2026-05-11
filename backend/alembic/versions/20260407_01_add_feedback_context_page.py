"""add context_page column to feedback

Revision ID: 20260407_01
Revises:
Create Date: 2026-04-07
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260407_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('public.feedback') IS NOT NULL THEN
                ALTER TABLE feedback
                ADD COLUMN IF NOT EXISTS context_page JSONB;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('public.feedback') IS NOT NULL THEN
                ALTER TABLE feedback
                DROP COLUMN IF EXISTS context_page;
            END IF;
        END
        $$;
        """
    )

