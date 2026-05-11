"""User settings model — maps every toggle/dropdown on the Settings page."""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from database import BaseUser


class UserSettings(BaseUser):
    __tablename__ = "user_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Notifications & AI
    email_notif = Column(Boolean, default=True)
    price_alerts = Column(Boolean, default=True)
    sms_updates = Column(Boolean, default=False)
    push_notif = Column(Boolean, default=True)
    voice_input = Column(Boolean, default=True)
    notif_time = Column(String(20), default="morning")
    ai_style = Column(String(50), default="friendly")

    # Privacy & Security
    two_factor = Column(Boolean, default=False)

    # Language & Region
    language = Column(String(20), default="english")
    currency = Column(String(10), default="usd")
    date_format = Column(String(10), default="mdy")
    time_format = Column(String(5), default="12")

    # Display & Accessibility
    theme = Column(String(10), default="light")
    text_size = Column(String(10), default="medium")
    high_contrast = Column(Boolean, default=False)
    keyboard_nav = Column(Boolean, default=True)

    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="settings")
