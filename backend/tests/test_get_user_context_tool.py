"""Unit tests for the get_user_context tool."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.tools.context import ToolExecutionContext
from services.tools.get_user_context import GetUserContextTool
from services.tools.result import ToolStatus


class FakeRepository:
    def __init__(
        self,
        user=None,
        guest_profile=None,
        trips=None,
        messages=None,
    ) -> None:
        self._user = user
        self._guest_profile = guest_profile
        self._trips = trips or []
        self._messages = messages or []

    def get_user_profile(self, user_id):
        return self._user

    def get_guest_profile(self, session_id):
        return self._guest_profile

    def get_recent_trips(self, user_id, limit):
        return self._trips[:limit]

    def get_recent_messages(self, user_id, session_id, limit):
        return self._messages[:limit]


class GetUserContextToolTests(unittest.TestCase):
    def test_returns_masked_profile_trip_and_chat_context(self) -> None:
        user = SimpleNamespace(
            id="user-1",
            first_name="Ava",
            last_name="Stone",
            full_name="Ava Stone",
            email="ava@example.com",
            phone="+911234567890",
            date_of_birth=date(1995, 5, 17),
            gender="Female",
            nationality="Indian",
            address="Mumbai",
            travel_preference=SimpleNamespace(
                seat_preference="Window",
                meal_preference="Vegetarian",
            ),
        )
        trip = SimpleNamespace(
            id="trip-1",
            origin="Mumbai",
            destination="Singapore",
            origin_code="BOM",
            destination_code="SIN",
            airline="Singapore Airlines",
            flight_number="SQ421",
            departure_date=datetime(2026, 6, 10, 9, 0, 0),
            arrival_date=datetime(2026, 6, 10, 17, 0, 0),
            status="CONFIRMED",
            cabin_class="Business",
            currency="USD",
            ticket_cost_minor=540000,
        )
        messages = [
            SimpleNamespace(
                role="user",
                content="Plan my Singapore trip with a premium hotel.",
                created_at=datetime(2026, 4, 13, 12, 0, 0),
            ),
            SimpleNamespace(
                role="assistant",
                content="I can help with flights, hotels, and a day-by-day itinerary.",
                created_at=datetime(2026, 4, 13, 12, 1, 0),
            ),
        ]

        tool = GetUserContextTool(
            repository=FakeRepository(user=user, trips=[trip], messages=messages)
        )
        result = tool.execute(
            {"user_id": "user-1", "session_id": "session-1"},
            ToolExecutionContext(user_id="user-1", session_id="session-1"),
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertEqual(result.data["profile"]["full_name"], "Ava Stone")
        self.assertIsNone(result.data["travel_documents"]["passport_number_masked"])
        self.assertIsNone(result.data["travel_documents"]["passport_expiry"])
        self.assertIsNone(result.data["travel_documents"]["tsa_number_masked"])
        self.assertEqual(len(result.data["recent_trips"]), 1)
        self.assertEqual(len(result.data["recent_chat_summary"]["recent_messages"]), 2)
        self.assertFalse(result.data["privacy"]["raw_passport_number_included"])

    def test_handles_missing_profile(self) -> None:
        tool = GetUserContextTool(repository=FakeRepository())
        result = tool.execute({}, ToolExecutionContext())

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertTrue(result.data["profile"]["is_guest"])
        self.assertEqual(result.data["recent_trips"], [])

    def test_uses_guest_profile_when_authenticated_user_is_missing(self) -> None:
        guest_profile = SimpleNamespace(
            full_name="Guest User",
            email="guest@example.com",
            phone=None,
            date_of_birth=None,
            nationality="Indian",
        )
        tool = GetUserContextTool(
            repository=FakeRepository(guest_profile=guest_profile)
        )
        result = tool.execute(
            {"session_id": "session-guest"},
            ToolExecutionContext(session_id="session-guest"),
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertEqual(result.data["profile"]["full_name"], "Guest User")
        self.assertIsNone(result.data["travel_documents"]["passport_number_masked"])


if __name__ == "__main__":
    unittest.main()
