"""Alert helpers for listing, refreshing, and AI-editing price alerts."""

from __future__ import annotations

import json
import os
import re
import uuid
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, Iterable, Optional

from dateutil import parser as date_parser
from openai import OpenAI
from sqlalchemy.orm import Session

from models.price_alert import PriceAlert
from services.amadeus_client import FlightSearchParams, search_flights_amadeus
from services.flight_ai import build_google_flights_url, get_iata
from services.departure_currency import serpapi_gl_for_iata
from services.serpapi_flights import search_flights_serpapi


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ALERT_ANALYSIS_MODEL = os.getenv("OPENAI_ALERT_ANALYSIS_MODEL", "gpt-4o")
ALERT_EDIT_MODEL = os.getenv("OPENAI_ALERT_EDIT_MODEL", "gpt-4o")
ALERT_REFRESH_TTL = timedelta(
    hours=max(int(os.getenv("PRICE_ALERT_REFRESH_TTL_HOURS", "8")), 1)
)
MAX_ALERT_REFRESHES_PER_REQUEST = max(
    int(os.getenv("PRICE_ALERT_MAX_REFRESHES_PER_REQUEST", "1")),
    1,
)
LIVE_SEARCH_TIMEOUT_SECONDS = max(
    float(os.getenv("PRICE_ALERT_LIVE_SEARCH_TIMEOUT_SECONDS", "10.0")),
    1.0,
)
ALERT_AI_TIMEOUT_SECONDS = max(
    float(os.getenv("PRICE_ALERT_AI_TIMEOUT_SECONDS", "3.5")),
    1.0,
)
SCHEDULER_BATCH_SIZE = max(
    int(os.getenv("PRICE_ALERT_SCHEDULER_BATCH_SIZE", "120")),
    1,
)
SCHEDULER_MAX_REFRESH_PER_RUN = max(
    int(os.getenv("PRICE_ALERT_SCHEDULER_MAX_REFRESH_PER_RUN", "60")),
    1,
)
BOOK_NOW_DROP_PCT = max(
    float(os.getenv("PRICE_ALERT_BOOK_NOW_DROP_PCT", "3.0")),
    0.1,
)

client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


