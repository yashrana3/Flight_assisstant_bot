"""Base class for deterministic AI tools."""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from pydantic import BaseModel, ValidationError

from services.tools.context import ToolExecutionContext
from services.tools.result import ToolError, ToolResult, ToolStatus

logger = logging.getLogger(__name__)

InputModelT = TypeVar("InputModelT", bound=BaseModel)


class BaseTool(ABC, Generic[InputModelT]):
    name: str
    description: str
    input_model: type[InputModelT]

    def execute(self, payload: dict, context: ToolExecutionContext) -> ToolResult:
        started_at = time.perf_counter()
        try:
            validated = self.input_model(**payload)
        except ValidationError as exc:
            return ToolResult(
                tool_name=self.name,
                status=ToolStatus.ERROR,
                error=ToolError(
                    code="validation_error",
                    message="Tool input validation failed.",
                    details={"errors": exc.errors()},
                ),
                metadata=self._build_metadata(started_at, context),
            )

        try:
            data = self.run(validated, context)
            return ToolResult(
                tool_name=self.name,
                status=ToolStatus.SUCCESS,
                data=data,
                metadata=self._build_metadata(started_at, context),
            )
        except Exception as exc:  # pragma: no cover - defensive boundary
            logger.exception("Tool %s failed", self.name)
            return ToolResult(
                tool_name=self.name,
                status=ToolStatus.ERROR,
                error=ToolError(
                    code="tool_execution_error",
                    message=str(exc) or f"{self.name} failed.",
                    retryable=False,
                ),
                metadata=self._build_metadata(started_at, context),
            )

    @abstractmethod
    def run(self, payload: InputModelT, context: ToolExecutionContext) -> dict:
        """Run the tool against a validated payload."""

    def _build_metadata(
        self,
        started_at: float,
        context: ToolExecutionContext,
    ) -> dict[str, object]:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        metadata: dict[str, object] = {
            "duration_ms": duration_ms,
        }
        if context.request_id:
            metadata["request_id"] = context.request_id
        if context.trace_metadata:
            metadata["trace"] = context.trace_metadata
        return metadata

