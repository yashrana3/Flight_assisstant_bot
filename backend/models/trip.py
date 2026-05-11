"""Trip / booking model."""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, ForeignKey, TIMESTAMP, Integer
from sqlalchemy.orm import relationship

from database import BaseUser


class Trip(BaseUser):
    __tablename__ = "trips"

    # Trip table in the active user DB uses normalized snake_case fields.
    id = Column(Text, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    airline = Column("airline_name", Text, nullable=True)
    origin = Column("origin_label", Text, nullable=False)
    destination = Column("destination_label", Text, nullable=False)
    origin_code = Column(Text, nullable=True)
    destination_code = Column(Text, nullable=True)
    departure_date = Column("departure_at", TIMESTAMP, nullable=True)
    arrival_date = Column("arrival_at", TIMESTAMP, nullable=True)
    flight_number = Column(Text, nullable=True)
    duration = Column(String(20), nullable=True)
    status = Column(String(20), nullable=False, default="CONFIRMED")
    cabin_class = Column(String(50), nullable=True)
    booking_ref = Column("booking_reference", Text, nullable=True)
    confirmation_code = Column(String(50), nullable=True)
    ticket_number = Column(String(50), nullable=True)
    seat_number = Column(String(10), nullable=True)
    ticket_cost_minor = Column(Integer, nullable=True)
    currency = Column("currency_code", String(10), nullable=True, default="USD")
    flight_snapshot = Column(Text, nullable=True)
    last_synced_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def session_id(self):
        return None

    user = relationship("User", back_populates="trips")
