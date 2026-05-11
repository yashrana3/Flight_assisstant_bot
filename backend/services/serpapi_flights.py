import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv

from services.flight_ai import get_iata


load_dotenv()

SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
logger = logging.getLogger(__name__)


class SerpApiError(Exception):
    pass


async def search_flights_serpapi(
    origin: str,
    destination: str,
    depart_date: str,
    return_date: str | None,
    passengers: int,
    currency: str,
    gl_country: str | None = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Call SerpAPI Google Flights. Returns (normalized list, reason_if_empty).
    """
    if not SERPAPI_API_KEY:
        reason = "SerpAPI: API key not set (SERPAPI_API_KEY)."
        return ([], reason)

    origin_iata = get_iata(origin)
    dest_iata = get_iata(destination)
    reason: Optional[str] = None
    gl = (gl_country or "us").strip().lower()
    if len(gl) != 2:
        gl = "us"

    params: Dict[str, Any] = {
        "engine": "google_flights",
        "api_key": SERPAPI_API_KEY,
        "departure_id": origin_iata,
        "arrival_id": dest_iata,
        "currency": currency.upper(),
        "hl": "en",
        "gl": gl,
        "adults": max(passengers, 1),
        "no_cache": "true",
    }

    if depart_date:
        params["outbound_date"] = depart_date
    if return_date:
        params["return_date"] = return_date
        params["type"] = 1
    else:
        params["type"] = 2

    logger.info(
        "SerpAPI request: origin=%s dest=%s outbound_date=%s",
        origin_iata,
        dest_iata,
        depart_date,
    )

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://serpapi.com/search",
                params=params,
                timeout=20.0,
            )
            if resp.status_code != 200:
                reason = (
                    f"SerpAPI HTTP {resp.status_code}: "
                    f"{resp.text[:200] if resp.text else 'no body'}"
                )
                logger.warning("SerpAPI: %s", reason)
                return ([], reason)
            data = resp.json()
        except Exception as e:
            reason = f"SerpAPI request error: {e}"
            logger.warning("SerpAPI: %s", reason)
            return ([], reason)

    flights_results = (data.get("best_flights") or []) + (data.get("other_flights") or [])
    if not flights_results:
        reason = (
            "I couldn’t find any flights for those exact details. "
            "Try adjusting your date or airports, or check back later."
        )
        logger.info(
            "SerpAPI: no flights for %s→%s on %s; returning friendly message",
            origin_iata,
            dest_iata,
            depart_date,
        )
    normalized: List[Dict[str, Any]] = []

    for f in flights_results:
        segments = f.get("flights") or []
        if not segments:
            continue

        first_seg = segments[0]
        last_seg = segments[-1]
        airline = first_seg.get("airline") or f.get("airline") or ""
        airline_code = ""
        flight_number = first_seg.get("flight_number") or ""
        if " " in flight_number:
            airline_code = flight_number.split(" ", 1)[0]

        departure_airport = first_seg.get("departure_airport", {})
        arrival_airport = last_seg.get("arrival_airport", {})
        from_iata = departure_airport.get("id", origin_iata)
        to_iata = arrival_airport.get("id", dest_iata)

        stop_cities = [
            seg.get("arrival_airport", {}).get("id")
            for seg in segments[:-1]
            if seg.get("arrival_airport")
        ]
        total_duration_minutes = f.get("total_duration")
        duration_str = (
            f"PT{int(total_duration_minutes // 60)}H{int(total_duration_minutes % 60)}M"
            if isinstance(total_duration_minutes, int)
            else ""
        )

        total_price: Optional[float] = None
        currency_code = currency.upper()
        try:
            raw_price = f.get("price")
            if isinstance(raw_price, (int, float)):
                parsed_price = float(raw_price)
                total_price = parsed_price if parsed_price > 0 else None
            elif isinstance(raw_price, str):
                cleaned = "".join(ch for ch in raw_price if ch.isdigit() or ch == ".")
                if cleaned:
                    parsed_price = float(cleaned)
                    total_price = parsed_price if parsed_price > 0 else None
        except Exception:
            total_price = None

        if total_price is None:
            logger.info(
                "SerpAPI: skipping offer without valid price for %s→%s",
                origin_iata,
                dest_iata,
            )
            continue

        extensions = []
        for seg in segments:
            extensions.extend(seg.get("extensions") or [])
        perks: List[str] = []
        joined_extensions = " | ".join(extensions).lower()
        if "wifi" in joined_extensions:
            perks.append("Wi-Fi")
        if "meal" in joined_extensions:
            perks.append("Free meal")
        if "power" in joined_extensions:
            perks.append("Power outlet")

        normalized_segments = []
        for seg in segments:
            dep = seg.get("departure_airport", {})
            arr = seg.get("arrival_airport", {})
            normalized_segments.append(
                {
                    "marketingCarrier": seg.get("airline"),
                    "operatingCarrier": seg.get("airline"),
                    "flightNumber": seg.get("flight_number"),
                    "aircraft": seg.get("airplane"),
                    "departureAt": dep.get("time"),
                    "arrivalAt": arr.get("time"),
                    "originIata": dep.get("id"),
                    "destinationIata": arr.get("id"),
                    "terminalDeparture": dep.get("terminal"),
                    "terminalArrival": arr.get("terminal"),
                },
            )

        normalized.append(
            {
                "provider": "serpapi",
                "provider_offer_id": (
                    f.get("booking_token") or f.get("departure_token") or f.get("link")
                ),
                "provider_booking_token": f.get("booking_token") or f.get("departure_token"),
                "provider_link": f.get("link"),
                "airline": airline,
                "airline_code": airline_code or None,
                "flight_number": flight_number,
                "from_iata": from_iata,
                "to_iata": to_iata,
                "from_city": departure_airport.get("name") or from_iata,
                "to_city": arrival_airport.get("name") or to_iata,
                "departure_time": departure_airport.get("time"),
                "arrival_time": arrival_airport.get("time"),
                "departure_terminal": departure_airport.get("terminal"),
                "arrival_terminal": arrival_airport.get("terminal"),
                "duration": duration_str,
                "stops": max(len(segments) - 1, 0),
                "stop_cities": [city for city in stop_cities if city],
                "cabin_class": first_seg.get("travel_class") or "ECONOMY",
                "fare_family": f.get("type") or "",
                "baggage_cabin": "",
                "baggage_checked": "",
                "price_total": total_price,
                "price_per_person": total_price / max(passengers, 1),
                "currency": currency_code,
                "refundable": None,
                "change_penalty": "",
                "perks": perks,
                "segments": normalized_segments,
                "aircraft": first_seg.get("airplane"),
                "carbon_emissions": f.get("carbon_emissions"),
            },
        )

    return (normalized, reason)
