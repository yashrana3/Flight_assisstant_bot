"""Unit tests for weather tool date-range support."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.tools.context import ToolExecutionContext
from services.tools.result import ToolStatus
from services.tools.weather_info import GetWeatherTool


class WeatherToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_current_weather_response(self) -> None:
        async def fake_weather(location: str):
            self.assertEqual(location, "Singapore")
            return {
                "city": "Singapore",
                "temp": 30,
                "condition": "Clear",
                "description": "clear sky",
            }

        async def fake_range(location: str, start_date: str, end_date: str):
            return []

        tool = GetWeatherTool(weather_resolver=fake_weather, range_resolver=fake_range)
        result = await tool.execute_async(
            {"location": "Singapore"},
            ToolExecutionContext(),
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertIn("weather", result.data)
        self.assertNotIn("weather_range", result.data)

    async def test_date_range_weather_response(self) -> None:
        async def fake_weather(location: str):
            return {
                "city": location,
                "temp": 27,
                "condition": "Clouds",
                "description": "few clouds",
            }

        async def fake_range(location: str, start_date: str, end_date: str):
            self.assertEqual(start_date, "2026-06-01")
            self.assertEqual(end_date, "2026-06-03")
            return [
                {"date": "2026-06-01", "temp_min": 24, "temp_max": 30, "condition": "Clouds"},
                {"date": "2026-06-02", "temp_min": 25, "temp_max": 31, "condition": "Rain"},
            ]

        tool = GetWeatherTool(weather_resolver=fake_weather, range_resolver=fake_range)
        result = await tool.execute_async(
            {
                "location": "Bangkok",
                "start_date": "2026-06-01",
                "end_date": "2026-06-03",
            },
            ToolExecutionContext(),
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertEqual(result.data["date_range"]["start_date"], "2026-06-01")
        self.assertEqual(len(result.data["weather_range"]), 2)
        self.assertIn("weather_range_advice", result.data)


if __name__ == "__main__":
    unittest.main()
