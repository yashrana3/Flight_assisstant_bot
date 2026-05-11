"""Tool-first AI planning and grounded response orchestration."""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from services.flight_ai import (
    get_iata,
    parse_flight_search_intent,
    present_flight_results,
    should_attempt_flight_search,
    _STRESS_COMFORT_RE,
)
from models.user import TravelPreference
from services.tools import ToolExecutionContext, ToolRegistry
from services.tools.convert_currency import ConvertCurrencyTool
from services.tools.flight_status import FlightStatusTool
from services.tools.get_user_context import GetUserContextTool
from services.tools.map_info import GetMapInfoTool
from services.tools.search_flights import SearchFlightsTool
from services.tools.weather_info import GetWeatherTool
from services.weather import get_city_name

GROUNDED_CHAT_MODEL = os.getenv("OPENAI_GROUNDED_CHAT_MODEL", os.getenv("OPENAI_CHAT_MODEL", "gpt-4o"))
_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if os.getenv("OPENAI_API_KEY") else None
DEFAULT_TOOL_TIMEOUT_SECONDS = float(os.getenv("TOOL_TIMEOUT_SECONDS", "12"))
DEFAULT_TOOL_RETRIES = int(os.getenv("TOOL_MAX_RETRIES", "1"))

_CHEAPEST_RE = re.compile(r"\b(cheapest|lowest fare|lowest price|budget|most affordable)\b", re.IGNORECASE)
_FASTEST_RE = re.compile(r"\b(fastest|quickest|shortest)\b", re.IGNORECASE)
_BEST_RE = re.compile(r"\b(best|top|recommended|overall)\b", re.IGNORECASE)
_NONSTOP_RE = re.compile(r"\b(nonstop|non-stop|direct)\b", re.IGNORECASE)
_BAGGAGE_RE = re.compile(r"\b(bag|bags|baggage|luggage)\b", re.IGNORECASE)
_MEAL_RE = re.compile(r"\b(meal|food|snack)\b", re.IGNORECASE)
_WIFI_RE = re.compile(r"\b(wifi|wi-fi|internet)\b", re.IGNORECASE)
_WEATHER_RE = re.compile(r"\b(weather|temperature|forecast|rain|snow|humid|sunny)\b", re.IGNORECASE)
_MAP_RE = re.compile(r"\b(map|directions|airport access|how far|travel time|leave for the airport)\b", re.IGNORECASE)
_FLIGHT_STATUS_RE = re.compile(r"\b(flight status|status of|track flight|is .* on time|delayed|arrived)\b", re.IGNORECASE)
_FLIGHT_NUMBER_RE = re.compile(r"\b([A-Z]{2,3}\s?\d{1,4})\b", re.IGNORECASE)
_COMPARE_RE = re.compile(r"\b(compare|difference|vs|versus)\b", re.IGNORECASE)
_CURRENCY_RE = re.compile(r"\b(convert|conversion|in|into|price in|show in|currency)\b", re.IGNORECASE)
_INCLUDE_AIRLINE_RE = re.compile(r"\b(only|just|with|include|including|prefer)\b", re.IGNORECASE)
_EXCLUDE_AIRLINE_RE = re.compile(r"\b(without|exclude|excluding|except|remove)\b", re.IGNORECASE)
_DATE_RANGE_ISO_RE = re.compile(
    r"\b(\d{4}-\d{2}-\d{2})\b(?:\s*(?:to|through|until|-)\s*)\b(\d{4}-\d{2}-\d{2})\b",
    re.IGNORECASE,
)
_ORDINAL_MAP = {
    "first": 0,
    "1st": 0,
    "option 1": 0,
    "flight 1": 0,
    "second": 1,
    "2nd": 1,
    "option 2": 1,
    "flight 2": 1,
    "third": 2,
    "3rd": 2,
    "option 3": 2,
    "flight 3": 2,
    "fourth": 3,
    "4th": 3,
    "option 4": 3,
    "flight 4": 3,
    "fifth": 4,
    "5th": 4,
    "option 5": 4,
    "flight 5": 4,
}
_CURRENCY_NAME_TO_CODE = {
    "inr": "INR",
    "rupee": "INR",
    "rupees": "INR",
    "usd": "USD",
    "dollar": "USD",
    "dollars": "USD",
    "eur": "EUR",
    "euro": "EUR",
    "euros": "EUR",
    "gbp": "GBP",
    "pound": "GBP",
    "pounds": "GBP",
    "aed": "AED",
    "dirham": "AED",
    "dirhams": "AED",
    "sgd": "SGD",
    "cad": "CAD",
    "aud": "AUD",
    "jpy": "JPY",
    "yen": "JPY",
}


