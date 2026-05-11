"""Async weather tool."""

from __future__ import annotations

from typing import Awaitable, Callable

from pydantic import BaseModel

from services.tools.async_base import AsyncBaseTool
from services.tools.context import ToolExecutionContext
from services.weather import (
    get_weather,
    get_weather_advice,
    get_weather_range,
    get_weather_range_advice,
)


class GetWeatherInput(BaseModel):
    location: str
    start_date: str | None = None
    end_date: str | None = None


class GetWeatherTool(AsyncBaseTool[GetWeatherInput]):
    name = "get_weather"
    description = "Fetch weather data and travel advice for a destination."
    input_model = GetWeatherInput

    def __init__(
        self,
        *,
        weather_resolver: Callable[[str], Awaitable[dict | None]] = get_weather,
        range_resolver: Callable[[str, str, str], Awaitable[list[dict]]] = get_weather_range,
    ) -> None:
        self._weather_resolver = weather_resolver
        self._range_resolver = range_resolver

    async def run(
        self,
        payload: GetWeatherInput,
        context: ToolExecutionContext,
    ) -> dict:
        weather = await self._weather_resolver(payload.location)
        response = {
            "location": payload.location,
            "weather": weather,
            "weather_advice": get_weather_advice(weather),
        }
        if payload.start_date and payload.end_date:
            weather_range = await self._range_resolver(
                payload.location,
                payload.start_date,
                payload.end_date,
            )
            response["date_range"] = {
                "start_date": payload.start_date,
                "end_date": payload.end_date,
            }
            response["weather_range"] = weather_range
            response["weather_range_advice"] = get_weather_range_advice(weather_range)
        return response
