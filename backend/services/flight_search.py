from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from dataclasses import dataclass, replace
from typing import List, Dict, Any, Optional, Tuple

from services.flight_ai import (
    get_iata,
    build_google_flights_url,
    get_city_airport_options,
)
from services.departure_currency import resolve_search_currency, serpapi_gl_for_iata
from services.amadeus_client import (
    search_flights_amadeus,
    FlightSearchParams,
    confirm_flight_price,
)
from services.serpapi_flights import search_flights_serpapi
from services.flight_cache import get_cached, set_cached
from services.weather import get_weather, get_city_name, get_weather_advice
from services.maps import get_destination_map_url, get_airport_convenience, get_airport_name
from services.flight_recommendation import rank_and_recommend_flights
from services.flightaware_client import get_flight_details


def _read_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


FLIGHTAWARE_ENRICH_LIMIT = _read_int_env("FLIGHTAWARE_ENRICH_LIMIT", 5)
PREVERIFY_TOP_RESULTS = _read_int_env("FLIGHT_PREVERIFY_TOP_RESULTS", 0)
ALTERNATE_DATE_WINDOW_DAYS = _read_int_env("FLIGHT_ALTERNATE_DATE_WINDOW_DAYS", 4)
ALTERNATE_DATE_MAX_OPTIONS = _read_int_env("FLIGHT_ALTERNATE_DATE_MAX_OPTIONS", 3)
NEARBY_AIRPORT_MAX_OPTIONS = _read_int_env("FLIGHT_NEARBY_AIRPORT_MAX_OPTIONS", 4)
METRO_AIRPORT_PAIR_CAP = max(1, int(os.getenv("FLIGHT_METRO_AIRPORT_PAIR_CAP", "12")))

NEARBY_AIRPORTS: Dict[str, List[str]] = {
    "DEL": ["JAI", "IXC", "LKO"],
    "BOM": ["PNQ", "GOI", "AMD"],
    "BLR": ["MAA", "HYD", "COK"],
    "MAA": ["BLR", "COK", "HYD"],
    "CCU": ["IXC", "GAU", "VNS"],
    "HYD": ["BLR", "MAA", "GOI"],
    "PNQ": ["BOM", "GOI", "AMD"],
    "GOI": ["BOM", "PNQ", "BLR"],
    "JFK": ["EWR", "LGA"],
    "LHR": ["LGW", "STN"],
}


@dataclass
class UnifiedSearchParams:
    origin: str
    destination: str
    depart_date: str
    return_date: str | None
    passengers: int
    budget: float | None = None
    cabin: str | None = None
    # None or empty = derive from departure airport country (see departure_currency).
    currency: Optional[str] = None
    preference: Optional[str] = None
    preferred_airlines: Optional[List[str]] = None
    excluded_airlines: Optional[List[str]] = None
    meal_preference: Optional[str] = None
    seat_preference: Optional[str] = None
    nonstop_only: bool = False
    baggage_required: bool = False
    refundable_only: bool = False
    # Soft cap on longest single airport connection (minutes). None = ignore.
    # Used for ranking penalties when the user wants to avoid long layovers but not nonstop-only.
    max_layover_minutes: Optional[int] = None
    user_lat: Optional[float] = None
    user_lng: Optional[float] = None