def _message_mentions_cabin_preference(message: str) -> bool:
    normalized = (message or "").lower()
    return any(
        term in normalized
        for term in (
            "economy",
            "premium economy",
            "premium-economy",
            "business",
            "first class",
            "first-class",
            "first",
        )
    )


def _message_mentions_layover_preference(message: str) -> bool:
    normalized = (message or "").lower()
    return any(
        term in normalized
        for term in (
            "nonstop",
            "non-stop",
            "direct flight",
            "direct flights",
            "1 stop",
            "one stop",
            "2 stops",
            "two stops",
            "layover",
        )
    )


def _load_travel_preference(db: Session | None, user_id: str | None) -> TravelPreference | None:
    if not db or not user_id:
        return None
    try:
        return (
            db.query(TravelPreference)
            .filter(TravelPreference.user_id == user_id)
            .order_by(TravelPreference.updated_at.desc())
            .first()
        )
    except Exception:
        return None


def _apply_profile_preferences_to_search(
    search: Dict[str, Any],
    travel_preference: TravelPreference | None,
    message: str,
) -> Dict[str, Any]:
    if not travel_preference:
        return search

    preferences = search.setdefault("preferences", {})
    constraints = search.setdefault("constraints", {})
    saved_cabin = (getattr(travel_preference, "cabin_class", None) or "").strip().lower()
    preferred_airlines = getattr(travel_preference, "preferred_airlines", None) or []
    airport_preference = getattr(travel_preference, "airport_preference", None) or []
    layover_preference = (getattr(travel_preference, "layover_preference", None) or "").strip()
    flight_timing = getattr(travel_preference, "flight_timing", None) or []
    travel_style = (getattr(travel_preference, "travel_style", None) or "").strip()
    meal_preference = (getattr(travel_preference, "meal_preference", None) or "").strip()
    seat_preference = (getattr(travel_preference, "seat_preference", None) or "").strip()

    if not _message_mentions_cabin_preference(message):
        cabin_map = {
            "economy": "economy",
            "premium economy": "premium economy",
            "business": "business",
            "first": "first",
        }
        if saved_cabin in cabin_map:
            search["cabin_class"] = cabin_map[saved_cabin]

    if not preferences.get("preferred_airlines") and preferred_airlines:
        preferences["preferred_airlines"] = preferred_airlines

    if not preferences.get("airport_preference") and airport_preference:
        preferences["airport_preference"] = airport_preference

    if (
        not constraints.get("nonstop_only")
        and not _message_mentions_layover_preference(message)
        and not _STRESS_COMFORT_RE.search(message or "")
    ):
        if layover_preference == "Direct flights only":
            constraints["nonstop_only"] = True

    if not preferences.get("time_window") and flight_timing:
        preferences["time_window"] = ", ".join(flight_timing)

    if not preferences.get("meal_preference") and meal_preference:
        preferences["meal_preference"] = meal_preference

    if not preferences.get("seat_preference") and seat_preference:
        preferences["seat_preference"] = seat_preference

    if not preferences.get("ranking_goal"):
        if travel_style == "Budget Optimized":
            preferences["ranking_goal"] = "cheapest"
        elif travel_style == "Comfort Optimized":
            preferences["ranking_goal"] = "best_overall"

    return search


def _build_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(GetUserContextTool())
    registry.register(SearchFlightsTool())
    registry.register(GetWeatherTool())
    registry.register(GetMapInfoTool())
    registry.register(ConvertCurrencyTool())
    registry.register(FlightStatusTool())
    return registry


def _context_with_trace(
    context: ToolExecutionContext,
    planned_tools: List[str],
) -> ToolExecutionContext:
    return ToolExecutionContext(
        user_db=context.user_db,
        chat_db=context.chat_db,
        user_id=context.user_id,
        session_id=context.session_id,
        request_id=context.request_id,
        trace_metadata=_build_planner_trace(planned_tools),
    )


