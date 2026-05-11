"""Registry for deterministic tool instances."""

from __future__ import annotations

import asyncio
import inspect

from services.tools.context import ToolExecutionContext
from services.tools.result import ToolError, ToolResult, ToolStatus


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, object] = {}

    def register(self, tool: object) -> None:
        self._tools[tool.name] = tool

    def get(self, tool_name: str) -> object | None:
        return self._tools.get(tool_name)

    def execute(
        self,
        tool_name: str,
        payload: dict,
        context: ToolExecutionContext,
    ) -> ToolResult:
        tool = self.get(tool_name)
        if not tool:
            return ToolResult(
                tool_name=tool_name,
                status=ToolStatus.ERROR,
                error=ToolError(
                    code="tool_not_found",
                    message=f"Tool '{tool_name}' is not registered.",
                ),
            )
        execute = getattr(tool, "execute", None)
        if not execute:
            return ToolResult(
                tool_name=tool_name,
                status=ToolStatus.ERROR,
                error=ToolError(
                    code="tool_not_executable",
                    message=f"Tool '{tool_name}' does not expose a sync execute method.",
                ),
            )
        return execute(payload, context)

    async def execute_async(
        self,
        tool_name: str,
        payload: dict,
        context: ToolExecutionContext,
        *,
        timeout_seconds: float | None = None,
        max_retries: int = 0,
    ) -> ToolResult:
        tool = self.get(tool_name)
        if not tool:
            return ToolResult(
                tool_name=tool_name,
                status=ToolStatus.ERROR,
                error=ToolError(
                    code="tool_not_found",
                    message=f"Tool '{tool_name}' is not registered.",
                ),
            )

        execute_async = getattr(tool, "execute_async", None)
        execute_callable = execute_async or getattr(tool, "execute", None)
        if not execute_callable:
            return ToolResult(
                tool_name=tool_name,
                status=ToolStatus.ERROR,
                error=ToolError(
                    code="tool_not_executable",
                    message=f"Tool '{tool_name}' is not executable.",
                ),
            )

        attempts = max(max_retries, 0) + 1
        last_error: ToolError | None = None

        for _ in range(attempts):
            result = await self._execute_with_optional_timeout(
                tool_name=tool_name,
                execute_callable=execute_callable,
                payload=payload,
                context=context,
                timeout_seconds=timeout_seconds,
            )
            if result.status == ToolStatus.SUCCESS:
                return result
            if not result.error or not result.error.retryable:
                return result
            last_error = result.error

        return ToolResult(
            tool_name=tool_name,
            status=ToolStatus.ERROR,
            error=last_error
            or ToolError(
                code="tool_execution_error",
                message=f"Tool '{tool_name}' failed after retries.",
            ),
        )

    async def _execute_with_optional_timeout(
        self,
        *,
        tool_name: str,
        execute_callable: object,
        payload: dict,
        context: ToolExecutionContext,
        timeout_seconds: float | None,
    ) -> ToolResult:
        coroutine = self._call_tool_callable(execute_callable, payload, context)
        if timeout_seconds is None:
            return await coroutine
        try:
            return await asyncio.wait_for(coroutine, timeout=timeout_seconds)
        except asyncio.TimeoutError:
            return ToolResult(
                tool_name=tool_name,
                status=ToolStatus.ERROR,
                error=ToolError(
                    code="tool_timeout",
                    message=f"Tool '{tool_name}' timed out after {timeout_seconds:.2f}s.",
                    retryable=True,
                    details={"timeout_seconds": timeout_seconds},
                ),
            )

    async def _call_tool_callable(
        self,
        execute_callable: object,
        payload: dict,
        context: ToolExecutionContext,
    ) -> ToolResult:
        result = execute_callable(payload, context)
        if inspect.isawaitable(result):
            return await result
        return result
