"""Planner tests for grounded flight follow-up behavior."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.ai_planner import (
    _apply_airline_filters_to_recent,
    _build_search_payload,
    _extract_airline_filters_from_message,
    _extract_currency_code,
    _extract_iso_date_range,
    _normalize_recent_flight,
    _sort_flights_for_goal,
)


class AiPlannerTests(unittest.TestCase):
    def test_extract_airline_filters_from_message(self) -> None:
        flights = [
            {"airline": "IndiGo", "flight_number": "6E 201"},
            {"airline": "Air India", "flight_number": "AI 505"},
        ]
        parsed = _extract_airline_filters_from_message("exclude Indigo and show remaining", flights)
        self.assertEqual(parsed["exclude"], ["IndiGo"])

    def test_apply_airline_filters_to_recent(self) -> None:
        flights = [
            {"airline": "IndiGo", "flight_number": "6E 201"},
            {"airline": "Air India", "flight_number": "AI 505"},
            {"airline": "Emirates", "flight_number": "EK 512"},
        ]
        filtered = _apply_airline_filters_to_recent(
            flights,
            include=["Air India", "Emirates"],
            exclude=["Emirates"],
        )
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["airline"], "Air India")

    def test_build_search_payload_includes_excluded_airlines(self) -> None:
        payload = _build_search_payload(
            {
                "origin_iata": "DEL",
                "destination_iata": "BOM",
                "departure_date": "2026-08-01",
                "preferences": {
                    "preferred_airlines": ["AI"],
                    "excluded_airlines": ["6E"],
                },
            },
            None,
            None,
        )
        self.assertEqual(payload["preferred_airlines"], ["AI"])
        self.assertEqual(payload["excluded_airlines"], ["6E"])

    def test_extract_iso_date_range(self) -> None:
        self.assertEqual(
            _extract_iso_date_range("weather from 2026-05-01 to 2026-05-04"),
            ("2026-05-01", "2026-05-04"),
        )
        self.assertIsNone(_extract_iso_date_range("weather next week"))

    def test_extract_currency_code_supports_names_and_codes(self) -> None:
        self.assertEqual(_extract_currency_code("show prices in usd"), "USD")
        self.assertEqual(_extract_currency_code("convert to euros"), "EUR")
        self.assertEqual(_extract_currency_code("display in INR"), "INR")

    def test_cheapest_sort_uses_full_fetched_set(self) -> None:
        flights = [
            _normalize_recent_flight(
                {
                    "airline": "Airline A",
                    "flight_number": "AA101",
                    "price": 12000,
                    "currency": "USD",
                    "duration": "2h 10m",
                    "stops": 0,
                    "route": {"originCity": "Delhi", "destinationCity": "Mumbai"},
                }
            ),
            _normalize_recent_flight(
                {
                    "airline": "Airline B",
                    "flight_number": "BB202",
                    "price": 8900,
                    "currency": "USD",
                    "duration": "2h 30m",
                    "stops": 1,
                    "route": {"originCity": "Delhi", "destinationCity": "Mumbai"},
                }
            ),
            _normalize_recent_flight(
                {
                    "airline": "Airline C",
                    "flight_number": "CC303",
                    "price": 9800,
                    "currency": "USD",
                    "duration": "1h 55m",
                    "stops": 0,
                    "route": {"originCity": "Delhi", "destinationCity": "Mumbai"},
                }
            ),
        ]

        ranked = _sort_flights_for_goal(flights, "cheapest", "show me the cheapest one")

        self.assertEqual(ranked[0]["flight_number"], "BB202")
        self.assertEqual(ranked[1]["flight_number"], "CC303")

    def test_nonstop_filter_keeps_direct_options(self) -> None:
        flights = [
            _normalize_recent_flight(
                {
                    "airline": "Airline A",
                    "flight_number": "AA101",
                    "price": 12000,
                    "currency": "USD",
                    "duration": "2h 10m",
                    "stops": 1,
                    "route": {"originCity": "Delhi", "destinationCity": "Mumbai"},
                }
            ),
            _normalize_recent_flight(
                {
                    "airline": "Airline C",
                    "flight_number": "CC303",
                    "price": 12800,
                    "currency": "USD",
                    "duration": "1h 55m",
                    "stops": 0,
                    "route": {"originCity": "Delhi", "destinationCity": "Mumbai"},
                }
            ),
        ]

        ranked = _sort_flights_for_goal(flights, "nonstop", "show the best nonstop option")

        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0]["flight_number"], "CC303")

    def test_baggage_filter_prefers_baggage_included(self) -> None:
        flights = [
            _normalize_recent_flight(
                {
                    "airline": "Airline A",
                    "flight_number": "AA101",
                    "price": 10000,
                    "currency": "USD",
                    "duration": "2h 10m",
                    "stops": 0,
                    "hasBag": False,
                    "route": {"originCity": "Delhi", "destinationCity": "Mumbai"},
                }
            ),
            _normalize_recent_flight(
                {
                    "airline": "Airline B",
                    "flight_number": "BB202",
                    "price": 10500,
                    "currency": "USD",
                    "duration": "2h 20m",
                    "stops": 0,
                    "hasBag": True,
                    "route": {"originCity": "Delhi", "destinationCity": "Mumbai"},
                }
            ),
        ]

        ranked = _sort_flights_for_goal(flights, "best", "which option includes baggage")

        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0]["flight_number"], "BB202")


if __name__ == "__main__":
    unittest.main()