def _safe_price(flight: Dict[str, Any]) -> float:
    fare_total = ((flight.get("fare") or {}).get("total"))
    for candidate in (fare_total, flight.get("price"), flight.get("verifiedPrice")):
        try:
            if candidate is not None:
                return float(candidate)
        except (TypeError, ValueError):
            continue
    return float("inf")


def _parse_duration_minutes(value: Any) -> float:
    raw = str(value or "").lower()
    hour_match = re.search(r"(\d+)\s*h", raw)
    minute_match = re.search(r"(\d+)\s*m", raw)
    if hour_match or minute_match:
        hours = int(hour_match.group(1)) if hour_match else 0
        minutes = int(minute_match.group(1)) if minute_match else 0
        return float(hours * 60 + minutes)
    numeric = re.search(r"\b(\d+)\b", raw)
    return float(numeric.group(1)) if numeric else float("inf")


def _normalize_recent_flight(flight: Dict[str, Any]) -> Dict[str, Any]:
    route = flight.get("route") or {}
    baggage = flight.get("baggage") or {}
    operations = flight.get("operations") or {}
    convenience = flight.get("convenience") or {}
    pricing = flight.get("pricing") or {}
    comparison = flight.get("comparison") or {}

    return {
        **flight,
        "flight_id": flight.get("flight_id") or flight.get("id") or flight.get("flightId"),
        "airline": flight.get("airline") or "",
        "flight_number": flight.get("flight_number") or flight.get("flightNumber"),
        "price": _safe_price(flight),
        "currency": ((flight.get("fare") or {}).get("currency") or flight.get("currency") or "USD").upper(),
        "duration": flight.get("duration") or "",
        "stops": int(flight.get("stops") or 0),
        "departure_time": flight.get("departure_time") or flight.get("departTime") or "",
        "arrival_time": flight.get("arrival_time") or flight.get("arriveTime") or "",
        "departure_at": flight.get("departure_at") or flight.get("departureAt"),
        "arrival_at": flight.get("arrival_at") or flight.get("arrivalAt"),
        "route": {
            "originIata": route.get("originIata") or flight.get("from") or flight.get("from_iata"),
            "destinationIata": route.get("destinationIata") or flight.get("to") or flight.get("to_iata"),
            "originCity": route.get("originCity") or flight.get("fromCity") or flight.get("from"),
            "destinationCity": route.get("destinationCity") or flight.get("toCity") or flight.get("to"),
        },
        "baggage": {
            "included": baggage.get("included", flight.get("hasBag")),
            "checked": baggage.get("checked") or flight.get("baggageChecked") or flight.get("baggage_text"),
            "cabin": baggage.get("cabin") or flight.get("baggageCabin"),
        },
        "meal_services": flight.get("meal_services") or flight.get("mealServices") or [],
        "perks": flight.get("perks") or [],
        "operations": {
            "reliabilityScore": operations.get("reliabilityScore") or flight.get("reliabilityScore"),
            "aircraft": operations.get("aircraft") or flight.get("aircraft"),
            "operator": operations.get("operator") or flight.get("operator"),
            "status": operations.get("status") or flight.get("status"),
        },
        "convenience": {
            "airportName": convenience.get("airportName"),
            "distanceKm": convenience.get("distanceKm"),
            "travelMinutes": convenience.get("travelMinutes"),
        },
        "pricing": {
            "source": pricing.get("source") or flight.get("pricingSource"),
            "kind": pricing.get("kind") or flight.get("pricingKind"),
            "lastCheckedAt": pricing.get("lastCheckedAt") or flight.get("searchCheckedAt"),
        },
        "comparison": comparison,
        "booking": flight.get("booking") or {"deepLinks": flight.get("bookingLinks") or {}},
        "ranking": flight.get("ranking") or {},
    }


def _extract_goal(message: str) -> str:
    if _CHEAPEST_RE.search(message):
        return "cheapest"
    if _FASTEST_RE.search(message):
        return "fastest"
    if _NONSTOP_RE.search(message):
        return "nonstop"
    if _BEST_RE.search(message):
        return "best"
    return "best"


