"""Repository-backed user context tool with privacy filtering."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.chat import ChatMessage
from models.trip import Trip
from models.user import GuestPassengerProfile, User
from services.sessions import to_session_user_uuid
from services.tools.base import BaseTool
from services.tools.context import ToolExecutionContext


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _safe_message_excerpt(value: str, limit: int = 180) -> str:
    text = " ".join((value or "").split()).strip()
    return text[:limit]


@dataclass(slots=True)
class UserContextRepository:
    user_db: Session | None
    chat_db: Session | None

    def get_user_profile(self, user_id: str | None) -> User | None:
        if not self.user_db or not user_id:
            return None
        return self.user_db.query(User).filter(User.id == user_id).first()

    def get_recent_trips(self, user_id: str | None, limit: int) -> list[Trip]:
        if not self.user_db or not user_id:
            return []
        return (
            self.user_db.query(Trip)
            .filter(Trip.user_id == user_id)
            .order_by(Trip.updated_at.desc())
            .limit(limit)
            .all()
        )

    def get_recent_messages(
        self,
        user_id: str | None,
        session_id: str | None,
        limit: int,
    ) -> list[ChatMessage]:
        if not self.chat_db:
            return []

        query = self.chat_db.query(ChatMessage).order_by(ChatMessage.created_at.desc())
        if session_id:
            try:
                query = query.filter(ChatMessage.session_id == uuid.UUID(str(session_id)))
            except ValueError:
                return []
        elif user_id:
            session_user_id = to_session_user_uuid(user_id)
            query = query.join(ChatMessage.session).filter_by(user_id=session_user_id)
        else:
            return []

        return list(reversed(query.limit(limit).all()))

    def get_guest_profile(self, session_id: str | None) -> GuestPassengerProfile | None:
        if not self.chat_db or not session_id:
            return None
        try:
            parsed = uuid.UUID(str(session_id))
        except ValueError:
            return None
        return (
            self.chat_db.query(GuestPassengerProfile)
            .filter(GuestPassengerProfile.session_id == parsed)
            .first()
        )


class GetUserContextInput(BaseModel):
    user_id: str | None = None
    session_id: str | None = None
    max_recent_messages: int = Field(default=6, ge=1, le=12)
    max_recent_trips: int = Field(default=3, ge=0, le=10)
    include_trip_history: bool = True


class GetUserContextTool(BaseTool[GetUserContextInput]):
    name = "get_user_context"
    description = "Read approved user, trip, and chat context for downstream planning."
    input_model = GetUserContextInput

    def __init__(self, repository: UserContextRepository | None = None) -> None:
        self._repository = repository

    def run(self, payload: GetUserContextInput, context: ToolExecutionContext) -> dict:
        repository = self._repository or UserContextRepository(
            user_db=context.user_db,
            chat_db=context.chat_db,
        )
        effective_user_id = payload.user_id or context.user_id
        effective_session_id = payload.session_id or context.session_id

        user = repository.get_user_profile(effective_user_id)
        guest_profile = None if user else repository.get_guest_profile(effective_session_id)
        recent_messages = repository.get_recent_messages(
            user_id=effective_user_id,
            session_id=effective_session_id,
            limit=payload.max_recent_messages,
        )
        recent_trips = (
            repository.get_recent_trips(effective_user_id, payload.max_recent_trips)
            if payload.include_trip_history
            else []
        )

        profile = {
            "user_id": effective_user_id,
            "is_guest": user is None,
            "first_name": getattr(user, "first_name", None) or None,
            "last_name": getattr(user, "last_name", None) or None,
            "full_name": getattr(user, "full_name", None) or getattr(guest_profile, "full_name", None),
            "email": getattr(user, "email", None) or getattr(guest_profile, "email", None),
            "phone": getattr(user, "phone", None) or getattr(guest_profile, "phone", None),
            "date_of_birth": (
                user.date_of_birth.isoformat() if getattr(user, "date_of_birth", None) else None
            ) or (
                guest_profile.date_of_birth.isoformat()
                if getattr(guest_profile, "date_of_birth", None)
                else None
            ),
            "gender": getattr(user, "gender", None),
            "nationality": getattr(user, "nationality", None) or getattr(guest_profile, "nationality", None),
            "address": getattr(user, "address", None),
        }

        travel_preferences = {
            "seat_preference": getattr(getattr(user, "travel_preference", None), "seat_preference", None),
            "meal_preference": getattr(getattr(user, "travel_preference", None), "meal_preference", None),
        }

        travel_documents = {
            "passport_number_masked": None,
            "passport_expiry": None,
            "tsa_number_masked": None,
        }

        trips = [
            {
                "trip_id": trip.id,
                "origin": trip.origin,
                "destination": trip.destination,
                "origin_code": trip.origin_code,
                "destination_code": trip.destination_code,
                "airline": trip.airline,
                "flight_number": trip.flight_number,
                "departure_at": _serialize_datetime(trip.departure_date),
                "arrival_at": _serialize_datetime(trip.arrival_date),
                "status": trip.status,
                "cabin_class": trip.cabin_class,
                "currency": trip.currency,
                "ticket_cost_minor": trip.ticket_cost_minor,
            }
            for trip in recent_trips
        ]

        conversation_summary = {
            "session_id": effective_session_id,
            "recent_messages": [
                {
                    "role": message.role,
                    "content": _safe_message_excerpt(message.content),
                    "created_at": _serialize_datetime(message.created_at),
                }
                for message in recent_messages
                if message.role in {"user", "assistant"}
            ],
        }

        return {
            "profile": profile,
            "travel_preferences": travel_preferences,
            "travel_documents": travel_documents,
            "recent_trips": trips,
            "recent_chat_summary": conversation_summary,
            "privacy": {
                "raw_passport_number_included": False,
                "raw_tsa_number_included": False,
                "approved_profile_fields_only": True,
            },
        }