def _decimal_to_float(value: Decimal | float | int | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _normalize_alert_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = re.sub(r"\s+", " ", value).strip()
    return normalized or None


def _normalize_location(value: str | None) -> str | None:
    normalized = _normalize_alert_text(value)
    if not normalized:
        return None

    if len(normalized) <= 3 and normalized.isalpha():
        return normalized.upper()

    return normalized.title()


def _normalize_airline(value: str | None) -> str | None:
    normalized = _normalize_alert_text(value)
    if not normalized:
        return None

    return normalized.title()


def _normalize_currency(value: str | None) -> str | None:
    normalized = _normalize_alert_text(value)
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


_MONTH_NAME_PATTERN = (
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
)


def _extract_airline_from_instruction(instruction: str) -> str | None:
    text = _normalize_alert_text(instruction)
    if not text:
        return None

    lowered = text.lower()
    if "any airline" in lowered or "no airline preference" in lowered:
        return None

    patterns = [
        r"\b(?:airline|carrier)\s*(?:is|=|:)?\s*([A-Za-z][A-Za-z .&-]{1,60})",
        r"\b(?:for|with|on)\s+([A-Z][A-Za-z.&-]*(?:\s+[A-Z][A-Za-z.&-]*){0,3})\b",
    ]

    disallowed = {
        "alert",
        "price alert",
        "trip",
        "route",
        "flexible dates",
        "any airline",
        "any dates",
    }

    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        candidate = _normalize_airline(match.group(1))
        if not candidate:
            continue
        candidate_lower = candidate.lower()
        if candidate_lower in disallowed:
            continue
        if re.fullmatch(_MONTH_NAME_PATTERN, candidate_lower):
            continue
        return candidate

    return None


def _extract_date_range_from_instruction(instruction: str) -> str | None:
    text = _normalize_alert_text(instruction)
    if not text:
        return None

    lowered = text.lower()
    if any(
        phrase in lowered
        for phrase in ("any date", "any dates", "flexible date", "flexible dates")
    ):
        return "Flexible dates"

    iso_dates = _parse_iso_dates(text)
    if len(iso_dates) >= 2:
        return f"{iso_dates[0]} to {iso_dates[1]}"
    if len(iso_dates) == 1:
        return iso_dates[0]

    range_patterns = [
        rf"({_MONTH_NAME_PATTERN}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,\s*|\s+)\d{{4}}\s*(?:to|until|through|[-–—])\s*(?:{_MONTH_NAME_PATTERN}\s+)?\d{{1,2}}(?:st|nd|rd|th)?(?:,\s*|\s+)\d{{4}})",
        rf"({_MONTH_NAME_PATTERN}\s+\d{{4}}\s*(?:to|until|through|[-–—])\s*{_MONTH_NAME_PATTERN}\s+\d{{4}})",
        r"(\d{1,2}[-/]\d{1,2}[-/]\d{4}\s*(?:to|until|through|[-–—])\s*\d{1,2}[-/]\d{1,2}[-/]\d{4})",
    ]
    for pattern in range_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return _normalize_alert_text(match.group(1))

    single_patterns = [
        rf"\bon\s+({_MONTH_NAME_PATTERN}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,\s*|\s+)\d{{4}})\b",
        r"\bon\s+(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b",
        rf"\b(?:for|in)\s+({_MONTH_NAME_PATTERN}\s+\d{{4}})\b",
        rf"\b(?:depart|departure|date)\s*(?:is|=|:)?\s*({_MONTH_NAME_PATTERN}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,\s*|\s+)\d{{4}})\b",
    ]
    for pattern in single_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return _normalize_alert_text(match.group(1))

    return None


def _parse_iso_dates(text: str) -> list[str]:
    return re.findall(r"\b\d{4}-\d{2}-\d{2}\b", text)


def _has_explicit_year(text: str) -> bool:
    return bool(re.search(r"\b\d{4}\b", text))


def _parse_single_date(part: str, now: datetime) -> str | None:
    cleaned = _normalize_alert_text(part)
    if not cleaned:
        return None

    parsed = date_parser.parse(
        cleaned,
        fuzzy=True,
        default=now.replace(hour=12, minute=0, second=0, microsecond=0),
    )
    if not _has_explicit_year(cleaned) and parsed.date() < now.date():
        parsed = parsed.replace(year=parsed.year + 1)
    return parsed.date().isoformat()


def parse_alert_date_range(date_range: str | None, now: datetime | None = None) -> tuple[str | None, str | None]:
    normalized = _normalize_alert_text(date_range)
    if not normalized:
        return (None, None)

    lowered = normalized.lower()
    if lowered in {"any date", "any dates", "flexible", "flexible dates"}:
        return (None, None)

    today = now or datetime.utcnow()
    iso_dates = _parse_iso_dates(normalized)
    if iso_dates:
        depart = iso_dates[0]
        return_date = iso_dates[1] if len(iso_dates) > 1 else None
        return (depart, return_date)

    split_match = re.split(r"\s+(?:to|until)\s+|\s+[–—-]\s+", normalized, maxsplit=1)
    if len(split_match) == 2:
        first_part, second_part = split_match
        month_match = re.match(r"([A-Za-z]+)", first_part.strip())
        if month_match and not re.search(r"[A-Za-z]", second_part):
            second_part = f"{month_match.group(1)} {second_part}"

        depart = _parse_single_date(first_part, today)
        return_date = _parse_single_date(second_part, today)
        return (depart, return_date)

    return (_parse_single_date(normalized, today), None)


def _compute_change(previous_price: float | None, current_price: float | None) -> tuple[str | None, str | None]:
    if previous_price is None or current_price is None or previous_price <= 0:
        return (None, None)

    delta_pct = ((current_price - previous_price) / previous_price) * 100
    if abs(delta_pct) < 0.5:
        return ("flat", "0%")

    trend = "down" if delta_pct < 0 else "up"
    return (trend, f"{abs(delta_pct):.1f}%")


def _days_until_departure(date_range: str | None, now: datetime | None = None) -> int | None:
    depart_date, _ = parse_alert_date_range(date_range, now)
    if not depart_date:
        return None
    try:
        dep = date_parser.parse(depart_date).date()
    except Exception:
        return None
    return (dep - (now or datetime.utcnow()).date()).days


def _parse_change_pct_value(change_pct: str | None) -> float | None:
    if not change_pct:
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", str(change_pct))
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def evaluate_book_now_signal(
    previous_price: float | None,
    refreshed_alert: dict[str, Any],
    *,
    drop_threshold_pct: float = BOOK_NOW_DROP_PCT,
) -> dict[str, Any]:
    current_price = refreshed_alert.get("currentPrice")
    lowest_price = refreshed_alert.get("lowestPrice")
    trend = (refreshed_alert.get("trend") or "flat").lower()
    change_pct = _parse_change_pct_value(refreshed_alert.get("changePct"))

    reasons: list[str] = []
    if isinstance(current_price, (int, float)) and isinstance(lowest_price, (int, float)) and current_price <= lowest_price:
        reasons.append("new_low")
    if trend == "down" and change_pct is not None and change_pct >= drop_threshold_pct:
        reasons.append("sharp_drop")
    if isinstance(previous_price, (int, float)) and isinstance(current_price, (int, float)) and current_price < previous_price:
        reasons.append("price_below_last_check")

    should_notify = len(reasons) > 0
    return {
        "should_notify": should_notify,
        "signal": "low" if should_notify else "watch",
        "reasons": reasons,
        "previous_price": previous_price,
        "current_price": current_price,
        "change_pct": refreshed_alert.get("changePct"),
    }


def should_refresh_alert(alert: PriceAlert, now: datetime | None = None) -> bool:
    if not alert.is_active:
        return False

    if alert.current_price is None:
        return True

    checked_at = alert.updated_at or alert.created_at
    if checked_at is None:
        return True

    return (now or datetime.utcnow()) - checked_at >= ALERT_REFRESH_TTL


def get_price_alert_for_user(db: Session, alert_id: str, user_id: str) -> PriceAlert | None:
    try:
        alert_uuid = uuid.UUID(alert_id)
    except ValueError:
        return None

    return (
        db.query(PriceAlert)
        .filter(PriceAlert.id == alert_uuid, PriceAlert.user_id == user_id)
        .first()
    )


def _extract_live_price_candidates(
    flights: Iterable[Dict[str, Any]],
    airline: str | None,
) -> tuple[list[float], str | None]:
    normalized_airline = (airline or "").strip().lower()
    filtered_flights = list(flights)
    source = "market"

    if normalized_airline:
        airline_matches = [
            flight
            for flight in filtered_flights
            if normalized_airline in (flight.get("airline") or "").strip().lower()
        ]
        if airline_matches:
            filtered_flights = airline_matches
            source = "airline"

    prices = sorted(
        float(flight["price"])
        for flight in filtered_flights
        if flight.get("price") is not None
    )
    return prices, source


def _extract_provider_prices(
    flights: Iterable[Dict[str, Any]],
    airline: str | None,
) -> tuple[list[float], str | None]:
    normalized: list[Dict[str, Any]] = []
    for flight in flights:
        raw_price = flight.get("price")
        if raw_price is None:
            raw_price = flight.get("price_total")
        if raw_price is None:
            continue
        try:
            parsed = float(raw_price)
        except (TypeError, ValueError):
            continue
        if parsed <= 0:
            continue
        normalized.append(
            {
                "price": parsed,
                "airline": flight.get("airline"),
            },
        )
    return _extract_live_price_candidates(normalized, airline)


async def _fetch_live_alert_prices(
    *,
    origin: str,
    destination: str,
    depart_date: str,
    return_date: str | None,
    airline: str | None,
    currency: str,
) -> tuple[list[float], str | None, str | None]:
    amadeus_task = search_flights_amadeus(
        FlightSearchParams(
            origin=origin,
            destination=destination,
            depart_date=depart_date,
            return_date=return_date,
            adults=1,
            currency=currency,
            max_price=None,
            cabin="economy",
        ),
    )
    serpapi_task = search_flights_serpapi(
        origin,
        destination,
        depart_date,
        return_date,
        1,
        currency,
        gl_country=serpapi_gl_for_iata(get_iata(origin)),
    )
    amadeus_result, serpapi_result = await asyncio.gather(
        amadeus_task,
        serpapi_task,
        return_exceptions=True,
    )

    if isinstance(amadeus_result, Exception):
        amadeus_flights: list[Dict[str, Any]] = []
        amadeus_reason: str | None = f"Amadeus error: {amadeus_result}"
    else:
        amadeus_flights = amadeus_result[0] or []
        amadeus_reason = amadeus_result[1] if len(amadeus_result) > 1 else None

    if isinstance(serpapi_result, Exception):
        serpapi_flights: list[Dict[str, Any]] = []
        serpapi_reason: str | None = f"SerpAPI error: {serpapi_result}"
    else:
        serpapi_flights = serpapi_result[0] or []
        serpapi_reason = serpapi_result[1] if len(serpapi_result) > 1 else None

    serpapi_prices, serpapi_mode = _extract_provider_prices(serpapi_flights, airline)
    amadeus_prices, amadeus_mode = _extract_provider_prices(amadeus_flights, airline)

    # Google Flights parity first: prefer SerpAPI prices whenever available.
    if serpapi_prices:
        return (
            serpapi_prices,
            "serpapi_airline" if serpapi_mode == "airline" else "serpapi",
            None,
        )

    if amadeus_prices:
        return (
            amadeus_prices,
            "amadeus_airline" if amadeus_mode == "airline" else "amadeus",
            None,
        )

    reasons = [reason for reason in (serpapi_reason, amadeus_reason) if reason]
    return (
        [],
        None,
        "; ".join(reasons) if reasons else "No live fares were returned by SerpAPI or Amadeus.",
    )


def _build_fallback_alert_insight(
    alert: PriceAlert,
    *,
    depart_date: str | None,
    live_price_source: str | None = None,
    live_prices: list[float] | None = None,
    search_reason: str | None = None,
) -> dict[str, str | None]:
    current_price = _decimal_to_float(alert.current_price)
    lowest_price = _decimal_to_float(alert.lowest_price)
    trend = (alert.trend or "flat").lower()

    if not depart_date:
        return {
            "analysis_summary": "Add a departure date to enable live price checks for this alert.",
            "price_outlook": "watch",
            "timing_hint": "Once a date is set, the alert can compare live fares and tell you when pricing is improving.",
            "live_price_source": None,
        }

    days_until_departure = (
        date_parser.parse(depart_date).date() - datetime.utcnow().date()
    ).days

    if current_price is None:
        summary = (
            search_reason
            or "A fresh live price was not available, so this alert is relying on previously saved data."
        )
        return {
            "analysis_summary": summary,
            "price_outlook": "watch",
            "timing_hint": "Check again later or widen the date and airline filters for better coverage.",
            "live_price_source": live_price_source,
        }

    if lowest_price is None:
        lowest_price = current_price

    near_low = current_price <= lowest_price * 1.03 if lowest_price else False

    if trend == "down" and near_low:
        summary = "Current pricing is close to the tracked low and still moving down."
        timing_hint = "This is a strong booking window if the route fits your plans."
        outlook = "low"
    elif trend == "up" and days_until_departure <= 14:
        summary = "Prices are rising close to departure, which usually means less room for a cheaper fare."
        timing_hint = "Book soon if this trip is fixed, because late fares often stay elevated."
        outlook = "high"
    elif trend == "down":
        summary = "Prices are easing compared with the last tracked check."
        timing_hint = "Watch for another dip, especially if you still have a few weeks before departure."
        outlook = "low"
    elif trend == "up":
        summary = "Prices have moved up from the last tracked check."
        timing_hint = "Keep watching, but expect less flexibility if travel is coming up soon."
        outlook = "watch"
    else:
        summary = "Pricing is relatively stable based on the latest tracked checks."
        timing_hint = "There is no strong signal yet, so keep the alert active and compare again later."
        outlook = "watch"

    if live_prices:
        market_low = min(live_prices)
        market_high = max(live_prices)
        source_label = (
            "matching airline"
            if str(live_price_source or "").endswith("airline")
            else "market"
        )
        summary = (
            f"{summary} Live {source_label} fares are currently ranging from "
            f"{market_low:.0f} to {market_high:.0f} {alert.currency or 'USD'}."
        )

    return {
        "analysis_summary": summary,
        "price_outlook": outlook,
        "timing_hint": timing_hint,
        "live_price_source": live_price_source,
    }


def _generate_ai_alert_insight(
    alert: PriceAlert,
    *,
    depart_date: str | None,
    return_date: str | None,
    live_prices: list[float],
    live_price_source: str | None,
) -> dict[str, str | None]:
    fallback = _build_fallback_alert_insight(
        alert,
        depart_date=depart_date,
        live_price_source=live_price_source,
        live_prices=live_prices,
    )

    if client is None or not live_prices or alert.current_price is None:
        return fallback

    prompt = {
        "route": f"{alert.origin} to {alert.destination}",
        "airline": alert.airline or "any airline",
        "departure_date": depart_date,
        "return_date": return_date,
        "currency": alert.currency or "USD",
        "current_price": _decimal_to_float(alert.current_price),
        "lowest_tracked_price": _decimal_to_float(alert.lowest_price),
        "trend": alert.trend or "flat",
        "change_pct": alert.change_pct,
        "live_price_source": live_price_source or "market",
        "live_market_prices": live_prices[:5],
        "last_checked_at": alert.updated_at.isoformat() if alert.updated_at else None,
    }

    try:
        response = client.chat.completions.create(
            model=ALERT_ANALYSIS_MODEL,
            temperature=0.2,
            max_completion_tokens=180,
            timeout=ALERT_AI_TIMEOUT_SECONDS,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You summarize flight alert pricing. Return only valid JSON with keys "
                        "analysis_summary, price_outlook, timing_hint. "
                        "price_outlook must be one of low, watch, high. Keep each value concise."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(prompt),
                },
            ],
        )
        raw = (response.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()
        parsed = json.loads(raw)
    except Exception:
        return fallback

    analysis_summary = _normalize_alert_text(parsed.get("analysis_summary"))
    timing_hint = _normalize_alert_text(parsed.get("timing_hint"))
    price_outlook = _normalize_alert_text(parsed.get("price_outlook"))

    return {
        "analysis_summary": analysis_summary or fallback["analysis_summary"],
        "price_outlook": (
            price_outlook.lower()
            if price_outlook and price_outlook.lower() in {"low", "watch", "high"}
            else fallback["price_outlook"]
        ),
        "timing_hint": timing_hint or fallback["timing_hint"],
        "live_price_source": live_price_source,
    }


def serialize_price_alert(
    alert: PriceAlert,
    *,
    insight: dict[str, str | None] | None = None,
    depart_date: str | None = None,
    return_date: str | None = None,
    live_prices: list[float] | None = None,
    live_search_available: bool | None = None,
) -> dict[str, Any]:
    resolved_insight = insight or _build_fallback_alert_insight(
        alert,
        depart_date=depart_date,
        live_prices=live_prices,
    )

    current_price = _decimal_to_float(alert.current_price)
    lowest_price = _decimal_to_float(alert.lowest_price)
    book_url = (
        build_google_flights_url(
            alert.origin,
            alert.destination,
            depart_date,
            return_date,
            1,
            "economy",
        )
        if depart_date
        else None
    )

    return {
        "id": str(alert.id),
        "origin": alert.origin,
        "destination": alert.destination,
        "route": f"{alert.origin} → {alert.destination}",
        "airline": alert.airline,
        "dateRange": alert.date_range,
        "currentPrice": current_price,
        "lowestPrice": lowest_price,
        "currency": alert.currency,
        "trend": (alert.trend or "flat").lower(),
        "changePct": alert.change_pct,
        "active": alert.is_active,
        "createdAt": alert.created_at.isoformat() if alert.created_at else None,
        "updatedAt": alert.updated_at.isoformat() if alert.updated_at else None,
        "analysisSummary": resolved_insight.get("analysis_summary"),
        "priceOutlook": resolved_insight.get("price_outlook"),
        "timingHint": resolved_insight.get("timing_hint"),
        "livePriceSource": resolved_insight.get("live_price_source"),
        "livePriceCheckedAt": alert.updated_at.isoformat() if alert.updated_at else None,
        "departureDate": depart_date,
        "returnDate": return_date,
        "liveSearchAvailable": live_search_available,
        "bookUrl": book_url,
    }


async def refresh_price_alert(
    db: Session,
    alert: PriceAlert,
    *,
    force: bool = False,
) -> dict[str, Any]:
    now = datetime.utcnow()
    depart_date, return_date = parse_alert_date_range(alert.date_range, now)
    current_before_refresh = _decimal_to_float(alert.current_price)
    live_prices: list[float] = []
    live_price_source: str | None = None
    search_reason: str | None = None
    live_search_available = bool(depart_date)

    if force or should_refresh_alert(alert, now):
        if alert.is_active and depart_date:
            try:
                live_prices, live_price_source, search_reason = await asyncio.wait_for(
                    _fetch_live_alert_prices(
                        origin=alert.origin,
                        destination=alert.destination,
                        depart_date=depart_date,
                        return_date=return_date,
                        airline=alert.airline,
                        currency=(alert.currency or "USD").upper(),
                    ),
                    timeout=LIVE_SEARCH_TIMEOUT_SECONDS,
                )
            except Exception as exc:
                search_reason = str(exc)

            if live_prices:
                current_price = live_prices[0]
                alert.current_price = current_price
                if alert.lowest_price is None or current_price < float(alert.lowest_price):
                    alert.lowest_price = current_price
                trend, change_pct = _compute_change(
                    current_before_refresh,
                    current_price,
                )
                alert.trend = trend
                alert.change_pct = change_pct
            elif alert.current_price is not None and not alert.trend:
                alert.trend = "flat"
                alert.change_pct = "0%"

        alert.updated_at = now
        db.add(alert)
        db.commit()
        db.refresh(alert)

    insight = _generate_ai_alert_insight(
        alert,
        depart_date=depart_date,
        return_date=return_date,
        live_prices=live_prices,
        live_price_source=live_price_source,
    ) if live_prices else _build_fallback_alert_insight(
        alert,
        depart_date=depart_date,
        live_price_source=live_price_source,
        live_prices=live_prices,
        search_reason=search_reason,
    )

    return serialize_price_alert(
        alert,
        insight=insight,
        depart_date=depart_date,
        return_date=return_date,
        live_prices=live_prices,
        live_search_available=live_search_available,
    )


def build_alert_snapshot(alert: PriceAlert) -> dict[str, Any]:
    depart_date, return_date = parse_alert_date_range(alert.date_range)
    return serialize_price_alert(
        alert,
        depart_date=depart_date,
        return_date=return_date,
        live_search_available=bool(depart_date),
    )


async def list_price_alerts(
    db: Session,
    user_id: str,
    *,
    refresh_live: bool = True,
) -> list[dict[str, Any]]:
    alerts = (
        db.query(PriceAlert)
        .filter(PriceAlert.user_id == user_id)
        .order_by(PriceAlert.is_active.desc(), PriceAlert.updated_at.desc(), PriceAlert.created_at.desc())
        .all()
    )

    remaining_refreshes = MAX_ALERT_REFRESHES_PER_REQUEST
    serialized: list[dict[str, Any]] = []

    for alert in alerts:
        should_force_live_refresh = (
            refresh_live
            and remaining_refreshes > 0
            and bool(alert.is_active)
        )
        if should_force_live_refresh:
            try:
                serialized.append(
                    await asyncio.wait_for(
                        refresh_price_alert(db, alert, force=True),
                        timeout=LIVE_SEARCH_TIMEOUT_SECONDS + 1.0,
                    )
                )
            except Exception:
                serialized.append(build_alert_snapshot(alert))
            remaining_refreshes -= 1
        else:
            serialized.append(build_alert_snapshot(alert))

    return serialized


async def refresh_active_alerts_for_scheduler(
    db: Session,
    *,
    limit: int = SCHEDULER_MAX_REFRESH_PER_RUN,
    now: datetime | None = None,
) -> dict[str, Any]:
    current_time = now or datetime.utcnow()
    max_limit = max(1, min(limit, SCHEDULER_BATCH_SIZE))
    active_alerts = (
        db.query(PriceAlert)
        .filter(PriceAlert.is_active.is_(True))
        .order_by(PriceAlert.updated_at.asc(), PriceAlert.created_at.asc())
        .limit(SCHEDULER_BATCH_SIZE)
        .all()
    )

    prioritized = sorted(
        active_alerts,
        key=lambda alert: (
            _days_until_departure(alert.date_range, current_time) is None,
            _days_until_departure(alert.date_range, current_time) if _days_until_departure(alert.date_range, current_time) is not None else 10_000,
            alert.updated_at or alert.created_at or current_time,
        ),
    )

    refreshed_count = 0
    triggered: list[dict[str, Any]] = []
    skipped_due_ttl = 0

    for alert in prioritized:
        if refreshed_count >= max_limit:
            break
        if not should_refresh_alert(alert, current_time):
            skipped_due_ttl += 1
            continue

        previous_price = _decimal_to_float(alert.current_price)
        try:
            refreshed = await refresh_price_alert(db, alert, force=True)
        except Exception:
            continue
        refreshed_count += 1

        signal = evaluate_book_now_signal(previous_price, refreshed)
        if signal["should_notify"]:
            triggered.append(
                {
                    "alert_id": refreshed.get("id"),
                    "user_id": alert.user_id,
                    "route": refreshed.get("route"),
                    "currency": refreshed.get("currency"),
                    "signal": signal["signal"],
                    "reasons": signal["reasons"],
                    "previous_price": signal["previous_price"],
                    "current_price": signal["current_price"],
                    "change_pct": signal["change_pct"],
                    "book_url": refreshed.get("bookUrl"),
                }
            )

    return {
        "checked_active": len(active_alerts),
        "refreshed": refreshed_count,
        "skipped_due_ttl": skipped_due_ttl,
        "triggers": triggered,
    }


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return json.loads(text)


def _fallback_edit_patch(instruction: str) -> dict[str, Any]:
    text = instruction.lower()
    patch: dict[str, Any] = {
        "origin": None,
        "destination": None,
        "airline": _extract_airline_from_instruction(instruction),
        "date_range": _extract_date_range_from_instruction(instruction),
        "clear_airline": False,
        "clear_date_range": False,
        "is_active": None,
    }

    if "pause" in text:
        patch["is_active"] = False
    elif "resume" in text or "activate" in text:
        patch["is_active"] = True

    if "any airline" in text or "remove airline" in text or "clear airline" in text:
        patch["clear_airline"] = True

    if "any date" in text or "flexible dates" in text or "clear date" in text:
        patch["clear_date_range"] = True

    route_match = re.search(r"\bfrom\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+)\b", instruction, re.IGNORECASE)
    if route_match:
        patch["origin"] = _normalize_location(route_match.group(1))
        patch["destination"] = _normalize_location(route_match.group(2))

    return patch


def _parse_ai_create_payload(instruction: str) -> dict[str, Any]:
    fallback = _fallback_edit_patch(instruction)
    if client is None:
        return {
            "origin": fallback.get("origin"),
            "destination": fallback.get("destination"),
            "airline": fallback.get("airline"),
            "date_range": fallback.get("date_range"),
            "is_active": fallback.get("is_active"),
            "currency": None,
        }

    try:
        response = client.chat.completions.create(
            model=ALERT_EDIT_MODEL,
            temperature=0.1,
            max_completion_tokens=220,
            timeout=ALERT_AI_TIMEOUT_SECONDS,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract structured data for a flight price alert. "
                        "Return only valid JSON with keys: origin, destination, airline, "
                        "date_range, is_active, currency. "
                        "Use null for unknown fields. "
                        "date_range can be flexible natural language like 'May 10 to May 18, 2026'."
                    ),
                },
                {
                    "role": "user",
                    "content": instruction,
                },
            ],
        )
        parsed = _extract_json_object(response.choices[0].message.content or "")
    except Exception:
        return {
            "origin": fallback.get("origin"),
            "destination": fallback.get("destination"),
            "airline": fallback.get("airline"),
            "date_range": fallback.get("date_range"),
            "is_active": fallback.get("is_active"),
            "currency": None,
        }

    return {
        "origin": _normalize_location(parsed.get("origin")) or fallback.get("origin"),
        "destination": _normalize_location(parsed.get("destination")) or fallback.get("destination"),
        "airline": _normalize_airline(parsed.get("airline")) or fallback.get("airline"),
        "date_range": _normalize_alert_text(parsed.get("date_range")) or fallback.get("date_range"),
        "is_active": (
            parsed.get("is_active")
            if isinstance(parsed.get("is_active"), bool)
            else fallback.get("is_active")
        ),
        "currency": _normalize_currency(parsed.get("currency")),
    }