def _sort_flights_for_goal(
    flights: List[Dict[str, Any]],
    goal: str,
    message: str,
) -> List[Dict[str, Any]]:
    filtered = list(flights)
    lowered = (message or "").lower()

    if _NONSTOP_RE.search(lowered):
        nonstop = [flight for flight in filtered if int(flight.get("stops") or 0) == 0]
        if nonstop:
            filtered = nonstop

    if _BAGGAGE_RE.search(lowered):
        baggage = [flight for flight in filtered if (flight.get("baggage") or {}).get("included")]
        if baggage:
            filtered = baggage

    if _MEAL_RE.search(lowered):
        meal = [
            flight for flight in filtered
            if flight.get("meal_services") or "Free meal" in (flight.get("perks") or [])
        ]
        if meal:
            filtered = meal

    if _WIFI_RE.search(lowered):
        wifi = [
            flight for flight in filtered
            if "Wi-Fi" in (flight.get("perks") or []) or "wifi" in " ".join(flight.get("perks") or []).lower()
        ]
        if wifi:
            filtered = wifi

    if goal == "cheapest":
        return sorted(filtered, key=_safe_price)
    if goal == "fastest":
        return sorted(filtered, key=lambda flight: _parse_duration_minutes(flight.get("duration")))
    if goal == "nonstop":
        return sorted(filtered, key=lambda flight: (int(flight.get("stops") or 0), _safe_price(flight)))
    return filtered


def _extract_selected_indices(message: str) -> List[int]:
    lowered = (message or "").lower()
    found: List[int] = []
    for phrase, index in _ORDINAL_MAP.items():
        if phrase in lowered and index not in found:
            found.append(index)
    digits = re.findall(r"\b([1-5])\b", lowered)
    for digit in digits:
        index = int(digit) - 1
        if index not in found:
            found.append(index)
    return found[:2]


def _build_search_payload(search: Dict[str, Any], user_lat: float | None, user_lng: float | None) -> Dict[str, Any]:
    raw_cur = search.get("currency")
    currency_payload = raw_cur.strip().upper() if isinstance(raw_cur, str) and raw_cur.strip() else None
    return {
        "origin": search.get("origin") or search.get("origin_iata") or "",
        "destination": search.get("destination") or search.get("destination_iata") or "",
        "departure_date": search.get("departure_date") or "",
        "return_date": search.get("return_date"),
        "passengers": int(search.get("passenger_count") or search.get("adults") or 1),
        "currency": currency_payload,
        "airport_preferences": ((search.get("preferences") or {}).get("airport_preference") or None),
        "budget": search.get("budget"),
        "cabin_class": (search.get("cabin_class") or "economy").lower(),
        "ranking_goal": ((search.get("preferences") or {}).get("ranking_goal")),
        "preferred_airlines": ((search.get("preferences") or {}).get("preferred_airlines") or []),
        "excluded_airlines": ((search.get("preferences") or {}).get("excluded_airlines") or []),
        "meal_preference": ((search.get("preferences") or {}).get("meal_preference")),
        "seat_preference": ((search.get("preferences") or {}).get("seat_preference")),
        "nonstop_only": bool((search.get("constraints") or {}).get("nonstop_only")),
        "baggage_required": bool((search.get("constraints") or {}).get("baggage_required")),
        "refundable_only": bool((search.get("constraints") or {}).get("refundable_only")),
        "max_layover_minutes": (search.get("constraints") or {}).get("max_layover_minutes"),
        "user_lat": user_lat,
        "user_lng": user_lng,
        "max_results": 10,
    }


def _extract_currency_code(message: str) -> str | None:
    lowered = (message or "").lower()
    for token, code in _CURRENCY_NAME_TO_CODE.items():
        if re.search(rf"\b{re.escape(token)}\b", lowered):
            return code
    return None


def _extract_iso_date_range(message: str) -> tuple[str, str] | None:
    match = _DATE_RANGE_ISO_RE.search(message or "")
    if not match:
        return None
    return match.group(1), match.group(2)


def _airline_tokens(flight: Dict[str, Any]) -> List[str]:
    airline = str(flight.get("airline") or "").strip().lower()
    code = str(flight.get("airline_code") or "").strip().lower()
    flight_number = str(flight.get("flight_number") or "").strip().lower()
    prefix = flight_number.split(" ", 1)[0] if flight_number else ""
    return [token for token in (airline, code, prefix) if token]


