"""Async wrapper around the unified flight search domain engine."""

from __future__ import annotations

from pydantic import BaseModel, Field

from services.flight_search import UnifiedSearchParams, unified_flight_search_for_intent
from services.tools.async_base import AsyncBaseTool
from services.tools.context import ToolExecutionContext


class SearchFlightsInput(BaseModel):
    origin: str
    destination: str
    departure_date: str
    return_date: str | None = None
    passengers: int = Field(default=1, ge=1, le=9)
    currency: str | None = Field(
        default=None,
        description="ISO 4217 (e.g. USD). Omit to use departure-airport market currency.",
    )
    budget: float | None = None
    cabin_class: str | None = "economy"
    ranking_goal: str | None = None
    preferred_airlines: list[str] = Field(default_factory=list)
    excluded_airlines: list[str] = Field(default_factory=list)
    meal_preference: str | None = None
    seat_preference: str | None = None
    nonstop_only: bool = False
    baggage_required: bool = False
    refundable_only: bool = False
    max_layover_minutes: int | None = Field(
        default=None,
        ge=30,
        le=1440,
        description="Soft ranking cap on longest connection (minutes). Omit when not specified.",
    )
    user_lat: float | None = None
    user_lng: float | None = None
    airport_preferences: list[str] | None = Field(
        default=None,
        description='Optional IATA codes to narrow a multi-airport city (e.g. ["JFK"] for New York).',
    )
    # Number of flights to return in the compact display list.
    # Full fetched set is returned separately for follow-up reasoning.
    max_results: int = Field(default=5, ge=1, le=15)


class SearchFlightsTool(AsyncBaseTool[SearchFlightsInput]):
    name = "search_flights"
    description = "Search, normalize, enrich, and rank live flight results."
    input_model = SearchFlightsInput

    async def run(
        self,
        payload: SearchFlightsInput,
        context: ToolExecutionContext,
    ) -> dict:
        cur = (payload.currency or "").strip().upper() or None
        flights, search_info = await unified_flight_search_for_intent(
            origin_text=(payload.origin or "").strip(),
            dest_text=(payload.destination or "").strip(),
            airport_preferences=payload.airport_preferences,
            base=UnifiedSearchParams(
                origin=(payload.origin or "").strip(),
                destination=(payload.destination or "").strip(),
                depart_date=payload.departure_date,
                return_date=payload.return_date,
                passengers=payload.passengers,
                currency=cur,
                budget=payload.budget,
                cabin=payload.cabin_class,
                preference=payload.ranking_goal,
                preferred_airlines=payload.preferred_airlines,
                excluded_airlines=payload.excluded_airlines,
                meal_preference=payload.meal_preference,
                seat_preference=payload.seat_preference,
                nonstop_only=payload.nonstop_only,
                baggage_required=payload.baggage_required,
                refundable_only=payload.refundable_only,
                max_layover_minutes=payload.max_layover_minutes,
                user_lat=payload.user_lat,
                user_lng=payload.user_lng,
            ),
        )

        display = flights[: payload.max_results]
        resolved = (search_info or {}).get("currency") if isinstance(search_info, dict) else None
        return {
            # Keep full fetched records in context so follow-up prompts
            # (cheapest/expensive/latest/etc.) can reuse data without refetch.
            "flights": flights,
            "display_flights": display,
            "search_info": search_info,
            "search": {
                "origin": payload.origin,
                "destination": payload.destination,
                "departure_date": payload.departure_date,
                "return_date": payload.return_date,
                "passengers": payload.passengers,
                "currency": resolved or cur or "",
                "cabin_class": payload.cabin_class,
                "preferred_airlines": payload.preferred_airlines,
                "excluded_airlines": payload.excluded_airlines,
                "nonstop_only": payload.nonstop_only,
                "baggage_required": payload.baggage_required,
                "refundable_only": payload.refundable_only,
                "max_layover_minutes": payload.max_layover_minutes,
            },
        }
