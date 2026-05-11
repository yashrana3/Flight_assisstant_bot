"""User feedback entries with chat and flight context."""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB

from database import BaseUser


class Feedback(BaseUser):
    __tablename__ = "feedback"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # Chat DB is separate; link by value only (no FK to chat_sessions)
    session_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    message = Column(Text, nullable=False)

    context_chat = Column(JSONB, nullable=True)
    context_flights = Column(JSONB, nullable=True)
    context_page = Column(JSONB, nullable=True)

    status = Column(String(20), nullable=False, default="new")  # new, in_review, resolved, dismissed

    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)

