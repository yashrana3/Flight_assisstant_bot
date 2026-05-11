"""Async map and airport-access tool."""

from __future__ import annotations

from pydantic import BaseModel

from services.maps import (
    get_airport_convenience,
    get_airport_name,
    get_destination_map_url,
)
from services.tools.async_base import AsyncBaseTool
from services.tools.context import ToolExecutionContext


class GetMapInfoInput(BaseModel):
    origin_iata: str | None = None
    destination_iata: str | None = None
    user_lat: float | None = None
    user_lng: float | None = None


class GetMapInfoTool(AsyncBaseTool[GetMapInfoInput]):
    name = "get_map_info"
    description = "Fetch airport convenience and map context for a trip."
    input_model = GetMapInfoInput

    async def run(
        self,
        payload: GetMapInfoInput,
        context: ToolExecutionContext,
    ) -> dict:
        convenience = None
        if payload.origin_iata and payload.user_lat is not None and payload.user_lng is not None:
            convenience = await get_airport_convenience(
                payload.origin_iata,
                payload.user_lat,
                payload.user_lng,
            )

        destination_map_url = (
            get_destination_map_url(payload.destination_iata)
            if payload.destination_iata
            else ""
        )

        return {
            "origin_iata": payload.origin_iata,
            "destination_iata": payload.destination_iata,
            "origin_airport": get_airport_name(payload.origin_iata) if payload.origin_iata else None,
            "destination_airport": get_airport_name(payload.destination_iata) if payload.destination_iata else None,
            "airport_convenience": convenience,
            "destination_map_url": destination_map_url,
        }