def _parse_ai_edit_patch(alert: PriceAlert, instruction: str) -> dict[str, Any]:
    fallback = _fallback_edit_patch(instruction)
    if client is None:
        return fallback

    context = {
        "current_alert": {
            "origin": alert.origin,
            "destination": alert.destination,
            "airline": alert.airline,
            "date_range": alert.date_range,
            "is_active": alert.is_active,
        },
        "instruction": instruction,
    }

    try:
        response = client.chat.completions.create(
            model=ALERT_EDIT_MODEL,
            temperature=0.1,
            max_completion_tokens=220,
            timeout=ALERT_AI_TIMEOUT_SECONDS,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract structured updates for a saved flight price alert. "
                        "Return only valid JSON with keys: origin, destination, airline, date_range, "
                        "clear_airline, clear_date_range, is_active. "
                        "Use null for unchanged fields. Use clear_airline true when the user wants any airline. "
                        "Use clear_date_range true when the user wants flexible or cleared dates."
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
        "origin": _normalize_location(parsed.get("origin")) or fallback.get("origin"),
        "destination": _normalize_location(parsed.get("destination")) or fallback.get("destination"),
        "airline": _normalize_airline(parsed.get("airline")) or fallback.get("airline"),
        "date_range": _normalize_alert_text(parsed.get("date_range")) or fallback.get("date_range"),
        "clear_airline": bool(parsed.get("clear_airline")) or bool(fallback.get("clear_airline")),
        "clear_date_range": bool(parsed.get("clear_date_range")) or bool(fallback.get("clear_date_range")),
        "is_active": (
            parsed.get("is_active")
            if isinstance(parsed.get("is_active"), bool)
            else fallback["is_active"]
        ),
    }