async def unified_flight_search(params: UnifiedSearchParams) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Orchestrates Amadeus + SerpAPI (Google Flights), normalizes results, fetches weather and map,
    then uses AI to rank flights and recommend one. Returns (flights, search_info).
    Results are cached (in-memory or Redis when REDIS_URL is set).
    """
    pax = max(params.passengers, 1)
    currency = resolve_search_currency(params.currency, params.origin).upper()
    origin_iata = get_iata(params.origin)
    serp_gl = serpapi_gl_for_iata(origin_iata)
    cache_variant = _build_cache_variant(params)

    # Check cache first
    cached = get_cached(
        params.origin,
        params.destination,
        params.depart_date,
        params.return_date,
        pax,
        currency,
        params.budget,
        variant=cache_variant,
    )
    if cached is not None:
        return cached

    # Call providers in parallel
    amadeus_params = FlightSearchParams(
        origin=params.origin,
        destination=params.destination,
        depart_date=params.depart_date,
        return_date=params.return_date,
        adults=pax,
        currency=currency,
        max_price=params.budget,
        cabin=params.cabin,
    )

    amadeus_task = search_flights_amadeus(amadeus_params)
    serp_task = search_flights_serpapi(
        params.origin,
        params.destination,
        params.depart_date,
        params.return_date,
        pax,
        currency,
        gl_country=serp_gl,
    )

    amadeus_tuple, serp_tuple = await _gather_safe(amadeus_task, serp_task)
    if isinstance(amadeus_tuple, tuple):
        amadeus_results = amadeus_tuple[0] or []
        amadeus_reason = amadeus_tuple[1] if len(amadeus_tuple) > 1 else None
    elif isinstance(amadeus_tuple, Exception):
        amadeus_results = []
        amadeus_reason = f"Amadeus error: {amadeus_tuple}"
    else:
        amadeus_results = amadeus_tuple or []
        amadeus_reason = None

    if isinstance(serp_tuple, tuple):
        serp_results = serp_tuple[0] or []
        serp_reason = serp_tuple[1] if len(serp_tuple) > 1 else None
    elif isinstance(serp_tuple, Exception):
        serp_results = []
        serp_reason = f"SerpAPI error: {serp_tuple}"
    else:
        serp_results = serp_tuple or []
        serp_reason = None

    raw_pool: List[Dict[str, Any]] = []
    raw_pool.extend(amadeus_results or [])
    raw_pool.extend(serp_results or [])
    invalid_price_count = sum(1 for flight in raw_pool if not _has_valid_price(flight.get("price_total")))
    pool = [flight for flight in raw_pool if _has_valid_price(flight.get("price_total"))]
    pre_filter_count = len(pool)
    pool = _apply_airline_filters(
        pool,
        include=params.preferred_airlines,
        exclude=params.excluded_airlines,
    )

    sources: List[str] = []
    if amadeus_results:
        sources.append("amadeus")
    if serp_results:
        sources.append("serpapi")

    empty_search_info: Dict[str, Any] = {
        "origin": params.origin,
        "destination": params.destination,
        "depart_date": params.depart_date,
        "return_date": params.return_date,
        "passengers": pax,
        "currency": currency,
        "budget": params.budget,
        "total_results": 0,
        "sources": sources,
        "invalid_price_count": invalid_price_count,
        "pre_filter_count": pre_filter_count,
        "post_filter_count": len(pool),
        "excluded_by_airline_count": max(0, pre_filter_count - len(pool)),
    }

    # Only real data from Amadeus/SerpAPI — no AI-generated suggestions
    if not pool:
        empty_search_info["no_api_results_reason"] = (
            "I couldn't find any flights for those exact details. Try adjusting your date or airports, or check back later."
        )
        alternate_dates = await _find_alternate_date_options(params)
        if alternate_dates:
            empty_search_info["alternate_dates"] = alternate_dates
        nearby_airports = await _find_nearby_airport_options(params)
        if nearby_airports:
            empty_search_info["nearby_airports"] = nearby_airports
        empty_search_info["amadeus_reason"] = amadeus_reason
        empty_search_info["serpapi_reason"] = serp_reason
        set_cached(
            params.origin, params.destination, params.depart_date, params.return_date,
            pax, currency, params.budget, [], empty_search_info, variant=cache_variant,
        )
        return ([], empty_search_info)

    # Deduplicate by (airline, flight_number, from_iata, to_iata, departure_time)
    merged: Dict[tuple, Dict[str, Any]] = {}
    for f in pool:
        key = (
            f.get("airline_code") or f.get("airline"),
            f.get("flight_number"),
            f.get("from_iata"),
            f.get("to_iata"),
            (f.get("departure_time") or "")[:10],
        )
        existing = merged.get(key)
        if not existing:
            merged[key] = _build_merged_flight_record(f, currency)
        else:
            _merge_provider_data(existing, f, currency)

    flights = list(merged.values())

    # Compute scores and tags
    _score_and_tag_flights(flights, budget=params.budget)

    # Adapt to canonical frontend contract
    origin_iata = get_iata(params.origin)
    dest_iata = get_iata(params.destination)
    # Generic fallback URLs — per-flight Google links are built inside the loop
    _fallback_urls = _build_booking_urls(
        origin_iata,
        dest_iata,
        params.depart_date,
        params.return_date,
        pax,
        params.cabin or "economy",
    )

    adapted: List[Dict[str, Any]] = []
    search_checked_at = datetime.now(timezone.utc).isoformat()
    for f in flights:
        departure_time = f.get("departure_time")
        arrival_time = f.get("arrival_time")
        duration_minutes = _parse_duration_minutes(f.get("duration"))
        flight_id = _build_flight_id(f)
        baggage_checked = f.get("baggage_checked") or ""
        baggage_cabin = f.get("baggage_cabin") or ""
        total_price = _safe_price(f.get("price_total")) or 0.0
        per_person_price = _safe_price(f.get("price_per_person")) or total_price
        raw_segments = f.get("segments") or _build_basic_segment(f)
        segments = _enrich_segments_with_locations(raw_segments)
        stop_labels: List[str] = []
        for segment in segments[:-1]:
            label = _format_location_label(segment.get("destinationCity"), segment.get("destinationIata"))
            if label and label not in stop_labels:
                stop_labels.append(label)
        if not stop_labels:
            for stop_value in f.get("stop_cities") or []:
                label = _normalize_stop_label(stop_value)
                if label and label not in stop_labels:
                    stop_labels.append(label)
        # SerpAPI provider_link IS the Google Flights booking page for this specific flight.
        # Use it as the primary "google" deep link; fall back to the generic search URL.
        serpapi_direct_link = f.get("provider_link")
        booking_urls = {
            **_fallback_urls,
            "google": serpapi_direct_link or _fallback_urls.get("google", ""),
        }
        official_booking_url = (
            serpapi_direct_link
            or booking_urls.get("google")
            or ""
        )
        adapted.append(
            {
                "flight_id": flight_id,
                "search_id": _build_search_id(params, currency, pax),
                "providers": f.get("providers") or [f.get("provider")],
                "provider_refs": {
                    "amadeus": {
                        "offerId": (f.get("provider_ids") or {}).get("amadeus"),
                        "rawOffer": f.get("raw_offer"),
                    },
                    "serpapi": {
                        "offerId": (f.get("provider_ids") or {}).get("serpapi"),
                        "bookingToken": f.get("provider_booking_token"),
                        "link": f.get("provider_link"),
                    },
                    "flightaware": {"faFlightId": None},
                },
                "route": {
                    "originCity": _location_name_for_iata(
                        f.get("from_iata") or origin_iata,
                        f.get("from_city") or params.origin,
                    ),
                    "originIata": f.get("from_iata") or origin_iata,
                    "destinationCity": _location_name_for_iata(
                        f.get("to_iata") or dest_iata,
                        f.get("to_city") or params.destination,
                    ),
                    "destinationIata": f.get("to_iata") or dest_iata,
                },
                "trip_type": "round_trip" if params.return_date else "one_way",
                "segments": segments,
                "duration_minutes": duration_minutes,
                "airline": f.get("airline"),
                "flight_number": f.get("flight_number"),
                "from_iata": f.get("from_iata"),
                "to_iata": f.get("to_iata"),
                "departure_time": _short_time(departure_time),
                "arrival_time": _short_time(arrival_time),
                "departure_at": departure_time,
                "arrival_at": arrival_time,
                "departure_date": _date_part(departure_time),
                "arrival_date": _date_part(arrival_time),
                "duration": _human_duration(f.get("duration")),
                "stops": f.get("stops", 0) or 0,
                "stop_cities": f.get("stop_cities") or [],
                "stop_labels": stop_labels,
                "price": round(total_price),
                "currency": f.get("currency") or currency,
                "fare": {
                    "currency": f.get("currency") or currency,
                    "total": round(total_price),
                    "base": f.get("price_base"),
                    "taxes": f.get("price_taxes"),
                    "perPassenger": round(per_person_price),
                },
                "cabin": f.get("cabin_class") or "Economy",
                "cabin_class": f.get("cabin_class") or "Economy",
                "fare_brand": f.get("fare_family"),
                "refundable": f.get("refundable"),
                "baggage": {
                    "cabin": baggage_cabin,
                    "checked": baggage_checked,
                    "included": bool(baggage_checked or baggage_cabin),
                    # Source: Amadeus enrichment provides authoritative baggage data
                    "source": "amadeus" if baggage_checked else None,
                },
                "meal_services": f.get("meal_services") or [],
                "booking": {
                    "deepLinks": booking_urls,
                    "officialLink": official_booking_url,
                    # priceVerified=true only when SerpAPI confirmed the price
                    "priceVerified": bool(f.get("price_verified")),
                    "lastCheckedAt": search_checked_at,
                },
                "pricing": {
                    "source": f.get("search_price_source") or f.get("provider") or "unknown",
                    # "live" = SerpAPI confirmed price; "indicative" = Amadeus-only estimate
                    "kind": f.get("search_price_kind") or "unknown",
                    "lastCheckedAt": search_checked_at,
                },
                "comparison": {
                    "providerQuotes": {
                        provider: details.get("total")
                        for provider, details in (f.get("provider_prices") or {}).items()
                        if isinstance(details, dict) and _safe_price(details.get("total")) is not None
                    },
                    "serpapiReferencePrice": (
                        ((f.get("provider_prices") or {}).get("serpapi") or {}).get("total")
                        if isinstance((f.get("provider_prices") or {}).get("serpapi"), dict)
                        else None
                    ),
                    "activePriceSource": f.get("search_price_source") or f.get("provider"),
                    "marketPosition": None,
                    "priceGapFromCheapest": None,
                    "priceGapPercent": None,
                },
                "allowances": {
                    "checkedBaggage": baggage_checked,
                    "cabinBaggage": baggage_cabin,
                    "refundable": bool(f.get("refundable")),
                    "mealServices": f.get("meal_services") or [],
                    "perks": f.get("perks") or [],
                },
                "convenience": {
                    "airportName": None,
                    "distanceKm": None,
                    "travelMinutes": None,
                    "source": None,
                    "isEstimate": True,
                },
                "operations": {
                    "aircraft": f.get("aircraft"),
                    "reliabilityScore": None,
                    "delayRisk": None,
                    "status": None,
                    "operator": None,
                },
                # Legacy fields kept for backward compat with existing frontend
                "baggage_text": baggage_checked or baggage_cabin,
                "booking_urls": booking_urls,
                "score": f.get("score", 0.0),
                "score_reason": f.get("score_reason") or "",
                "perks": f.get("perks") or [],
                "badge": f.get("badge"),
                "ranking": {
                    "baseScore": f.get("score", 0.0),
                    "aiScore": None,
                    "badges": [f.get("badge")] if f.get("badge") else [],
                    "pros": [],
                    "cons": [],
                    "recommended": False,
                },
                "analysis": {
                    "priceScore": None,
                    "durationScore": None,
                    "reliabilityScore": None,
                    "preferenceScore": None,
                    "convenienceScore": None,
                    "overallScore": f.get("score", 0.0),
                },
            }
        )

    await _enrich_with_airport_convenience(adapted, params.user_lat, params.user_lng)
    _apply_structured_analysis(adapted, params)

    candidate_flights = sorted(
        adapted,
        key=lambda flight: float(
            ((flight.get("analysis") or {}).get("overallScore"))
            or flight.get("score")
            or 0.0,
        ),
        reverse=True,
    )[:15]

    # FlightAware enrichment + weather run concurrently for the strongest candidates
    origin_iata_for_weather = get_iata(params.origin)
    dest_iata_for_weather = get_iata(params.destination)
    origin_city = get_city_name(origin_iata_for_weather) or params.origin
    dest_city = get_city_name(dest_iata_for_weather) or params.destination
    enrich_task = _enrich_with_flightaware(candidate_flights, limit=min(len(candidate_flights), FLIGHTAWARE_ENRICH_LIMIT))
    weather_origin_task = get_weather(origin_city)
    weather_dest_task = get_weather(dest_city)
    _, weather_origin, weather_dest = await asyncio.gather(
        enrich_task,
        weather_origin_task,
        weather_dest_task,
    )
    _apply_structured_analysis(candidate_flights, params)
    weather_advice = get_weather_advice(weather_dest) if weather_dest else ""
    destination_map_url = get_destination_map_url(dest_iata_for_weather) or ""

    # AI ranking and recommendation (pros, cons, one recommended, explanation)
    ranked_flights, recommended_index, recommendation_explanation = rank_and_recommend_flights(
        candidate_flights,
        budget=params.budget,
        currency=currency,
        weather_origin=weather_origin,
        weather_dest=weather_dest,
        origin_city=origin_city,
        dest_city=dest_city,
        preferred_airlines=params.preferred_airlines,
        preference_goal=params.preference,
    )
    ranked_flights = ranked_flights[:10]
    verified_top_count = await _attach_price_confidence(ranked_flights, limit=PREVERIFY_TOP_RESULTS)
    _apply_rank_badges(ranked_flights)
    recommended_index = next(
        (index for index, flight in enumerate(ranked_flights) if flight.get("is_recommended")),
        0,
    )

    # Comparison indices: cheapest and fastest by position in ranked list
    cheapest_index = (
        min(range(len(ranked_flights)), key=lambda i: _safe_price(ranked_flights[i].get("price")) or float("inf"))
        if ranked_flights else 0
    )
    fastest_index = (
        min(range(len(ranked_flights)), key=lambda i: _parse_duration_minutes(ranked_flights[i].get("duration")))
        if ranked_flights else 0
    )

    search_info: Dict[str, Any] = {
        "origin": params.origin,
        "destination": params.destination,
        "depart_date": params.depart_date,
        "return_date": params.return_date,
        "passengers": pax,
        "currency": currency,
        "budget": params.budget,
        "total_results": len(ranked_flights),
        "total_candidates": len(adapted),
        "candidate_count": len(candidate_flights),
        "sources": sources,
        "amadeus_count": len(amadeus_results),
        "serpapi_count": len(serp_results),
        "invalid_price_count": invalid_price_count,
        "amadeus_error": amadeus_reason,
        "serpapi_error": serp_reason,
        "recommendation_explanation": recommendation_explanation,
        "recommended_index": recommended_index,
        "cheapest_index": cheapest_index,
        "fastest_index": fastest_index,
        "verified_top_count": verified_top_count,
        "weather_origin": weather_origin,
        "weather_dest": weather_dest,
        "weather_advice": weather_advice,
        "destination_map_url": destination_map_url,
        "preferred_airlines": params.preferred_airlines or [],
        "excluded_airlines": params.excluded_airlines or [],
        "nonstop_only": params.nonstop_only,
        "baggage_required": params.baggage_required,
        "refundable_only": params.refundable_only,
        "max_layover_minutes": getattr(params, "max_layover_minutes", None),
        "user_location_used": params.user_lat is not None and params.user_lng is not None,
    }
    set_cached(
        params.origin, params.destination, params.depart_date, params.return_date,
        pax, currency, params.budget, ranked_flights, search_info, variant=cache_variant,
    )
    return (ranked_flights, search_info)


def metro_airport_code_lists(
    origin_text: str,
    dest_text: str,
    airport_preferences: Optional[List[str]] = None,
) -> Tuple[List[str], List[str]]:
    """
    For cities with multiple commercial airports (e.g. New York), return every
    airport code so we can search them in parallel. If the user named specific
    airport(s) in airport_preferences that belong to that metro, return only those.
    """
    prefs = [str(c).upper().strip() for c in (airport_preferences or []) if str(c).strip()]

    def codes_for(text: str) -> List[str]:
        t = (text or "").strip()
        if not t:
            return []
        opts = get_city_airport_options(t)
        if not opts:
            code = get_iata(t).strip().upper()
            return [code] if len(code) == 3 else []
        known = [o["code"] for o in opts]
        know_set = set(known)
        hits = [c for c in prefs if c in know_set]
        if hits:
            return hits
        if len(opts) > 1:
            return known
        return [known[0]] if known else [get_iata(t).strip().upper()]

    return codes_for(origin_text), codes_for(dest_text)


async def unified_flight_search_for_intent(
    *,
    origin_text: str,
    dest_text: str,
    airport_preferences: Optional[List[str]],
    base: UnifiedSearchParams,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Run unified_flight_search across metro airport combinations when needed,
    merge and de-duplicate, then return a single ranked-style list for the UI.
    """
    oc, dc = metro_airport_code_lists(origin_text, dest_text, airport_preferences)
    oc = [c for c in oc if c and len(c) == 3]
    dc = [c for c in dc if c and len(c) == 3]
    if not oc:
        oc = [get_iata(origin_text or base.origin).strip().upper()]
    if not dc:
        dc = [get_iata(dest_text or base.destination).strip().upper()]

    while len(oc) * len(dc) > METRO_AIRPORT_PAIR_CAP:
        if len(oc) >= len(dc) and len(oc) > 1:
            oc = oc[:-1]
        elif len(dc) > 1:
            dc = dc[:-1]
        else:
            break

    if len(oc) == 1 and len(dc) == 1:
        return await unified_flight_search(replace(base, origin=oc[0], destination=dc[0]))

    tasks = [
        unified_flight_search(replace(base, origin=o, destination=d))
        for o in oc
        for d in dc
    ]
    gathered = await asyncio.gather(*tasks)
    merged: List[Dict[str, Any]] = []
    merged_info: Dict[str, Any] = {}
    for flights, info in gathered:
        merged.extend(flights or [])
        if info and not merged_info:
            merged_info = dict(info)

    def _dedup_key(flight: Dict[str, Any]) -> Tuple[str, ...]:
        return (
            str(flight.get("airline_code") or "").upper(),
            str(flight.get("flight_number") or "").upper().replace(" ", ""),
            str(flight.get("from_iata") or "").upper(),
            str(flight.get("to_iata") or "").upper(),
            str(flight.get("departure_time") or flight.get("departure_at") or "")[:16],
        )

    seen: set[Tuple[str, ...]] = set()
    deduped: List[Dict[str, Any]] = []
    for flight in sorted(
        merged,
        key=lambda f: float((f.get("fare") or {}).get("total") or f.get("price") or 1e18),
    ):
        key = _dedup_key(flight)
        if key in seen:
            continue
        seen.add(key)
        flight["is_recommended"] = False
        deduped.append(flight)

    if deduped:
        deduped[0]["is_recommended"] = True

    ranked = deduped[:10]
    merged_info = merged_info or {}
    merged_info["origin"] = origin_text or oc[0]
    merged_info["destination"] = dest_text or dc[0]
    merged_info["total_results"] = len(ranked)
    if ranked:
        merged_info["cheapest_index"] = min(
            range(len(ranked)),
            key=lambda i: float((ranked[i].get("fare") or {}).get("total") or ranked[i].get("price") or 1e18),
        )
        merged_info["fastest_index"] = min(
            range(len(ranked)),
            key=lambda i: _parse_duration_minutes(ranked[i].get("duration")),
        )
    else:
        merged_info["cheapest_index"] = 0
        merged_info["fastest_index"] = 0
    merged_info["metro_airports_searched"] = {"origins": oc, "destinations": dc}
    merged_info["recommendation_explanation"] = merged_info.get("recommendation_explanation") or ""
    return ranked, merged_info


