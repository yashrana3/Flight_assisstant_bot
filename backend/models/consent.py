"""Consent records for passenger data scopes."""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, ForeignKey, TIMESTAMP, Text
from sqlalchemy.dialects.postgresql import UUID

from database import BaseUser


class ConsentRecord(BaseUser):
    __tablename__ = "consent_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # NOTE: users.id is TEXT in the real DB (Prisma-created). Keep FK types compatible.
    user_id = Column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    # Chat DB is separate; link by value only (no FK to chat_sessions)
    session_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    scope = Column(String(50), nullable=False)  # passenger_basic, passport, preferences
    granted = Column(Boolean, default=True, nullable=False)

    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    expires_at = Column(TIMESTAMP, nullable=True)

