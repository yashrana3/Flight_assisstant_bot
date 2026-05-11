"""Admin user records stored in the user database."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String, Text

from database import BaseUser


class AdminUser(BaseUser):
    __tablename__ = "admin_users"

    id = Column(Text, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(80), nullable=False, unique=True, index=True)
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True, unique=True, index=True)
    password_hash = Column(Text, nullable=False)
    role = Column(String(50), nullable=False, default="super_admin")
    is_active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime, nullable=True)
    session_token_hash = Column(Text, nullable=True)
    session_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