async def _gather_safe(t1, t2):
    return await asyncio.gather(t1, t2, return_exceptions=True)


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _build_alternate_date_candidates(
    depart_date: date,
    return_date: Optional[date],
    *,
    window_days: int,
) -> List[Tuple[date, Optional[date]]]:
    offsets: List[int] = []
    for day in range(1, window_days + 1):
        offsets.append(day)
    for day in range(1, window_days + 1):
        offsets.append(-day)

    today = datetime.now(timezone.utc).date()
    trip_span_days = (return_date - depart_date).days if return_date else None
    candidates: List[Tuple[date, Optional[date]]] = []
    seen: set[Tuple[str, str]] = set()

    for offset in offsets:
        candidate_depart = depart_date + timedelta(days=offset)
        if candidate_depart < today:
            continue

        candidate_return: Optional[date] = None
        if trip_span_days is not None:
            candidate_return = candidate_depart + timedelta(days=max(trip_span_days, 1))

        key = (
            candidate_depart.isoformat(),
            candidate_return.isoformat() if candidate_return else "",
        )
        if key in seen:
            continue
        seen.add(key)
        candidates.append((candidate_depart, candidate_return))
    return candidates


async def _probe_flights_for_dates(
    *,
    params: UnifiedSearchParams,
    depart_date: date,
    return_date: Optional[date],
) -> Optional[Dict[str, Any]]:
    pax = max(params.passengers, 1)
    origin_iata = get_iata(params.origin)
    currency = resolve_search_currency(params.currency, params.origin).upper()
    serp_gl = serpapi_gl_for_iata(origin_iata)
    amadeus_params = FlightSearchParams(
        origin=params.origin,
        destination=params.destination,
        depart_date=depart_date.isoformat(),
        return_date=return_date.isoformat() if return_date else None,
        adults=pax,
        currency=currency,
        max_price=params.budget,
        cabin=params.cabin,
    )
    amadeus_task = search_flights_amadeus(amadeus_params)
    serp_task = search_flights_serpapi(
        params.origin,
        params.destination,
        depart_date.isoformat(),
        return_date.isoformat() if return_date else None,
        pax,
        currency,
        gl_country=serp_gl,
    )
    amadeus_tuple, serp_tuple = await _gather_safe(amadeus_task, serp_task)

    amadeus_results = amadeus_tuple[0] if isinstance(amadeus_tuple, tuple) else (
        amadeus_tuple if isinstance(amadeus_tuple, list) else []
    )
    serp_results = serp_tuple[0] if isinstance(serp_tuple, tuple) else (
        serp_tuple if isinstance(serp_tuple, list) else []
    )
    if not isinstance(amadeus_results, list):
        amadeus_results = []
    if not isinstance(serp_results, list):
        serp_results = []

    pool = [
        flight
        for flight in (amadeus_results + serp_results)
        if _has_valid_price(flight.get("price_total"))
    ]
    if not pool:
        return None

    prices = [
        _safe_price(flight.get("price_total"))
        for flight in pool
        if _safe_price(flight.get("price_total")) is not None
    ]
    from_price = round(min(prices)) if prices else None
    return {
        "departure_date": depart_date.isoformat(),
        "return_date": return_date.isoformat() if return_date else None,
        "flight_count": len(pool),
        "from_price": from_price,
        "currency": currency,
    }