async def apply_ai_edit_to_alert(
    db: Session,
    alert: PriceAlert,
    instruction: str,
) -> dict[str, Any]:
    normalized_instruction = _normalize_alert_text(instruction)
    if not normalized_instruction:
        raise ValueError("Instruction is required.")

    patch = _parse_ai_edit_patch(alert, normalized_instruction)

    changed_config = False

    if patch.get("origin") and patch["origin"] != alert.origin:
        alert.origin = patch["origin"]
        changed_config = True
    if patch.get("destination") and patch["destination"] != alert.destination:
        alert.destination = patch["destination"]
        changed_config = True
    if patch.get("clear_airline"):
        if alert.airline is not None:
            alert.airline = None
            changed_config = True
    elif patch.get("airline") and patch["airline"] != alert.airline:
        alert.airline = patch["airline"]
        changed_config = True
    if patch.get("clear_date_range"):
        if alert.date_range is not None:
            alert.date_range = None
            changed_config = True
    elif patch.get("date_range") and patch["date_range"] != alert.date_range:
        alert.date_range = patch["date_range"]
        changed_config = True
    if isinstance(patch.get("is_active"), bool):
        alert.is_active = patch["is_active"]

    if changed_config:
        alert.current_price = None
        alert.lowest_price = None
        alert.trend = None
        alert.change_pct = None

    alert.updated_at = datetime.utcnow()
    db.add(alert)
    db.commit()
    db.refresh(alert)

    return await refresh_price_alert(
        db,
        alert,
        force=changed_config or alert.is_active,
    )


async def create_price_alert_from_ai_instruction(
    db: Session,
    *,
    user_id: str,
    instruction: str,
) -> dict[str, Any]:
    normalized_instruction = _normalize_alert_text(instruction)
    if not normalized_instruction:
        raise ValueError("Instruction is required.")

    payload = _parse_ai_create_payload(normalized_instruction)
    if not payload.get("origin") or not payload.get("destination"):
        raise ValueError("Please include at least the origin and destination for the alert.")

    alert = PriceAlert(
        user_id=user_id,
        origin=payload["origin"],
        destination=payload["destination"],
        airline=payload.get("airline"),
        date_range=payload.get("date_range"),
        currency=payload.get("currency") or "USD",
        is_active=payload.get("is_active") if isinstance(payload.get("is_active"), bool) else True,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    return await refresh_price_alert(
        db,
        alert,
        force=bool(alert.is_active),
    )
