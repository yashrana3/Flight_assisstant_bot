"""Unit tests for the shared tool runtime."""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import dataclass

from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.tools.async_base import AsyncBaseTool
from services.tools.base import BaseTool
from services.tools.context import ToolExecutionContext
from services.tools.registry import ToolRegistry
from services.tools.result import ToolStatus


class EchoInput(BaseModel):
    value: str


class EmptyInput(BaseModel):
    pass


class EchoTool(BaseTool[EchoInput]):
    name = "echo"
    description = "Echo the input payload."
    input_model = EchoInput

    def run(self, payload: EchoInput, context: ToolExecutionContext) -> dict:
        return {"value": payload.value, "request_id": context.request_id}


@dataclass
class RetryState:
    calls: int = 0


class SlowAsyncTool(AsyncBaseTool[EmptyInput]):
    name = "slow_async"
    description = "Sleeps longer than timeout."
    input_model = EmptyInput

    async def run(self, payload: EmptyInput, context: ToolExecutionContext) -> dict:
        import asyncio

        await asyncio.sleep(0.05)
        return {"ok": True}


class FlakyAsyncTool(AsyncBaseTool[EmptyInput]):
    name = "flaky_async"
    description = "Fails first call, succeeds second."
    input_model = EmptyInput

    def __init__(self, state: RetryState) -> None:
        self.state = state

    async def run(self, payload: EmptyInput, context: ToolExecutionContext) -> dict:
        self.state.calls += 1
        if self.state.calls == 1:
            raise RuntimeError("temporary issue")
        return {"ok": True, "attempts": self.state.calls}

    async def execute_async(self, payload: dict, context: ToolExecutionContext):
        result = await super().execute_async(payload, context)
        if result.status == ToolStatus.ERROR and result.error:
            result.error.retryable = True
        return result


class ToolRuntimeTests(unittest.TestCase):
    def test_registry_executes_registered_tool(self) -> None:
        registry = ToolRegistry()
        registry.register(EchoTool())

        result = registry.execute(
            "echo",
            {"value": "hello"},
            ToolExecutionContext(request_id="req-1"),
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertEqual(result.data["value"], "hello")
        self.assertEqual(result.data["request_id"], "req-1")

    def test_registry_returns_error_for_missing_tool(self) -> None:
        registry = ToolRegistry()
        result = registry.execute("missing", {}, ToolExecutionContext())

        self.assertEqual(result.status, ToolStatus.ERROR)
        self.assertEqual(result.error.code, "tool_not_found")

    def test_validation_error_is_structured(self) -> None:
        tool = EchoTool()
        result = tool.execute({}, ToolExecutionContext())

        self.assertEqual(result.status, ToolStatus.ERROR)
        self.assertEqual(result.error.code, "validation_error")


class ToolAsyncRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_timeout_returns_retryable_timeout_error(self) -> None:
        registry = ToolRegistry()
        registry.register(SlowAsyncTool())

        result = await registry.execute_async(
            "slow_async",
            {},
            ToolExecutionContext(request_id="req-async-1"),
            timeout_seconds=0.001,
        )

        self.assertEqual(result.status, ToolStatus.ERROR)
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error.code, "tool_timeout")
        self.assertTrue(result.error.retryable)

    async def test_async_retry_succeeds_for_retryable_error(self) -> None:
        registry = ToolRegistry()
        state = RetryState()
        registry.register(FlakyAsyncTool(state))

        result = await registry.execute_async(
            "flaky_async",
            {},
            ToolExecutionContext(request_id="req-async-2"),
            max_retries=1,
        )

        self.assertEqual(result.status, ToolStatus.SUCCESS)
        self.assertEqual(result.data.get("attempts"), 2)


if __name__ == "__main__":
    unittest.main()