def _build_nearby_airport_candidates(iata_code: str) -> List[str]:
    base = (iata_code or "").upper().strip()
    if not base:
        return []
    return [candidate for candidate in NEARBY_AIRPORTS.get(base, []) if candidate != base]


async def _probe_flights_for_route(
    *,
    params: UnifiedSearchParams,
    origin_iata: str,
    destination_iata: str,
) -> Optional[Dict[str, Any]]:
    pax = max(params.passengers, 1)
    currency = resolve_search_currency(params.currency, origin_iata).upper()
    serp_gl = serpapi_gl_for_iata(origin_iata)
    amadeus_params = FlightSearchParams(
        origin=origin_iata,
        destination=destination_iata,
        depart_date=params.depart_date,
        return_date=params.return_date,
        adults=pax,
        currency=currency,
        max_price=params.budget,
        cabin=params.cabin,
    )
    amadeus_task = search_flights_amadeus(amadeus_params)
    serp_task = search_flights_serpapi(
        origin_iata,
        destination_iata,
        params.depart_date,
        params.return_date,
        pax,
        currency,
        gl_country=serp_gl,
    )
    amadeus_tuple, serp_tuple = await _gather_safe(amadeus_task, serp_task)
    amadeus_results = amadeus_tuple[0] if isinstance(amadeus_tuple, tuple) else (
        amadeus_tuple if isinstance(amadeus_tuple, list) else []
    )
    serp_results = serp_tuple[0] if isinstance(serp_tuple, tuple) else (
        serp_tuple if isinstance(serp_tuple, list) else []
    )
    if not isinstance(amadeus_results, list):
        amadeus_results = []
    if not isinstance(serp_results, list):
        serp_results = []

    pool = [
        flight
        for flight in (amadeus_results + serp_results)
        if _has_valid_price(flight.get("price_total"))
    ]
    if not pool:
        return None

    prices = [
        _safe_price(flight.get("price_total"))
        for flight in pool
        if _safe_price(flight.get("price_total")) is not None
    ]
    return {
        "origin": origin_iata,
        "destination": destination_iata,
        "flight_count": len(pool),
        "from_price": round(min(prices)) if prices else None,
        "currency": currency,
    }


async def _find_nearby_airport_options(params: UnifiedSearchParams) -> List[Dict[str, Any]]:
    if NEARBY_AIRPORT_MAX_OPTIONS <= 0:
        return []
    origin_iata = get_iata(params.origin)
    destination_iata = get_iata(params.destination)
    origin_candidates = [origin_iata] + _build_nearby_airport_candidates(origin_iata)
    destination_candidates = [destination_iata] + _build_nearby_airport_candidates(destination_iata)
    route_pairs: List[Tuple[str, str]] = []
    for candidate_origin in origin_candidates:
        for candidate_destination in destination_candidates:
            if candidate_origin == origin_iata and candidate_destination == destination_iata:
                continue
            route_pairs.append((candidate_origin, candidate_destination))

    options: List[Dict[str, Any]] = []
    for candidate_origin, candidate_destination in route_pairs:
        option = await _probe_flights_for_route(
            params=params,
            origin_iata=candidate_origin,
            destination_iata=candidate_destination,
        )
        if option:
            options.append(option)
        if len(options) >= NEARBY_AIRPORT_MAX_OPTIONS:
            break
    return options


async def _find_alternate_date_options(params: UnifiedSearchParams) -> List[Dict[str, Any]]:
    if ALTERNATE_DATE_WINDOW_DAYS <= 0 or ALTERNATE_DATE_MAX_OPTIONS <= 0:
        return []

    depart_date = _parse_iso_date(params.depart_date)
    if not depart_date:
        return []
    return_date = _parse_iso_date(params.return_date) if params.return_date else None

    candidates = _build_alternate_date_candidates(
        depart_date,
        return_date,
        window_days=ALTERNATE_DATE_WINDOW_DAYS,
    )
    if not candidates:
        return []

    options: List[Dict[str, Any]] = []
    for candidate_depart, candidate_return in candidates:
        option = await _probe_flights_for_dates(
            params=params,
            depart_date=candidate_depart,
            return_date=candidate_return,
        )
        if option:
            options.append(option)
        if len(options) >= ALTERNATE_DATE_MAX_OPTIONS:
            break
    return options


async def _attach_price_confidence(ranked_flights: List[Dict[str, Any]], limit: int = 0) -> int:
    for flight in ranked_flights:
        estimated_price = _safe_price(((flight.get("fare") or {}).get("total")) or flight.get("price"))
        flight["estimated_price"] = estimated_price
        flight["verified_price"] = None
        flight["verified_currency"] = None
        flight["verified_offer"] = None
        flight["is_verified"] = False
        flight["price_confidence"] = "estimated"

    if limit <= 0:
        return 0

    top_flights = ranked_flights[:limit]
    if not top_flights:
        return 0

    confirmed = await asyncio.gather(
        *[_confirm_price_for_flight(flight) for flight in top_flights],
        return_exceptions=True,
    )

    verified_count = 0
    for index, flight in enumerate(top_flights):
        result = confirmed[index]
        if isinstance(result, Exception) or not result:
            continue

        flight["verified_price"] = result["price"]
        flight["verified_currency"] = result["currency"]
        flight["verified_offer"] = result["offer"]
        flight["is_verified"] = True
        flight["price_confidence"] = "verified"

        booking = flight.setdefault("booking", {})
        booking["priceVerified"] = True
        booking["lastCheckedAt"] = result["checked_at"]

        pricing = flight.setdefault("pricing", {})
        pricing["source"] = result["source"]
        pricing["kind"] = "verified"
        pricing["lastCheckedAt"] = result["checked_at"]

        verified_count += 1

    return verified_count


