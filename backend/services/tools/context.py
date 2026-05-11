"""Execution context passed to tools at runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session


@dataclass(slots=True)
class ToolExecutionContext:
    user_db: Session | None = None
    chat_db: Session | None = None
    user_id: str | None = None
    session_id: str | None = None
    request_id: str | None = None
    trace_metadata: dict[str, Any] = field(default_factory=dict)

