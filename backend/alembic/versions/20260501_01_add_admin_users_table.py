"""add admin_users table

Revision ID: 20260501_01
Revises: 20260407_01
Create Date: 2026-05-01
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260501_01"
down_revision = "20260407_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_users (
          id TEXT PRIMARY KEY,
          username VARCHAR(80) NOT NULL UNIQUE,
          full_name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE,
          password_hash TEXT NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'super_admin',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          last_login_at TIMESTAMP NULL,
          session_token_hash TEXT NULL,
          session_expires_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_admin_users_username
        ON admin_users (username)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_admin_users_email
        ON admin_users (email)
        """
    )
    # Backfill for environments where admin_users already existed without the
    # newer session-tracking columns.
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
    op.execute("DROP TABLE IF EXISTS admin_users")
