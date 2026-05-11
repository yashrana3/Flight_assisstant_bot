"""FlightAware AeroAPI v4 client for flight details and status."""

import os
import re
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx
from dotenv import load_dotenv

load_dotenv()

AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi"
FLIGHTAWARE_API_KEY = os.getenv("FLIGHTAWARE_API_KEY", "")
FLIGHT_STATUS_CACHE_TTL_SECONDS = max(int(os.getenv("FLIGHT_STATUS_CACHE_TTL_SECONDS", "600")), 30)
_status_cache: dict[str, tuple[float, str]] = {}


def _normalize_ident(flight_number: str) -> str:
    """Normalize flight number to ident (e.g. 'AI 101' -> 'AI101', 'EK501' -> 'EK501')."""
    s = re.sub(r"\s+", "", str(flight_number).strip()).upper()
    return s if s else flight_number.strip()


def _airport_code_candidates(value: Any) -> set[str]:
    candidates: set[str] = set()
    if isinstance(value, dict):
        for key in (
            "code",
            "code_iata",
            "iata",
            "iata_code",
            "code_icao",
            "icao_code",
            "airport_code",
        ):
            raw = str(value.get(key) or "").strip().upper()
            if raw:
                candidates.add(raw)
        return candidates

    raw = str(value or "").strip().upper()
    if raw:
        candidates.add(raw)
    return candidates


