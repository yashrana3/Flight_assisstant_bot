"""Trip helpers for serialization, lookup, and AI-assisted create/edit flows."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any

from dateutil import parser as date_parser
from openai import OpenAI
from sqlalchemy.orm import Session

from models.trip import Trip


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TRIP_EDIT_MODEL = os.getenv("OPENAI_TRIP_EDIT_MODEL", "gpt-4o")
TRIP_CREATE_MODEL = os.getenv("OPENAI_TRIP_CREATE_MODEL", TRIP_EDIT_MODEL)
TRIP_AI_TIMEOUT_SECONDS = max(
    float(os.getenv("TRIP_AI_TIMEOUT_SECONDS", "4.0")),
    1.0,
)

client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

_OPTIONAL_TRIP_FIELDS = {
    "airline",
    "flight_number",
    "arrival_date",
    "cabin_class",
    "confirmation_code",
    "ticket_number",
    "booking_ref",
    "seat_number",
    "ticket_cost",
    "currency",
}


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = re.sub(r"\s+", " ", str(value)).strip()
    return normalized or None


def _normalize_flight_number(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    return normalized.upper() if normalized else None


def _normalize_location(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    if len(normalized) <= 3 and normalized.isalpha():
        return normalized.upper()

    return normalized.title()


def _normalize_airline(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    return normalized.title() if normalized else None


def _normalize_cabin_class(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    lowered = normalized.lower()
    mapping = {
        "economy": "Economy",
        "premium economy": "Premium Economy",
        "premium_economy": "Premium Economy",
        "business": "Business",
        "first": "First",
    }
    return mapping.get(lowered, normalized.title())


def _normalize_currency(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    cleaned = normalized.upper()
    aliases = {
        "RS": "INR",
        "INR": "INR",
        "RUPEE": "INR",
        "RUPEES": "INR",
        "USD": "USD",
        "DOLLAR": "USD",
        "DOLLARS": "USD",
        "EUR": "EUR",
        "EURO": "EUR",
        "EUROS": "EUR",
        "GBP": "GBP",
    }
    return aliases.get(cleaned, cleaned[:10])


def _normalize_trip_type(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    lowered = normalized.lower().replace("-", "_").replace(" ", "_")
    mapping = {
        "oneway": "one_way",
        "one_way": "one_way",
        "single": "one_way",
        "single_trip": "one_way",
        "roundtrip": "round_trip",
        "round_trip": "round_trip",
        "return": "round_trip",
        "return_trip": "round_trip",
    }
    return mapping.get(lowered)


def _normalize_status(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    lowered = normalized.lower()
    if "pause" in lowered or "hold" in lowered:
        return "PLANNED"
    if "resume" in lowered or "confirm" in lowered or "active" in lowered:
        return "CONFIRMED"
    if "complete" in lowered or "done" in lowered:
        return "COMPLETED"
    if "cancel" in lowered:
        return "CANCELLED"

    mapping = {
        "planned": "PLANNED",
        "paused": "PLANNED",
        "confirmed": "CONFIRMED",
        "ticketed": "TICKETED",
        "completed": "COMPLETED",
        "cancelled": "CANCELLED",
    }
    return mapping.get(lowered)


def _trip_snapshot_payload(
    *,
    trip_type: str | None = None,
    passenger_name: str | None = None,
    existing_snapshot: str | None = None,
) -> str | None:
    snapshot: dict[str, Any] = {}

    if existing_snapshot:
        try:
            parsed = json.loads(existing_snapshot)
            if isinstance(parsed, dict):
                snapshot = parsed
        except Exception:
            snapshot = {}

    normalized_trip_type = _normalize_trip_type(trip_type)
    normalized_passenger_name = _normalize_text(passenger_name)

    if normalized_trip_type:
        snapshot["trip_type"] = normalized_trip_type
    if normalized_passenger_name:
        snapshot["passenger_name"] = normalized_passenger_name

    if not snapshot:
        return None

    return json.dumps(snapshot, separators=(",", ":"), sort_keys=True)


def _trip_snapshot_fields(trip: Trip) -> dict[str, Any]:
    parsed: dict[str, Any] = {}
    if trip.flight_snapshot:
        try:
            snapshot = json.loads(trip.flight_snapshot)
            if isinstance(snapshot, dict):
                parsed = snapshot
        except Exception:
            parsed = {}

    trip_type = _normalize_trip_type(parsed.get("trip_type"))
    if not trip_type:
        trip_type = "round_trip" if trip.arrival_date else "one_way"

    return {
        "trip_type": trip_type,
        "passenger_name": _normalize_text(parsed.get("passenger_name")),
    }


def _parse_amount(value: Any) -> float | None:
    if value is None or value == "":
        return None

    if isinstance(value, (int, float)):
        return float(value)

    text = _normalize_text(str(value))
    if not text:
        return None

    match = re.search(r"([0-9][0-9,]*(?:\.[0-9]+)?)", text.replace(",", ""))
    if not match:
        return None

    try:
        return float(match.group(1))
    except ValueError:
        return None


def _has_explicit_year(text: str) -> bool:
    return bool(re.search(r"\b\d{4}\b", text))


def _parse_datetime(value: str | None, *, now: datetime | None = None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    current_time = now or datetime.utcnow()

    try:
        parsed = date_parser.parse(
            normalized,
            fuzzy=True,
            default=current_time.replace(hour=12, minute=0, second=0, microsecond=0),
        )
    except Exception:
        return None

    if not _has_explicit_year(normalized) and parsed.date() < current_time.date():
        parsed = parsed.replace(year=parsed.year + 1)

    has_time = (
        bool(re.search(r"\d{1,2}:\d{2}", normalized))
        or bool(re.search(r"\b(?:am|pm)\b", normalized, re.IGNORECASE))
    )
    if has_time:
        return parsed.replace(second=0, microsecond=0).isoformat()

    return parsed.date().isoformat()


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return json.loads(text)


def serialize_trip(trip: Trip) -> dict[str, Any]:
    snapshot_fields = _trip_snapshot_fields(trip)
    return {
        "id": str(trip.id),
        "session_id": trip.session_id,
        "airline": trip.airline,
        "origin": trip.origin,
        "destination": trip.destination,
        "flight_number": trip.flight_number,
        "trip_type": snapshot_fields["trip_type"],
        "passenger_name": snapshot_fields["passenger_name"],
        "departure_date": trip.departure_date.isoformat() if trip.departure_date else None,
        "arrival_date": trip.arrival_date.isoformat() if trip.arrival_date else None,
        "duration": trip.duration,
        "status": trip.status,
        "cabin_class": trip.cabin_class,
        "booking_ref": trip.booking_ref,
        "confirmation_code": trip.confirmation_code,
        "ticket_number": trip.ticket_number,
        "seat_number": trip.seat_number,
        "ticket_cost": (
            float(trip.ticket_cost_minor) / 100.0
            if trip.ticket_cost_minor is not None
            else None
        ),
        "currency": trip.currency,
        "created_at": trip.created_at.isoformat() if trip.created_at else None,
        "updated_at": trip.updated_at.isoformat() if trip.updated_at else None,
    }


def get_trip_for_user(db: Session, trip_id: str, user_id: str) -> Trip | None:
    return db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()


def _fallback_trip_patch(instruction: str) -> dict[str, Any]:
    text = instruction.lower()
    clear_fields: set[str] = set()

    if "remove airline" in text or "clear airline" in text or "any airline" in text:
        clear_fields.add("airline")
    if "remove flight number" in text or "clear flight number" in text:
        clear_fields.add("flight_number")
    if "remove arrival" in text or "clear arrival" in text:
        clear_fields.add("arrival_date")
    if "remove confirmation" in text or "clear confirmation" in text or "remove pnr" in text:
        clear_fields.add("confirmation_code")
    if "remove ticket number" in text or "clear ticket number" in text:
        clear_fields.add("ticket_number")
    if "remove booking reference" in text or "clear booking reference" in text:
        clear_fields.add("booking_ref")
    if "remove seat" in text or "clear seat" in text:
        clear_fields.add("seat_number")
    if "remove fare" in text or "clear fare" in text or "remove cost" in text:
        clear_fields.add("ticket_cost")

    patch: dict[str, Any] = {
        "origin": None,
        "destination": None,
        "airline": None,
        "flight_number": None,
        "trip_type": None,
        "passenger_name": None,
        "departure_date": None,
        "arrival_date": None,
        "cabin_class": None,
        "confirmation_code": None,
        "ticket_number": None,
        "booking_ref": None,
        "seat_number": None,
        "ticket_cost": None,
        "currency": None,
        "status": _normalize_status(instruction),
        "clear_fields": sorted(clear_fields),
    }

    route_match = re.search(
        r"\bfrom\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+)\b",
        instruction,
        re.IGNORECASE,
    )
    if route_match:
        patch["origin"] = _normalize_location(route_match.group(1))
        patch["destination"] = _normalize_location(route_match.group(2))

    date_matches = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", instruction)
    if date_matches:
        patch["departure_date"] = date_matches[0]
        if len(date_matches) > 1:
            patch["arrival_date"] = date_matches[1]

    airline_match = re.search(r"\bairline\s*(?:is|=|:)?\s*([A-Za-z0-9 .&-]+)", instruction, re.IGNORECASE)
    if airline_match:
        patch["airline"] = _normalize_airline(airline_match.group(1))

    flight_number_match = re.search(
        r"\bflight(?: number| no\.?)?\s*(?:is|=|:)?\s*([A-Za-z0-9-]+\s*[A-Za-z0-9-]*)",
        instruction,
        re.IGNORECASE,
    )
    if flight_number_match:
        patch["flight_number"] = _normalize_flight_number(flight_number_match.group(1))

    if "premium economy" in text:
        patch["cabin_class"] = "Premium Economy"
    elif "business" in text:
        patch["cabin_class"] = "Business"
    elif "first" in text:
        patch["cabin_class"] = "First"
    elif "economy" in text:
        patch["cabin_class"] = "Economy"

    confirmation_match = re.search(
        r"\b(?:confirmation code|confirmation|pnr)\s*(?:is|=|:)?\s*([A-Za-z0-9-]+)",
        instruction,
        re.IGNORECASE,
    )
    if confirmation_match:
        patch["confirmation_code"] = _normalize_text(confirmation_match.group(1))

    ticket_match = re.search(
        r"\bticket(?: number| no\.?)?\s*(?:is|=|:)?\s*([A-Za-z0-9-]+)",
        instruction,
        re.IGNORECASE,
    )
    if ticket_match:
        patch["ticket_number"] = _normalize_text(ticket_match.group(1))

    booking_ref_match = re.search(
        r"\bbooking(?: reference| ref)?\s*(?:is|=|:)?\s*([A-Za-z0-9-]+)",
        instruction,
        re.IGNORECASE,
    )
    if booking_ref_match:
        patch["booking_ref"] = _normalize_text(booking_ref_match.group(1))

    seat_match = re.search(
        r"\bseat(?: number| no\.?)?\s*(?:is|=|:)?\s*([A-Za-z0-9-]+)",
        instruction,
        re.IGNORECASE,
    )
    if seat_match:
        patch["seat_number"] = _normalize_text(seat_match.group(1))

    amount_match = re.search(
        r"(?:price|fare|cost)\D{0,8}(₹|rs|inr|\$|usd|eur|gbp)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
        instruction,
        re.IGNORECASE,
    )
    if amount_match:
        patch["ticket_cost"] = _parse_amount(amount_match.group(2))
        patch["currency"] = _normalize_currency(amount_match.group(1))

    if any(term in text for term in ("round trip", "round-trip", "roundtrip", "return trip")):
        patch["trip_type"] = "round_trip"
    elif any(term in text for term in ("one way", "one-way", "oneway", "single trip")):
        patch["trip_type"] = "one_way"
    elif patch["arrival_date"]:
        patch["trip_type"] = "round_trip"

    passenger_match = re.search(
        r"\b(?:pax name|passenger name|traveler name|traveller name)\s*(?:is|=|:)?\s*([A-Za-z][A-Za-z .'-]+)",
        instruction,
        re.IGNORECASE,
    )
    if passenger_match:
        patch["passenger_name"] = _normalize_text(passenger_match.group(1))

    return patch


def _normalize_clear_fields(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    normalized: list[str] = []
    for item in value:
        field = _normalize_text(str(item))
        if field and field in _OPTIONAL_TRIP_FIELDS and field not in normalized:
            normalized.append(field)
    return normalized


def _parse_ai_trip_patch(trip: Trip | None, instruction: str) -> dict[str, Any]:
    fallback = _fallback_trip_patch(instruction)
    if client is None:
        return fallback

    context = {
        "current_trip": serialize_trip(trip) if trip is not None else None,
        "instruction": instruction,
    }

    try:
        response = client.chat.completions.create(
            model=TRIP_EDIT_MODEL if trip is not None else TRIP_CREATE_MODEL,
            temperature=0.1,
            max_completion_tokens=320,
            timeout=TRIP_AI_TIMEOUT_SECONDS,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract structured flight booking data from a user instruction. "
                        "Return only valid JSON with keys: origin, destination, airline, "
                        "flight_number, trip_type, passenger_name, departure_date, "
                        "arrival_date, cabin_class, confirmation_code, ticket_number, "
                        "booking_ref, seat_number, ticket_cost, currency, status, clear_fields. "
                        "Use null for unknown or unchanged fields. "
                        "Dates must be ISO 8601 strings or YYYY-MM-DD. "
                        "trip_type must be one_way or round_trip when specified. "
                        "status must be one of confirmed, paused, completed, cancelled when specified. "
                        "clear_fields must be an array and may include airline, flight_number, "
                        "arrival_date, cabin_class, confirmation_code, ticket_number, booking_ref, seat_number, "
                        "ticket_cost, currency when the user wants them removed."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(context),
                },
            ],
        )
        parsed = _extract_json_object(response.choices[0].message.content or "")
    except Exception:
        return fallback

    return {
        "origin": _normalize_location(parsed.get("origin")),
        "destination": _normalize_location(parsed.get("destination")),
        "airline": _normalize_airline(parsed.get("airline")),
        "flight_number": _normalize_flight_number(parsed.get("flight_number")),
        "trip_type": _normalize_trip_type(parsed.get("trip_type")),
        "passenger_name": _normalize_text(parsed.get("passenger_name")),
        "departure_date": _parse_datetime(parsed.get("departure_date")),
        "arrival_date": _parse_datetime(parsed.get("arrival_date")),
        "cabin_class": _normalize_cabin_class(parsed.get("cabin_class")),
        "confirmation_code": _normalize_text(parsed.get("confirmation_code")),
        "ticket_number": _normalize_text(parsed.get("ticket_number")),
        "booking_ref": _normalize_text(parsed.get("booking_ref")),
        "seat_number": _normalize_text(parsed.get("seat_number")),
        "ticket_cost": _parse_amount(parsed.get("ticket_cost")),
        "currency": _normalize_currency(parsed.get("currency")),
        "status": _normalize_status(parsed.get("status")) or fallback["status"],
        "clear_fields": _normalize_clear_fields(parsed.get("clear_fields")),
    }


def _apply_trip_patch(trip: Trip, patch: dict[str, Any]) -> bool:
    changed = False
    clear_fields = set(patch.get("clear_fields") or [])

    for field in clear_fields:
        if getattr(trip, field) is not None:
            setattr(trip, field, None)
            changed = True

    field_mapping = {
        "origin": "origin",
        "destination": "destination",
        "airline": "airline",
        "flight_number": "flight_number",
        "departure_date": "departure_date",
        "arrival_date": "arrival_date",
        "cabin_class": "cabin_class",
        "confirmation_code": "confirmation_code",
        "ticket_number": "ticket_number",
        "booking_ref": "booking_ref",
        "seat_number": "seat_number",
        "ticket_cost": "ticket_cost_minor",
        "currency": "currency",
        "status": "status",
    }

    for patch_key, trip_attr in field_mapping.items():
        if patch_key in clear_fields:
            continue

        value = patch.get(patch_key)
        if value is None:
            continue

        if patch_key == "ticket_cost":
            value = int(round(float(value) * 100))

        if getattr(trip, trip_attr) != value:
            setattr(trip, trip_attr, value)
            changed = True

    snapshot = _trip_snapshot_payload(
        trip_type=patch.get("trip_type"),
        passenger_name=patch.get("passenger_name"),
        existing_snapshot=trip.flight_snapshot,
    )
    if snapshot is not None and trip.flight_snapshot != snapshot:
        trip.flight_snapshot = snapshot
        changed = True

    if changed:
        trip.updated_at = datetime.utcnow()

    return changed


async def apply_ai_edit_to_trip(
    db: Session,
    trip: Trip,
    instruction: str,
) -> dict[str, Any]:
    normalized_instruction = _normalize_text(instruction)
    if not normalized_instruction:
        raise ValueError("Instruction is required.")

    patch = _parse_ai_trip_patch(trip, normalized_instruction)
    changed = _apply_trip_patch(trip, patch)

    if not changed:
        return serialize_trip(trip)

    db.add(trip)
    db.commit()
    db.refresh(trip)
    return serialize_trip(trip)


async def create_trip_from_ai_instruction(
    db: Session,
    *,
    user_id: str,
    instruction: str,
    session_id: str | None = None,
) -> dict[str, Any]:
    normalized_instruction = _normalize_text(instruction)
    if not normalized_instruction:
        raise ValueError("Instruction is required.")

    patch = _parse_ai_trip_patch(None, normalized_instruction)
    origin = patch.get("origin")
    destination = patch.get("destination")
    departure_date = patch.get("departure_date")

    if not origin or not destination:
        raise ValueError("Please include at least the origin and destination for the trip.")
    if not departure_date:
        raise ValueError(
            "Please include at least the departure date for this trip before I save it."
        )

    # session_id is accepted for API compatibility; the trips table has no session column yet.
    trip = Trip(
        user_id=user_id,
        origin=origin,
        destination=destination,
        airline=patch.get("airline"),
        flight_number=patch.get("flight_number"),
        departure_date=(
            datetime.fromisoformat(departure_date)
        ),
        arrival_date=(
            datetime.fromisoformat(patch["arrival_date"])
            if patch.get("arrival_date")
            else None
        ),
        status=patch.get("status") or "CONFIRMED",
        cabin_class=patch.get("cabin_class"),
        booking_ref=patch.get("booking_ref"),
        confirmation_code=patch.get("confirmation_code"),
        ticket_number=patch.get("ticket_number"),
        seat_number=patch.get("seat_number"),
        flight_snapshot=_trip_snapshot_payload(
            trip_type=patch.get("trip_type") or ("round_trip" if patch.get("arrival_date") else "one_way"),
            passenger_name=patch.get("passenger_name"),
        ),
        ticket_cost_minor=(
            int(round(float(patch.get("ticket_cost")) * 100))
            if patch.get("ticket_cost") is not None
            else None
        ),
        currency=patch.get("currency") or "USD",
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return serialize_trip(trip)
