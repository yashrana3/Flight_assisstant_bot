"""Unit tests for nearby-airport exploration helpers."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.flight_search import (
    UnifiedSearchParams,
    _apply_airline_filters,
    _build_nearby_airport_candidates,
    _find_nearby_airport_options,
)


class FlightSearchNearbyTests(unittest.IsolatedAsyncioTestCase):
    def test_apply_airline_filters_include_exclude(self) -> None:
        flights = [
            {"airline": "IndiGo", "airline_code": "6E", "flight_number": "6E 203"},
            {"airline": "Air India", "airline_code": "AI", "flight_number": "AI 505"},
            {"airline": "Emirates", "airline_code": "EK", "flight_number": "EK 511"},
        ]

        included = _apply_airline_filters(flights, include=["air india", "ek"], exclude=[])
        self.assertEqual(len(included), 2)

        filtered = _apply_airline_filters(
            flights,
            include=["indigo", "air india", "emirates"],
            exclude=["indigo"],
        )
        self.assertEqual(len(filtered), 2)
        self.assertTrue(all(flight["airline"] != "IndiGo" for flight in filtered))

    def test_build_nearby_candidates_known_airport(self) -> None:
        candidates = _build_nearby_airport_candidates("DEL")
        self.assertIn("JAI", candidates)
        self.assertNotIn("DEL", candidates)

    async def test_find_nearby_options_collects_non_empty_routes(self) -> None:
        params = UnifiedSearchParams(
            origin="DEL",
            destination="BOM",
            depart_date="2026-07-10",
            return_date=None,
            passengers=1,
            budget=None,
            cabin="economy",
            currency=None,
        )

        async def fake_probe(*, params, origin_iata, destination_iata):  # type: ignore[no-redef]
            if origin_iata == "JAI" and destination_iata == "BOM":
                return {
                    "origin": origin_iata,
                    "destination": destination_iata,
                    "flight_count": 5,
                    "from_price": 7800,
                    "currency": "INR",
                }
            return None

        with patch("services.flight_search._probe_flights_for_route", side_effect=fake_probe):
            options = await _find_nearby_airport_options(params)

        self.assertEqual(len(options), 1)
        self.assertEqual(options[0]["origin"], "JAI")
        self.assertEqual(options[0]["destination"], "BOM")


if __name__ == "__main__":
    unittest.main()
