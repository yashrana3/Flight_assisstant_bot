"""Unit tests for convert_currency tool."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.tools.context import ToolExecutionContext
from services.tools.convert_currency import ConvertCurrencyTool
from services.tools.result import ToolStatus


class ConvertCurrencyToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_converts_single_and_multiple_amounts(self) -> None:
        async def fake_resolver(*, source_currency: str, target_currency: str):
            self.assertEqual(source_currency, "INR")
            self.assertEqual(target_currency, "USD")
            return {
                "rate": 0.012,
                "provider": "fake",
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "provider_timestamp": datetime.now(timezone.utc).isoformat(),
            }

        tool = ConvertCurrencyTool(rate_resolver=fake_resolver)
        result = await tool.execute_async(
            {
                "amount": 1000,
                "amounts": [2500, 5000],
                "source_currency": "INR",
                "target_currency": "USD",
            },
            ToolExecutionContext(),
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertEqual(result.data["converted_amount"], 12.0)
        self.assertEqual(result.data["converted_amounts"], [12.0, 30.0, 60.0])
        self.assertFalse(result.data["is_stale"])

    async def test_marks_stale_rate_based_on_threshold(self) -> None:
        old_timestamp = datetime.now(timezone.utc) - timedelta(minutes=400)

        async def fake_resolver(*, source_currency: str, target_currency: str):
            return {
                "rate": 1.5,
                "provider": "fake",
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "provider_timestamp": old_timestamp.isoformat(),
            }

        tool = ConvertCurrencyTool(rate_resolver=fake_resolver)
        result = await tool.execute_async(
            {
                "amount": 10,
                "source_currency": "USD",
                "target_currency": "CAD",
                "max_age_minutes": 60,
            },
            ToolExecutionContext(),
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertTrue(result.data["is_stale"])
        self.assertGreater(result.data["age_minutes"], 60)

    async def test_validation_fails_without_amounts(self) -> None:
        tool = ConvertCurrencyTool()
        result = await tool.execute_async(
            {
                "source_currency": "USD",
                "target_currency": "INR",
            },
            ToolExecutionContext(),
        )

        self.assertEqual(result.status, ToolStatus.ERROR)
        self.assertEqual(result.error.code, "validation_error")


if __name__ == "__main__":
    unittest.main()
