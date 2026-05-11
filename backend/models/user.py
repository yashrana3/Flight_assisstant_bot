"""User-related models: User, TravelPreference, GuestPassengerProfile."""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Date, Text, ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import relationship

from database import BaseUser, BaseChat


class User(BaseUser):
    __tablename__ = "users"

    # Active user table uses snake_case columns and enum role/status.
    id = Column(Text, primary_key=True, default=lambda: str(uuid.uuid4()))
    clerk_id = Column("clerk_user_id", Text, unique=True, nullable=True)
    email = Column(Text, unique=True, nullable=False, index=True)
    first_name = Column(Text, nullable=True)
    last_name = Column(Text, nullable=True)
    full_name = Column(Text, nullable=True)
    image_url = Column(Text, nullable=True)
    phone = Column(Text, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(Text, nullable=True)
    nationality = Column(Text, nullable=True)
    address = Column(Text, nullable=True)
    role = Column(Text, nullable=True)
    status = Column(Text, nullable=True)
    last_sign_in_at = Column(TIMESTAMP, nullable=True)
    deleted_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    travel_preference = relationship("TravelPreference", back_populates="user", uselist=False, cascade="all, delete-orphan")
    trips = relationship("Trip", back_populates="user", cascade="all, delete-orphan")
    # Chat sessions live in Chat DB; no ORM relationship (link by user_id only)
    price_alerts = relationship("PriceAlert", back_populates="user", cascade="all, delete-orphan")
    settings = relationship("UserSettings", back_populates="user", uselist=False, cascade="all, delete-orphan")
    travel_stats = relationship("TravelStats", back_populates="user", uselist=False, cascade="all, delete-orphan")
    user_achievements = relationship("UserAchievement", back_populates="user", cascade="all, delete-orphan")


class TravelPreference(BaseUser):
    __tablename__ = "travel_preferences"

    id = Column(Text, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    preferred_airlines = Column(ARRAY(Text), nullable=True)
    flight_timing = Column(ARRAY(Text), nullable=True)
    seat_preference = Column(String(50), nullable=True)
    cabin_class = Column(String(50), nullable=True)
    travel_style = Column(String(50), nullable=True)
    layover_preference = Column(String(50), nullable=True)
    max_layover_time = Column(String(50), nullable=True)
    airport_preference = Column(ARRAY(Text), nullable=True)
    special_assistance = Column(Text, nullable=True)
    meal_preference = Column(String(50), nullable=True)
    extra_preferences = Column(JSONB, nullable=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="travel_preference")


class GuestPassengerProfile(BaseChat):
    """
    Lightweight passenger profile for guest users, linked to a chat session.
    Logged-in users use the main User / TravelPreference models instead.
    """

    __tablename__ = "guest_passenger_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, unique=True)

    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    nationality = Column(String(100), nullable=True)

    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)
