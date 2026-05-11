"""Async tool for flight status lookups with cached provider results."""

from __future__ import annotations

from pydantic import BaseModel, Field

from services.flightaware_client import get_flight_status
from services.tools.async_base import AsyncBaseTool
from services.tools.context import ToolExecutionContext


class FlightStatusInput(BaseModel):
    flight_number: str = Field(min_length=2, max_length=16)


class FlightStatusTool(AsyncBaseTool[FlightStatusInput]):
    name = "flight_status"
    description = "Get live/cached status for a specific flight number."
    input_model = FlightStatusInput

    async def run(
        self,
        payload: FlightStatusInput,
        context: ToolExecutionContext,
    ) -> dict:
        status_text = await get_flight_status(payload.flight_number)
        return {
            "flight_number": payload.flight_number,
            "status_text": status_text,
        }