def _matches_airline_term(flight: Dict[str, Any], term: str) -> bool:
    needle = (term or "").strip().lower()
    if not needle:
        return False
    return any(needle in token or token in needle for token in _airline_tokens(flight))


def _extract_airline_filters_from_message(message: str, flights: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    lowered = (message or "").lower()
    discovered_names = sorted(
        {
            str(flight.get("airline") or "").strip()
            for flight in flights
            if str(flight.get("airline") or "").strip()
        },
        key=len,
        reverse=True,
    )
    mentioned = [
        name for name in discovered_names
        if re.search(rf"\b{re.escape(name.lower())}\b", lowered)
    ]
    if not mentioned:
        return {"include": [], "exclude": []}
    include = mentioned if _INCLUDE_AIRLINE_RE.search(lowered) else []
    exclude = mentioned if _EXCLUDE_AIRLINE_RE.search(lowered) else []
    if not include and not exclude and re.search(r"\bonly\b", lowered):
        include = mentioned
    return {"include": include, "exclude": exclude}


def _apply_airline_filters_to_recent(
    flights: List[Dict[str, Any]],
    *,
    include: List[str],
    exclude: List[str],
) -> List[Dict[str, Any]]:
    filtered = list(flights)
    if include:
        filtered = [
            flight for flight in filtered
            if any(_matches_airline_term(flight, term) for term in include)
        ]
    if exclude:
        filtered = [
            flight for flight in filtered
            if not any(_matches_airline_term(flight, term) for term in exclude)
        ]
    return filtered


def _build_ranked_summary_text(
    flights: List[Dict[str, Any]],
    goal: str,
    origin: str,
    destination: str,
) -> str:
    if not flights:
        return "I couldn't find a matching option in the fetched results."
    lead = flights[0]
    goal_label = {
        "cheapest": "cheapest",
        "fastest": "fastest",
        "nonstop": "best nonstop",
        "best": "best-ranked",
    }.get(goal, "best-ranked")
    return (
        f"Using the full fetched result set, here are the top {min(len(flights), 5)} {goal_label} flights "
        f"for {origin} to {destination}. The leading option is {lead.get('airline') or 'the first result'} "
        f"{lead.get('flight_number') or ''} at {int(_safe_price(lead)) if _safe_price(lead) != float('inf') else 'N/A'} "
        f"{lead.get('currency') or 'USD'}."
    ).strip()


def _build_compare_text(flights: List[Dict[str, Any]], indices: List[int]) -> str:
    chosen = [flights[index] for index in indices if 0 <= index < len(flights)]
    if len(chosen) < 2:
        return ""
    first, second = chosen[0], chosen[1]
    return (
        f"Option {indices[0] + 1} is {first.get('airline')} {first.get('flight_number') or ''} at "
        f"{int(_safe_price(first)) if _safe_price(first) != float('inf') else 'N/A'} {first.get('currency') or 'USD'}, "
        f"{first.get('duration') or 'duration unavailable'}, with {first.get('stops', 0)} stop(s). "
        f"Option {indices[1] + 1} is {second.get('airline')} {second.get('flight_number') or ''} at "
        f"{int(_safe_price(second)) if _safe_price(second) != float('inf') else 'N/A'} {second.get('currency') or 'USD'}, "
        f"{second.get('duration') or 'duration unavailable'}, with {second.get('stops', 0)} stop(s)."
    )


def _build_conversion_text(
    source_currency: str,
    target_currency: str,
    rate: float,
    converted_count: int,
    stale: bool,
) -> str:
    stale_note = " (rate may be stale)" if stale else ""
    return (
        f"Converted {converted_count} flight prices from {source_currency} to {target_currency} "
        f"at {rate:.4f}{stale_note}. I kept original fares too."
    )


def _build_grounded_messages(
    message: str,
    flights: List[Dict[str, Any]],
    weather: Dict[str, Any] | None,
    map_info: Dict[str, Any] | None,
) -> list[dict[str, str]]:
    context_lines = [
        "Answer only from the provided tool results.",
        "If a detail is missing from the tool results, say that directly and do not invent it.",
        "Keep the answer concise and practical.",
        f"Flights context: {flights}",
        f"Weather context: {weather or {}}",
        f"Map context: {map_info or {}}",
    ]
    return [
        {"role": "system", "content": "\n".join(context_lines)},
        {"role": "user", "content": message},
    ]


def _grounded_flights_reply(
    message: str,
    flights: List[Dict[str, Any]],
    weather: Dict[str, Any] | None = None,
    map_info: Dict[str, Any] | None = None,
) -> str:
    if not _client:
        return (
            "I can answer from the fetched flight results, but I don't have more grounded data for that exact question. "
            "Try asking for the cheapest, fastest, nonstop, weather, or airport access."
        )

    response = _client.chat.completions.create(
        model=GROUNDED_CHAT_MODEL,
        messages=_build_grounded_messages(message, flights[:8], weather, map_info),
        temperature=0.1,
        max_completion_tokens=220,
    )
    return (response.choices[0].message.content or "").strip()


def _build_planner_trace(planned_tools: List[str]) -> Dict[str, Any]:
    return {
        "planner": "tool_first",
        "planned_tools": planned_tools,
    }


def _extract_flight_number(message: str) -> Optional[str]:
    match = _FLIGHT_NUMBER_RE.search(message or "")
    if not match:
        return None
    return re.sub(r"\s+", "", match.group(1).upper())


async def plan_chat_response(
    *,
    message: str,
    history: List[Dict[str, str]],
    recent_flights: Optional[List[Dict[str, Any]]],
    user_context: ToolExecutionContext,
    user_city: Optional[str] = None,
    user_lat: float | None = None,
    user_lng: float | None = None,
) -> Dict[str, Any] | None:
    registry = _build_registry()
    planned_tools: List[str] = []

    registry.execute(
        "get_user_context",
        {},
        _context_with_trace(user_context, ["get_user_context"]),
    )

    normalized_recent_flights = [
        _normalize_recent_flight(flight)
        for flight in (recent_flights or [])
        if isinstance(flight, dict)
    ]

    if _FLIGHT_STATUS_RE.search(message):
        flight_number = _extract_flight_number(message)
        if flight_number:
            planned_tools.append("flight_status")
            status_result = await registry.execute_async(
                "flight_status",
                {"flight_number": flight_number},
                _context_with_trace(user_context, planned_tools),
                timeout_seconds=DEFAULT_TOOL_TIMEOUT_SECONDS,
                max_retries=DEFAULT_TOOL_RETRIES,
            )
            if status_result.status.value == "success":
                return {
                    "type": "text",
                    "text": status_result.data.get("status_text") or f"I couldn't find status details for {flight_number}.",
                    "session_id": user_context.session_id,
                    "planner_trace": _build_planner_trace(planned_tools),
                }

    if normalized_recent_flights:
        selected_indices = _extract_selected_indices(message)
        requested_currency = _extract_currency_code(message)
        airline_filters = _extract_airline_filters_from_message(message, normalized_recent_flights)

        if airline_filters["include"] or airline_filters["exclude"]:
            filtered_flights = _apply_airline_filters_to_recent(
                normalized_recent_flights,
                include=airline_filters["include"],
                exclude=airline_filters["exclude"],
            )
            if filtered_flights:
                return {
                    "type": "flights",
                    "text": (
                        f"I filtered your current results and found {len(filtered_flights)} matching option(s) "
                        "from the flights already fetched."
                    ),
                    "flights": filtered_flights[:5],
                    "all_flights": filtered_flights,
                    "session_id": user_context.session_id,
                    "planner_trace": _build_planner_trace(planned_tools),
                }
            return {
                "type": "text",
                "text": "None of the already fetched options match that airline filter. Ask for a new route/date if you want a fresh search.",
                "session_id": user_context.session_id,
            }

        if _COMPARE_RE.search(message) and len(selected_indices) >= 2:
            return {
                "type": "text",
                "text": _build_compare_text(normalized_recent_flights, selected_indices),
                "session_id": user_context.session_id,
            }

        if requested_currency and _CURRENCY_RE.search(message):
            source_currency = str(normalized_recent_flights[0].get("currency") or "USD").upper()
            if requested_currency != source_currency:
                amounts = [
                    float(flight.get("price"))
                    for flight in normalized_recent_flights[:5]
                    if isinstance(flight.get("price"), (int, float))
                ]
                if amounts:
                    planned_tools.append("convert_currency")
                    conversion_result = await registry.execute_async(
                        "convert_currency",
                        {
                            "amounts": amounts,
                            "source_currency": source_currency,
                            "target_currency": requested_currency,
                        },
                        _context_with_trace(user_context, planned_tools),
                        timeout_seconds=DEFAULT_TOOL_TIMEOUT_SECONDS,
                        max_retries=DEFAULT_TOOL_RETRIES,
                    )
                    if conversion_result.status.value == "success":
                        converted = conversion_result.data.get("converted_amounts") or []
                        converted_flights: List[Dict[str, Any]] = []
                        for index, flight in enumerate(normalized_recent_flights):
                            clone = dict(flight)
                            if index < len(converted):
                                clone["converted_price"] = converted[index]
                                clone["converted_currency"] = requested_currency
                            converted_flights.append(clone)
                        return {
                            "type": "flights",
                            "text": _build_conversion_text(
                                source_currency,
                                requested_currency,
                                float(conversion_result.data.get("rate") or 0.0),
                                len(converted),
                                bool(conversion_result.data.get("is_stale")),
                            ),
                            "flights": converted_flights[:5],
                            "all_flights": converted_flights,
                            "session_id": user_context.session_id,
                            "planner_trace": _build_planner_trace(planned_tools),
                            "currency_conversion": conversion_result.data,
                        }

        weather_result = None
        if _WEATHER_RE.search(message):
            planned_tools.append("get_weather")
            destination_city = (
                ((normalized_recent_flights[0].get("route") or {}).get("destinationCity"))
                or get_city_name((normalized_recent_flights[0].get("route") or {}).get("destinationIata") or "")
            )
            date_range = _extract_iso_date_range(message)
            weather_payload: Dict[str, Any] = {"location": destination_city}
            if date_range:
                weather_payload["start_date"], weather_payload["end_date"] = date_range
            weather_result = await registry.execute_async(
                "get_weather",
                weather_payload,
                _context_with_trace(user_context, planned_tools),
                timeout_seconds=DEFAULT_TOOL_TIMEOUT_SECONDS,
                max_retries=DEFAULT_TOOL_RETRIES,
            )

        map_result = None
        if _MAP_RE.search(message):
            planned_tools.append("get_map_info")
            route = normalized_recent_flights[0].get("route") or {}
            map_result = await registry.execute_async(
                "get_map_info",
                {
                    "origin_iata": route.get("originIata"),
                    "destination_iata": route.get("destinationIata"),
                    "user_lat": user_lat,
                    "user_lng": user_lng,
                },
                _context_with_trace(user_context, planned_tools),
                timeout_seconds=DEFAULT_TOOL_TIMEOUT_SECONDS,
                max_retries=DEFAULT_TOOL_RETRIES,
            )

        if _CHEAPEST_RE.search(message) or _FASTEST_RE.search(message) or _NONSTOP_RE.search(message) or _BEST_RE.search(message) or _BAGGAGE_RE.search(message) or _MEAL_RE.search(message) or _WIFI_RE.search(message):
            goal = _extract_goal(message)
            ranked = _sort_flights_for_goal(normalized_recent_flights, goal, message)
            lead_route = ranked[0].get("route") or {}
            response: Dict[str, Any] = {
                "type": "flights",
                "text": _build_ranked_summary_text(
                    ranked,
                    goal,
                    lead_route.get("originCity") or lead_route.get("originIata") or "Origin",
                    lead_route.get("destinationCity") or lead_route.get("destinationIata") or "Destination",
                ),
                "flights": ranked[:5],
                "all_flights": ranked,
                "search": {
                    "origin": lead_route.get("originCity") or lead_route.get("originIata"),
                    "destination": lead_route.get("destinationCity") or lead_route.get("destinationIata"),
                },
                "session_id": user_context.session_id,
                "planner_trace": _build_planner_trace(planned_tools),
            }
            if weather_result and weather_result.status.value == "success":
                response["weather"] = weather_result.data.get("weather")
                response["weather_advice"] = weather_result.data.get("weather_advice")
                if weather_result.data.get("weather_range"):
                    response["weather_range"] = weather_result.data.get("weather_range")
                    response["weather_range_advice"] = weather_result.data.get("weather_range_advice")
            if map_result and map_result.status.value == "success":
                response["destination_map_url"] = map_result.data.get("destination_map_url")
            return response

        if weather_result or map_result:
            response = {
                "type": "flights",
                "text": _grounded_flights_reply(
                    message,
                    normalized_recent_flights,
                    weather_result.data if weather_result and weather_result.status.value == "success" else None,
                    map_result.data if map_result and map_result.status.value == "success" else None,
                ),
                "flights": normalized_recent_flights[:5],
                "all_flights": normalized_recent_flights,
                "session_id": user_context.session_id,
                "planner_trace": _build_planner_trace(planned_tools),
            }
            if weather_result and weather_result.status.value == "success":
                response["weather"] = weather_result.data.get("weather")
                response["weather_advice"] = weather_result.data.get("weather_advice")
                if weather_result.data.get("weather_range"):
                    response["weather_range"] = weather_result.data.get("weather_range")
                    response["weather_range_advice"] = weather_result.data.get("weather_range_advice")
            if map_result and map_result.status.value == "success":
                response["destination_map_url"] = map_result.data.get("destination_map_url")
            return response

    if should_attempt_flight_search(message, history):
        if normalized_recent_flights and not _extract_iso_date_range(message) and not re.search(r"\bfrom\s+\w+\s+to\s+\w+\b", message, re.IGNORECASE):
            return {
                "type": "text",
                "text": _grounded_flights_reply(message, normalized_recent_flights),
                "session_id": user_context.session_id,
            }
        intent_result = parse_flight_search_intent(message, history, user_city=user_city)
        if intent_result.get("intent") == "flight_search":
            if not intent_result.get("is_sufficient"):
                return {
                    "type": "text",
                    "text": intent_result.get("assistant_reply") or "I can search as soon as I have the route and date.",
                    "session_id": user_context.session_id,
                }

            search = intent_result.get("search") or {}
            search = _apply_profile_preferences_to_search(
                search,
                _load_travel_preference(user_context.user_db, user_context.user_id),
                message,
            )
            planned_tools.append("search_flights")
            search_result = await registry.execute_async(
                "search_flights",
                _build_search_payload(search, user_lat, user_lng),
                _context_with_trace(user_context, planned_tools),
                timeout_seconds=DEFAULT_TOOL_TIMEOUT_SECONDS,
                max_retries=DEFAULT_TOOL_RETRIES,
            )
            if search_result.status.value != "success":
                return {
                    "type": "text",
                    "text": "I ran into a problem while searching live flight data. Please try again.",
                    "session_id": user_context.session_id,
                }

            flights = search_result.data.get("flights") or []
            display_flights = search_result.data.get("display_flights") or []
            search_info = search_result.data.get("search_info") or {}
            response: Dict[str, Any] = {
                "type": "flights",
                "text": present_flight_results(message, search, display_flights, search_info).get("text"),
                "flights": display_flights,
                "all_flights": flights,
                "search": {
                    "origin": search.get("origin") or search_info.get("origin"),
                    "destination": search.get("destination") or search_info.get("destination"),
                },
                "search_info": search_info,
                "session_id": user_context.session_id,
                "follow_up_prompt": "Ask for the cheapest, fastest, best nonstop, baggage-friendly, or airport/weather details.",
                "planner_trace": _build_planner_trace(planned_tools),
            }
            if search_info.get("weather_dest"):
                response["weather"] = search_info.get("weather_dest")
            if search_info.get("weather_advice"):
                response["weather_advice"] = search_info.get("weather_advice")
            if search_info.get("destination_map_url"):
                response["destination_map_url"] = search_info.get("destination_map_url")
            if search_info.get("recommendation_explanation"):
                response["recommendation_explanation"] = search_info.get("recommendation_explanation")
            return response

    if _WEATHER_RE.search(message) or _MAP_RE.search(message):
        return None

    if normalized_recent_flights:
        return {
            "type": "text",
            "text": _grounded_flights_reply(message, normalized_recent_flights),
            "session_id": user_context.session_id,
        }

    return None
