"""backfill admin_users session columns

Revision ID: 20260501_02
Revises: 20260501_01
Create Date: 2026-05-01
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260501_02"
down_revision = "20260501_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL
        """
    )
    op.execute(
        """
        ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS session_token_hash TEXT NULL
        """
    )
    op.execute(
        """
        ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMP NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE admin_users
        DROP COLUMN IF EXISTS session_expires_at
        """
    )
    op.execute(
        """
        ALTER TABLE admin_users
        DROP COLUMN IF EXISTS session_token_hash
        """
    )
    op.execute(
        """
        ALTER TABLE admin_users
        DROP COLUMN IF EXISTS last_login_at
        """
    )