async def _confirm_price_for_flight(flight: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw_offer = (
        ((flight.get("provider_refs") or {}).get("amadeus") or {}).get("rawOffer")
        or flight.get("raw_offer")
    )
    if not raw_offer:
        return None

    confirmed_offer, error = await confirm_flight_price(raw_offer)
    if error or not confirmed_offer:
        return None

    price_info = confirmed_offer.get("price") or {}
    verified_price = _safe_price(price_info.get("grandTotal") or price_info.get("total"))
    if verified_price is None:
        return None

    return {
        "price": verified_price,
        "currency": price_info.get("currency") or flight.get("currency"),
        "offer": confirmed_offer,
        "source": "amadeus",
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def _provider_price_payload(flight: Dict[str, Any], currency: str) -> Dict[str, Any]:
    return {
        "total": _safe_price(flight.get("price_total")),
        "perPerson": _safe_price(flight.get("price_per_person")),
        "currency": flight.get("currency") or currency,
    }


def _build_merged_flight_record(flight: Dict[str, Any], currency: str) -> Dict[str, Any]:
    provider = flight.get("provider")
    merged = {
        **flight,
        "providers": [provider] if provider else [],
        "provider_ids": ({provider: flight.get("provider_offer_id")} if provider else {}),
        "provider_prices": ({provider: _provider_price_payload(flight, currency)} if provider else {}),
        "raw_offer": flight.get("raw_offer") if provider == "amadeus" else None,
        "search_price_source": None,
        "search_price_kind": "search",
    }
    _apply_primary_price_source(merged)
    return merged


def _merge_provider_data(existing: Dict[str, Any], incoming: Dict[str, Any], currency: str) -> None:
    provider = incoming.get("provider")
    if provider and provider not in (existing.get("providers") or []):
        existing.setdefault("providers", []).append(provider)
    if provider:
        existing.setdefault("provider_ids", {})[provider] = incoming.get("provider_offer_id")
        existing.setdefault("provider_prices", {})[provider] = _provider_price_payload(incoming, currency)

    if incoming.get("provider_booking_token"):
        existing["provider_booking_token"] = incoming.get("provider_booking_token")
    if incoming.get("provider_link"):
        existing["provider_link"] = incoming.get("provider_link")

    # Keep the Amadeus offer for repricing, even if SerpAPI is the primary search-price source.
    if provider == "amadeus" and incoming.get("raw_offer"):
        existing["raw_offer"] = incoming.get("raw_offer")

    # Amadeus wins for cabin, baggage, refundability, meal, and segment metadata.
    # SerpAPI wins for price. Never overwrite Amadeus enrichment with SerpAPI's empty values.
    prefer_amadeus_fields = (
        "segments",
        "cabin_class",
        "fare_family",
        "baggage_cabin",
        "baggage_checked",
        "baggage_pieces",
        "meal_services",
        "refundable",
        "change_penalty",
        "aircraft",
        "price_base",
        "price_taxes",
    )
    if provider == "amadeus":
        for field in prefer_amadeus_fields:
            value = incoming.get(field)
            if value not in (None, "", [], {}):
                existing[field] = value

    # Fill any missing generic fields from the incoming provider.
    for field in (
        "airline",
        "airline_code",
        "flight_number",
        "from_iata",
        "to_iata",
        "from_city",
        "to_city",
        "departure_time",
        "arrival_time",
        "departure_terminal",
        "arrival_terminal",
        "duration",
        "stops",
        "stop_cities",
    ):
        current = existing.get(field)
        value = incoming.get(field)
        if current in (None, "", [], {}) and value not in (None, "", [], {}):
            existing[field] = value

    # Merge perks from both providers; Amadeus meal_services are the authoritative meal source.
    existing_perks = set(existing.get("perks") or [])
    incoming_perks = set(incoming.get("perks") or [])
    amadeus_meals = set(incoming.get("meal_services") or []) if provider == "amadeus" else set()
    combined_perks = existing_perks | incoming_perks | amadeus_meals
    if combined_perks:
        existing["perks"] = sorted(combined_perks)

    _apply_primary_price_source(existing)


def _apply_primary_price_source(flight: Dict[str, Any]) -> None:
    """
    SerpAPI is the canonical price source for display and market comparison.
    Amadeus price is used only as a fallback when SerpAPI has no price, and is
    marked as 'indicative' so downstream code can filter it from price comparisons.
    """
    provider_prices = flight.get("provider_prices") or {}
    selected_provider: Optional[str] = None
    selected_price: Optional[Dict[str, Any]] = None

    # SerpAPI price is always preferred — it reflects live Google Flights pricing.
    serpapi_price = provider_prices.get("serpapi")
    if isinstance(serpapi_price, dict) and _safe_price(serpapi_price.get("total")) is not None:
        selected_provider = "serpapi"
        selected_price = serpapi_price
    else:
        # Amadeus fallback: only used when SerpAPI has no price for this flight.
        for provider, details in provider_prices.items():
            if provider == "serpapi":
                continue
            if isinstance(details, dict) and _safe_price(details.get("total")) is not None:
                selected_provider = provider
                selected_price = details
                break

    if not selected_provider or not selected_price:
        return

    total_price = _safe_price(selected_price.get("total"))
    per_person_price = _safe_price(selected_price.get("perPerson")) or total_price
    if total_price is None:
        return

    flight["price_total"] = total_price
    flight["price_per_person"] = per_person_price or total_price
    flight["currency"] = selected_price.get("currency") or flight.get("currency")
    flight["search_price_source"] = selected_provider
    # "live" = from SerpAPI (Google Flights); "indicative" = Amadeus-only (no SerpAPI match)
    flight["search_price_kind"] = "live" if selected_provider == "serpapi" else "indicative"
    # Price is only considered verified for market comparison when SerpAPI confirmed it.
    flight["price_verified"] = selected_provider == "serpapi"

    if selected_provider != "amadeus":
        flight["price_base"] = None
        flight["price_taxes"] = None


def _safe_price(value: Any) -> Optional[float]:
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


def _has_valid_price(value: Any) -> bool:
    return _safe_price(value) is not None


def _build_search_id(params: UnifiedSearchParams, currency: str, passengers: int) -> str:
    raw = "|".join(
        [
            params.origin.lower(),
            params.destination.lower(),
            params.depart_date,
            params.return_date or "",
            str(passengers),
            currency.upper(),
            str(params.budget or ""),
            (params.cabin or "").lower(),
            (params.preference or "").lower(),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _build_cache_variant(params: UnifiedSearchParams) -> str:
    """Add personalization inputs to the flight cache key."""
    payload = {
        "cabin": (params.cabin or "").lower(),
        "preference": (params.preference or "").lower(),
        "preferred_airlines": sorted(
            airline.strip().lower()
            for airline in (params.preferred_airlines or [])
            if airline and airline.strip()
        ),
        "excluded_airlines": sorted(
            airline.strip().lower()
            for airline in (params.excluded_airlines or [])
            if airline and airline.strip()
        ),
        "meal_preference": (params.meal_preference or "").strip().lower(),
        "seat_preference": (params.seat_preference or "").strip().lower(),
        "nonstop_only": params.nonstop_only,
        "baggage_required": params.baggage_required,
        "refundable_only": params.refundable_only,
        "max_layover_minutes": getattr(params, "max_layover_minutes", None),
        "user_location": (
            [round(params.user_lat, 2), round(params.user_lng, 2)]
            if params.user_lat is not None and params.user_lng is not None
            else None
        ),
    }
    return hashlib.sha1(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"),
    ).hexdigest()


def _build_flight_id(flight: Dict[str, Any]) -> str:
    raw = "|".join(
        [
            str(flight.get("airline") or ""),
            str(flight.get("flight_number") or ""),
            str(flight.get("from_iata") or ""),
            str(flight.get("to_iata") or ""),
            str(flight.get("departure_time") or ""),
            str(flight.get("arrival_time") or ""),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _location_name_for_iata(iata_code: str | None, fallback_name: str | None = None) -> str:
    """Return the best readable place name for an IATA code."""
    code = str(iata_code or "").strip().upper()
    fallback = str(fallback_name or "").strip()
    if code:
        city_name = get_city_name(code)
        if city_name and city_name.upper() != code:
            return city_name
        if fallback and fallback.upper() != code:
            return fallback
        airport_name = get_airport_name(code)
        if airport_name and airport_name.upper() != f"{code} AIRPORT":
            return airport_name
        return city_name or fallback or code
    return fallback


def _format_location_label(location_name: str | None, iata_code: str | None) -> str:
    """Format a label like 'Dubai (DXB)' for UI display."""
    code = str(iata_code or "").strip().upper()
    name = _location_name_for_iata(code, location_name)
    if code and name and name.upper() != code:
        return f"{name} ({code})"
    return name or code


def _normalize_stop_label(stop_value: Any) -> str:
    """Normalize stop values from raw codes or preformatted strings."""
    raw = str(stop_value or "").strip()
    if not raw:
        return ""

    match = re.match(r"^(?P<name>.+?)\s*\((?P<code>[A-Za-z0-9]{3})\)$", raw)
    if match:
        return _format_location_label(match.group("name").strip(), match.group("code").upper())

    code = raw.upper()
    if re.fullmatch(r"[A-Z0-9]{3}", code):
        return _format_location_label(None, code)

    return raw


def _enrich_segments_with_locations(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach readable origin and destination names to each segment."""
    enriched: List[Dict[str, Any]] = []
    for segment in segments:
        origin_iata = str(segment.get("originIata") or "").strip().upper() or None
        destination_iata = str(segment.get("destinationIata") or "").strip().upper() or None
        enriched.append(
            {
                **segment,
                "originIata": origin_iata,
                "destinationIata": destination_iata,
                "originCity": _location_name_for_iata(origin_iata, segment.get("originCity")),
                "destinationCity": _location_name_for_iata(destination_iata, segment.get("destinationCity")),
            }
        )
    return enriched


async def _enrich_with_airport_convenience(
    flights: List[Dict[str, Any]],
    user_lat: Optional[float],
    user_lng: Optional[float],
) -> None:
    """Attach Google Maps or fallback airport-distance convenience data per origin airport."""
    if user_lat is None or user_lng is None or not flights:
        return

    origin_iatas = {
        ((flight.get("route") or {}).get("originIata") or flight.get("from_iata"))
        for flight in flights
    }
    origin_iatas = {iata for iata in origin_iatas if iata}
    if not origin_iatas:
        return

    results = await asyncio.gather(
        *[
            get_airport_convenience(iata, user_lat, user_lng)
            for iata in sorted(origin_iatas)
        ],
        return_exceptions=True,
    )
    convenience_map: Dict[str, Dict[str, Any]] = {}
    for iata, result in zip(sorted(origin_iatas), results):
        if isinstance(result, Exception) or not isinstance(result, dict):
            continue
        convenience_map[iata] = result

    for flight in flights:
        origin_iata = ((flight.get("route") or {}).get("originIata") or flight.get("from_iata"))
        convenience = convenience_map.get(origin_iata)
        if not convenience:
            continue
        flight["convenience"] = {
            "airportName": convenience.get("airport_name"),
            "distanceKm": convenience.get("distance_km"),
            "travelMinutes": convenience.get("duration_minutes"),
            "source": convenience.get("source"),
            "isEstimate": convenience.get("is_estimate", True),
        }


def _match_preferred_airline(
    flight: Dict[str, Any],
    preferred_airlines: Optional[List[str]],
) -> bool:
    if not preferred_airlines:
        return False
    airline = str(flight.get("airline") or "").lower()
    code = str(flight.get("flight_number") or "").split(" ", 1)[0].lower()
    for preferred in preferred_airlines:
        normalized = preferred.strip().lower()
        if not normalized:
            continue
        if normalized in airline or normalized == code:
            return True
    return False


def _airline_match_tokens(flight: Dict[str, Any]) -> set[str]:
    airline_name = str(flight.get("airline") or "").strip().lower()
    airline_code = str(flight.get("airline_code") or "").strip().lower()
    flight_number = str(flight.get("flight_number") or "").strip().lower()
    flight_prefix = flight_number.split(" ", 1)[0] if flight_number else ""
    tokens = {token for token in (airline_name, airline_code, flight_prefix) if token}
    return tokens


def _normalize_airline_filters(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    normalized = []
    for value in values:
        token = str(value or "").strip().lower()
        if token:
            normalized.append(token)
    return normalized


def _matches_any_airline_filter(flight: Dict[str, Any], filters: List[str]) -> bool:
    if not filters:
        return False
    tokens = _airline_match_tokens(flight)
    if not tokens:
        return False
    for item in filters:
        if any(item in token or token in item for token in tokens):
            return True
    return False


def _apply_airline_filters(
    flights: List[Dict[str, Any]],
    *,
    include: Optional[List[str]],
    exclude: Optional[List[str]],
) -> List[Dict[str, Any]]:
    include_filters = _normalize_airline_filters(include)
    exclude_filters = _normalize_airline_filters(exclude)

    filtered = list(flights)
    if include_filters:
        filtered = [
            flight for flight in filtered
            if _matches_any_airline_filter(flight, include_filters)
        ]
    if exclude_filters:
        filtered = [
            flight for flight in filtered
            if not _matches_any_airline_filter(flight, exclude_filters)
        ]
    return filtered


def _market_position_label(
    price_gap_from_cheapest: Optional[float],
    price_gap_percent: Optional[float],
) -> str:
    if not price_gap_from_cheapest or price_gap_from_cheapest <= 0:
        return "cheapest"
    if price_gap_percent is not None and price_gap_percent <= 7:
        return "competitive"
    if price_gap_percent is not None and price_gap_percent <= 18:
        return "mid_range"
    return "premium"


def _normalize_score(value: float, minimum: float, maximum: float) -> float:
    if maximum <= minimum:
        return 10.0
    return max(0.0, min(10.0, 10.0 * (1 - ((value - minimum) / (maximum - minimum)))))


def _convenience_score(distance_km: Optional[float], travel_minutes: Optional[float]) -> float:
    if distance_km is None and travel_minutes is None:
        return 6.5
    score = 10.0
    if distance_km is not None:
        if distance_km > 80:
            score -= 4.0
        elif distance_km > 50:
            score -= 2.5
        elif distance_km > 30:
            score -= 1.2
        elif distance_km > 15:
            score -= 0.5
    if travel_minutes is not None:
        if travel_minutes > 120:
            score -= 3.0
        elif travel_minutes > 75:
            score -= 1.8
        elif travel_minutes > 45:
            score -= 0.8
    return max(1.0, round(score, 1))


def _coerce_segment_datetime(at_val: Optional[str], base_date: str) -> Optional[datetime]:
    """Parse segment departure/arrival into naive local datetime when possible."""
    if not at_val:
        return None
    s = str(at_val).strip()
    if not s:
        return None
    if "T" in s and re.match(r"\d{4}-\d{2}-\d{2}", s):
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo:
                dt = dt.replace(tzinfo=None)
            return dt
        except ValueError:
            pass
    bd = (base_date or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", bd):
        base_d = datetime.strptime(bd, "%Y-%m-%d").date()
        for fmt in ("%I:%M %p", "%H:%M", "%I:%M%p", "%H:%M:%S"):
            try:
                t = datetime.strptime(s, fmt).time()
                return datetime.combine(base_d, t)
            except ValueError:
                continue
    return None


def _max_connection_minutes_for_flight(flight: Dict[str, Any]) -> Optional[float]:
    """Longest ground time between consecutive segments, in minutes, if parseable."""
    segments = flight.get("segments") or []
    if len(segments) < 2:
        return 0.0
    base_date = str(flight.get("departure_date") or "").strip()
    gaps: List[float] = []
    for i in range(len(segments) - 1):
        arr = segments[i].get("arrivalAt") or segments[i].get("arrival_at")
        dep = segments[i + 1].get("departureAt") or segments[i + 1].get("departure_at")
        ta = _coerce_segment_datetime(arr, base_date)
        tb = _coerce_segment_datetime(dep, base_date)
        if not ta or not tb:
            continue
        delta = (tb - ta).total_seconds() / 60.0
        if delta < 0:
            delta += 24 * 60
        gaps.append(delta)
    if not gaps:
        return None
    return max(gaps)


def _apply_structured_analysis(
    flights: List[Dict[str, Any]],
    params: UnifiedSearchParams,
) -> None:
    """
    Compute comparison, convenience, preference, and overall ranking scores.

    Price comparison baseline: built exclusively from SerpAPI-priced flights (live Google
    Flights prices). Amadeus-only flights are scored against that baseline but marked as
    having an indicative price so the frontend can display them differently.

    Amadeus enrichment: checked baggage, meal services, refundability, and cabin class are
    used to compute the preferenceScore, rewarding flights that objectively include more.
    """
    if not flights:
        return

    prices = [
        _safe_price((flight.get("fare") or {}).get("total") or flight.get("price"))
        for flight in flights
    ]
    durations = [
        int(flight.get("duration_minutes") or _parse_duration_minutes(flight.get("duration")))
        for flight in flights
    ]

    # --- Price baseline: ONLY SerpAPI-verified prices ---
    # Amadeus-only indicative prices are excluded so the cheapest/most-expensive
    # labels and priceGapFromCheapest are always grounded in live market data.
    serpapi_prices = [
        price
        for flight, price in zip(flights, prices)
        if flight.get("price_verified") and price is not None
    ]
    # Fall back to all prices when SerpAPI returned nothing (Amadeus-only search result).
    comparison_prices = serpapi_prices if serpapi_prices else [p for p in prices if p is not None]

    comparable_durations = [d for d in durations if d > 0]
    min_serp_price = min(comparison_prices) if comparison_prices else 0.0
    max_serp_price = max(comparison_prices) if comparison_prices else 0.0
    min_duration = min(comparable_durations) if comparable_durations else 0
    max_duration = max(comparable_durations) if comparable_durations else 0

    # All prices are used for the price_score normalization range so that Amadeus-only
    # flights are not scored on a different scale.
    all_prices = [p for p in prices if p is not None]
    min_price_all = min(all_prices) if all_prices else 0.0
    max_price_all = max(all_prices) if all_prices else 0.0

    base_weights = {
        "price": 0.25,
        "duration": 0.20,
        "reliability": 0.20,
        "preference": 0.20,
        "convenience": 0.15,
    }
    preference_goal = (params.preference or "best_overall").lower()
    if preference_goal == "cheapest":
        base_weights.update({"price": 0.40, "duration": 0.15, "reliability": 0.15, "preference": 0.15, "convenience": 0.15})
    elif preference_goal == "fastest":
        base_weights.update({"price": 0.15, "duration": 0.35, "reliability": 0.20, "preference": 0.15, "convenience": 0.15})
    elif preference_goal in {"reliable", "reliability"}:
        base_weights.update({"price": 0.15, "duration": 0.15, "reliability": 0.35, "preference": 0.20, "convenience": 0.15})
    elif preference_goal in {"comfort", "low_stress", "easy"}:
        base_weights.update({"price": 0.20, "duration": 0.18, "reliability": 0.28, "preference": 0.24, "convenience": 0.10})

    for flight, price, duration_minutes in zip(flights, prices, durations):
        comparison = flight.setdefault("comparison", {})
        convenience = flight.get("convenience") or {}
        operations = flight.get("operations") or {}
        ranking = flight.setdefault("ranking", {})
        price_verified = bool(flight.get("price_verified"))

        safe_price = price or max_price_all or 0.0

        # priceGapFromCheapest is always relative to the SerpAPI price baseline.
        if comparison_prices:
            price_gap = round(max(0.0, safe_price - min_serp_price), 2)
            price_gap_percent = (
                round((price_gap / min_serp_price) * 100, 1)
                if min_serp_price > 0
                else None
            )
        else:
            price_gap = price_gap_percent = None

        comparison["priceGapFromCheapest"] = price_gap
        comparison["priceGapPercent"] = price_gap_percent
        comparison["marketPosition"] = (
            _market_position_label(price_gap, price_gap_percent)
            if price_verified
            else "indicative_price"
        )
        comparison["priceVerified"] = price_verified
        comparison["priceSource"] = flight.get("search_price_source")
        comparison["priceKind"] = flight.get("search_price_kind", "unknown")

        price_score = _normalize_score(safe_price, min_price_all, max_price_all) if all_prices else 6.5
        duration_score = (
            _normalize_score(float(duration_minutes), float(min_duration), float(max_duration))
            if comparable_durations and duration_minutes > 0
            else 6.5
        )
        reliability_score = float(operations.get("reliabilityScore") or 6.5)
        convenience_score = _convenience_score(
            convenience.get("distanceKm"),
            convenience.get("travelMinutes"),
        )

        # --- Preference score: budget, stops, airlines, Amadeus baggage/meal/refund ---
        preference_score = 6.0
        stops = int(flight.get("stops") or 0)

        # Budget fit
        if params.budget and safe_price <= params.budget:
            preference_score += 1.5
        elif params.budget and safe_price > params.budget:
            preference_score -= 2.0

        # Stops
        if params.nonstop_only:
            preference_score += 2.0 if stops == 0 else -3.5
        elif stops == 0:
            preference_score += 0.8
        elif stops >= 2:
            preference_score -= 1.4

        # Long layover soft constraint (ranking only; keep one-stop cheap options in play)
        max_lay = getattr(params, "max_layover_minutes", None)
        if max_lay and int(max_lay) > 0:
            conn = _max_connection_minutes_for_flight(flight)
            if conn is None:
                if stops == 1:
                    preference_score -= 0.35
            elif conn > float(max_lay):
                over = conn - float(max_lay)
                preference_score -= min(4.5, 1.0 + (over / 60.0) * 0.9)
            elif stops >= 1:
                preference_score += 0.35

        # Comfort / low-stress phrasing → bias toward direct and calmer schedules (no API filter)
        if preference_goal in {"comfort", "low_stress", "easy"}:
            if stops == 0:
                preference_score += 0.9
            elif stops == 1:
                preference_score += 0.15
            dep_raw = str(flight.get("departure_at") or flight.get("departure_time") or "")
            dep_dt = _coerce_segment_datetime(dep_raw, str(flight.get("departure_date") or ""))
            if dep_dt:
                h = dep_dt.hour + dep_dt.minute / 60.0
                if h < 6.0 or h >= 23.0:
                    preference_score -= 0.9

        # Preferred airline
        if _match_preferred_airline(flight, params.preferred_airlines):
            preference_score += 2.0

        # Amadeus baggage enrichment — checked baggage string is set by Amadeus only
        baggage_checked = (flight.get("baggage") or {}).get("checked") or flight.get("baggage_checked") or ""
        has_checked_baggage = bool(baggage_checked and str(baggage_checked).strip())
        if params.baggage_required:
            preference_score += 1.0 if has_checked_baggage else -1.5
        elif has_checked_baggage:
            # Baggage included always a small bonus even when not explicitly required
            preference_score += 0.5

        # Amadeus meal enrichment
        meal_services = flight.get("meal_services") or []
        perks = flight.get("perks") or []
        has_complimentary_meal = any(
            "complimentary" in str(s).lower() or "free meal" in str(s).lower()
            for s in meal_services + perks
        )
        if has_complimentary_meal:
            preference_score += 0.6
        preferred_meal = (params.meal_preference or "").strip().lower()
        meal_tokens = " ".join(str(s).lower() for s in (meal_services + perks))
        meal_preference_matched = None
        if preferred_meal:
            meal_preference_matched = preferred_meal in meal_tokens
            if meal_preference_matched:
                preference_score += 1.2
            elif meal_services:
                preference_score -= 0.6
            else:
                preference_score -= 1.0

        # Amadeus refundability
        if params.refundable_only:
            refundable = bool(flight.get("refundable"))
            preference_score += 1.0 if refundable else -1.5

        # Seat-side preference typically requires seatmap data. Track intent and
        # apply only a tiny penalty when no seatmap-backed matching is possible.
        if (params.seat_preference or "").strip():
            preference_score -= 0.2

        # Slight penalty when price is indicative (Amadeus-only, not confirmed by SerpAPI)
        if not price_verified:
            preference_score -= 0.5

        preference_score = max(1.0, min(10.0, round(preference_score, 1)))

        overall_score = round(
            (price_score * base_weights["price"])
            + (duration_score * base_weights["duration"])
            + (reliability_score * base_weights["reliability"])
            + (preference_score * base_weights["preference"])
            + (convenience_score * base_weights["convenience"]),
            2,
        )

        flight["analysis"] = {
            "priceScore": round(price_score, 1),
            "durationScore": round(duration_score, 1),
            "reliabilityScore": round(reliability_score, 1),
            "preferenceScore": round(preference_score, 1),
            "convenienceScore": round(convenience_score, 1),
            "overallScore": overall_score,
            "preferredAirlineMatch": _match_preferred_airline(flight, params.preferred_airlines),
            "withinBudget": bool(params.budget and safe_price <= params.budget),
            "hasCheckedBaggage": has_checked_baggage,
            "hasComplimentaryMeal": has_complimentary_meal,
            "mealPreference": params.meal_preference,
            "mealPreferenceMatched": meal_preference_matched,
            "priceVerified": price_verified,
        }
        flight["score"] = round(overall_score, 1)
        ranking["baseScore"] = round(overall_score, 1)


def _apply_rank_badges(flights: List[Dict[str, Any]]) -> None:
    """Apply user-facing badges after final ranking is complete."""
    if not flights:
        return

    for flight in flights:
        flight["badge"] = None
        ranking = flight.setdefault("ranking", {})
        ranking["badges"] = []
        ranking["recommended"] = False
        flight["is_recommended"] = False

    flights[0]["badge"] = "Best Match"
    flights[0]["ranking"]["badges"] = ["Best Match"]
    flights[0]["ranking"]["recommended"] = True
    flights[0]["is_recommended"] = True

    cheapest = min(
        flights,
        key=lambda flight: _safe_price(flight.get("price")) or float("inf"),
    )
    fastest = min(
        flights,
        key=lambda flight: int(flight.get("duration_minutes") or _parse_duration_minutes(flight.get("duration")) or 0) or float("inf"),
    )

    if cheapest is not flights[0]:
        cheapest["badge"] = "Cheapest"
        cheapest["ranking"]["badges"] = ["Cheapest"]
    if fastest is not flights[0] and fastest is not cheapest:
        fastest["badge"] = "Fastest"
        fastest["ranking"]["badges"] = ["Fastest"]


def _build_basic_segment(flight: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            "marketingCarrier": flight.get("airline_code") or flight.get("airline"),
            "operatingCarrier": flight.get("airline_code") or flight.get("airline"),
            "flightNumber": flight.get("flight_number"),
            "aircraft": flight.get("aircraft"),
            "departureAt": flight.get("departure_time"),
            "arrivalAt": flight.get("arrival_time"),
            "originIata": flight.get("from_iata"),
            "destinationIata": flight.get("to_iata"),
            "terminalDeparture": flight.get("departure_terminal"),
            "terminalArrival": flight.get("arrival_terminal"),
        }
    ]


async def _enrich_with_flightaware(flights: List[Dict[str, Any]], limit: int = 5) -> None:
    """Fetch FlightAware operational metadata for the top N candidate flights."""
    candidates = []
    for index, flight in enumerate(flights[:limit]):
        flight_number = flight.get("flight_number")
        if not flight_number:
            continue
        route = flight.get("route") or {}
        expected_origin = route.get("originIata") or flight.get("from_iata")
        expected_destination = route.get("destinationIata") or flight.get("to_iata")
        expected_depart_date = (
            flight.get("departure_date")
            or str(flight.get("departure_at") or "")[:10]
            or None
        )
        candidates.append(
            (
                index,
                flight_number,
                expected_origin,
                expected_destination,
                expected_depart_date,
            )
        )
    if not candidates:
        return

    results = await asyncio.gather(
        *[
            get_flight_details(
                flight_number,
                expected_origin=expected_origin,
                expected_destination=expected_destination,
                expected_depart_date=expected_depart_date,
            )
            for _, flight_number, expected_origin, expected_destination, expected_depart_date in candidates
        ],
        return_exceptions=True,
    )
    for (index, _, _, _, _), result in zip(candidates, results):
        if isinstance(result, Exception) or not isinstance(result, dict):
            continue
        if not result.get("found"):
            continue
        if result.get("route_match") is False:
            continue
        if result.get("date_match") is False:
            continue
        reliability_score = _estimate_reliability_score(result)
        delay_risk = _estimate_delay_risk(result)
        flights[index]["operations"] = {
            "aircraft": result.get("aircraft_type") or flights[index].get("operations", {}).get("aircraft"),
            "reliabilityScore": reliability_score,
            "delayRisk": delay_risk,
            "status": result.get("status"),
            "operator": result.get("operator"),
        }
        flights[index]["provider_refs"]["flightaware"]["faFlightId"] = result.get("fa_flight_id")


def _estimate_reliability_score(result: Dict[str, Any]) -> Optional[float]:
    status = str(result.get("status") or "").lower()
    if not status:
        return None
    if "cancel" in status or "divert" in status:
        return 2.5
    if "delayed" in status or "late" in status:
        return 5.0
    if "scheduled" in status:
        return 7.0
    if "en route" in status or "arrived" in status or "landed" in status or "on time" in status:
        return 8.5
    return 6.5


def _estimate_delay_risk(result: Dict[str, Any]) -> Optional[str]:
    status = str(result.get("status") or "").lower()
    if not status:
        return None
    if "cancel" in status or "divert" in status:
        return "high"
    if "delayed" in status or "late" in status:
        return "medium"
    return "low"


def _apply_operational_bonus(flights: List[Dict[str, Any]]) -> None:
    """Boost score for flights with high FlightAware reliability and add a reliability perk."""
    for flight in flights:
        ops = flight.get("operations") or {}
        reliability = ops.get("reliabilityScore")
        if reliability is None:
            continue
        base_score = float(flight.get("score") or 0.0)
        adjusted_score = min(10.0, round(base_score + ((float(reliability) - 5.0) / 5.0), 1))
        flight["score"] = adjusted_score
        flight["ranking"]["baseScore"] = adjusted_score
        if reliability >= 8 and "Reliable operation" not in (flight.get("perks") or []):
            flight.setdefault("perks", []).append("Reliable operation")


def _score_and_tag_flights(flights: List[Dict[str, Any]], budget: float | None) -> None:
    if not flights:
        return

    valid_prices = [_safe_price(f.get("price_total")) for f in flights]
    durations = [_parse_duration_minutes(f.get("duration")) for f in flights]
    comparable_prices = [price for price in valid_prices if price is not None]
    if not comparable_prices or not durations:
        return

    min_price = min(comparable_prices)
    max_price = max(comparable_prices)
    min_dur = min(durations)
    max_dur = max(durations)

    for f, price, dur in zip(flights, valid_prices, durations):
        comparable_price = price if price is not None else max_price
        # Normalize price: cheaper is better but not the only factor
        price_score = 1.0
        if max_price > min_price:
            price_score = 1 - (comparable_price - min_price) / (max_price - min_price)
        # Normalize duration: shorter is better and slightly more important than price
        dur_score = 1.0
        if max_dur > min_dur:
            dur_score = 1 - (dur - min_dur) / (max_dur - min_dur)
        # Extra penalty for flights that are much longer than the fastest option
        if dur > min_dur * 1.5:
            dur_score *= 0.7
        if dur > min_dur * 2:
            dur_score *= 0.5

        stops = f.get("stops", 0) or 0
        stops_score = 1.0 if stops == 0 else 0.6 if stops == 1 else 0.3

        # Balance: duration 40%, price 35%, stops 25%
        score = 10 * (0.35 * price_score + 0.40 * dur_score + 0.25 * stops_score)
        f["score"] = round(score, 1)

        reasons: list[str] = []
        if budget and comparable_price <= budget:
            reasons.append("Within your budget")
        if stops == 0:
            reasons.append("Non-stop flight")
        elif stops == 1:
            reasons.append("Only one short stop")
        if comparable_price == min_price:
            reasons.append("Cheapest option for this search")
        if dur == min_dur:
            reasons.append("Fastest overall journey time")

        f["score_reason"] = "; ".join(reasons) if reasons else "Balanced option for this route"

    # Tag badges
    flights.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    if flights:
        flights[0]["badge"] = "Best Overall"
    cheapest = min(flights, key=lambda x: _safe_price(x.get("price_total")) or float("inf"))
    fastest = min(flights, key=lambda x: _parse_duration_minutes(x.get("duration")))
    if cheapest is not flights[0]:
        cheapest["badge"] = "Cheapest"
    if fastest is not flights[0] and fastest is not cheapest:
        fastest["badge"] = "Fastest"


def _parse_duration_minutes(duration: str | None) -> int:
    if not duration:
        return 0
    # Amadeus duration format like "PT4H30M"
    if duration.startswith("PT"):
        hours = minutes = 0
        s = duration[2:]
        if "H" in s:
            h_part, s = s.split("H", 1)
            try:
                hours = int(h_part)
            except ValueError:
                hours = 0
        if "M" in s:
            m_part = s.split("M", 1)[0]
            try:
                minutes = int(m_part)
            except ValueError:
                minutes = 0
        return hours * 60 + minutes
    # Fallback: parse like "4h 30m"
    total = 0
    for piece in str(duration).lower().replace(" ", "").split("h"):
        if "m" in piece:
            try:
                minutes = int(piece.split("m", 1)[0] or 0)
            except ValueError:
                minutes = 0
            total += minutes
        else:
            try:
                hours = int(piece or 0)
            except ValueError:
                hours = 0
            total += hours * 60
    return total


def _short_time(iso_or_str: str | None) -> str:
    if not iso_or_str:
        return ""
    s = str(iso_or_str)
    time_match = re.search(r"\b(\d{1,2}):(\d{2})\b", s)
    if time_match:
        hour = int(time_match.group(1))
        minute = time_match.group(2)
        return f"{hour:02d}:{minute}"

    # Fallback for ISO-like values when regex fails unexpectedly
    if "T" in s:
        time_part = s.split("T", 1)[1]
        return time_part[:5]
    return s[:5]


def _date_part(iso_or_str: str | None) -> str:
    if not iso_or_str:
        return ""
    s = str(iso_or_str)
    if "T" in s:
        return s.split("T", 1)[0]
    match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", s)
    return match.group(1) if match else ""


def _human_duration(duration: str | None) -> str:
    minutes = _parse_duration_minutes(duration)
    if not minutes:
        return ""
    h = minutes // 60
    m = minutes % 60
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


def _build_booking_urls(
    origin: str,
    destination: str,
    depart_date: str,
    return_date: str | None,
    passengers: int,
    cabin: str,
) -> Dict[str, str]:
    return {
        "google": build_google_flights_url(origin, destination, depart_date, return_date, passengers, cabin),
    }