def _preferred_airport_code(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("code_iata", "iata", "iata_code", "code", "code_icao", "icao_code"):
            raw = str(value.get(key) or "").strip().upper()
            if raw:
                return raw
        return ""
    return str(value or "").strip().upper()


def _normalize_expected_date(value: Optional[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""

    if re.match(r"^\d{4}-\d{2}-\d{2}", raw):
        return raw[:10]

    for fmt in ("%d %b %Y", "%d %B %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return raw[:10] if len(raw) >= 10 else ""


def _extract_event_date(flight: Dict[str, Any]) -> str:
    for key in (
        "scheduled_out",
        "scheduled_off",
        "estimated_out",
        "estimated_off",
        "actual_out",
        "actual_off",
    ):
        raw = str(flight.get(key) or "").strip()
        if raw and len(raw) >= 10:
            return raw[:10]
    return ""


def _select_relevant_flight(
    flights: list[Dict[str, Any]],
    expected_origin: Optional[str],
    expected_destination: Optional[str],
    expected_depart_date: Optional[str],
) -> Tuple[Optional[Dict[str, Any]], bool, bool]:
    if not flights:
        return None, False, False

    expected_origin_codes = _airport_code_candidates(expected_origin)
    expected_destination_codes = _airport_code_candidates(expected_destination)
    expected_date = _normalize_expected_date(expected_depart_date)

    candidates = flights
    route_expected = bool(expected_origin_codes and expected_destination_codes)
    route_match = True
    date_match = True

    if route_expected:
        route_candidates = [
            flight
            for flight in flights
            if _airport_code_candidates(flight.get("origin")) & expected_origin_codes
            and _airport_code_candidates(flight.get("destination")) & expected_destination_codes
        ]
        if route_candidates:
            candidates = route_candidates
            route_match = True
        else:
            route_match = False
            candidates = flights

    if expected_date:
        date_candidates = [
            flight
            for flight in candidates
            if _extract_event_date(flight) == expected_date
        ]
        if date_candidates:
            candidates = date_candidates
        else:
            date_match = False

    return (candidates[0] if candidates else None), route_match, date_match


def _format_flight_for_status(flight: Dict[str, Any]) -> str:
    """Turn one flight object from AeroAPI into a short status line."""
    ident = flight.get("ident") or flight.get("ident_icao") or flight.get("ident_iata") or "?"
    origin = flight.get("origin", {}).get("code") if isinstance(flight.get("origin"), dict) else flight.get("origin") or "?"
    destination = flight.get("destination", {}).get("code") if isinstance(flight.get("destination"), dict) else flight.get("destination") or "?"
    status = flight.get("status") or "unknown"
    scheduled_out = flight.get("scheduled_out") or flight.get("scheduled_off")
    estimated_out = flight.get("estimated_out") or flight.get("estimated_off")
    scheduled_in = flight.get("scheduled_in") or flight.get("scheduled_on")
    estimated_in = flight.get("estimated_in") or flight.get("estimated_on")
    actual_out = flight.get("actual_out") or flight.get("actual_off")
    actual_in = flight.get("actual_in") or flight.get("actual_on")

    parts = [f"Flight {ident}: {origin} → {destination}", f"Status: {status}"]
    if actual_out:
        parts.append(f"Departed: {actual_out}")
    elif estimated_out:
        parts.append(f"Estimated departure: {estimated_out}")
    elif scheduled_out:
        parts.append(f"Scheduled departure: {scheduled_out}")
    if actual_in:
        parts.append(f"Arrived: {actual_in}")
    elif estimated_in:
        parts.append(f"Estimated arrival: {estimated_in}")
    elif scheduled_in:
        parts.append(f"Scheduled arrival: {scheduled_in}")
    return "\n".join(parts)


async def get_flight_details(
    flight_number: str,
    *,
    expected_origin: Optional[str] = None,
    expected_destination: Optional[str] = None,
    expected_depart_date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fetch flight details from FlightAware AeroAPI v4 for verification.
    Returns a dict with status, route, and times; suitable for GET /flights/verify.
    """
    ident = _normalize_ident(flight_number)
    if not FLIGHTAWARE_API_KEY:
        return {
            "error": "FlightAware API key not configured",
            "ident": ident,
            "message": "Set FLIGHTAWARE_API_KEY in .env to enable flight verification.",
        }

    url = f"{AEROAPI_BASE}/flights/{ident}"
    headers = {"x-apikey": FLIGHTAWARE_API_KEY}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 404:
                return {
                    "ident": ident,
                    "found": False,
                    "message": f"No flight information found for {ident}.",
                }
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        return {
            "ident": ident,
            "error": "request_failed",
            "message": str(e),
        }

    flights = data.get("flights") or []
    if not flights:
        return {
            "ident": ident,
            "found": False,
            "message": f"No flight information found for {ident}.",
        }

    flight, route_match, date_match = _select_relevant_flight(
        flights,
        expected_origin=expected_origin,
        expected_destination=expected_destination,
        expected_depart_date=expected_depart_date,
    )
    if not flight:
        return {
            "ident": ident,
            "found": False,
            "message": f"No flight information found for {ident}.",
        }

    origin = flight.get("origin") or {}
    destination = flight.get("destination") or {}
    origin_code = _preferred_airport_code(origin)
    dest_code = _preferred_airport_code(destination)
    expected_origin_code = _preferred_airport_code(expected_origin)
    expected_destination_code = _preferred_airport_code(expected_destination)
    expected_depart_date_normalized = _normalize_expected_date(expected_depart_date)

    message = None
    if route_match is False:
        message = (
            f"Flight number {ident} was found, but the live route is {origin_code} to {dest_code}, "
            f"not {expected_origin_code} to {expected_destination_code}."
        )
    elif date_match is False and expected_depart_date_normalized:
        actual_date = _extract_event_date(flight)
        if actual_date:
            message = (
                f"Flight number {ident} was found for {origin_code} to {dest_code}, "
                f"but it is scheduled on {actual_date} (not {expected_depart_date_normalized})."
            )
        else:
            message = (
                f"Flight number {ident} was found for {origin_code} to {dest_code}, "
                f"but no schedule was found for {expected_depart_date_normalized}."
            )

    return {
        "ident": flight.get("ident") or flight.get("ident_icao") or ident,
        "found": True,
        "route_match": route_match,
        "date_match": date_match,
        "message": message,
        "expected_origin": expected_origin_code,
        "expected_destination": expected_destination_code,
        "expected_depart_date": expected_depart_date_normalized or None,
        "origin": origin_code,
        "destination": dest_code,
        "status": flight.get("status"),
        "scheduled_out": flight.get("scheduled_out") or flight.get("scheduled_off"),
        "scheduled_in": flight.get("scheduled_in") or flight.get("scheduled_on"),
        "estimated_out": flight.get("estimated_out") or flight.get("estimated_off"),
        "estimated_in": flight.get("estimated_in") or flight.get("estimated_on"),
        "actual_out": flight.get("actual_out") or flight.get("actual_off"),
        "actual_in": flight.get("actual_in") or flight.get("actual_on"),
        "aircraft_type": flight.get("aircraft_type"),
        "operator": flight.get("operator") or flight.get("operator_iata") or flight.get("operator_icao"),
        "fa_flight_id": flight.get("fa_flight_id"),
    }


async def get_flight_status(flight_number: str) -> str:
    """
    Fetch flight status from FlightAware and return a human-readable string for chat.
    """
    ident = _normalize_ident(flight_number)
    now_ts = datetime.utcnow().timestamp()
    cached = _status_cache.get(ident)
    if cached and cached[0] > now_ts:
        return cached[1]

    def _cache_and_return(value: str) -> str:
        _status_cache[ident] = (now_ts + FLIGHT_STATUS_CACHE_TTL_SECONDS, value)
        return value

    def _sample_status_from_fixture() -> Optional[str]:
        fixture_dir = Path(__file__).resolve().parents[3] / "api_json_test" / "outputs"
        preferred = fixture_dir / f"flightaware_flights_{ident}.json"
        candidate_files = [preferred, fixture_dir / "flightaware_flights_AI101.json", fixture_dir / "flightaware_flight.json"]
        for candidate in candidate_files:
            if not candidate.exists():
                continue
            try:
                payload = json.loads(candidate.read_text(encoding="utf-8"))
                flights = (((payload.get("response") or {}).get("body") or {}).get("flights") or [])
                if not flights:
                    continue
                return "\n\n".join(_format_flight_for_status(f) for f in flights[:3])
            except Exception:
                continue
        return None

    if not FLIGHTAWARE_API_KEY:
        sample = _sample_status_from_fixture()
        if sample:
            return _cache_and_return(
                f"Live FlightAware key is not configured, so I am using cached fixture data.\n\n{sample}"
            )
        return _cache_and_return(
            f"Flight verification is not configured (missing FLIGHTAWARE_API_KEY). Ident: {ident}."
        )

    url = f"{AEROAPI_BASE}/flights/{ident}"
    headers = {"x-apikey": FLIGHTAWARE_API_KEY}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 404:
                return _cache_and_return(f"No flight information found for {ident}.")
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        sample = _sample_status_from_fixture()
        if sample:
            return _cache_and_return(
                f"I couldn't reach live FlightAware just now, so here is cached fixture data.\n\n{sample}"
            )
        return _cache_and_return(f"I couldn't look up that flight: {e}.")

    flights = data.get("flights") or []
    if not flights:
        return _cache_and_return(f"No flight information found for {ident}.")

    return _cache_and_return("\n\n".join(_format_flight_for_status(f) for f in flights[:3]))
