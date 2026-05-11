"""Price alert model for the Deals / Smart Price Alerts page."""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, ForeignKey, TIMESTAMP, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from database import BaseUser


class PriceAlert(BaseUser):
    __tablename__ = "price_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    origin = Column(String(100), nullable=False)
    destination = Column(String(100), nullable=False)
    airline = Column(String(100), nullable=True)
    date_range = Column(String(50), nullable=True)
    current_price = Column(Numeric(12, 2), nullable=True)
    lowest_price = Column(Numeric(12, 2), nullable=True)
    currency = Column(String(10), nullable=True, default="USD")
    trend = Column(String(10), nullable=True)  # up, down
    change_pct = Column(String(10), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="price_alerts")
