import json
import logging
import os
import re
import secrets
import hashlib
import threading
import time
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException, Depends, Header, Query, Body
from pydantic import BaseModel
from sqlalchemy import and_, func, text
from sqlalchemy.orm import Session

from orchestion import (
    build_streaming_chat_response,
    is_flight_result_followup,
    maybe_handle_direct_travel_request,
    should_stream_response,
)
from services.ai_planner import plan_chat_response
from services.flight_ai import (
    chat_response,
    get_iata,
    parse_flight_search_intent,
    present_flight_results,
    should_attempt_flight_search,
    _STRESS_COMFORT_RE,
)
from services.travel_tips import generate_travel_tip
from services.chat_titles import generate_chat_title
from services.flight_search import unified_flight_search_for_intent, UnifiedSearchParams
from services.tools.context import ToolExecutionContext
from services.amadeus_client import confirm_flight_price, get_seatmap_by_offer
from services.price_alerts import (
    apply_ai_edit_to_alert,
    build_alert_snapshot,
    create_price_alert_from_ai_instruction,
    get_price_alert_for_user,
    list_price_alerts,
    parse_alert_date_range,
    refresh_price_alert,
    refresh_active_alerts_for_scheduler,
)
from services.sessions import create_session, get_session, add_message, list_sessions, delete_session, import_sessions as import_chat_sessions
from services.sessions import to_session_user_uuid
from services.trips import (
    apply_ai_edit_to_trip,
    create_trip_from_ai_instruction,
    get_trip_for_user,
    serialize_trip,
)
from services.mock_flights import search_flights
from services.weather import get_weather, get_city_name, get_weather_advice
from services.maps import get_directions_url, get_destination_map_url, get_airport_name
from services.geocode import reverse_geocode
from services.flightaware_client import get_flight_details
from database import get_db, get_user_db, get_chat_db, engine_user
from models.chat import ChatSession, ChatMessage
from models.user import GuestPassengerProfile, User, TravelPreference
from models.trip import Trip
from models.price_alert import PriceAlert
from models.consent import ConsentRecord
from models.feedback import Feedback
from models.api_monitoring import ApiRequestLog
from models.admin_user import AdminUser
from auth import get_current_user_id, get_optional_user_id
import bcrypt

# ── Auth Setup (bcrypt only; avoids passlib + bcrypt>=4.1 init crash) ──
_BCRYPT_MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    raw = password.encode("utf-8")
    if len(raw) > _BCRYPT_MAX_PASSWORD_BYTES:
        raw = raw[:_BCRYPT_MAX_PASSWORD_BYTES]
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    try:
        digest = hashed_password.encode("utf-8")
        candidate = plain_password.encode("utf-8")
        if len(candidate) > _BCRYPT_MAX_PASSWORD_BYTES:
            candidate = candidate[:_BCRYPT_MAX_PASSWORD_BYTES]
        return bcrypt.checkpw(candidate, digest)
    except (ValueError, TypeError):
        return False


router = APIRouter()

_PENDING_ITINERARY_DRAFTS: dict[str, dict[str, Any]] = {}
_ITINERARY_DRAFT_TTL = timedelta(minutes=20)
_PENDING_TRIP_SAVES: dict[str, dict[str, Any]] = {}
_PENDING_ALERT_SAVES: dict[str, dict[str, Any]] = {}
_PENDING_ALERT_DRAFTS: dict[str, dict[str, Any]] = {}
_PENDING_PROFILE_SAVES: dict[str, dict[str, Any]] = {}
_FLIGHT_DOMAIN_HINT_RE = re.compile(
    r"\b("
    r"flight|flights|airline|airport|fare|ticket|book|booking|"
    r"nonstop|layover|departure|arrival|return|round trip|one way|"
    r"weather|forecast|temperature|map|directions|flight status|track flight|"
    r"baggage|meal|wifi|cheapest|fastest|compare option|"
    r"origin|destination|iata"
    r")\b",
    re.IGNORECASE,
)


def _cleanup_stale_itinerary_drafts() -> None:
    now = datetime.utcnow()
    expired = [
        sid for sid, payload in _PENDING_ITINERARY_DRAFTS.items()
        if payload.get("expires_at") and payload["expires_at"] < now
    ]
    for sid in expired:
        _PENDING_ITINERARY_DRAFTS.pop(sid, None)


def _cleanup_stale_trip_saves() -> None:
    now = datetime.utcnow()
    expired = [
        sid for sid, payload in _PENDING_TRIP_SAVES.items()
        if payload.get("expires_at") and payload["expires_at"] < now
    ]
    for sid in expired:
        _PENDING_TRIP_SAVES.pop(sid, None)


def _cleanup_stale_alert_saves() -> None:
    now = datetime.utcnow()
    expired = [
        sid for sid, payload in _PENDING_ALERT_SAVES.items()
        if payload.get("expires_at") and payload["expires_at"] < now
    ]
    for sid in expired:
        _PENDING_ALERT_SAVES.pop(sid, None)


def _cleanup_stale_alert_drafts() -> None:
    now = datetime.utcnow()
    expired = [
        sid for sid, payload in _PENDING_ALERT_DRAFTS.items()
        if payload.get("expires_at") and payload["expires_at"] < now
    ]
    for sid in expired:
        _PENDING_ALERT_DRAFTS.pop(sid, None)


def _cleanup_stale_profile_saves() -> None:
    now = datetime.utcnow()
    expired = [
        sid for sid, payload in _PENDING_PROFILE_SAVES.items()
        if payload.get("expires_at") and payload["expires_at"] < now
    ]
    for sid in expired:
        _PENDING_PROFILE_SAVES.pop(sid, None)


def _record_chat_consent(
    db_user: Session,
    user_id: str,
    session_id_str: str | None,
    scope: str,
) -> None:
    """Store consent after the user explicitly confirms a chat action (audit / compliance)."""
    if not user_id or not session_id_str or not scope:
        return
    try:
        session_uuid = uuid.UUID(session_id_str)
    except Exception:
        return
    try:
        consent = (
            db_user.query(ConsentRecord)
            .filter(
                ConsentRecord.user_id == user_id,
                ConsentRecord.session_id == session_uuid,
                ConsentRecord.scope == scope,
            )
            .first()
        )
        if not consent:
            consent = ConsentRecord(
                user_id=user_id,
                session_id=session_uuid,
                scope=scope,
                granted=True,
            )
            db_user.add(consent)
        else:
            consent.granted = True
        db_user.commit()
    except Exception:
        db_user.rollback()


def _normalize_profile_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    return cleaned or None


def _is_flight_domain_message(
    message: str,
    history: List[Dict[str, str]],
    recent_flights: List[Dict[str, Any]],
) -> bool:
    text = (message or "").strip()
    if not text:
        return False
    if should_attempt_flight_search(text, history):
        return True
    if is_flight_result_followup(text, recent_flights):
        return True
    if _FLIGHT_DOMAIN_HINT_RE.search(text):
        return True
    return False


def _extract_profile_update_fields(text: str) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    source = _normalize_profile_text(text) or ""

    first_name_match = re.search(
        r"\b(?:first name|firstname)\s*(?:is|to|=|:)?\s*([A-Za-z][A-Za-z' -]{0,40})",
        source,
        re.IGNORECASE,
    )
    if first_name_match:
        payload["first_name"] = _normalize_profile_text(first_name_match.group(1)).title()

    last_name_match = re.search(
        r"\b(?:last name|lastname|surname)\s*(?:is|to|=|:)?\s*([A-Za-z][A-Za-z' -]{0,40})",
        source,
        re.IGNORECASE,
    )
    if last_name_match:
        payload["last_name"] = _normalize_profile_text(last_name_match.group(1)).title()

    full_name_match = re.search(
        r"\b(?:my name is|name is|set my name to|update my name to)\s+([A-Za-z][A-Za-z' -]{1,80})",
        source,
        re.IGNORECASE,
    )
    if full_name_match:
        full_name = _normalize_profile_text(full_name_match.group(1))
        if full_name:
            parts = [p for p in full_name.split(" ") if p]
            if parts:
                payload["first_name"] = parts[0].title()
                if len(parts) > 1:
                    payload["last_name"] = " ".join(parts[1:]).title()

    email_match = re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", source)
    if email_match:
        payload["email"] = email_match.group(0).lower()

    phone_match = re.search(
        r"\b(?:phone|mobile|contact|number)\s*(?:is|to|=|:)?\s*(\+?[0-9][0-9()\- ]{6,20})",
        source,
        re.IGNORECASE,
    )
    if phone_match:
        payload["phone"] = _normalize_profile_text(phone_match.group(1))

    dob_match = re.search(
        r"\b(?:date of birth|dob|birth date)\s*(?:is|to|=|:)?\s*(\d{4}-\d{2}-\d{2})",
        source,
        re.IGNORECASE,
    )
    if dob_match:
        payload["date_of_birth"] = dob_match.group(1)

    gender_match = re.search(
        r"\b(?:gender)\s*(?:is|to|=|:)?\s*(male|female|other|non-binary|non binary)",
        source,
        re.IGNORECASE,
    )
    if gender_match:
        payload["gender"] = _normalize_profile_text(gender_match.group(1)).title()

    nationality_match = re.search(
        r"\b(?:nationality)\s*(?:is|to|=|:)?\s*([A-Za-z][A-Za-z' -]{1,50})",
        source,
        re.IGNORECASE,
    )
    if nationality_match:
        payload["nationality"] = _normalize_profile_text(nationality_match.group(1)).title()

    address_match = re.search(
        r"\b(?:address)\s*(?:is|to|=|:)?\s*([A-Za-z0-9#.,' -]{5,160})",
        source,
        re.IGNORECASE,
    )
    if address_match:
        payload["address"] = _normalize_profile_text(address_match.group(1))

    return payload


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


def _apply_saved_profile_preferences(
    search: Dict[str, Any],
    travel_preference: Optional[TravelPreference],
    message: str,
) -> Dict[str, Any]:
    if not travel_preference:
        return search

    pref = travel_preference
    preferences = search.setdefault("preferences", {})
    constraints = search.setdefault("constraints", {})
    saved_cabin = (getattr(pref, "cabin_class", None) or "").strip().lower()
    preferred_airlines = getattr(pref, "preferred_airlines", None) or []
    airport_preference = getattr(pref, "airport_preference", None) or []
    layover_preference = (getattr(pref, "layover_preference", None) or "").strip()
    flight_timing = getattr(pref, "flight_timing", None) or []
    travel_style = (getattr(pref, "travel_style", None) or "").strip()

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

    if not preferences.get("ranking_goal"):
        if travel_style == "Budget Optimized":
            preferences["ranking_goal"] = "cheapest"
        elif travel_style == "Comfort Optimized":
            preferences["ranking_goal"] = "best_overall"

    return search


def _load_travel_preference(db: Session, user_id: Optional[str]) -> Optional[TravelPreference]:
    if not user_id:
        return None

    try:
        return (
            db.query(TravelPreference)
            .filter(TravelPreference.user_id == user_id)
            .order_by(TravelPreference.updated_at.desc())
            .first()
        )
    except Exception:
        logger.exception("Failed to load travel preference for user %s", user_id)
        return None


def _build_profile_recommendation_note(
    recommended_flight: Optional[Dict[str, Any]],
    search: Dict[str, Any],
    travel_preference: Optional[TravelPreference],
    recommendation_explanation: str,
) -> str:
    if not recommended_flight:
        return (recommendation_explanation or "").strip()

    airline = (recommended_flight.get("airline") or "This flight").strip()
    flight_number = (recommended_flight.get("flight_number") or "").strip()
    flight_label = f"{airline} {flight_number}".strip()
    origin = (
        ((recommended_flight.get("route") or {}).get("originIata"))
        or recommended_flight.get("from_iata")
        or search.get("origin")
        or "origin"
    )
    destination = (
        ((recommended_flight.get("route") or {}).get("destinationIata"))
        or recommended_flight.get("to_iata")
        or search.get("destination")
        or "destination"
    )
    depart_time = (recommended_flight.get("departure_time") or "").strip() or "scheduled departure"
    arrive_time = (recommended_flight.get("arrival_time") or "").strip() or "scheduled arrival"

    ranking = recommended_flight.get("ranking") or {}
    pros = [str(item).strip() for item in (ranking.get("pros") or recommended_flight.get("pros") or []) if str(item).strip()]
    top_reason = pros[0] if pros else (recommended_flight.get("score_reason") or "").strip()
    if not top_reason:
        top_reason = "it gives the strongest balance of price, timing, and travel comfort"
    if top_reason[-1:] in {".", "!", "?"}:
        top_reason = top_reason[:-1]

    preferences = search.get("preferences") or {}
    constraints = search.get("constraints") or {}
    preference_signals: List[str] = []

    ranking_goal = str(preferences.get("ranking_goal") or "").strip().lower()
    if ranking_goal == "cheapest":
        preference_signals.append("your budget-first preference")
    elif ranking_goal == "fastest":
        preference_signals.append("your fastest-route preference")
    elif ranking_goal in {"best_overall", "comfort"}:
        preference_signals.append("your comfort-focused preference")

    preferred_airlines = [str(a).strip().lower() for a in (preferences.get("preferred_airlines") or []) if str(a).strip()]
    if preferred_airlines:
        airline_lower = airline.lower()
        if any(pref in airline_lower for pref in preferred_airlines):
            preference_signals.append("your preferred-airline setting")

    if constraints.get("nonstop_only") and int(recommended_flight.get("stops") or 0) == 0:
        preference_signals.append("your nonstop-only setting")
    if constraints.get("baggage_required") and (
        ((recommended_flight.get("baggage") or {}).get("included"))
        or (recommended_flight.get("baggage_checked") or "")
    ):
        preference_signals.append("your baggage preference")

    if travel_preference:
        seat_pref = str(getattr(travel_preference, "seat_preference", "") or "").strip()
        meal_pref = str(getattr(travel_preference, "meal_preference", "") or "").strip()
        if seat_pref:
            preference_signals.append(f"your seat preference ({seat_pref})")
        if meal_pref:
            meal_services = [str(item).lower() for item in (recommended_flight.get("meal_services") or [])]
            perks = [str(item).lower() for item in (recommended_flight.get("perks") or [])]
            if any("meal" in item for item in meal_services + perks):
                preference_signals.append(f"your meal preference ({meal_pref})")

    explanation = (recommendation_explanation or "").strip()
    if explanation and explanation[-1:] not in {".", "!", "?"}:
        explanation = f"{explanation}."

    note = (
        f"You should take {flight_label} from {origin} to {destination} "
        f"({depart_time} to {arrive_time}) because {top_reason}."
    )
    if preference_signals:
        note += " It aligns with " + ", ".join(preference_signals[:3]) + "."
    if explanation:
        note += f" {explanation}"
    return note.strip()


def _format_alternate_date_suggestions(alternate_dates: List[Dict[str, Any]]) -> str:
    if not alternate_dates:
        return ""

    lines: List[str] = []
    for option in alternate_dates[:3]:
        depart_iso = str(option.get("departure_date") or "").strip()
        return_iso = str(option.get("return_date") or "").strip()
        try:
            depart_label = datetime.strptime(depart_iso, "%Y-%m-%d").strftime("%a, %d %b")
        except ValueError:
            depart_label = depart_iso
        if return_iso:
            try:
                return_label = datetime.strptime(return_iso, "%Y-%m-%d").strftime("%a, %d %b")
            except ValueError:
                return_label = return_iso
            date_label = f"{depart_label} to {return_label}"
        else:
            date_label = depart_label

        flight_count = int(option.get("flight_count") or 0)
        from_price = option.get("from_price")
        currency = str(option.get("currency") or "USD").upper()
        price_text = f"from {currency} {int(from_price):,}" if isinstance(from_price, (int, float)) else "price available"
        lines.append(f"- {date_label}: {flight_count} option{'s' if flight_count != 1 else ''}, {price_text}")

    return "\n".join(lines)


def _extract_itinerary_request(message: str) -> dict[str, Any] | None:
    text_lower = (message or "").lower()
    asks_itinerary = any(
        phrase in text_lower
        for phrase in ["itinerary", "itinery", "iterinary", "trip plan", "travel plan", "day plan"]
    )
    if not asks_itinerary:
        return None

    destination = None
    dest_match = re.search(r"\b(?:to|for)\s+([A-Za-z][A-Za-z\s]{1,40})", message, re.IGNORECASE)
    if dest_match:
        destination = re.sub(r"\s+", " ", dest_match.group(1)).strip(" .,!?:;").title()

    days = None
    days_match = re.search(r"\b(\d{1,2})\s*(?:day|days|d)\b", text_lower)
    if days_match:
        days = max(1, min(int(days_match.group(1)), 14))

    budget = None
    budget_match = re.search(r"(?:₹|inr|rs\.?)\s*([0-9][0-9,]*)|\bbudget\s*(?:is|of|around)?\s*([0-9][0-9,]*)", text_lower)
    if budget_match:
        raw_budget = budget_match.group(1) or budget_match.group(2)
        if raw_budget:
            try:
                budget = int(raw_budget.replace(",", ""))
            except ValueError:
                budget = None

    return {
        "destination": destination,
        "days": days,
        "budget": budget,
    }


def _looks_like_itinerary_text(text: str) -> bool:
    lowered = (text or "").lower()
    has_itinerary_keyword = any(
        phrase in lowered for phrase in ["itinerary", "itinery", "iterinary", "day 1", "day 2"]
    )
    has_multi_day_structure = bool(
        re.search(r"\bday\s*1\b", lowered) and re.search(r"\bday\s*2\b", lowered)
    )
    return has_itinerary_keyword or has_multi_day_structure


def _draft_from_freeform_itinerary(text: str, user_message: str) -> dict[str, Any]:
    request = _extract_itinerary_request(user_message or "") or {}
    destination = (request.get("destination") or "Trip").strip()
    days = request.get("days")
    if not days:
        days_match = re.search(r"\b(\d{1,2})\s*[- ]?\s*(?:day|days|d)\b", text or "", re.IGNORECASE)
        if days_match:
            days = max(1, min(int(days_match.group(1)), 14))
    day_count = days or 7
    return {
        "title": f"{destination} {day_count}-Day Plan",
        "type": "TRIP_PLAN",
        "status": "SAVED",
        "duration_days": day_count,
        "destinations": [destination] if destination and destination != "Trip" else [],
        "ai_suggestion": text,
        "details": {"source": "freeform_chat_itinerary"},
    }


def _build_itinerary_plan(destination: str, days: int, budget: int | None) -> dict[str, Any]:
    day_count = max(1, min(days, 14))
    destination_label = destination.strip()
    budget_line = f"Budget target: USD {budget:,} total." if budget else "Budget target: mid-range split across stay, food, and local transport."
    per_day = int(budget / day_count) if budget and day_count > 0 else None

    day_plans: list[dict[str, str]] = []
    templates = [
        ("Arrival + City Core", "Check in, explore central landmarks, local dinner."),
        ("Culture + Local Food", "Museums/heritage walk, market visit, signature local meals."),
        ("Nature + Flexible Time", "Scenic point/park plus buffer for shopping or rest."),
        ("Short Excursion + Departure", "Half-day nearby attraction, airport transfer."),
    ]
    for i in range(day_count):
        if i < len(templates):
            title, agenda = templates[i]
        else:
            # For longer trips, rotate practical day themes without crashing.
            title, agenda = templates[i % len(templates)]
            if (i + 1) % 2 == 0:
                agenda = "Flexible day for local neighborhoods, cafes, and optional activities."
            else:
                agenda = "Mix of landmarks, local food spots, and free time for personal interests."
        day_plans.append(
            {
                "day": f"Day {i + 1}",
                "title": title,
                "agenda": agenda,
                "estimated_budget_inr": f"{per_day:,}" if per_day else "Flexible",
            }
        )

    suggestion_lines = [
        f"Here is a {day_count}-day itinerary for {destination_label}:",
        "",
    ]
    for plan in day_plans:
        suggestion_lines.append(f"- {plan['day']}: {plan['title']} - {plan['agenda']}")
    suggestion_lines.extend(
        [
            "",
            budget_line,
            "If you want changes, tell me what to modify and I will revise it here in chat.",
            "When you are happy, reply with 'yes, save itinerary' to store this plan, or 'no' to skip saving.",
        ]
    )

    return {
        "title": f"{destination_label} {day_count}-Day Plan",
        "type": "TRIP_PLAN",
        "status": "SAVED",
        "duration_days": day_count,
        "destinations": [destination_label],
        "ai_suggestion": "\n".join(suggestion_lines),
        "details": {"days": day_plans, "budget_inr": budget},
    }


def _is_itinerary_save_confirmation(message: str) -> bool:
    lowered = (message or "").lower()
    if "itinerary" not in lowered and "save" not in lowered and "yes" not in lowered:
        return False
    return bool(
        re.search(r"\b(yes|save|store|confirm|go ahead|proceed)\b", lowered)
        and not re.search(r"\b(don't|do not|no|not now|cancel)\b", lowered)
    )


def _is_positive_itinerary_feedback(message: str) -> bool:
    lowered = (message or "").lower().strip()
    if not lowered:
        return False
    if re.search(r"\b(don't|do not|no|not now|cancel|change|modify|edit|update)\b", lowered):
        return False
    positive_patterns = [
        r"\blooks?\s+(good|great|cool|nice|perfect)\b",
        r"\bsounds?\s+(good|great|perfect)\b",
        r"\b(it'?s|its)\s+(good|great|cool|nice|perfect)\b",
        r"\b(good|great|cool|nice|perfect)\b",
        r"\blove it\b",
        r"\blooks awesome\b",
    ]
    return any(re.search(pattern, lowered) for pattern in positive_patterns)


def _is_trip_save_confirmation(message: str) -> bool:
    lowered = (message or "").lower()
    return bool(
        re.search(r"\b(yes|save|store|confirm|go ahead|proceed)\b", lowered)
        and not re.search(r"\b(don't|do not|no|not now|cancel)\b", lowered)
    )


# ── Admin auth helper ─────────────────────────────────────

ADMIN_SESSION_TTL_HOURS = int(os.getenv("ADMIN_SESSION_TTL_HOURS", "24"))
DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin").strip() or "admin"
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123").strip() or "admin123"
DEFAULT_ADMIN_FULL_NAME = os.getenv("DEFAULT_ADMIN_FULL_NAME", "Admin").strip() or "Admin"
DEFAULT_ADMIN_EMAIL = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@bookwithai.local").strip() or "admin@bookwithai.local"
_ADMIN_AUTH_TABLE_READY = False
_ADMIN_AUTH_LOCK = threading.Lock()

def _hash_admin_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _ensure_admin_users_table() -> None:
    global _ADMIN_AUTH_TABLE_READY
    if _ADMIN_AUTH_TABLE_READY or engine_user is None:
        return
    with _ADMIN_AUTH_LOCK:
        if _ADMIN_AUTH_TABLE_READY or engine_user is None:
            return
        with engine_user.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS admin_users (
                      id TEXT PRIMARY KEY,
                      username VARCHAR(80) NOT NULL UNIQUE,
                      full_name VARCHAR(255) NOT NULL,
                      email VARCHAR(255) UNIQUE,
                      password_hash TEXT NOT NULL,
                      role VARCHAR(50) NOT NULL DEFAULT 'super_admin',
                      is_active BOOLEAN NOT NULL DEFAULT TRUE,
                      last_login_at TIMESTAMP NULL,
                      session_token_hash TEXT NULL,
                      session_expires_at TIMESTAMP NULL,
                      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS idx_admin_users_username
                    ON admin_users (username)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS idx_admin_users_email
                    ON admin_users (email)
                    """
                )
            )
        _ADMIN_AUTH_TABLE_READY = True


def _normalize_admin_username(value: Optional[str]) -> str:
    return re.sub(r"\s+", "", (value or "").strip()).lower()


def _normalize_admin_email(value: Optional[str]) -> Optional[str]:
    normalized = (value or "").strip().lower()
    return normalized or None


def _serialize_admin_user(admin: AdminUser) -> dict[str, Any]:
    return {
        "id": str(admin.id),
        "username": admin.username,
        "email": admin.email,
        "fullName": admin.full_name,
        "role": admin.role,
        "isActive": bool(admin.is_active),
        "lastLoginAt": admin.last_login_at.isoformat() if admin.last_login_at else None,
        "createdAt": admin.created_at.isoformat() if admin.created_at else None,
        "updatedAt": admin.updated_at.isoformat() if admin.updated_at else None,
    }


def _build_admin_session_response(admin: AdminUser) -> dict[str, Any]:
    raw_token = secrets.token_urlsafe(32)
    admin.session_token_hash = _hash_admin_session_token(raw_token)
    admin.session_expires_at = datetime.utcnow() + timedelta(hours=ADMIN_SESSION_TTL_HOURS)
    admin.updated_at = datetime.utcnow()
    return {
        "accessToken": raw_token,
        "expiresInSeconds": ADMIN_SESSION_TTL_HOURS * 60 * 60,
        "admin": _serialize_admin_user(admin),
    }


def _extract_admin_token(
    authorization: Optional[str],
    x_admin_token: Optional[str],
) -> Optional[str]:
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    token = (x_admin_token or "").strip()
    return token or None


def _ensure_default_admin_user(db: Session) -> None:
    _ensure_admin_users_table()
    if db.query(AdminUser.id).first():
        return

    admin = AdminUser(
        username=_normalize_admin_username(DEFAULT_ADMIN_USERNAME),
        full_name=DEFAULT_ADMIN_FULL_NAME,
        email=_normalize_admin_email(DEFAULT_ADMIN_EMAIL),
        password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
        role="super_admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()


def _find_admin_by_session_token(db: Session, token: str) -> Optional[AdminUser]:
    if not token:
        return None
    token_hash = _hash_admin_session_token(token)
    now = datetime.utcnow()
    return (
        db.query(AdminUser)
        .filter(
            AdminUser.session_token_hash == token_hash,
            AdminUser.is_active.is_(True),
            AdminUser.session_expires_at.is_not(None),
            AdminUser.session_expires_at >= now,
        )
        .first()
    )


def require_admin(
    db: Session = Depends(get_user_db),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_admin_token: Optional[str] = Header(default=None),
) -> Optional[str]:
    _ensure_default_admin_user(db)
    token = _extract_admin_token(authorization, x_admin_token)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    admin = _find_admin_by_session_token(db, token)
    if not admin:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return str(admin.id)


def get_current_admin_user(
    db: Session = Depends(get_user_db),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_admin_token: Optional[str] = Header(default=None),
) -> AdminUser:
    _ensure_default_admin_user(db)
    token = _extract_admin_token(authorization, x_admin_token)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    admin = _find_admin_by_session_token(db, token)
    if not admin:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return admin


# ── Models ──────────────────────────────────────────────

class ChatMessagePayload(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessagePayload] = []
    session_id: Optional[str] = None
    user_lat: Optional[float] = None
    user_lng: Optional[float] = None
    user_city: Optional[str] = None
    stream: bool = False
    recent_flights: Optional[List[Dict[str, Any]]] = None


class ChatTitleRequest(BaseModel):
    messages: List[ChatMessagePayload] = []


class SessionImportMessagePayload(BaseModel):
    role: str
    content: str
    metadata: Optional[Dict[str, Any]] = None


class SessionImportConversationPayload(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    updated_at: Optional[str] = None
    messages: List[SessionImportMessagePayload] = []


class SessionImportPayload(BaseModel):
    sessions: List[SessionImportConversationPayload] = []


class AdminApiKeyUpdatePayload(BaseModel):
    keyName: str
    provider: Optional[str] = None
    status: Optional[str] = None
    quotaDaily: Optional[int] = None
    costPerRequest: Optional[float] = None


class AdminSignInPayload(BaseModel):
    username: str
    password: str


class AdminAccountUpdatePayload(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class AdminCreateUserPayload(BaseModel):
    username: str
    full_name: str
    email: Optional[str] = None
    password: str


class PriceAlertUpdatePayload(BaseModel):
    is_active: Optional[bool] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    airline: Optional[str] = None
    date_range: Optional[str] = None
    refresh_live: bool = True


class PriceAlertAiEditPayload(BaseModel):
    instruction: str


class PriceAlertAiCreatePayload(BaseModel):
    instruction: str

class FlightSearchRequest(BaseModel):
    origin: str
    destination: str
    date: str
    passengers: int = 1
    return_date: Optional[str] = None
    currency: Optional[str] = None
    budget: Optional[float] = None
    preferred_airlines: Optional[List[str]] = None
    nonstop_only: bool = False
    baggage_required: bool = False
    refundable_only: bool = False
    user_lat: Optional[float] = None
    user_lng: Optional[float] = None


class FlightOfferVerificationRequest(BaseModel):
    offer: Dict[str, Any]


class PassengerProfilePayload(BaseModel):
    session_id: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None


class ConsentPayload(BaseModel):
    session_id: str
    scope: str
    granted: bool


class TripCreatePayload(BaseModel):
    session_id: Optional[str] = None
    airline: Optional[str] = None
    flight_number: Optional[str] = None
    trip_type: Optional[str] = None
    passenger_name: Optional[str] = None
    origin: str
    destination: str
    departure_date: Optional[str] = None
    arrival_date: Optional[str] = None
    cabin_class: Optional[str] = None
    confirmation_code: Optional[str] = None
    ticket_number: Optional[str] = None
    booking_ref: Optional[str] = None
    seat_number: Optional[str] = None
    ticket_cost: Optional[float] = None
    currency: Optional[str] = "USD"


class TripUpdatePayload(BaseModel):
    status: Optional[str] = None
    airline: Optional[str] = None
    flight_number: Optional[str] = None
    trip_type: Optional[str] = None
    passenger_name: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    departure_date: Optional[str] = None
    arrival_date: Optional[str] = None
    cabin_class: Optional[str] = None
    confirmation_code: Optional[str] = None
    ticket_number: Optional[str] = None
    booking_ref: Optional[str] = None
    seat_number: Optional[str] = None
    ticket_cost: Optional[float] = None
    currency: Optional[str] = None


class TripAiCreatePayload(BaseModel):
    instruction: str
    session_id: Optional[str] = None


class TripAiEditPayload(BaseModel):
    instruction: str


class FeedbackSubmitPayload(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    message: str
    chat_session_id: Optional[str] = None
    context_flights: Optional[Dict[str, Any]] = None
    context_page: Optional[Dict[str, Any]] = None


class RegisterRequest(BaseModel):
    full_name: str
    email: str
    phone: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class VerifyOTPRequest(BaseModel):
    email: str
    otp: str


class SendSignupOtpRequest(BaseModel):
    full_name: str
    email: str
    phone: str


class VerifySignupOtpRequest(BaseModel):
    email: str
    phone: str
    otp: str

class UserProfileUpdatePayload(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    nationality: Optional[str] = None
    address: Optional[str] = None
    avatar_url: Optional[str] = None
    
    # Travel Preferences
    seat_preference: Optional[str] = None
    meal_preference: Optional[str] = None
    cabin_class: Optional[str] = None
    preferred_airlines: Optional[List[str]] = None
    travel_style: Optional[str] = None
    flight_timing: Optional[List[str]] = None
    layover_preference: Optional[str] = None
    max_layover_time: Optional[str] = None
    airport_preference: Optional[List[str]] = None
    special_assistance: Optional[str] = None



# ── Health ──────────────────────────────────────────────

@router.get("/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0", "service": "Book With AI API"}


# ── Auth ────────────────────────────────────────────────

@router.post("/auth/validate")
async def auth_validate():
    """
    Deprecated: credentials are now validated in Next.js API routes only.
    Kept for backward compatibility; always returns 501.
    """
    raise HTTPException(
        status_code=501,
        detail="Use Next.js /api/auth/login for credential validation",
    )


@router.post("/auth/register")
async def register(payload: RegisterRequest, db: Session = Depends(get_user_db)):
    from models.user import User

    existing_user = db.query(User).filter(User.email == payload.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    parsed_full_name = payload.full_name.strip()
    first_name = parsed_full_name.split()[0] if parsed_full_name else ""

    new_user = User(
        email=payload.email,
        first_name=first_name,
        last_name=None,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        is_verified=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "User registered successfully", "user_id": str(new_user.id)}


@router.post("/auth/login")
async def login():
    """
    Deprecated legacy login; Next.js now handles login and JWT creation entirely.
    """
    raise HTTPException(
        status_code=501,
        detail="Use Next.js /api/auth/login; FastAPI only validates JWT",
    )


@router.post("/auth/verify-otp")
async def verify_otp(payload: VerifyOTPRequest, db: Session = Depends(get_user_db)):
    from models.user import User

    if not re.match(r"^\d{6}$", payload.otp):
        raise HTTPException(status_code=400, detail="Invalid OTP format")
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "message": "Login successful",
        "user": {
            "id": str(user.id),
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
        },
    }


@router.post("/auth/send-signup-otp")
async def send_signup_otp():
    """
    Deprecated: OTP is now handled in Next.js (POST /api/auth/send-signup-otp).
    """
    raise HTTPException(
        status_code=501,
        detail="Use Next.js /api/auth/send-signup-otp for OTP",
    )


@router.post("/auth/verify-signup-otp")
async def verify_signup_otp():
    """
    Deprecated: OTP verification is now handled in Next.js (POST /api/auth/verify-signup-otp).
    """
    raise HTTPException(
        status_code=501,
        detail="Use Next.js /api/auth/verify-signup-otp for OTP verification",
    )


@router.get("/user/profile")
async def get_user_profile(user_id: str = Query(...), db: Session = Depends(get_user_db)):
    from models.user import User
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    travel_preference = _load_travel_preference(db, user_id)

    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "phone": user.phone,
        "date_of_birth": user.date_of_birth.isoformat() if user.date_of_birth else None,
        "gender": user.gender,
        "nationality": user.nationality,
        "address": user.address,
        "avatar_url": user.image_url,
        "preferences": {
            "seat_preference": travel_preference.seat_preference if travel_preference else None,
            "meal_preference": travel_preference.meal_preference if travel_preference else None,
            "cabin_class": getattr(travel_preference, "cabin_class", None) if travel_preference else None,
            "preferred_airlines": getattr(travel_preference, "preferred_airlines", []) if travel_preference else [],
            "travel_style": getattr(travel_preference, "travel_style", None) if travel_preference else None,
            "flight_timing": getattr(travel_preference, "flight_timing", []) if travel_preference else [],
            "layover_preference": getattr(travel_preference, "layover_preference", None) if travel_preference else None,
            "max_layover_time": getattr(travel_preference, "max_layover_time", None) if travel_preference else None,
            "airport_preference": getattr(travel_preference, "airport_preference", []) if travel_preference else [],
            "special_assistance": getattr(travel_preference, "special_assistance", None) if travel_preference else None,
        },
    }


@router.patch("/user/profile")
async def update_user_profile(user_id: str = Query(...), payload: UserProfileUpdatePayload = ..., db: Session = Depends(get_user_db)):
    from models.user import User, TravelPreference
    from datetime import date

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update User basic info
    if payload.first_name is not None: user.first_name = payload.first_name
    if payload.last_name is not None: user.last_name = payload.last_name
    if payload.email is not None: user.email = payload.email
    if payload.phone is not None: user.phone = payload.phone
    if payload.gender is not None: user.gender = payload.gender
    if payload.nationality is not None: user.nationality = payload.nationality
    if payload.address is not None: user.address = payload.address
    if payload.avatar_url is not None: user.image_url = payload.avatar_url
    
    if payload.date_of_birth is not None:
        try:
            user.date_of_birth = date.fromisoformat(payload.date_of_birth)
        except Exception: pass

    # Update Travel Preferences
    pref_fields = ["seat_preference", "meal_preference"]
    has_pref_updates = any(getattr(payload, f) is not None for f in pref_fields)

    
    if has_pref_updates:
        travel_preference = _load_travel_preference(db, user.id)
        if not travel_preference:
            travel_preference = TravelPreference(user_id=user.id)
            db.add(travel_preference)
        
        for f in pref_fields:
            val = getattr(payload, f)
            if val is not None:
                setattr(travel_preference, f, val)

    db.commit()
    return {"ok": True, "message": "Profile updated"}





# ── Chat ────────────────────────────────────────────────

@router.post("/chat")
async def chat_endpoint(
    request: ChatRequest,
    db: Session = Depends(get_chat_db),
    user_id: Optional[str] = Depends(get_optional_user_id),
    db_user: Session = Depends(get_user_db),
):
    msg = request.message
    history = [{"role": h.role, "content": h.content} for h in request.history]
    sid = request.session_id

    def merge_recent_session_history() -> None:
        nonlocal history
        if not sid:
            return
        try:
            sid_uuid = uuid.UUID(str(sid))
        except Exception:
            return

        db_rows = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == sid_uuid)
            .order_by(ChatMessage.created_at.desc())
            .limit(10)
            .all()
        )
        if not db_rows:
            return

        db_history = [
            {"role": (row.role or "").strip().lower(), "content": row.content or ""}
            for row in reversed(db_rows)
            if (row.role or "").strip().lower() in {"user", "assistant"}
            and (row.content or "").strip()
        ]
        if not db_history:
            return

        merged = db_history + history
        deduped: List[Dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in merged:
            key = (
                (item.get("role") or "").strip().lower(),
                (item.get("content") or "").strip(),
            )
            if not key[0] or not key[1]:
                continue
            if key in seen:
                continue
            seen.add(key)
            deduped.append({"role": key[0], "content": key[1]})
        history = deduped[-12:]

    merge_recent_session_history()

    if user_id:
        if sid:
            session = get_session(db, sid, user_id=user_id)
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
        else:
            sid = create_session(db, user_id)["session_id"]

    def persist_chat_exchange(response_payload: Dict[str, Any]) -> None:
        if not sid or not user_id:
            return

        add_message(
            db,
            sid,
            "user",
            msg,
            metadata={"type": "text"},
            user_id=user_id,
        )
        add_message(
            db,
            sid,
            "assistant",
            response_payload.get("text") or "",
            metadata=response_payload,
            user_id=user_id,
        )

    # Resolve user city from coordinates if not provided directly
    user_city = request.user_city
    if not user_city and request.user_lat is not None and request.user_lng is not None:
        try:
            user_city = await reverse_geocode(request.user_lat, request.user_lng)
        except Exception:
            user_city = None

    def stage_itinerary_draft_if_needed(reply_text: str) -> None:
        if user_id and sid and _looks_like_itinerary_text(reply_text):
            _PENDING_ITINERARY_DRAFTS[sid] = {
                "draft": _draft_from_freeform_itinerary(reply_text, msg),
                "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
            }

    # ── Itinerary draft + consent flow ──────────────────────────────────────
    _cleanup_stale_itinerary_drafts()
    _cleanup_stale_trip_saves()
    _cleanup_stale_alert_saves()
    _cleanup_stale_alert_drafts()
    _cleanup_stale_profile_saves()
    if user_id and sid:
        pending_profile = _PENDING_PROFILE_SAVES.get(sid)
        if pending_profile and _is_trip_save_confirmation(msg):
            try:
                profile_fields = pending_profile.get("fields") or {}
                user = db_user.query(User).filter(User.id == user_id).first()
                if not user:
                    response = {
                        "type": "text",
                        "text": "I couldn't access your profile just now. Please try again in a moment.",
                        "session_id": sid,
                    }
                    _PENDING_PROFILE_SAVES.pop(sid, None)
                    persist_chat_exchange(response)
                    return response

                if profile_fields.get("first_name") is not None:
                    user.first_name = profile_fields.get("first_name")
                if profile_fields.get("last_name") is not None:
                    user.last_name = profile_fields.get("last_name")
                if profile_fields.get("email") is not None:
                    user.email = profile_fields.get("email")
                if profile_fields.get("phone") is not None:
                    user.phone = profile_fields.get("phone")
                if profile_fields.get("date_of_birth") is not None:
                    try:
                        user.date_of_birth = datetime.strptime(
                            profile_fields.get("date_of_birth"),
                            "%Y-%m-%d",
                        ).date()
                    except Exception:
                        pass
                if profile_fields.get("gender") is not None:
                    user.gender = profile_fields.get("gender")
                if profile_fields.get("nationality") is not None:
                    user.nationality = profile_fields.get("nationality")
                if profile_fields.get("address") is not None:
                    user.address = profile_fields.get("address")

                combined_name = " ".join(
                    part for part in [user.first_name, user.last_name] if part
                ).strip()
                user.full_name = combined_name or None

                db_user.add(user)
                db_user.commit()
                db_user.refresh(user)
                _PENDING_PROFILE_SAVES.pop(sid, None)
                _record_chat_consent(db_user, user_id, sid, "profile_update")
                response = {
                    "type": "text",
                    "text": "Saved. I updated your profile details.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
            except Exception:
                _PENDING_PROFILE_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": "I couldn't save your profile details just now. Please try again in a moment.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
        if pending_profile:
            lowered = (msg or "").lower()
            if re.search(r"\b(don't|do not|no|not now|cancel)\b", lowered):
                _PENDING_PROFILE_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": "Okay, I won't update your profile.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

        pending_trip = _PENDING_TRIP_SAVES.get(sid)
        if pending_trip and _is_trip_save_confirmation(msg):
            try:
                trip_id = pending_trip.get("trip_id")
                instruction = pending_trip.get("instruction") or msg
                if trip_id:
                    trip = get_trip_for_user(db_user, trip_id, user_id)
                    if not trip:
                        response = {
                            "type": "text",
                            "text": "I couldn't find that trip anymore. Please open it again from My Trips and try once more.",
                            "session_id": sid,
                        }
                        _PENDING_TRIP_SAVES.pop(sid, None)
                        persist_chat_exchange(response)
                        return response
                    updated_trip = await apply_ai_edit_to_trip(db_user, trip, instruction)
                    _PENDING_TRIP_SAVES.pop(sid, None)
                    _record_chat_consent(db_user, user_id, sid, "trip_storage")
                    response = {
                        "type": "text",
                        "text": "Saved. I added these details to your trip in My Trips.",
                        "session_id": sid,
                        "trip": updated_trip,
                    }
                    persist_chat_exchange(response)
                    return response

                created_trip = await create_trip_from_ai_instruction(
                    db_user,
                    user_id=user_id,
                    instruction=instruction,
                    session_id=sid,
                )
                _PENDING_TRIP_SAVES.pop(sid, None)
                _record_chat_consent(db_user, user_id, sid, "trip_storage")
                response = {
                    "type": "text",
                    "text": "Saved. I created a new trip in My Trips from these details.",
                    "session_id": sid,
                    "trip": created_trip,
                }
                persist_chat_exchange(response)
                return response
            except ValueError as exc:
                _PENDING_TRIP_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": str(exc),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
            except Exception:
                _PENDING_TRIP_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": "I couldn't save the trip just now. Please try again in a moment.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

        if pending_trip:
            lowered = (msg or "").lower()
            if re.search(r"\b(don't|do not|no|not now|cancel)\b", lowered):
                _PENDING_TRIP_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": "Okay, I won't save this trip to My Trips.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

        pending_alert = _PENDING_ALERT_SAVES.get(sid)
        if pending_alert and _is_trip_save_confirmation(msg):
            try:
                alert_id = pending_alert.get("alert_id")
                instruction = pending_alert.get("instruction") or msg

                if alert_id:
                    alert = get_price_alert_for_user(db_user, alert_id, user_id)
                    if not alert:
                        response = {
                            "type": "text",
                            "text": "I couldn't find that alert anymore. Please open it again from Price Alerts and try once more.",
                            "session_id": sid,
                        }
                        _PENDING_ALERT_SAVES.pop(sid, None)
                        persist_chat_exchange(response)
                        return response

                    updated_alert = await apply_ai_edit_to_alert(
                        db_user,
                        alert,
                        instruction,
                    )
                    _PENDING_ALERT_SAVES.pop(sid, None)
                    _record_chat_consent(db_user, user_id, sid, "price_alert_storage")
                    response = {
                        "type": "text",
                        "text": f"Saved. I updated your price alert.\nAlert ID: {updated_alert.get('id')}",
                        "session_id": sid,
                    }
                    persist_chat_exchange(response)
                    return response

                created_alert = await create_price_alert_from_ai_instruction(
                    db_user,
                    user_id=user_id,
                    instruction=instruction,
                )
                _PENDING_ALERT_SAVES.pop(sid, None)
                _record_chat_consent(db_user, user_id, sid, "price_alert_storage")
                response = {
                    "type": "text",
                    "text": (
                        "Saved. I created a new price alert from these flight details.\n"
                        f"Alert ID: {created_alert.get('id')}"
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
            except ValueError as exc:
                _PENDING_ALERT_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": (
                        f"I need a bit more detail to save the alert: {str(exc)} "
                        "Please include origin and destination."
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
            except Exception:
                _PENDING_ALERT_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": "I couldn't save the alert right now. Please try again in a moment.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
        if pending_alert:
            lowered = (msg or "").lower()
            if re.search(r"\b(don't|do not|no|not now|cancel)\b", lowered):
                _PENDING_ALERT_SAVES.pop(sid, None)
                response = {
                    "type": "text",
                    "text": "Okay, I won't save this price alert.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

        pending_draft = _PENDING_ITINERARY_DRAFTS.get(sid)
        if pending_draft and _is_itinerary_save_confirmation(msg):
            draft = pending_draft["draft"]
            now = datetime.utcnow()
            itinerary_id = str(uuid.uuid4())
            metadata = {
                "source": "chat_itinerary_consent_flow",
                "details": draft["details"],
            }
            db_user.execute(
                text(
                    """
                    INSERT INTO itineraries
                    (id, user_id, title, itinerary_type, status, start_date, end_date, duration_days, destination_labels, ai_suggestion, metadata, created_at, updated_at)
                    VALUES
                    (:id, :user_id, :title, CAST(:itinerary_type AS "ItineraryType"), CAST(:status AS "ItineraryStatus"), NULL, NULL, :duration_days, :destinations, :ai_suggestion, CAST(:metadata AS jsonb), :created_at, :updated_at)
                    """
                ),
                {
                    "id": itinerary_id,
                    "user_id": user_id,
                    "title": draft["title"],
                    "itinerary_type": draft["type"],
                    "status": draft["status"],
                    "duration_days": draft["duration_days"],
                    "destinations": draft["destinations"],
                    "ai_suggestion": draft["ai_suggestion"],
                    "metadata": json.dumps(metadata),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            db_user.commit()
            _record_chat_consent(db_user, user_id, sid, "itinerary_storage")
            _PENDING_ITINERARY_DRAFTS.pop(sid, None)
            response = {
                "type": "text",
                "text": f"Saved. Your itinerary is now stored in My Itineraries.\nItinerary ID: {itinerary_id}",
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response
        if pending_draft and _is_positive_itinerary_feedback(msg):
            response = {
                "type": "text",
                "text": (
                    "Great! Would you like me to save this itinerary to My Itineraries now?\n"
                    "Reply with 'yes, save itinerary' to confirm or 'no' to skip."
                ),
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response

        itinerary_request = _extract_itinerary_request(msg)
        if itinerary_request:
            missing: list[str] = []
            if not itinerary_request.get("destination"):
                missing.append("destination")
            if not itinerary_request.get("days"):
                missing.append("days")
            if missing:
                response = {
                    "type": "text",
                    "text": "I can build a trip plan right here in chat. Please share your destination and number of days (for example: 'Plan 7 days in Paris').",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

            draft = _build_itinerary_plan(
                itinerary_request["destination"],
                itinerary_request["days"],
                itinerary_request["budget"],
            )
            _PENDING_ITINERARY_DRAFTS[sid] = {
                "draft": draft,
                "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
            }
            response = {
                "type": "text",
                "text": draft["ai_suggestion"],
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response

    # ── Save trip details from chat (AI-only, consent-first) ─────────────────
    # Goal: when the user asks to save trip details, ask for explicit confirmation first.
    if user_id:
        profile_text = (msg or "") + " " + " ".join(
            (h.get("content") or "") for h in (history[-6:] if history else [])
        )
        profile_fields = _extract_profile_update_fields(profile_text)
        lowered_msg = (msg or "").lower()
        asks_profile_save = bool(
            re.search(r"\b(save|update|set|change|edit|correct)\b", lowered_msg)
            and re.search(
                r"\b(profile|name|email|phone|address|nationality|gender|date of birth|dob)\b",
                lowered_msg,
            )
        )
        mentions_profile_fields = bool(
            re.search(
                r"\b(name|email|phone|mobile|address|nationality|gender|date of birth|dob|first name|last name)\b",
                lowered_msg,
            )
        )
        has_other_intent = bool(
            re.search(r"\b(trip|booking|price alert|alert|itinerary)\b", lowered_msg)
        )

        should_stage_profile_save = (
            sid
            and profile_fields
            and not has_other_intent
            and (asks_profile_save or mentions_profile_fields)
        )

        if should_stage_profile_save:
            _PENDING_PROFILE_SAVES[sid] = {
                "fields": profile_fields,
                "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
            }
            updated_fields = ", ".join(
                field.replace("_", " ") for field in profile_fields.keys()
            )
            response = {
                "type": "text",
                "text": (
                    f"I understood these profile updates: {updated_fields}. "
                    "Do you want me to save them to your profile now? Reply with 'yes' to confirm."
                ),
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response

    if user_id:
        combined_text = msg or ""
        recent_history_text = " ".join(
            (h.get("content") or "") for h in (history[-6:] if history else [])
        )
        lowered_msg = (msg or "").lower()

        uuid_regex = r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
        trip_id_match = re.search(
            rf"Trip\s*ID\s*[:#]?\s*({uuid_regex})",
            combined_text,
            re.IGNORECASE,
        )
        if not trip_id_match:
            trip_id_match = re.search(
                rf"Trip\s*ID\s*[:#]?\s*({uuid_regex})",
                recent_history_text,
                re.IGNORECASE,
            )
        trip_id = trip_id_match.group(1) if trip_id_match else None

        # Only attempt a trip update when the message looks like trip details and the user
        # explicitly wants to save.
        wants_save = bool(re.search(r"\b(save|submit|store)\b", combined_text, re.IGNORECASE))
        wants_alert_language = bool(
            re.search(r"\b(alert|price alert|deal alert|track price)\b", lowered_msg, re.IGNORECASE)
        )
        wants_trip_intent = bool(
            re.search(r"\b(add|create|plan|set up|setup)\b", msg or "", re.IGNORECASE)
            and re.search(r"\b(trip|my trip|my trips|booking)\b", msg or "", re.IGNORECASE)
        )

        # Include the current user turn so a single save prompt can work without
        # depending on prior history.
        recent_text = " ".join(
            part for part in [recent_history_text, msg or ""] if part
        ).strip()

        has_trip_date = bool(
            re.search(r"\b\d{4}-\d{2}-\d{2}\b", recent_text, re.IGNORECASE)
            or re.search(
                r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b",
                recent_text,
                re.IGNORECASE,
            )
        )

        looks_like_trip_details = bool(
            re.search(r"\bdeparture\b", recent_text, re.IGNORECASE)
            and re.search(r"\bdestination\b", recent_text, re.IGNORECASE)
        ) or bool(
            re.search(r"\bfrom\b", recent_text, re.IGNORECASE)
            and re.search(r"\bto\b", recent_text, re.IGNORECASE)
        )

        if wants_trip_intent and not (has_trip_date and looks_like_trip_details):
            response = {
                "type": "text",
                "text": (
                    "Absolutely, I can add that to My Trips.\n"
                    "Please share:\n"
                    "- Departure city\n"
                    "- Destination city\n"
                    "- Departure date (YYYY-MM-DD)\n"
                    "- Return date (optional, for round trips)\n"
                    "- Airline (optional)\n"
                    "- Flight number (optional)\n"
                    "- Trip type: one way or round trip (optional)\n"
                    "- Passenger name (optional)\n"
                    "- Cabin class (Economy/Business/Premium Economy/First)\n"
                    "- Confirmation code / PNR (optional)\n"
                    "- Ticket number (optional)\n\n"
                    "When you are ready, say 'save trip details' and I will ask your confirmation before saving."
                ),
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response

        if (
            wants_save
            and not wants_alert_language
            and has_trip_date
            and looks_like_trip_details
            and sid
            and not _extract_itinerary_request(msg)
        ):
            _PENDING_TRIP_SAVES[sid] = {
                "trip_id": trip_id,
                # Include the recent trip details so the AI can extract structured fields.
                "instruction": f"{combined_text}\n\nRecent trip details context:\n{recent_text}",
                "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
            }
            response = {
                "type": "text",
                "text": (
                    "I've captured the trip details. "
                    "Do you want me to save them to My Trips now? Reply with 'yes' to confirm."
                ),
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response

    # ── Price alert: collect details -> track -> consent -> save ─────────────────────
    if user_id:
        combined_text = (msg or "") + " " + " ".join(h.get("content") or "" for h in (history or []))
        recent_history_text = " ".join(
            (h.get("content") or "") for h in (history[-6:] if history else [])
        )

        uuid_regex = r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
        alert_id_match = re.search(
            rf"Alert\s*ID\s*[:#]?\s*({uuid_regex})",
            combined_text,
            re.IGNORECASE,
        )
        alert_id = alert_id_match.group(1) if alert_id_match else None

        lowered_msg = (msg or "").lower()
        wants_alert_setup_intent = bool(
            re.search(r"\b(add|create|set up|setup|add a)\b", lowered_msg, re.IGNORECASE)
            and re.search(r"\b(alert|price alert|deal alert)\b", lowered_msg, re.IGNORECASE)
        )

        # Trigger to actually create/save the alert (details should already be known)
        wants_alert_track_trigger = bool(
            re.search(r"\b(track|save|store|create)\b", lowered_msg, re.IGNORECASE)
            and re.search(r"\b(alert|price alert|deal alert)\b", lowered_msg, re.IGNORECASE)
        )
        if not wants_alert_setup_intent and wants_alert_track_trigger:
            # Treat "track/save alert ..." as setup intent too, so we do not fall through
            # to the generic chat reply that asks unrelated extra fields.
            wants_alert_setup_intent = True

        route_detection_text = combined_text

        # Loose route detection: "from X to Y", "origin X destination Y", or "X to Y"
        looks_like_route = bool(
            re.search(r"\b(from|origin)\b.+\bto\b", route_detection_text, re.IGNORECASE)
        ) or bool(
            re.search(r"\borigin\b.+\bdestination\b", route_detection_text, re.IGNORECASE)
        ) or bool(
            re.search(r"\b[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,3}\b\s+to\s+\b[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,3}\b", route_detection_text, re.IGNORECASE)
        )

        has_date_any = bool(
            re.search(r"\b\d{4}-\d{2}-\d{2}\b", route_detection_text, re.IGNORECASE)
            or re.search(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", route_detection_text, re.IGNORECASE)
            or re.search(r"\b20\d{2}\b", route_detection_text, re.IGNORECASE)
        )
        date_mentions = 0
        date_mentions += len(re.findall(r"\b\d{4}-\d{2}-\d{2}\b", route_detection_text, re.IGNORECASE))
        date_mentions += len(re.findall(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", route_detection_text, re.IGNORECASE))
        date_mentions += len(
            re.findall(
                r"\b\d{1,2}(?:st|nd|rd|th)?\s+"
                r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
                r"\s+\d{4}\b",
                route_detection_text,
                re.IGNORECASE,
            )
        )
        try:
            parsed_depart_date, parsed_return_date = parse_alert_date_range(route_detection_text)
        except Exception:
            parsed_depart_date, parsed_return_date = (None, None)
        has_return_date = bool(parsed_return_date)
        wants_round_trip = bool(
            re.search(r"\b(round[\s-]?trip|return|round trip)\b", route_detection_text, re.IGNORECASE)
        )
        if wants_round_trip and not has_return_date and date_mentions >= 2:
            # In conversational follow-ups, full-text date parsing can miss "route to city"
            # patterns. Two date mentions are enough to treat round-trip dates as present.
            has_return_date = True
        needs_return_date = wants_round_trip and has_date_any and not has_return_date

        pending_alert_draft = _PENDING_ALERT_DRAFTS.get(sid) if sid else None

        # 1) If we already asked for alert details, keep collecting and avoid flight-search hijack.
        if pending_alert_draft:
            # User cancelled the pending setup
            if re.search(r"\b(don't|do not|no|not now|cancel)\b", lowered_msg):
                _PENDING_ALERT_DRAFTS.pop(sid, None)
                response = {
                    "type": "text",
                    "text": "Understood, I won't create this price alert.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

            # User said track/save -> stage consent prompt
            if wants_alert_track_trigger:
                _PENDING_ALERT_SAVES[sid] = {
                    "alert_id": alert_id,  # optional (edit flow) if present
                    "instruction": (
                        (pending_alert_draft.get("instruction") or "")
                        + "\n\nUser trigger:\n"
                        + combined_text
                    ).strip(),
                    "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
                }
                response = {
                    "type": "text",
                    "text": (
                        "I've captured the alert details. "
                        "Do you want me to save this price alert now? Reply with 'yes' to confirm."
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

            # User provided route/date details -> store them and ask for track trigger
            if looks_like_route and has_date_any and not needs_return_date:
                pending_alert_draft["instruction"] = (
                    (pending_alert_draft.get("instruction") or "")
                    + "\n\n"
                    + combined_text
                ).strip()
                pending_alert_draft["expires_at"] = datetime.utcnow() + _ITINERARY_DRAFT_TTL
                _PENDING_ALERT_SAVES[sid] = {
                    "alert_id": alert_id,
                    "instruction": pending_alert_draft["instruction"],
                    "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
                }
                response = {
                    "type": "text",
                    "text": (
                        "Perfect, I have the route and dates.\n"
                        "Do you want me to save this price alert now? Reply with 'yes' to confirm."
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
            if looks_like_route and has_date_any and needs_return_date:
                pending_alert_draft["instruction"] = (
                    (pending_alert_draft.get("instruction") or "")
                    + "\n\n"
                    + combined_text
                ).strip()
                pending_alert_draft["expires_at"] = datetime.utcnow() + _ITINERARY_DRAFT_TTL
                response = {
                    "type": "text",
                    "text": (
                        "I have the route and departure date for your round trip. "
                        "Please share the return date, and I'll line up the save confirmation."
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

            # Otherwise keep chat as-is (fall through)

        # 2) Start a new alert setup flow
        if wants_alert_setup_intent and sid:
            if looks_like_route and has_date_any and not needs_return_date:
                staged_instruction = combined_text
                _PENDING_ALERT_DRAFTS[sid] = {
                    "instruction": staged_instruction,
                    "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
                }
                _PENDING_ALERT_SAVES[sid] = {
                    "alert_id": alert_id,
                    "instruction": staged_instruction,
                    "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
                }
                response = {
                    "type": "text",
                    "text": (
                        "Everything looks complete for the alert.\n"
                        "Do you want me to save this price alert now? Reply with 'yes' to confirm."
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
            if looks_like_route and has_date_any and needs_return_date:
                _PENDING_ALERT_DRAFTS[sid] = {
                    "instruction": combined_text,
                    "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
                }
                response = {
                    "type": "text",
                    "text": (
                        "I have the route and departure date. "
                        "Since this is a round trip, please share the return date."
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

            _PENDING_ALERT_DRAFTS[sid] = {
                "instruction": combined_text,
                "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
            }
            response = {
                "type": "text",
                "text": (
                    "To set up your price alert, I just need the remaining details.\n"
                    + ("- Departure and arrival route\n" if not looks_like_route else "")
                    + ("- Departure date or date range\n" if not has_date_any else "")
                    + ("- Return date (you asked for a round trip)\n" if needs_return_date else "")
                    + ("- Optional airline preferences\n" if "air india" not in lowered_msg and "airline" not in lowered_msg else "")
                    + "\n"
                    "When you say 'track this price alert', I will ask your confirmation before saving."
                ),
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response

        # 3) If the user referenced an Alert ID directly, allow AI edit after they request save/track.
        if alert_id and wants_alert_track_trigger:
            try:
                _PENDING_ALERT_SAVES[sid] = {
                    "alert_id": alert_id,
                    "instruction": combined_text,
                    "expires_at": datetime.utcnow() + _ITINERARY_DRAFT_TTL,
                }
                response = {
                    "type": "text",
                    "text": (
                        "I've captured the alert update. "
                        "Do you want me to save the updated price alert now? Reply with 'yes' to confirm."
                    ),
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response
            except Exception:
                response = {
                    "type": "text",
                    "text": "I couldn't prepare that alert update just now. Please try again in a moment.",
                    "session_id": sid,
                }
                persist_chat_exchange(response)
                return response

    recent_flights: List[Dict[str, Any]] = request.recent_flights or []
    cached_session_response = _find_cached_session_reply(db, sid, msg)
    if cached_session_response:
        cached_session_response["session_id"] = sid
        cache_meta = cached_session_response.setdefault("meta", {})
        if isinstance(cache_meta, dict):
            cache_meta.setdefault("cache_hit", "session_response_reuse")
        persist_chat_exchange(cached_session_response)
        return cached_session_response

    planned_response = await plan_chat_response(
        message=msg,
        history=history,
        recent_flights=recent_flights,
        user_context=ToolExecutionContext(
            user_db=db_user,
            chat_db=db,
            user_id=user_id,
            session_id=sid,
            request_id=sid,
        ),
        user_city=user_city,
        user_lat=request.user_lat,
        user_lng=request.user_lng,
    )
    if planned_response:
        stage_itinerary_draft_if_needed(planned_response.get("text") or "")
        persist_chat_exchange(planned_response)
        return planned_response

    if is_flight_result_followup(msg, recent_flights):
        direct_response = await maybe_handle_direct_travel_request(msg, sid)
        if direct_response:
            persist_chat_exchange(direct_response)
            return direct_response

        if request.stream and should_stream_response(msg):
            return build_streaming_chat_response(
                message=msg,
                sid=sid,
                history=history,
                user_city=user_city,
                recent_flights=recent_flights,
                persist_chat_exchange=persist_chat_exchange,
                on_final_text=stage_itinerary_draft_if_needed,
            )

        followup_reply = chat_response(
            msg,
            history,
            user_city=user_city,
            recent_flights=recent_flights,
        )
        stage_itinerary_draft_if_needed(followup_reply)
        followup_response = {
            "type": "text",
            "text": followup_reply,
            "session_id": sid,
        }
        persist_chat_exchange(followup_response)
        return followup_response

    # ── Stage A: Only parse flight intent when the message looks flight-related ──
    intent_result = {
        "intent": "other",
        "is_sufficient": False,
        "missing_fields": [],
        "assistant_reply": "",
        "search": None,
    }
    if should_attempt_flight_search(msg, history):
        intent_result = parse_flight_search_intent(msg, history, user_city=user_city)

    if intent_result.get("intent") == "flight_search":
        # ── Stage B: Sufficiency gate ────────────────────────────────────────
        if not intent_result.get("is_sufficient"):
            # Return targeted clarification without hitting any provider APIs
            response = {
                "type": "text",
                "text": intent_result.get("assistant_reply") or "I can start as soon as I have one or two more details for the search.",
                "session_id": sid,
            }
            persist_chat_exchange(response)
            return response

        search = intent_result.get("search") or {}
        travel_preference = _load_travel_preference(db_user, user_id)
        search = _apply_saved_profile_preferences(search, travel_preference, msg)

        # Normalize departure_date: reject past or missing dates
        depart_date = (search.get("departure_date") or "").strip()
        if not depart_date or not re.match(r"^\d{4}-\d{2}-\d{2}$", depart_date):
            depart_date = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            try:
                d = datetime.strptime(depart_date, "%Y-%m-%d")
                if d.date() < datetime.utcnow().date():
                    depart_date = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
            except ValueError:
                depart_date = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

        return_date = search.get("return_date") or None
        pax = int(search.get("passenger_count") or search.get("adults") or 1)
        raw_currency = search.get("currency")
        if isinstance(raw_currency, str) and raw_currency.strip():
            currency = raw_currency.strip().upper()
        else:
            currency = None
        cabin = (search.get("cabin_class") or "economy").lower()
        budget = search.get("budget")
        constraints = search.get("constraints") or {}
        preferences = search.get("preferences") or {}
        raw_max_lay = constraints.get("max_layover_minutes")
        max_layover_minutes: int | None = None
        if raw_max_lay is not None and str(raw_max_lay).strip() != "":
            try:
                max_layover_minutes = max(30, min(1440, int(float(raw_max_lay))))
            except (TypeError, ValueError):
                max_layover_minutes = None

        try:
            # ── Stage C–E: Search, normalise, enrich, rank ───────────────────
            origin_text = (search.get("origin") or search.get("origin_iata") or "").strip()
            dest_text = (search.get("destination") or search.get("destination_iata") or "").strip()
            search_params = UnifiedSearchParams(
                origin=origin_text,
                destination=dest_text,
                depart_date=depart_date,
                return_date=return_date,
                passengers=pax,
                currency=currency,
                budget=budget,
                cabin=cabin,
                preference=preferences.get("ranking_goal"),
                preferred_airlines=preferences.get("preferred_airlines") or [],
                nonstop_only=bool(constraints.get("nonstop_only")),
                baggage_required=bool(constraints.get("baggage_required")),
                refundable_only=bool(constraints.get("refundable_only")),
                max_layover_minutes=max_layover_minutes,
                user_lat=request.user_lat,
                user_lng=request.user_lng,
            )
            flights, search_info = await unified_flight_search_for_intent(
                origin_text=origin_text,
                dest_text=dest_text,
                airport_preferences=preferences.get("airport_preference"),
                base=search_params,
            )
            # Show only top 5 ranked flights in chat.
            flights = flights[:5]
            try:
                # Recompute indices within the sliced list for consistent summary pills.
                cheapest_index = min(
                    range(len(flights)),
                    key=lambda i: float(
                        (
                            flights[i].get("fare", {}) or {}
                        ).get("total")
                        or flights[i].get("price")
                        or 0,
                    )
                    if flights
                    else 0,
                ) if flights else 0
            except Exception:
                cheapest_index = search_info.get("cheapest_index", 0) if isinstance(search_info, dict) else 0

            def _parse_duration_minutes(val: Any) -> float:
                s = str(val or "").lower()
                # Common formats: "4h 15m", "4h15m", "75m", etc.
                h_match = re.search(r"(\d+)\s*h", s)
                m_match = re.search(r"(\d+)\s*m", s)
                if h_match or m_match:
                    h = int(h_match.group(1)) if h_match else 0
                    m = int(m_match.group(1)) if m_match else 0
                    return float(h * 60 + m)
                # If duration is already numeric minutes
                num = re.search(r"\b(\d+)\b", s)
                return float(num.group(1)) if num else 999999.0

            try:
                fastest_index = min(
                    range(len(flights)),
                    key=lambda i: _parse_duration_minutes(flights[i].get("duration")),
                ) if flights else 0
            except Exception:
                fastest_index = search_info.get("fastest_index", 0) if isinstance(search_info, dict) else 0

            recommended_index = next(
                (i for i, fl in enumerate(flights) if fl.get("is_recommended")),
                0,
            ) if flights else 0

            if isinstance(search_info, dict):
                search_info.update(
                    {
                        "total_results": len(flights),
                        "recommended_index": recommended_index,
                        "cheapest_index": cheapest_index,
                        "fastest_index": fastest_index,
                    }
                )

            # ── Stage F: Fast deterministic presentation ─────────────────────
            presentation = present_flight_results(msg, search, flights, search_info)
            result_text = presentation.get("text") or f"Here are flights from {search.get('origin')} to {search.get('destination')}:"
            follow_up = presentation.get("follow_up_prompt")

            response: Dict = {
                "type": "flights",
                "text": result_text,
                "flights": flights,
                "search": search,
                "session_id": sid,
                "summary": {
                    "totalOptions": len(flights),
                    "recommendedFlightId": (
                        flights[search_info.get("recommended_index", 0)].get("flight_id")
                        if flights else None
                    ),
                    "cheapestFlightId": (
                        flights[search_info.get("cheapest_index", 0)].get("flight_id")
                        if flights else None
                    ),
                    "fastestFlightId": (
                        flights[search_info.get("fastest_index", 0)].get("flight_id")
                        if flights else None
                    ),
                },
            }
            if follow_up:
                response["follow_up_prompt"] = follow_up
            if search_info:
                response["search_info"] = search_info
                if search_info.get("weather_advice"):
                    response["weather_advice"] = search_info["weather_advice"]
                if search_info.get("destination_map_url"):
                    response["destination_map_url"] = search_info["destination_map_url"]
                if search_info.get("recommendation_explanation"):
                    response["recommendation_explanation"] = search_info["recommendation_explanation"]
                if search_info.get("no_api_results_reason") and not flights:
                    alternate_dates = search_info.get("alternate_dates") or []
                    if alternate_dates:
                        response["alternate_dates"] = alternate_dates
                        options_text = _format_alternate_date_suggestions(alternate_dates)
                        response["text"] = (
                            "I couldn't find a strong match for that exact date, but I did find nearby options.\n"
                            f"{options_text}\n\n"
                            "Tell me which date you prefer, and I'll re-run the top options for that day."
                        ).strip()
                        response["follow_up_prompt"] = "Reply with a date from the list and I'll fetch the best matches."
                    else:
                        response["text"] = (
                            "I couldn't find a strong match for those exact details. "
                            "Try adjusting the date or airports, or check again a little later."
                        )

            # Build why_choose from AI pros or score_reason fallback
            for fl in flights:
                reasons = list((fl.get("ranking") or {}).get("pros") or fl.get("pros") or [])
                if not reasons and fl.get("score_reason"):
                    reasons.append(fl["score_reason"])
                if fl.get("is_recommended") or (fl.get("ranking") or {}).get("recommended"):
                    reasons.insert(0, "Our top recommendation")
                if fl.get("stops", 0) == 0 and not any("direct" in r.lower() for r in reasons):
                    reasons.append("Direct flight - no layovers")
                if "Free meal" in (fl.get("perks") or []):
                    reasons.append("Complimentary meal included")
                if "Wi-Fi" in (fl.get("perks") or []):
                    reasons.append("In-flight Wi-Fi available")
                fl["why_choose"] = reasons

            recommended_index = 0
            if isinstance(search_info, dict):
                try:
                    recommended_index = int(search_info.get("recommended_index", 0) or 0)
                except (TypeError, ValueError):
                    recommended_index = 0
            if recommended_index < 0 or recommended_index >= len(flights):
                recommended_index = 0

            recommended_flight = flights[recommended_index] if flights else None
            recommendation_note = _build_profile_recommendation_note(
                recommended_flight=recommended_flight,
                search=search,
                travel_preference=travel_preference,
                recommendation_explanation=(
                    (search_info or {}).get("recommendation_explanation")
                    if isinstance(search_info, dict)
                    else ""
                ),
            )
            if recommendation_note:
                response["recommendation_note"] = recommendation_note

        except Exception as e:
            response = {
                "type": "text",
                "text": "I found some options, but I ran into a problem while organizing them. Please try again.",
                "session_id": sid,
                "debug_error": str(e),
            }
        persist_chat_exchange(response)
        return response

    # ── Not a flight search: direct tool shortcuts then flight-only boundary ──
    direct_response = await maybe_handle_direct_travel_request(msg, sid)
    if direct_response:
        persist_chat_exchange(direct_response)
        return direct_response

    if not _is_flight_domain_message(msg, history, recent_flights):
        response = {
            "type": "text",
            "text": (
                "I currently handle only flight-related help. "
                "Ask about routes, fares, airlines, stop preferences, baggage, flight weather/map context, "
                "or flight status, and I will answer from fetched results and tools."
            ),
            "session_id": sid,
        }
        persist_chat_exchange(response)
        return response

    if request.stream and should_stream_response(msg):
        return build_streaming_chat_response(
            message=msg,
            sid=sid,
            history=history,
            user_city=user_city,
            recent_flights=recent_flights,
            persist_chat_exchange=persist_chat_exchange,
            on_final_text=stage_itinerary_draft_if_needed,
        )

    reply = chat_response(
        msg,
        history,
        user_city=user_city,
        recent_flights=recent_flights,
    )

    if "<WEATHER_SEARCH>" in reply and "</WEATHER_SEARCH>" in reply:
        search_json = reply.split("<WEATHER_SEARCH>")[1].split("</WEATHER_SEARCH>")[0].strip()
        if search_json.startswith("```"):
            search_json = search_json.split("\n", 1)[1] if "\n" in search_json else search_json[3:]
            if search_json.endswith("```"): search_json = search_json[:-3]
        search_json = search_json.strip()

        text_part = reply.split("<WEATHER_SEARCH>")[0].strip()
        try:
            params = json.loads(search_json)
            location = params.get("location")
            location_iata = get_iata(location)
            
            dest_city = location
            try:
                dest_city = get_city_name(location_iata)
            except Exception:
                pass

            response = {
                "type": "flights", # using flights type so ChatClient renders it if we send weather payload
                "text": text_part or f"Here's the latest weather for {dest_city}:",
                "session_id": sid,
                "flights": [], # empty flights array
            }

            try:
                weather_data = await get_weather(dest_city)
                if weather_data:
                    response["weather"] = weather_data
                    response["weather_advice"] = get_weather_advice(weather_data)
            except Exception:
                pass
        except Exception as e:
            response = {
                "type": "text",
                "text": f"I ran into a problem while checking the weather. Please try again in a moment.\n\nError: {str(e)}",
                "session_id": sid,
            }
    elif "<MAP_SEARCH>" in reply and "</MAP_SEARCH>" in reply:
        search_json = reply.split("<MAP_SEARCH>")[1].split("</MAP_SEARCH>")[0].strip()
        if search_json.startswith("```"):
            search_json = search_json.split("\n", 1)[1] if "\n" in search_json else search_json[3:]
            if search_json.endswith("```"): search_json = search_json[:-3]
        search_json = search_json.strip()

        text_part = reply.split("<MAP_SEARCH>")[0].strip()
        try:
            params = json.loads(search_json)
            location = params.get("location")
            location_iata = get_iata(location)
            
            dest_city = location
            try:
                dest_city = get_city_name(location_iata)
            except Exception:
                pass

            response = {
                "type": "flights", # using flights type so ChatClient renders the map payload
                "text": text_part or f"Here's the map for {dest_city}:",
                "session_id": sid,
                "flights": [], # empty flights array
            }

            try:
                response["destination_map_url"] = get_destination_map_url(location_iata)
            except Exception:
                pass
        except Exception as e:
            response = {
                "type": "text",
                "text": f"I ran into a problem while loading the map. Please try again in a moment.\n\nError: {str(e)}",
                "session_id": sid,
            }
    elif "<FLIGHT_STATUS_SEARCH>" in reply and "</FLIGHT_STATUS_SEARCH>" in reply:
        search_json = reply.split("<FLIGHT_STATUS_SEARCH>")[1].split("</FLIGHT_STATUS_SEARCH>")[0].strip()
        if search_json.startswith("```"):
            search_json = search_json.split("\n", 1)[1] if "\n" in search_json else search_json[3:]
            if search_json.endswith("```"): search_json = search_json[:-3]
        search_json = search_json.strip()

        text_part = reply.split("<FLIGHT_STATUS_SEARCH>")[0].strip()
        try:
            params = json.loads(search_json)
            flight_number = params.get("flight_number")
            
            from services.flightaware_client import get_flight_status
            status_info = await get_flight_status(flight_number)
            
            response = {
                "type": "text",
                "text": f"{text_part}\n\n{status_info}".strip(),
                "session_id": sid,
            }
        except Exception as e:
            response = {
                "type": "text",
                "text": f"I ran into a problem while checking that flight. Please try again in a moment.\n\nError: {str(e)}",
                "session_id": sid,
            }
    else:
        response = {"type": "text", "text": reply, "session_id": sid}
        stage_itinerary_draft_if_needed(reply)

    persist_chat_exchange(response)
    return response


@router.post("/chat/title")
async def chat_title_endpoint(request: ChatTitleRequest):
    return {
        "title": generate_chat_title(
            {
                "role": message.role,
                "content": message.content,
            }
            for message in request.messages
        ),
    }


# ── Flight Search (Mocked) ──────────────────────────────

@router.post("/flights/search")
async def flight_search_endpoint(request: FlightSearchRequest):
    origin_text = (request.origin or "").strip()
    dest_text = (request.destination or "").strip()
    search_params = UnifiedSearchParams(
        origin=origin_text,
        destination=dest_text,
        depart_date=request.date,
        return_date=request.return_date,
        passengers=request.passengers,
        currency=request.currency,
        budget=request.budget,
        cabin="economy",
        preferred_airlines=request.preferred_airlines or [],
        nonstop_only=request.nonstop_only,
        baggage_required=request.baggage_required,
        refundable_only=request.refundable_only,
        user_lat=request.user_lat,
        user_lng=request.user_lng,
    )
    flights, search_info = await unified_flight_search_for_intent(
        origin_text=origin_text,
        dest_text=dest_text,
        airport_preferences=None,
        base=search_params,
    )
    flights = flights[:5]
    resolved_currency = (
        (search_info or {}).get("currency") if isinstance(search_info, dict) else None
    )
    out = {
        "origin": request.origin,
        "destination": request.destination,
        "date": request.date,
        "return_date": request.return_date,
        "passengers": request.passengers,
        "currency": resolved_currency or request.currency,
        "flights": flights,
    }
    if search_info:
        try:
            recommended_index = int(search_info.get("recommended_index", 0) or 0)
        except (TypeError, ValueError):
            recommended_index = 0
        if recommended_index < 0 or recommended_index >= len(flights):
            recommended_index = 0
        search_info = {
            **search_info,
            "total_results": len(flights),
            "recommended_index": recommended_index,
        }
        out["search_info"] = search_info
        out["recommendation_explanation"] = search_info.get("recommendation_explanation")
        out["recommendation_note"] = _build_profile_recommendation_note(
            recommended_flight=(flights[recommended_index] if flights else None),
            search={
                "origin": request.origin,
                "destination": request.destination,
                "constraints": {
                    "nonstop_only": request.nonstop_only,
                    "baggage_required": request.baggage_required,
                    "refundable_only": request.refundable_only,
                },
            },
            travel_preference=None,
            recommendation_explanation=search_info.get("recommendation_explanation") or "",
        )
        out["weather_advice"] = search_info.get("weather_advice")
        out["destination_map_url"] = search_info.get("destination_map_url")
    return out


@router.get("/flights/verify")
async def verify_flight_details(
    flight_number: str = Query(..., description="Flight number to verify (e.g. AI 101 or EK501)"),
    origin: Optional[str] = Query(None, description="Expected origin IATA (e.g. DEL)"),
    destination: Optional[str] = Query(None, description="Expected destination IATA (e.g. PNQ)"),
    departure_date: Optional[str] = Query(None, description="Expected departure date YYYY-MM-DD"),
):
    """
    Fetch real flight details from FlightAware for verification.
    Use this to verify status, route, and times for any flight.
    """
    details = await get_flight_details(
        flight_number.strip(),
        expected_origin=(origin or "").strip().upper() or None,
        expected_destination=(destination or "").strip().upper() or None,
        expected_depart_date=(departure_date or "").strip() or None,
    )
    return details


@router.post("/flights/confirm-price")
async def confirm_price_endpoint(request: FlightOfferVerificationRequest):
    """
    Confirm live price and availability for a specific Amadeus flight offer.
    """
    confirmed_offer, error = await confirm_flight_price(request.offer)
    if error or not confirmed_offer:
        raise HTTPException(status_code=400, detail=error or "Price verification failed")
    return {
        "confirmed_offer": confirmed_offer,
        "verification": {
            "source": "amadeus",
            "verified_at": datetime.utcnow().isoformat() + "Z",
        },
    }


@router.post("/flights/seatmap")
async def seatmap_endpoint(request: FlightOfferVerificationRequest):
    """
    Fetch the seatmap for a specific Amadeus flight offer.
    """
    seatmaps, error = await get_seatmap_by_offer(request.offer)
    if error:
        raise HTTPException(status_code=400, detail=error)
    return {"seatmaps": seatmaps}


# ── Passenger profile & consent ───────────────────────────


@router.get("/passenger/profile")
async def get_passenger_profile(
    session_id: str = Query(...),
    db: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    """Return passenger profile for the given session (session must belong to current user)."""
    from uuid import UUID
    try:
        session_uuid = UUID(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    session_user_uuid = to_session_user_uuid(user_id)
    session = db.query(ChatSession).filter(ChatSession.id == session_uuid, ChatSession.user_id == session_user_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    profile = db.query(GuestPassengerProfile).filter(GuestPassengerProfile.session_id == session_uuid).first()
    if not profile:
        return {"profile": None}
    return {
        "profile": {
            "full_name": profile.full_name,
            "email": profile.email,
            "phone": profile.phone,
            "date_of_birth": profile.date_of_birth.isoformat() if profile.date_of_birth else None,
            "nationality": profile.nationality,
        }
    }


@router.post("/passenger/profile")
async def upsert_passenger_profile(
    payload: PassengerProfilePayload,
    db: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    """Create or update a guest passenger profile for the given session."""
    from uuid import UUID
    from datetime import date

    try:
        session_uuid = UUID(payload.session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    session_user_uuid = to_session_user_uuid(user_id)
    session = db.query(ChatSession).filter(ChatSession.id == session_uuid, ChatSession.user_id == session_user_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    profile = (
        db.query(GuestPassengerProfile)
        .filter(GuestPassengerProfile.session_id == session_uuid)
        .first()
    )
    if not profile:
        profile = GuestPassengerProfile(session_id=session_uuid, full_name=payload.full_name)
        db.add(profile)

    profile.full_name = payload.full_name
    profile.email = payload.email
    profile.phone = payload.phone
    profile.nationality = payload.nationality

    try:
        profile.date_of_birth = date.fromisoformat(payload.date_of_birth) if payload.date_of_birth else None
    except Exception:
        profile.date_of_birth = None

    db.commit()
    db.refresh(profile)

    return {"ok": True}


@router.get("/passenger/consent")
async def get_passenger_consent(
    session_id: str = Query(...),
    db_user: Session = Depends(get_user_db),
    db_chat: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    """Return consent states for a given session (session must belong to current user)."""
    from uuid import UUID

    try:
        session_uuid = UUID(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    session_user_uuid = to_session_user_uuid(user_id)
    session = db_chat.query(ChatSession).filter(ChatSession.id == session_uuid, ChatSession.user_id == session_user_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    records = (
        db_user.query(ConsentRecord)
        .filter(ConsentRecord.session_id == session_uuid, ConsentRecord.user_id == user_id)
        .all()
    )
    result: Dict[str, bool] = {}
    for r in records:
        result[r.scope] = r.granted
    return {"consent": result}


@router.post("/passenger/consent")
async def set_passenger_consent(
    payload: ConsentPayload,
    db_user: Session = Depends(get_user_db),
    db_chat: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    """Record or update consent for a specific scope (session must belong to current user)."""
    from uuid import UUID

    try:
        session_uuid = UUID(payload.session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    session_user_uuid = to_session_user_uuid(user_id)
    session = db_chat.query(ChatSession).filter(ChatSession.id == session_uuid, ChatSession.user_id == session_user_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    record = (
        db_user.query(ConsentRecord)
        .filter(ConsentRecord.session_id == session_uuid, ConsentRecord.user_id == user_id, ConsentRecord.scope == payload.scope)
        .first()
    )
    if not record:
        record = ConsentRecord(user_id=user_id, session_id=session_uuid, scope=payload.scope, granted=payload.granted)
        db_user.add(record)
    else:
        record.granted = payload.granted
    db_user.commit()
    db_user.refresh(record)
    return {"ok": True}


# ── Trips (My Trips) ──────────────────────────────────────


@router.get("/trips")
async def list_trips(
    session_id: Optional[str] = Query(None),
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    """List trips for the current user. Optionally filter by session_id."""
    q = db.query(Trip).filter(Trip.user_id == user_id)
    trips = q.order_by(Trip.created_at.desc()).all()
    return {"trips": [serialize_trip(t) for t in trips]}


@router.post("/trips")
async def create_trip(
    payload: TripCreatePayload,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    """Create a new trip entry for the current user."""
    from datetime import datetime as dt

    def normalize_trip_type(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        lowered = value.strip().lower().replace("-", "_").replace(" ", "_")
        if lowered in {"oneway", "one_way", "single", "single_trip"}:
            return "one_way"
        if lowered in {"roundtrip", "round_trip", "return", "return_trip"}:
            return "round_trip"
        return None

    def parse_dt(value: Optional[str]):
        if not value:
            return None
        try:
            return dt.fromisoformat(value)
        except Exception:
            return None

    metadata: dict[str, Any] = {}
    trip_type = normalize_trip_type(payload.trip_type)
    if trip_type:
        metadata["trip_type"] = trip_type
    elif payload.arrival_date:
        metadata["trip_type"] = "round_trip"
    else:
        metadata["trip_type"] = "one_way"

    if payload.passenger_name and payload.passenger_name.strip():
        metadata["passenger_name"] = payload.passenger_name.strip()

    trip = Trip(
        user_id=user_id,
        origin=payload.origin,
        destination=payload.destination,
        airline=payload.airline,
        flight_number=payload.flight_number,
        departure_date=parse_dt(payload.departure_date),
        arrival_date=parse_dt(payload.arrival_date),
        status="CONFIRMED",
        cabin_class=payload.cabin_class,
        booking_ref=payload.booking_ref,
        confirmation_code=payload.confirmation_code,
        ticket_number=payload.ticket_number,
        seat_number=payload.seat_number,
        flight_snapshot=json.dumps(metadata, separators=(",", ":"), sort_keys=True),
        ticket_cost_minor=(
            int(round(float(payload.ticket_cost) * 100))
            if payload.ticket_cost is not None
            else None
        ),
        currency=payload.currency or "USD",
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return {"trip": serialize_trip(trip)}


@router.post("/trips/ai-create")
async def create_trip_with_ai(
    payload: TripAiCreatePayload,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    from uuid import UUID

    session_id = None
    if payload.session_id:
        try:
            session_id = str(UUID(payload.session_id))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid session_id") from exc

    try:
        trip = await create_trip_from_ai_instruction(
            db,
            user_id=user_id,
            instruction=payload.instruction,
            session_id=session_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"trip": trip}


@router.get("/trips/{trip_id}")
async def get_trip(
    trip_id: str,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    trip = get_trip_for_user(db, trip_id, user_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    return {"trip": serialize_trip(trip)}


@router.patch("/trips/{trip_id}")
async def update_trip(
    trip_id: str,
    payload: TripUpdatePayload,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    from datetime import datetime as dt

    trip = get_trip_for_user(db, trip_id, user_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    def normalize_trip_type(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        lowered = value.strip().lower().replace("-", "_").replace(" ", "_")
        if lowered in {"oneway", "one_way", "single", "single_trip"}:
            return "one_way"
        if lowered in {"roundtrip", "round_trip", "return", "return_trip"}:
            return "round_trip"
        return None

    def parse_dt(value: Optional[str]):
        if value is None:
            return None
        if not value.strip():
            return None
        try:
            return dt.fromisoformat(value)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid date: {value}")

    fields_provided = any(
        getattr(payload, field) is not None
        for field in (
            "status",
            "airline",
            "flight_number",
            "trip_type",
            "passenger_name",
            "origin",
            "destination",
            "departure_date",
            "arrival_date",
            "cabin_class",
            "confirmation_code",
            "ticket_number",
            "booking_ref",
            "seat_number",
            "ticket_cost",
            "currency",
        )
    )
    if not fields_provided:
        raise HTTPException(status_code=400, detail="No trip fields provided")

    if payload.status is not None:
        normalized_status = payload.status.strip().lower()
        status_map = {
            "confirmed": "CONFIRMED",
            "paused": "PLANNED",
            "planned": "PLANNED",
            "ticketed": "TICKETED",
            "completed": "COMPLETED",
            "cancelled": "CANCELLED",
        }
        resolved_status = status_map.get(normalized_status)
        if not resolved_status:
            raise HTTPException(status_code=400, detail="Invalid status")
        trip.status = resolved_status

    if payload.origin is not None:
        origin = payload.origin.strip()
        if not origin:
            raise HTTPException(status_code=400, detail="origin cannot be empty")
        trip.origin = origin.upper() if len(origin) <= 3 and origin.isalpha() else origin.title()

    if payload.destination is not None:
        destination = payload.destination.strip()
        if not destination:
            raise HTTPException(status_code=400, detail="destination cannot be empty")
        trip.destination = (
            destination.upper()
            if len(destination) <= 3 and destination.isalpha()
            else destination.title()
        )

    if payload.airline is not None:
        trip.airline = payload.airline.strip().title() or None
    if payload.flight_number is not None:
        trip.flight_number = payload.flight_number.strip().upper() or None
    if payload.cabin_class is not None:
        trip.cabin_class = payload.cabin_class.strip() or None
    if payload.confirmation_code is not None:
        trip.confirmation_code = payload.confirmation_code.strip() or None
    if payload.ticket_number is not None:
        trip.ticket_number = payload.ticket_number.strip() or None
    if payload.booking_ref is not None:
        trip.booking_ref = payload.booking_ref.strip() or None
    if payload.seat_number is not None:
        trip.seat_number = payload.seat_number.strip() or None
    if payload.currency is not None:
        trip.currency = payload.currency.strip().upper() or "USD"
    if payload.ticket_cost is not None:
        trip.ticket_cost_minor = int(round(float(payload.ticket_cost) * 100))
    if payload.departure_date is not None:
        trip.departure_date = parse_dt(payload.departure_date)
    if payload.arrival_date is not None:
        trip.arrival_date = parse_dt(payload.arrival_date)

    metadata: dict[str, Any] = {}
    if trip.flight_snapshot:
        try:
            parsed_snapshot = json.loads(trip.flight_snapshot)
            if isinstance(parsed_snapshot, dict):
                metadata = parsed_snapshot
        except Exception:
            metadata = {}

    if payload.trip_type is not None:
        normalized_trip_type = normalize_trip_type(payload.trip_type)
        if normalized_trip_type:
            metadata["trip_type"] = normalized_trip_type
        else:
            metadata.pop("trip_type", None)
    elif "trip_type" not in metadata:
        metadata["trip_type"] = "round_trip" if trip.arrival_date else "one_way"

    if payload.passenger_name is not None:
        passenger_name = payload.passenger_name.strip()
        if passenger_name:
            metadata["passenger_name"] = passenger_name
        else:
            metadata.pop("passenger_name", None)

    trip.flight_snapshot = (
        json.dumps(metadata, separators=(",", ":"), sort_keys=True)
        if metadata
        else None
    )
    trip.updated_at = datetime.utcnow()
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return {"trip": serialize_trip(trip)}


@router.post("/trips/{trip_id}/ai-edit")
async def ai_edit_trip(
    trip_id: str,
    payload: TripAiEditPayload,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    trip = get_trip_for_user(db, trip_id, user_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    try:
        updated_trip = await apply_ai_edit_to_trip(db, trip, payload.instruction)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"trip": updated_trip}


@router.delete("/trips/{trip_id}")
async def delete_trip(
    trip_id: str,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    trip = get_trip_for_user(db, trip_id, user_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    db.delete(trip)
    db.commit()
    return {"deleted": True}


# ── Feedback submission ───────────────────────────────────


@router.post("/feedback")
async def submit_feedback(
    payload: FeedbackSubmitPayload,
    db_user: Session = Depends(get_user_db),
    db_chat: Session = Depends(get_chat_db),
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """Submit feedback with optional chat context. If authenticated, user_id is stored."""
    from uuid import UUID

    trimmed_message = (payload.message or "").strip()
    if not trimmed_message:
        raise HTTPException(status_code=400, detail="message is required")

    resolved_name = payload.name
    resolved_email = payload.email
    if user_id:
        db_user_obj = db_user.query(User).filter(User.id == user_id).first()
        if db_user_obj:
            full_name = " ".join(
                part for part in [db_user_obj.first_name, db_user_obj.last_name] if part
            ).strip()
            resolved_name = full_name or db_user_obj.first_name or payload.name
            resolved_email = db_user_obj.email or payload.email
    else:
        resolved_name = (resolved_name or "").strip() or None
        resolved_email = (resolved_email or "").strip() or None

    # When the account has no first/last name, use the email local-part as name (matches frontend).
    if not (resolved_name or "").strip():
        res_email = (resolved_email or "").strip()
        if "@" in res_email:
            resolved_name = res_email.split("@", 1)[0].strip()

    if not (resolved_name or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    if not (resolved_email or "").strip():
        raise HTTPException(status_code=400, detail="email is required")

    resolved_name = (resolved_name or "").strip()
    resolved_email = (resolved_email or "").strip()

    session_uuid = None
    if payload.chat_session_id:
        try:
            session_uuid = UUID(payload.chat_session_id)
        except Exception:
            session_uuid = None

    context_chat = None
    if session_uuid:
        msgs = (
            db_chat.query(ChatMessage)
            .filter(ChatMessage.session_id == session_uuid)
            .order_by(ChatMessage.created_at.desc())
            .limit(15)
            .all()
        )
        context_chat = [
            {
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in reversed(msgs)
        ]

    merged_context_flights = payload.context_flights
    if payload.context_page:
        if isinstance(merged_context_flights, dict):
            merged_context_flights = {
                **merged_context_flights,
                "page_snapshot": payload.context_page,
            }
        else:
            merged_context_flights = {"page_snapshot": payload.context_page}

    resolved_context_page = payload.context_page
    if not resolved_context_page and isinstance(payload.context_flights, dict):
        maybe_snapshot = payload.context_flights.get("page_snapshot")
        if isinstance(maybe_snapshot, dict):
            resolved_context_page = maybe_snapshot

    fb = Feedback(
        user_id=user_id if user_id else None,
        session_id=session_uuid,
        name=resolved_name,
        email=resolved_email,
        message=trimmed_message,
        context_chat=context_chat,
        context_flights=merged_context_flights,
        context_page=resolved_context_page,
        status="new",
    )
    db_user.add(fb)
    db_user.commit()
    db_user.refresh(fb)
    return {"id": str(fb.id)}


# ── Admin endpoints (metrics, sessions, feedback) ─────────


def _iso_datetime(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _build_recent_day_keys(days: int = 7) -> list[datetime]:
    today = _start_of_day(datetime.utcnow())
    return [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


def _normalize_admin_label(value: Any, fallback: str = "Unknown") -> str:
    if value is None:
        return fallback
    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        return ", ".join(cleaned) if cleaned else fallback
    text_value = str(value).strip()
    return text_value or fallback


def _first_list_value(value: Any, fallback: str = "Unknown") -> str:
    if isinstance(value, list):
        for item in value:
            normalized = _normalize_admin_label(item, "")
            if normalized:
                return normalized
        return fallback
    return _normalize_admin_label(value, fallback)


def _normalize_chat_query(value: str) -> str:
    return re.sub(r"[^a-z0-9\s]+", " ", (value or "").lower()).strip()


def _chat_tokens(value: str) -> set[str]:
    normalized = _normalize_chat_query(value)
    return {token for token in normalized.split() if token}


def _is_near_same_intent(current: str, candidate: str) -> bool:
    norm_current = _normalize_chat_query(current)
    norm_candidate = _normalize_chat_query(candidate)
    if not norm_current or not norm_candidate:
        return False
    if norm_current == norm_candidate:
        return True
    if norm_current in norm_candidate or norm_candidate in norm_current:
        return True

    tokens_current = _chat_tokens(current)
    tokens_candidate = _chat_tokens(candidate)
    if not tokens_current or not tokens_candidate:
        return False

    intersection = len(tokens_current.intersection(tokens_candidate))
    union = len(tokens_current.union(tokens_candidate))
    if union == 0:
        return False
    return (intersection / union) >= 0.72


def _find_cached_session_reply(
    db: Session,
    session_id: Optional[str],
    message: str,
) -> Optional[Dict[str, Any]]:
    if not session_id or not (message or "").strip():
        return None
    try:
        session_uuid = uuid.UUID(str(session_id))
    except Exception:
        return None

    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_uuid)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    if len(rows) < 2:
        return None

    for index in range(len(rows) - 2, -1, -1):
        user_msg = rows[index]
        if (user_msg.role or "").strip().lower() != "user":
            continue
        if not _is_near_same_intent(message, user_msg.content or ""):
            continue

        for follow_index in range(index + 1, len(rows)):
            assistant_msg = rows[follow_index]
            role = (assistant_msg.role or "").strip().lower()
            if role == "user":
                break
            if role != "assistant":
                continue

            payload = assistant_msg.metadata_ if isinstance(assistant_msg.metadata_, dict) else None
            if payload:
                cloned = dict(payload)
                cloned.setdefault("text", assistant_msg.content or "")
                return cloned
            return {
                "type": "text",
                "text": assistant_msg.content or "",
            }
    return None


def _is_search_message(message: ChatMessage) -> bool:
    content = message.content or ""
    return "<FLIGHT_SEARCH>" in content or message.msg_type == "flights"


def _is_redirect_message(message: ChatMessage) -> bool:
    content = (message.content or "").lower()
    return any(
        host in content
        for host in (
            "skyscanner.com",
            "kayak.com",
            "google.com/travel/flights",
            "expedia.com",
            "booking.com/flights",
        )
    )


def _profile_completion_percent(user: User, preference: Optional[TravelPreference]) -> int:
    fields = [
        user.first_name or user.full_name,
        user.last_name or user.full_name,
        user.phone,
        user.date_of_birth,
        user.gender,
        user.nationality,
        user.address,
        user.image_url,
        preference.seat_preference if preference else None,
        preference.cabin_class if preference else None,
    ]
    completed = sum(1 for field in fields if field not in (None, "", []))
    return round((completed / len(fields)) * 100)


def _build_bucket_counts(values: list[int], buckets: list[tuple[str, int, Optional[int]]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for label, minimum, maximum in buckets:
        if maximum is None:
            count = sum(1 for value in values if value >= minimum)
        else:
            count = sum(1 for value in values if minimum <= value <= maximum)
        output.append({"label": label, "count": count})
    return output


def _format_route_label(origin: Optional[str], destination: Optional[str]) -> str:
    left = _normalize_admin_label(origin, "Unknown origin")
    right = _normalize_admin_label(destination, "Unknown destination")
    return f"{left} -> {right}"


_IATA_PAIR_ROUTE_RE = re.compile(r"\b([A-Z]{3})\s*(?:-|to|->)\s*([A-Z]{3})\b")


def _route_label_from_flight_metadata(metadata: Any) -> Optional[str]:
    """Best-effort route label from assistant flight message metadata (JSON)."""
    if not isinstance(metadata, dict):
        return None
    search = metadata.get("search") or {}
    o = (search.get("origin") or "").strip()
    d = (search.get("destination") or "").strip()
    if o and d:
        return _format_route_label(o, d)
    for key in ("flights", "all_flights"):
        flights = metadata.get(key)
        if isinstance(flights, list) and flights:
            first = flights[0]
            if isinstance(first, dict):
                route = first.get("route") or {}
                o = (route.get("originCity") or route.get("originIata") or "").strip()
                dd = (route.get("destinationCity") or route.get("destinationIata") or "").strip()
                if o or dd:
                    return _format_route_label(o or None, dd or None)
    return None


def _short_prompt(content: str, limit: int = 80) -> str:
    normalized = re.sub(r"\s+", " ", (content or "").strip())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _age_from_date_of_birth(date_of_birth: Any) -> int | None:
    """Compute integer age in years from date_of_birth, if available."""
    if not date_of_birth:
        return None
    try:
        today = datetime.utcnow().date()
        years = today.year - date_of_birth.year
        if (today.month, today.day) < (date_of_birth.month, date_of_birth.day):
            years -= 1
        return years if years >= 0 else None
    except Exception:
        return None


# Stale-while-revalidate memoization for the heavy admin data builder.
# Multiple admin endpoints (users/analytics, funnel, behavior, ai/performance)
# call this and the dashboard fetches them in parallel, so without caching the
# same full-DB scan runs 3–4× concurrently and saturates DB/CPU leading to 25s+
# responses.
#
# We intentionally do NOT spawn background threads to refresh the cache: extra
# DB sessions during uvicorn --reload / graceful shutdown can keep the worker
# process from exiting cleanly and look like a "stuck" backend.
#
# Instead: after TTL, keep serving stale data for up to STALE_MAX seconds; then
# one request pays the cost of a synchronous rebuild under a lock (others wait
# on that single rebuild, not on N parallel full scans).
_ADMIN_CONTEXT_CACHE: dict[str, Any] = {"value": None, "expires_at": 0.0}
_ADMIN_CONTEXT_LOCK = threading.Lock()
_ADMIN_CONTEXT_TTL_SECONDS = float(os.getenv("ADMIN_CONTEXT_TTL_SECONDS", "30"))
# Seconds after TTL expiry we still return cached data without rebuilding.
_ADMIN_CONTEXT_STALE_MAX_SECONDS = float(
    os.getenv("ADMIN_CONTEXT_STALE_MAX_SECONDS", "900")
)


def _build_admin_data_context(
    db_user: Session,
    db_chat: Session,
) -> dict[str, Any]:
    now = time.monotonic()
    cached_value = _ADMIN_CONTEXT_CACHE.get("value")
    cached_expires = float(_ADMIN_CONTEXT_CACHE.get("expires_at", 0) or 0)

    # Fast path: cache is still fresh.
    if cached_value is not None and cached_expires > now:
        return cached_value

    # Stale-while-revalidate: serve last good snapshot without blocking on a
    # rebuild (refresh happens once stale_max is exceeded, see locked path).
    if (
        cached_value is not None
        and (now - cached_expires) <= _ADMIN_CONTEXT_STALE_MAX_SECONDS
    ):
        return cached_value

    # Cold start (or cache too old): single-flight synchronous rebuild.
    with _ADMIN_CONTEXT_LOCK:
        now = time.monotonic()
        cached_value = _ADMIN_CONTEXT_CACHE.get("value")
        cached_expires = float(_ADMIN_CONTEXT_CACHE.get("expires_at", 0) or 0)
        if cached_value is not None and cached_expires > now:
            return cached_value
        if (
            cached_value is not None
            and (now - cached_expires) <= _ADMIN_CONTEXT_STALE_MAX_SECONDS
        ):
            return cached_value

        value = _build_admin_data_context_uncached(db_user, db_chat)
        _ADMIN_CONTEXT_CACHE["value"] = value
        _ADMIN_CONTEXT_CACHE["expires_at"] = (
            time.monotonic() + _ADMIN_CONTEXT_TTL_SECONDS
        )
        return value


def _build_admin_data_context_uncached(
    db_user: Session,
    db_chat: Session,
) -> dict[str, Any]:
    users = (
        db_user.query(User)
        .filter(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
        .all()
    )
    known_user_ids = {str(user.id) for user in users}
    preferences = db_user.query(TravelPreference).all()
    trips = db_user.query(Trip).all()
    alerts = db_user.query(PriceAlert).all()
    feedback_items = db_user.query(Feedback).all()
    chat_sessions = db_chat.query(ChatSession).all()
    chat_messages = (
        db_chat.query(ChatMessage)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    preference_by_user = {pref.user_id: pref for pref in preferences}
    sessions_by_id = {str(session.id): session for session in chat_sessions}

    session_messages: dict[str, list[ChatMessage]] = defaultdict(list)
    session_search_counts: Counter[str] = Counter()
    redirect_message_count = 0
    total_searches = 0
    total_options = 0
    prompt_counter: Counter[str] = Counter()
    search_route_counter: Counter[str] = Counter()
    messages_last_24h = 0
    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)

    for message in chat_messages:
        session_key = str(message.session_id)
        session_messages[session_key].append(message)

        if _is_search_message(message):
            session_search_counts[session_key] += 1
            total_searches += 1
        if message.msg_type == "flights":
            total_options += 1
            route_label = _route_label_from_flight_metadata(message.metadata_)
            if not route_label and message.content:
                pair = _IATA_PAIR_ROUTE_RE.search(message.content)
                if pair:
                    route_label = f"{pair.group(1)} -> {pair.group(2)}"
            if route_label:
                search_route_counter[route_label] += 1

        if _is_redirect_message(message):
            redirect_message_count += 1

        if message.role == "user":
            prompt = _short_prompt(message.content or "")
            if len(prompt) >= 8:
                prompt_counter[prompt] += 1

        if message.created_at and message.created_at >= twenty_four_hours_ago:
            messages_last_24h += 1

    trip_counts: Counter[str] = Counter()
    conversion_counts: Counter[str] = Counter()
    alert_counts: Counter[str] = Counter()
    feedback_counts: Counter[str] = Counter()
    route_counter: Counter[str] = Counter()

    for trip in trips:
        if trip.user_id:
            trip_counts[str(trip.user_id)] += 1
            if str(getattr(trip, "status", "") or "").upper() == "CONFIRMED":
                conversion_counts[str(trip.user_id)] += 1
        route_counter[_format_route_label(trip.origin, trip.destination)] += 1

    for alert in alerts:
        if alert.user_id:
            alert_counts[str(alert.user_id)] += 1

    for item in feedback_items:
        if item.user_id:
            feedback_counts[str(item.user_id)] += 1

    user_session_count: Counter[str] = Counter()
    user_message_count: Counter[str] = Counter()
    user_search_count: Counter[str] = Counter()
    user_last_active: dict[str, datetime] = {}
    active_user_ids_30d: set[str] = set()
    authenticated_session_count = 0
    guest_session_count = 0
    one_month_ago = datetime.utcnow() - timedelta(days=30)

    session_metrics: list[dict[str, Any]] = []
    for session in chat_sessions:
        session_key = str(session.id)
        messages = session_messages.get(session_key, [])
        session_user_id = str(session.user_id) if session.user_id else None
        message_count = len(messages)
        search_count = session_search_counts.get(session_key, 0)
        duration_seconds = 0
        if session.created_at and session.updated_at and session.updated_at >= session.created_at:
            duration_seconds = int((session.updated_at - session.created_at).total_seconds())

        last_message_preview = ""
        if messages:
            last_message_preview = (messages[-1].content or "").strip()[:120]

        session_metrics.append(
            {
                "id": session_key,
                "user_id": session_user_id,
                "created_at": session.created_at,
                "updated_at": session.updated_at,
                "message_count": message_count,
                "search_count": search_count,
                "duration_seconds": duration_seconds,
                "last_message_preview": last_message_preview,
            }
        )

        if session_user_id:
            authenticated_session_count += 1
            if session_user_id in known_user_ids:
                user_session_count[session_user_id] += 1
                user_message_count[session_user_id] += message_count
                user_search_count[session_user_id] += search_count
                if session.updated_at:
                    prior = user_last_active.get(session_user_id)
                    if not prior or session.updated_at > prior:
                        user_last_active[session_user_id] = session.updated_at
                    if session.updated_at >= one_month_ago:
                        active_user_ids_30d.add(session_user_id)
        else:
            guest_session_count += 1

    user_rows: list[dict[str, Any]] = []
    country_counter: Counter[str] = Counter()
    gender_counter: Counter[str] = Counter()
    role_counter: Counter[str] = Counter()
    status_counter: Counter[str] = Counter()
    cabin_counter: Counter[str] = Counter()
    seat_counter: Counter[str] = Counter()
    timing_counter: Counter[str] = Counter()

    for user in users:
        user_id = str(user.id)
        preference = preference_by_user.get(user_id)
        profile_completion = _profile_completion_percent(user, preference)
        session_count = user_session_count.get(user_id, 0)
        message_count = user_message_count.get(user_id, 0)
        search_count = user_search_count.get(user_id, 0)
        trip_count = trip_counts.get(user_id, 0)
        conversion_count = conversion_counts.get(user_id, 0)
        alert_count = alert_counts.get(user_id, 0)
        feedback_count = feedback_counts.get(user_id, 0)
        last_active_at = user_last_active.get(user_id) or user.last_sign_in_at or user.updated_at

        if last_active_at and last_active_at >= one_month_ago:
            active_user_ids_30d.add(user_id)

        engagement_score = min(
            100,
            int(
                min(session_count * 12, 24)
                + min(message_count * 1.5, 22)
                + min(search_count * 6, 18)
                + min(trip_count * 10, 16)
                + min(alert_count * 8, 10)
                + min(feedback_count * 4, 6)
                + round(profile_completion * 0.04)
            ),
        )

        country_label = _normalize_admin_label(user.nationality)
        gender_label = _normalize_admin_label(user.gender)
        role_label = _normalize_admin_label(user.role)
        status_label = _normalize_admin_label(user.status)
        cabin_label = _normalize_admin_label(preference.cabin_class if preference else None)
        seat_label = _normalize_admin_label(preference.seat_preference if preference else None)
        timing_label = _first_list_value(
            preference.flight_timing if preference else None,
            "Unknown",
        )

        country_counter[country_label] += 1
        gender_counter[gender_label] += 1
        role_counter[role_label] += 1
        status_counter[status_label] += 1
        cabin_counter[cabin_label] += 1
        seat_counter[seat_label] += 1
        timing_counter[timing_label] += 1

        user_rows.append(
            {
                "id": user_id,
                "name": (
                    f"{(user.first_name or '').strip()} {(user.last_name or '').strip()}".strip()
                    or _normalize_admin_label(user.full_name, "")
                    or user.email
                ),
                "email": user.email,
                "nationality": None if country_label == "Unknown" else country_label,
                "gender": None if gender_label == "Unknown" else gender_label,
                "role": role_label,
                "status": status_label,
                "created_at": _iso_datetime(user.created_at),
                "last_active_at": _iso_datetime(last_active_at),
                "session_count": session_count,
                "message_count": message_count,
                "search_count": search_count,
                "trip_count": trip_count,
                "conversion_count": conversion_count,
                "alert_count": alert_count,
                "feedback_count": feedback_count,
                "age": _age_from_date_of_birth(getattr(user, "date_of_birth", None)),
                "profile_completion": profile_completion,
                "engagement_score": engagement_score,
                "cabin_class": None if cabin_label == "Unknown" else cabin_label,
                "seat_preference": None if seat_label == "Unknown" else seat_label,
                "flight_timing": None if timing_label == "Unknown" else timing_label,
            }
        )

    user_rows.sort(
        key=lambda item: (
            item["last_active_at"] or "",
            item["created_at"] or "",
        ),
        reverse=True,
    )

    age_bucket_counts = {
        "18-24": 0,
        "25-34": 0,
        "35-44": 0,
        "45-54": 0,
        "55+": 0,
        "Unknown": 0,
    }
    for user in users:
        age = _age_from_date_of_birth(getattr(user, "date_of_birth", None))
        if age is None or age < 18:
            age_bucket_counts["Unknown"] += 1
        elif age <= 24:
            age_bucket_counts["18-24"] += 1
        elif age <= 34:
            age_bucket_counts["25-34"] += 1
        elif age <= 44:
            age_bucket_counts["35-44"] += 1
        elif age <= 54:
            age_bucket_counts["45-54"] += 1
        else:
            age_bucket_counts["55+"] += 1
    age_distribution = [
        {"range": label, "count": age_bucket_counts[label]}
        for label in ("18-24", "25-34", "35-44", "45-54", "55+", "Unknown")
    ]

    avg_messages_per_user = (
        round(sum(row["message_count"] for row in user_rows) / len(user_rows), 2)
        if user_rows
        else 0
    )
    avg_profile = (
        round(sum(row["profile_completion"] for row in user_rows) / len(user_rows), 1)
        if user_rows
        else 0
    )
    travel_prefs_count = sum(
        1
        for row in user_rows
        if (row.get("cabin_class") not in (None, "Unknown", ""))
        or (row.get("seat_preference") not in (None, "Unknown", ""))
    )
    travel_prefs_pct = (
        round(travel_prefs_count / len(user_rows) * 100, 1) if user_rows else 0
    )
    completed_profile_count = sum(
        1 for row in user_rows if row.get("profile_completion", 0) >= 80
    )
    aggregate_profile = {
        "avg_completion_pct": avg_profile,
        "travel_prefs_pct": travel_prefs_pct,
        "travel_prefs_users": travel_prefs_count,
        "completed_profiles_count": completed_profile_count,
    }

    power_users = sorted(
        user_rows, key=lambda r: r["engagement_score"], reverse=True
    )[:10]

    recent_days = _build_recent_day_keys(7)
    new_users_daily: Counter[str] = Counter()
    active_users_daily: dict[str, set[str]] = defaultdict(set)
    sessions_daily: Counter[str] = Counter()
    searches_daily: Counter[str] = Counter()
    redirects_daily: Counter[str] = Counter()
    options_daily: Counter[str] = Counter()
    trips_daily: Counter[str] = Counter()

    for user in users:
        if user.created_at:
            new_users_daily[_start_of_day(user.created_at).date().isoformat()] += 1
        if user.last_sign_in_at:
            active_users_daily[_start_of_day(user.last_sign_in_at).date().isoformat()].add(str(user.id))

    for session in chat_sessions:
        if session.created_at:
            sessions_daily[_start_of_day(session.created_at).date().isoformat()] += 1
        if session.updated_at and session.user_id:
            active_users_daily[_start_of_day(session.updated_at).date().isoformat()].add(str(session.user_id))

    for message in chat_messages:
        if not message.created_at:
            continue
        day_key = _start_of_day(message.created_at).date().isoformat()
        if _is_search_message(message):
            searches_daily[day_key] += 1
            if message.msg_type == "flights":
                options_daily[day_key] += 1
        if _is_redirect_message(message):
            redirects_daily[day_key] += 1

    for trip in trips:
        if trip.created_at:
            trips_daily[_start_of_day(trip.created_at).date().isoformat()] += 1

    growth_7d = []
    for day in recent_days:
        key = day.date().isoformat()
        growth_7d.append(
            {
                "date": key,
                "new_users": new_users_daily.get(key, 0),
                "active_users": len(active_users_daily.get(key, set())),
                "sessions": sessions_daily.get(key, 0),
                "searches": searches_daily.get(key, 0),
            }
        )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "totals": {
            "total_users": len(users),
            "active_users_last_30d": len(active_user_ids_30d),
            "inactive_users_last_30d": max(len(users) - len(active_user_ids_30d), 0),
            "new_users_last_7d": sum(
                1 for user in users if user.created_at and user.created_at >= datetime.utcnow() - timedelta(days=7)
            ),
            "new_users_last_30d": sum(
                1 for user in users if user.created_at and user.created_at >= one_month_ago
            ),
            "users_with_feedback": len([user_id for user_id, count in feedback_counts.items() if count > 0]),
            "users_with_trips": len([user_id for user_id, count in trip_counts.items() if count > 0]),
            "users_with_alerts": len([user_id for user_id, count in alert_counts.items() if count > 0]),
            "authenticated_sessions": authenticated_session_count,
            "guest_sessions": guest_session_count,
            "avg_searches_per_user": round(total_searches / len(users), 2) if users else 0,
            "avg_messages_per_session": round(len(chat_messages) / len(chat_sessions), 2) if chat_sessions else 0,
            "avg_sessions_per_user": round(sum(user_session_count.values()) / len(users), 2) if users else 0,
            "avg_messages_per_user": avg_messages_per_user,
            "messages_last_24h": messages_last_24h,
            "total_searches": total_searches,
            "total_options": total_options,
            "redirect_messages": redirect_message_count,
            "distinct_search_routes": len(search_route_counter),
        },
        "growth_7d": growth_7d,
        "distributions": {
            "countries": [{"label": label, "count": count} for label, count in country_counter.most_common(8)],
            "genders": [{"label": label, "count": count} for label, count in gender_counter.most_common(6)],
            "roles": [{"label": label, "count": count} for label, count in role_counter.most_common(6)],
            "statuses": [{"label": label, "count": count} for label, count in status_counter.most_common(6)],
            "cabin_classes": [{"label": label, "count": count} for label, count in cabin_counter.most_common(6)],
            "seat_preferences": [{"label": label, "count": count} for label, count in seat_counter.most_common(6)],
            "flight_timings": [{"label": label, "count": count} for label, count in timing_counter.most_common(6)],
        },
        "top_prompts": [{"label": label, "count": count} for label, count in prompt_counter.most_common(6)],
        "top_routes": [{"label": label, "count": count} for label, count in route_counter.most_common(6)],
        "top_search_routes": [
            {"label": label, "count": count} for label, count in search_route_counter.most_common(12)
        ],
        "funnel_trend_7d": [
            {
                "date": day.date().isoformat(),
                "conversations": sessions_daily.get(day.date().isoformat(), 0),
                "searches": searches_daily.get(day.date().isoformat(), 0),
                "options": options_daily.get(day.date().isoformat(), 0),
                "redirects": redirects_daily.get(day.date().isoformat(), 0),
                "trips": trips_daily.get(day.date().isoformat(), 0),
            }
            for day in recent_days
        ],
        "users": user_rows[:25],
        "session_metrics": session_metrics,
        "age_distribution": age_distribution,
        "aggregate_profile": aggregate_profile,
        "power_users": power_users,
    }


def _validate_admin_identity(
    username: Optional[str],
    full_name: Optional[str],
    email: Optional[str],
) -> tuple[str, str, Optional[str]]:
    normalized_username = _normalize_admin_username(username)
    normalized_full_name = re.sub(r"\s+", " ", (full_name or "").strip())
    normalized_email = _normalize_admin_email(email)

    if not normalized_username:
        raise HTTPException(status_code=400, detail="Username is required.")
    if not normalized_full_name:
        raise HTTPException(status_code=400, detail="Full name is required.")

    return normalized_username, normalized_full_name, normalized_email


def _ensure_admin_identity_is_unique(
    db: Session,
    username: str,
    email: Optional[str],
    exclude_admin_id: Optional[str] = None,
) -> None:
    username_query = db.query(AdminUser).filter(func.lower(AdminUser.username) == username)
    if exclude_admin_id:
        username_query = username_query.filter(AdminUser.id != exclude_admin_id)
    if username_query.first():
        raise HTTPException(status_code=400, detail="Username is already in use.")

    if email:
        email_query = db.query(AdminUser).filter(func.lower(AdminUser.email) == email)
        if exclude_admin_id:
            email_query = email_query.filter(AdminUser.id != exclude_admin_id)
        if email_query.first():
            raise HTTPException(status_code=400, detail="Email is already in use.")


@router.get("/admin/auth/setup-status")
async def admin_auth_setup_status(
    db: Session = Depends(get_user_db),
):
    _ensure_default_admin_user(db)
    return {"needsSetup": False}


@router.post("/admin/auth/sign-in")
async def admin_auth_sign_in(
    payload: AdminSignInPayload,
    db: Session = Depends(get_user_db),
):
    _ensure_default_admin_user(db)
    username = _normalize_admin_username(payload.username)
    password = (payload.password or "").strip()

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required.")

    admin = (
        db.query(AdminUser)
        .filter(func.lower(AdminUser.username) == username, AdminUser.is_active.is_(True))
        .first()
    )
    if not admin or not verify_password(password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    admin.last_login_at = datetime.utcnow()
    response = _build_admin_session_response(admin)
    db.add(admin)
    db.commit()
    db.refresh(admin)
    response["admin"] = _serialize_admin_user(admin)
    return response


@router.get("/admin/auth/me")
async def admin_auth_me(
    admin: AdminUser = Depends(get_current_admin_user),
):
    return {"admin": _serialize_admin_user(admin)}


@router.post("/admin/auth/sign-out")
async def admin_auth_sign_out(
    db: Session = Depends(get_user_db),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_admin_token: Optional[str] = Header(default=None),
):
    _ensure_default_admin_user(db)
    token = _extract_admin_token(authorization, x_admin_token)
    if not token:
        return {"ok": True}

    admin = _find_admin_by_session_token(db, token)
    if admin:
        admin.session_token_hash = None
        admin.session_expires_at = None
        admin.updated_at = datetime.utcnow()
        db.add(admin)
        db.commit()

    return {"ok": True}


@router.patch("/admin/account")
async def admin_update_account(
    payload: AdminAccountUpdatePayload,
    admin: AdminUser = Depends(get_current_admin_user),
    db: Session = Depends(get_user_db),
):
    next_username = payload.username if payload.username is not None else admin.username
    next_full_name = payload.full_name if payload.full_name is not None else admin.full_name
    next_email = payload.email if payload.email is not None else admin.email
    username, full_name, email = _validate_admin_identity(
        next_username,
        next_full_name,
        next_email,
    )
    _ensure_admin_identity_is_unique(db, username, email, exclude_admin_id=str(admin.id))

    new_password = (payload.new_password or "").strip()
    if new_password:
        current_password = (payload.current_password or "").strip()
        if not current_password:
            raise HTTPException(
                status_code=400,
                detail="Current password is required to set a new password.",
            )
        if not verify_password(current_password, admin.password_hash):
            raise HTTPException(status_code=401, detail="Current password is incorrect.")
        admin.password_hash = hash_password(new_password)

    admin.username = username
    admin.full_name = full_name
    admin.email = email
    admin.updated_at = datetime.utcnow()
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return {"admin": _serialize_admin_user(admin)}


@router.get("/admin/admin-users")
async def admin_list_admin_users(
    _: AdminUser = Depends(get_current_admin_user),
    db: Session = Depends(get_user_db),
):
    _ensure_default_admin_user(db)
    admins = db.query(AdminUser).order_by(AdminUser.created_at.asc()).all()
    return {"admins": [_serialize_admin_user(admin) for admin in admins]}


@router.post("/admin/admin-users")
async def admin_create_admin_user(
    payload: AdminCreateUserPayload,
    _: AdminUser = Depends(get_current_admin_user),
    db: Session = Depends(get_user_db),
):
    _ensure_default_admin_user(db)
    username, full_name, email = _validate_admin_identity(
        payload.username,
        payload.full_name,
        payload.email,
    )
    password = (payload.password or "").strip()
    if not password:
        raise HTTPException(status_code=400, detail="Password is required.")

    _ensure_admin_identity_is_unique(db, username, email)

    admin = AdminUser(
        username=username,
        full_name=full_name,
        email=email,
        password_hash=hash_password(password),
        role="super_admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return {"admin": _serialize_admin_user(admin)}


@router.get("/admin/metrics/overview")
async def admin_metrics_overview(
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
    db_user: Session = Depends(get_user_db),
):
    """High-level metrics for the admin dashboard."""
    # Total searches via flight messages (chat DB)
    total_searches = (
        db_chat.query(ChatMessage)
        .filter(
            (ChatMessage.content.contains("<FLIGHT_SEARCH>"))
            | (ChatMessage.msg_type == "flights")
        )
        .count()
    )

    ten_minutes_ago = datetime.utcnow() - timedelta(minutes=10)
    active_sessions = (
        db_chat.query(ChatSession)
        .filter(ChatSession.updated_at >= ten_minutes_ago)
        .count()
    )

    feedback_counts = (
        db_user.query(Feedback.status, func.count(Feedback.id))
        .group_by(Feedback.status)
        .all()
    )
    feedback_summary = {status: count for status, count in feedback_counts}

    return {
        "total_searches": total_searches,
        "active_sessions": active_sessions,
        "feedback_counts": feedback_summary,
    }


@router.get("/admin/users/analytics")
async def admin_users_analytics(
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
    db_user: Session = Depends(get_user_db),
):
    """Expanded user analytics pulled from both the user DB and chat DB."""
    context = _build_admin_data_context(db_user, db_chat)
    return {
        "generated_at": context["generated_at"],
        "totals": context["totals"],
        "growth_7d": context["growth_7d"],
        "distributions": context["distributions"],
        "top_prompts": context["top_prompts"],
        "top_routes": context["top_routes"],
        "top_search_routes": context["top_search_routes"],
        "users": context["users"],
        "age_distribution": context["age_distribution"],
        "aggregate_profile": context["aggregate_profile"],
        "power_users": context["power_users"],
    }


@router.get("/admin/funnel")
async def admin_funnel(
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
    db_user: Session = Depends(get_user_db),
):
    """Funnel metrics derived from registered users, chats, searches, and redirects."""
    context = _build_admin_data_context(db_user, db_chat)
    totals = context["totals"]
    visitors = totals["total_users"]
    conversations = len(context["session_metrics"])
    flight_searches = totals["total_searches"]
    options_viewed = totals["total_options"]
    redirect_clicks = totals["redirect_messages"]
    trips_saved = sum(
        1 for user in context["users"] if user["trip_count"] > 0
    )

    stages = [
        {"key": "visitors", "label": "Registered users", "count": visitors},
        {"key": "conversations", "label": "Chat sessions", "count": conversations},
        {"key": "searches", "label": "Flight searches", "count": flight_searches},
        {"key": "options", "label": "Flight options surfaced", "count": options_viewed},
        {"key": "redirects", "label": "Redirect clicks", "count": redirect_clicks},
        {"key": "trips", "label": "Users with saved trips", "count": trips_saved},
    ]

    base = max(visitors, 1)
    for stage in stages:
        stage["percentage"] = round((stage["count"] / base) * 100, 2)

    drop_offs = []
    for previous, current in zip(stages, stages[1:]):
        drop_count = max(previous["count"] - current["count"], 0)
        drop_percentage = round((drop_count / max(previous["count"], 1)) * 100, 2)
        drop_offs.append(
            {
                "from_key": previous["key"],
                "to_key": current["key"],
                "from_label": previous["label"],
                "to_label": current["label"],
                "drop_count": drop_count,
                "drop_percentage": drop_percentage,
            }
        )

    return {
        "generated_at": context["generated_at"],
        "stages": stages,
        "drop_offs": drop_offs,
        "trend_7d": context["funnel_trend_7d"],
        "top_routes": context["top_routes"],
        "top_search_routes": context["top_search_routes"],
        "top_prompts": context["top_prompts"],
    }


@router.get("/admin/behavior")
async def admin_behavior(
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
    db_user: Session = Depends(get_user_db),
):
    """Session and interaction behavior metrics for the admin dashboard."""
    context = _build_admin_data_context(db_user, db_chat)
    session_metrics = context["session_metrics"]
    search_counts = [metric["search_count"] for metric in session_metrics]
    message_counts = [metric["message_count"] for metric in session_metrics]
    duration_minutes = [round(metric["duration_seconds"] / 60) for metric in session_metrics]

    now = datetime.utcnow()
    active_sessions = sum(
        1
        for metric in session_metrics
        if metric["updated_at"] and metric["updated_at"] >= now - timedelta(minutes=10)
    )

    hourly_sessions: Counter[str] = Counter()
    hourly_messages: Counter[str] = Counter()
    hourly_searches: Counter[str] = Counter()

    for metric in session_metrics:
        created_at = metric["created_at"]
        if created_at:
            label = created_at.strftime("%H:00")
            hourly_sessions[label] += 1
            hourly_searches[label] += metric["search_count"]
            hourly_messages[label] += metric["message_count"]

    ordered_hours = sorted(hourly_sessions.keys())
    recent_activity = []
    for metric in sorted(
        session_metrics,
        key=lambda item: item["updated_at"] or item["created_at"] or datetime.min,
        reverse=True,
    )[:10]:
        recent_activity.append(
            {
                "session_id": metric["id"],
                "user_id": metric["user_id"],
                "updated_at": _iso_datetime(metric["updated_at"]),
                "message_count": metric["message_count"],
                "search_count": metric["search_count"],
                "last_message_preview": metric["last_message_preview"],
                "status": (
                    "Active"
                    if metric["updated_at"] and metric["updated_at"] >= now - timedelta(minutes=10)
                    else "Idle"
                ),
            }
        )

    return {
        "generated_at": context["generated_at"],
        "totals": {
            "session_count": len(session_metrics),
            "active_sessions": active_sessions,
            "authenticated_sessions": context["totals"]["authenticated_sessions"],
            "guest_sessions": context["totals"]["guest_sessions"],
            "avg_searches_per_session": round(sum(search_counts) / len(session_metrics), 2) if session_metrics else 0,
            "avg_messages_per_session": round(sum(message_counts) / len(session_metrics), 2) if session_metrics else 0,
            "avg_session_duration_seconds": round(
                sum(metric["duration_seconds"] for metric in session_metrics) / len(session_metrics)
            ) if session_metrics else 0,
            "messages_last_24h": context["totals"]["messages_last_24h"],
        },
        "search_distribution": _build_bucket_counts(
            search_counts,
            [
                ("0 searches", 0, 0),
                ("1 search", 1, 1),
                ("2-3 searches", 2, 3),
                ("4-5 searches", 4, 5),
                ("6+ searches", 6, None),
            ],
        ),
        "message_distribution": _build_bucket_counts(
            message_counts,
            [
                ("1-3 messages", 1, 3),
                ("4-6 messages", 4, 6),
                ("7-10 messages", 7, 10),
                ("11-20 messages", 11, 20),
                ("21+ messages", 21, None),
            ],
        ),
        "session_duration_distribution": _build_bucket_counts(
            duration_minutes,
            [
                ("0-1 min", 0, 1),
                ("2-3 min", 2, 3),
                ("4-5 min", 4, 5),
                ("6-10 min", 6, 10),
                ("11+ min", 11, None),
            ],
        ),
        "hourly_activity": [
            {
                "label": hour,
                "sessions": hourly_sessions[hour],
                "messages": hourly_messages[hour],
                "searches": hourly_searches[hour],
            }
            for hour in ordered_hours
        ],
        "top_prompts": context["top_prompts"],
        "top_routes": context["top_routes"],
        "top_search_routes": context["top_search_routes"],
        "recent_activity": recent_activity,
    }


# ── Shared heuristics used by the new admin endpoints ──────────────

# Intent classification buckets for AI Performance → Question Intent Analysis.
# Ordered: earlier buckets win when a prompt matches several.
_AI_INTENT_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("Cheap Flights", ("cheap", "cheapest", "lowest", "under", "budget", "affordable")),
    ("Direct Flights", ("direct", "nonstop", "non-stop", "no stop", "no layover")),
    ("Business / Premium", ("business class", "first class", "premium economy", "premium")),
    ("Baggage / Meals", ("baggage", "bag", "luggage", "carry on", "carry-on", "meal", "food")),
    ("Weekend / Short Trip", ("weekend", "short trip", "3 day", "2 day", "getaway")),
    ("Best Time to Travel", ("best time", "when to", "cheapest time", "season")),
    ("Loyalty / Miles", ("miles", "loyalty", "frequent flyer", "reward", "status")),
    ("Visa / Documents", ("visa", "passport", "document", "entry requirement")),
    ("Hotel / Stay", ("hotel", "stay", "accommodation", "airbnb")),
    ("Weather", ("weather", "forecast", "climate")),
]

_AI_INTENT_COLORS = {
    "Cheap Flights": "#3b82f6",
    "Direct Flights": "#8b5cf6",
    "Business / Premium": "#f59e0b",
    "Baggage / Meals": "#06b6d4",
    "Weekend / Short Trip": "#ef4444",
    "Best Time to Travel": "#10b981",
    "Loyalty / Miles": "#ec4899",
    "Visa / Documents": "#6366f1",
    "Hotel / Stay": "#14b8a6",
    "Weather": "#f97316",
    "General": "#6b7280",
}


def _classify_ai_intent(text: str) -> str:
    lowered = (text or "").lower()
    if not lowered:
        return "General"
    for label, keywords in _AI_INTENT_PATTERNS:
        for keyword in keywords:
            if keyword in lowered:
                return label
    return "General"


# Feedback category inference (aligned with admin dashboard frontend rules).
def _classify_feedback_category(text: str) -> str:
    lowered = (text or "").lower()
    if re.search(r"(ai|assistant|chatbot|response)", lowered):
        return "AI Response"
    if re.search(r"(redirect|link|open.*website|booking website)", lowered):
        return "Redirect Issue"
    if re.search(r"(price|fare|flight time|airline|ticket|search result)", lowered):
        return "Flight Data Issue"
    if re.search(r"(mobile|layout|button|screen|\bui\b|\bux\b|design)", lowered):
        return "UI / UX"
    if re.search(r"(feature|would like|wish|please add|\badd\b)", lowered):
        return "Feature Request"
    if re.search(r"(crash|bug|error|broken|fail|cannot|can't|won't)", lowered):
        return "Bug / Error"
    if re.search(r"(search|filter|date|calendar)", lowered):
        return "Search Experience"
    return "General"


def _classify_feedback_priority(text: str, status: str) -> str:
    lowered = (text or "").lower()
    if re.search(r"(crash|payment|broken|cannot book|can't book|security|incorrect price)", lowered):
        return "Critical"
    if status == "in_review":
        return "High"
    if re.search(r"(wrong|incorrect|error|fail|issue|not work|can't|cannot|missing)", lowered):
        return "High"
    if re.search(r"(feature|request|suggest|improve|better)", lowered):
        return "Low"
    return "Medium"


# Very cheap sentiment heuristic — keeps NLP-free runtime and matches the
# frontend category rules so server and client never disagree.
_FB_POSITIVE = (
    "love", "amazing", "great", "awesome", "fantastic", "excellent",
    "perfect", "thank", "thanks", "helpful", "good", "nice", "works",
    "fast", "smooth",
)
_FB_NEGATIVE = (
    "not work", "doesn't", "dont work", "don't work", "cannot", "can't",
    "wrong", "incorrect", "broken", "crash", "bug", "error", "fail",
    "bad", "terrible", "worst", "hate", "slow", "confusing",
)


def _classify_feedback_sentiment(text: str) -> str:
    lowered = (text or "").lower()
    if not lowered:
        return "Neutral"
    pos = sum(1 for kw in _FB_POSITIVE if kw in lowered)
    neg = sum(1 for kw in _FB_NEGATIVE if kw in lowered)
    if neg > pos:
        return "Negative"
    if pos > neg:
        return "Positive"
    return "Neutral"


# Which platform area feedback most likely refers to (used for the heatmap).
_FB_SECTION_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("AI Chat", ("ai", "assistant", "chatbot", "chat ", "response", "answer")),
    ("Flight Results", ("flight", "price", "fare", "airline", "ticket", "result")),
    ("Search Filters", ("filter", "sort", "search", "date", "calendar")),
    ("Redirect Page", ("redirect", "booking", "open link", "open website")),
    ("User Profile", ("profile", "account", "name", "address", "phone")),
    ("Settings", ("setting", "preference", "notification", "theme")),
    ("Mobile UX", ("mobile", "phone", "ios", "android", "app ")),
]


def _classify_feedback_section(text: str) -> str:
    lowered = (text or "").lower()
    for label, keywords in _FB_SECTION_PATTERNS:
        for keyword in keywords:
            if keyword in lowered:
                return label
    return "Other"


@router.get("/admin/ai/performance")
async def admin_ai_performance(
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
    db_user: Session = Depends(get_user_db),
):
    """AI conversation KPIs, intent mix, quality heuristic, hourly load and model config.

    Everything here is derived from data already stored in the chat DB or backend env.
    Response-latency metrics are intentionally returned as null-valued series because we
    do not currently persist per-message generation time — a `latency_ms` column on
    `chat_messages` would light them up without further changes to this handler.
    """
    context = _build_admin_data_context(db_user, db_chat)
    session_metrics = context["session_metrics"]
    total_sessions = len(session_metrics)
    total_messages = sum(metric["message_count"] for metric in session_metrics)
    avg_messages = (
        round(total_messages / total_sessions, 2) if total_sessions else 0
    )
    # "Engaged" ≈ sessions with 3+ messages; low-engagement = likely drop-off.
    engaged_sessions = sum(1 for m in session_metrics if m["message_count"] >= 3)
    drop_off_sessions = total_sessions - engaged_sessions
    drop_off_rate = (
        round((drop_off_sessions / total_sessions) * 100, 2) if total_sessions else 0
    )

    # Quality mix (heuristic):
    # - successful: session contains a redirect message (user was handed off to booking)
    # - out_of_context: session has 0 search + 0 redirect messages (user engaged but AI did not help with flights)
    # - failed: zero messages of type assistant despite user messages (stuck/error)
    # - partial: remaining active conversations
    successful = 0
    partial = 0
    failed = 0
    out_of_context = 0

    # Pre-count per-session searches and redirects by scanning messages once.
    session_message_counts = {m["id"]: m["message_count"] for m in session_metrics}
    session_search_count_map = {m["id"]: m["search_count"] for m in session_metrics}
    session_redirect_map: dict[str, int] = defaultdict(int)
    session_has_assistant: dict[str, bool] = defaultdict(bool)
    session_has_user: dict[str, bool] = defaultdict(bool)

    for message in (
        db_chat.query(ChatMessage).order_by(ChatMessage.created_at.asc()).all()
    ):
        key = str(message.session_id)
        if _is_redirect_message(message):
            session_redirect_map[key] += 1
        if message.role == "assistant":
            session_has_assistant[key] = True
        if message.role == "user":
            session_has_user[key] = True

    for metric in session_metrics:
        key = metric["id"]
        redirect_count = session_redirect_map.get(key, 0)
        search_count = session_search_count_map.get(key, 0)
        if redirect_count > 0:
            successful += 1
        elif session_has_user.get(key) and not session_has_assistant.get(key):
            failed += 1
        elif search_count == 0 and redirect_count == 0 and session_message_counts.get(key, 0) >= 2:
            out_of_context += 1
        else:
            partial += 1

    total_for_quality = max(total_sessions, 1)
    quality = {
        "successful": {
            "count": successful,
            "percentage": round((successful / total_for_quality) * 100, 2),
        },
        "partial": {
            "count": partial,
            "percentage": round((partial / total_for_quality) * 100, 2),
        },
        "failed": {
            "count": failed,
            "percentage": round((failed / total_for_quality) * 100, 2),
        },
        "out_of_context": {
            "count": out_of_context,
            "percentage": round((out_of_context / total_for_quality) * 100, 2),
        },
    }

    # Intent mix from the prompt counter built in the shared context.
    intent_counter: Counter[str] = Counter()
    for prompt in context["top_prompts"]:
        label = _classify_ai_intent(prompt["label"])
        intent_counter[label] += prompt["count"]
    # Include long-tail prompts if any, to avoid undercounting rare intents.
    if not intent_counter:
        intent_counter["General"] = total_sessions

    total_intent = sum(intent_counter.values()) or 1
    question_intents = [
        {
            "intent": label,
            "count": count,
            "percentage": round((count / total_intent) * 100, 2),
            "color": _AI_INTENT_COLORS.get(label, "#6b7280"),
        }
        for label, count in intent_counter.most_common(8)
    ]

    # Hourly AI load = sessions / messages / searches grouped by hour-of-day over
    # the whole chat DB (bounded by session_metrics already capped upstream).
    hourly_requests: Counter[str] = Counter()
    hourly_concurrent: Counter[str] = Counter()
    hourly_searches: Counter[str] = Counter()

    for metric in session_metrics:
        created_at = metric["created_at"]
        if not created_at:
            continue
        label = created_at.strftime("%H:00")
        hourly_requests[label] += metric["message_count"]
        hourly_concurrent[label] += 1
        hourly_searches[label] += metric["search_count"]

    ordered_hours = sorted(hourly_requests.keys())
    ai_load = [
        {
            "time": hour,
            "requests": hourly_requests[hour],
            "concurrent": hourly_concurrent[hour],
            "searches": hourly_searches[hour],
        }
        for hour in ordered_hours
    ]

    # Model config — read-only view of what the backend is configured with.
    model_config = {
        "provider": os.getenv("AI_PROVIDER", "OpenAI"),
        "model": os.getenv(
            "AI_MODEL",
            os.getenv("OPENAI_MODEL", os.getenv("GEMINI_MODEL", "gpt-4o")),
        ),
        "temperature": float(os.getenv("AI_TEMPERATURE", "0.7") or 0.7),
        "max_tokens": int(os.getenv("AI_MAX_TOKENS", "2048") or 2048),
        "prompt_version": os.getenv("AI_PROMPT_VERSION", "v1"),
        "response_style": os.getenv("AI_RESPONSE_STYLE", "Conversational"),
    }

    # Funnel from AI → redirect, reused by the page's conversion-funnel card.
    totals = context["totals"]
    conversion_funnel = [
        {
            "stage": "AI Conversations Started",
            "value": total_sessions,
            "percentage": 100.0,
        },
        {
            "stage": "Engaged Users (3+ messages)",
            "value": engaged_sessions,
            "percentage": round((engaged_sessions / total_for_quality) * 100, 2),
        },
        {
            "stage": "Flight Options Presented",
            "value": totals["total_options"],
            "percentage": round((totals["total_options"] / total_for_quality) * 100, 2),
        },
        {
            "stage": "Flight Searches",
            "value": totals["total_searches"],
            "percentage": round((totals["total_searches"] / total_for_quality) * 100, 2),
        },
        {
            "stage": "Redirects Triggered",
            "value": totals["redirect_messages"],
            "percentage": round((totals["redirect_messages"] / total_for_quality) * 100, 2),
        },
    ]

    # Flagged responses from feedback that mentions AI issues, grouped by severity.
    ai_feedback = (
        db_user.query(Feedback)
        .filter(Feedback.message.isnot(None))
        .order_by(Feedback.created_at.desc())
        .limit(300)
        .all()
    )
    flag_counter: dict[str, dict[str, Any]] = {}
    for feedback in ai_feedback:
        if "ai" not in (feedback.message or "").lower():
            continue
        severity = _classify_feedback_priority(feedback.message or "", feedback.status or "new")
        category = _classify_feedback_category(feedback.message or "")
        key = category
        entry = flag_counter.setdefault(
            key,
            {
                "category": category,
                "count": 0,
                "severity": severity,
                "example": (feedback.message or "")[:140],
                "status": feedback.status or "new",
            },
        )
        entry["count"] += 1
        # Use the first high/critical example we encounter.
        if severity in ("Critical", "High") and entry["severity"] not in ("Critical",):
            entry["severity"] = severity
            entry["example"] = (feedback.message or "")[:140]

    flagged_responses = sorted(
        flag_counter.values(), key=lambda item: item["count"], reverse=True
    )[:6]

    return {
        "generated_at": context["generated_at"],
        "model_config": model_config,
        "kpis": {
            "total_conversations": total_sessions,
            "avg_messages": avg_messages,
            "engaged_sessions": engaged_sessions,
            "drop_off_rate": drop_off_rate,
            "messages_last_24h": totals["messages_last_24h"],
            "authenticated_sessions": totals["authenticated_sessions"],
            "guest_sessions": totals["guest_sessions"],
            # Response-time KPIs are not tracked yet — returning null is a contract
            # the frontend can display as an empty state rather than faking numbers.
            "avg_response_time_ms": None,
            "p95_response_time_ms": None,
            "success_rate": quality["successful"]["percentage"],
        },
        "question_intents": question_intents,
        "quality": quality,
        "hourly_load": ai_load,
        "conversion_funnel": conversion_funnel,
        "flagged_responses": flagged_responses,
        "top_prompts": context["top_prompts"],
    }


@router.get("/admin/feedback/summary")
async def admin_feedback_summary(
    _: None = Depends(require_admin),
    db_user: Session = Depends(get_user_db),
):
    """Aggregated feedback metrics used by the dashboard, analytics, sentiment and heatmap pages.

    Sentiment and platform-section classification are keyword heuristics intended to match
    the (same) rules used in the admin frontend so the two never drift.
    """
    feedback_items = (
        db_user.query(Feedback).order_by(Feedback.created_at.desc()).limit(500).all()
    )

    category_counter: Counter[str] = Counter()
    priority_counter: Counter[str] = Counter()
    status_counter: Counter[str] = Counter()
    sentiment_counter: Counter[str] = Counter()
    section_counter: Counter[str] = Counter()
    section_sentiment: dict[str, Counter[str]] = defaultdict(Counter)
    section_trend: dict[str, Counter[str]] = defaultdict(Counter)

    # 7-day trend + response-time accumulator.
    trend_days = _build_recent_day_keys(7)
    trend_counts: Counter[str] = Counter()

    response_deltas_seconds: list[int] = []

    positive_examples: list[str] = []
    neutral_examples: list[str] = []
    negative_examples: list[str] = []

    recent_rows = []
    ai_related = 0
    new_today = 0
    today_start = _start_of_day(datetime.utcnow())

    for feedback in feedback_items:
        message = feedback.message or ""
        status = feedback.status or "new"
        category = _classify_feedback_category(message)
        priority = _classify_feedback_priority(message, status)
        sentiment = _classify_feedback_sentiment(message)
        section = _classify_feedback_section(message)

        category_counter[category] += 1
        priority_counter[priority] += 1
        status_counter[status] += 1
        sentiment_counter[sentiment] += 1
        section_counter[section] += 1
        section_sentiment[section][sentiment] += 1

        if category == "AI Response":
            ai_related += 1

        if feedback.created_at:
            day_key = _start_of_day(feedback.created_at).date().isoformat()
            trend_counts[day_key] += 1
            section_trend[section][day_key] += 1
            if feedback.created_at >= today_start:
                new_today += 1

        if (
            status in ("resolved", "dismissed")
            and feedback.created_at
            and feedback.updated_at
            and feedback.updated_at >= feedback.created_at
        ):
            response_deltas_seconds.append(
                int((feedback.updated_at - feedback.created_at).total_seconds())
            )

        if sentiment == "Positive" and len(positive_examples) < 3:
            positive_examples.append(message[:160])
        elif sentiment == "Neutral" and len(neutral_examples) < 3:
            neutral_examples.append(message[:160])
        elif sentiment == "Negative" and len(negative_examples) < 3:
            negative_examples.append(message[:160])

        if len(recent_rows) < 20:
            recent_rows.append(
                {
                    "id": str(feedback.id),
                    "email": feedback.email,
                    "name": feedback.name,
                    "message_preview": message[:160],
                    "category": category,
                    "priority": priority,
                    "status": status,
                    "sentiment": sentiment,
                    "section": section,
                    "created_at": feedback.created_at.isoformat()
                    if feedback.created_at
                    else None,
                }
            )

    total = len(feedback_items)
    avg_response_seconds = (
        round(sum(response_deltas_seconds) / len(response_deltas_seconds))
        if response_deltas_seconds
        else None
    )

    trend = [
        {
            "date": day.date().isoformat(),
            "count": trend_counts.get(day.date().isoformat(), 0),
        }
        for day in trend_days
    ]

    # Heatmap rows = a section breakdown with week-over-week trend.
    seven_days_ago = today_start - timedelta(days=7)
    fourteen_days_ago = today_start - timedelta(days=14)
    heatmap_rows = []
    for section, count in section_counter.most_common():
        this_week = 0
        prev_week = 0
        for day_key, day_count in section_trend[section].items():
            try:
                day_date = datetime.fromisoformat(day_key)
            except ValueError:
                continue
            if day_date >= seven_days_ago:
                this_week += day_count
            elif day_date >= fourteen_days_ago:
                prev_week += day_count
        base = prev_week or 1
        trend_pct = round(((this_week - prev_week) / base) * 100, 2) if prev_week else (
            100.0 if this_week else 0.0
        )
        sent_counts = section_sentiment.get(section, Counter())
        heatmap_rows.append(
            {
                "section": section,
                "count": count,
                "percentage": round((count / total) * 100, 2) if total else 0,
                "trend": trend_pct,
                "positive": sent_counts.get("Positive", 0),
                "neutral": sent_counts.get("Neutral", 0),
                "negative": sent_counts.get("Negative", 0),
            }
        )

    hottest = heatmap_rows[0]["section"] if heatmap_rows else None
    trending_up = max(
        heatmap_rows, key=lambda row: row["trend"], default=None
    )
    improving = min(
        heatmap_rows, key=lambda row: row["trend"], default=None
    )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "totals": {
            "total": total,
            "new_today": new_today,
            "open": status_counter.get("new", 0),
            "in_review": status_counter.get("in_review", 0),
            "resolved": status_counter.get("resolved", 0),
            "dismissed": status_counter.get("dismissed", 0),
            "ai_related": ai_related,
            "avg_response_seconds": avg_response_seconds,
        },
        "categories": [
            {"label": label, "count": count}
            for label, count in category_counter.most_common()
        ],
        "priorities": [
            {"label": label, "count": count}
            for label, count in priority_counter.most_common()
        ],
        "statuses": [
            {"label": label, "count": count}
            for label, count in status_counter.most_common()
        ],
        "sentiments": [
            {"label": label, "count": count}
            for label, count in sentiment_counter.most_common()
        ],
        "sections": [
            {"label": label, "count": count}
            for label, count in section_counter.most_common()
        ],
        "trend": trend,
        "heatmap": heatmap_rows,
        "hottest_section": hottest,
        "trending_up_section": trending_up,
        "improving_section": improving,
        "recent": recent_rows,
        "examples": {
            "positive": positive_examples,
            "neutral": neutral_examples,
            "negative": negative_examples,
        },
    }


@router.get("/admin/retention")
async def admin_retention(
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
    db_user: Session = Depends(get_user_db),
):
    """Retention cohorts (Day 1/7/30) and authenticated-vs-guest session split.

    Retention is computed from `created_at` and whichever of (`last_sign_in_at`,
    latest chat session `updated_at`) is most recent per user, because we do not
    store per-event visit logs. This approximates 'user still active on day N' and
    matches what the Figma Retention card communicates.
    """
    users = (
        db_user.query(User)
        .filter(User.deleted_at.is_(None))
        .all()
    )
    sessions = db_chat.query(ChatSession).all()

    # Most recent activity per user id.
    latest_activity: dict[str, datetime] = {}
    for user in users:
        candidates = [user.last_sign_in_at, user.updated_at]
        latest = max([c for c in candidates if c], default=None)
        if latest:
            latest_activity[str(user.id)] = latest

    for session in sessions:
        if not session.user_id or not session.updated_at:
            continue
        key = str(session.user_id)
        prior = latest_activity.get(key)
        if prior is None or session.updated_at > prior:
            latest_activity[key] = session.updated_at

    cohort_d1 = cohort_d7 = cohort_d30 = 0
    retained_d1 = retained_d7 = retained_d30 = 0
    now = datetime.utcnow()

    for user in users:
        if not user.created_at:
            continue
        age_days = (now - user.created_at).days
        last_active = latest_activity.get(str(user.id))

        def still_active_after(days: int) -> bool:
            if not last_active:
                return False
            return (last_active - user.created_at).days >= days

        if age_days >= 1:
            cohort_d1 += 1
            if still_active_after(1):
                retained_d1 += 1
        if age_days >= 7:
            cohort_d7 += 1
            if still_active_after(7):
                retained_d7 += 1
        if age_days >= 30:
            cohort_d30 += 1
            if still_active_after(30):
                retained_d30 += 1

    def _pct(numerator: int, denom: int) -> float:
        return round((numerator / denom) * 100, 2) if denom else 0.0

    # Returning users = has activity > 1 day after creation / total users with cohort history.
    returning_users = sum(
        1
        for user in users
        if user.created_at
        and (la := latest_activity.get(str(user.id)))
        and (la - user.created_at).days >= 1
    )
    total_eligible = sum(1 for user in users if user.created_at and (now - user.created_at).days >= 1)

    auth_sessions = sum(1 for s in sessions if s.user_id)
    guest_sessions = sum(1 for s in sessions if not s.user_id)

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "cohorts": {
            "day_1": {"cohort": cohort_d1, "retained": retained_d1, "rate": _pct(retained_d1, cohort_d1)},
            "day_7": {"cohort": cohort_d7, "retained": retained_d7, "rate": _pct(retained_d7, cohort_d7)},
            "day_30": {"cohort": cohort_d30, "retained": retained_d30, "rate": _pct(retained_d30, cohort_d30)},
        },
        "returning_users": {
            "count": returning_users,
            "percentage": _pct(returning_users, total_eligible),
        },
        "session_split": {
            "authenticated": auth_sessions,
            "guest": guest_sessions,
            "total": auth_sessions + guest_sessions,
        },
    }


@router.get("/admin/api-monitoring")
async def admin_api_monitoring(
    _: None = Depends(require_admin),
    window: str = Query("24h"),
    provider: Optional[str] = Query(None),
    endpoint: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db_user: Session = Depends(get_user_db),
):
    """Per-request API monitoring feed from persisted request logs."""
    db_user.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS api_request_logs (
              id UUID PRIMARY KEY,
              request_id VARCHAR(64),
              method VARCHAR(16) NOT NULL,
              path VARCHAR(255) NOT NULL,
              status_code INTEGER NOT NULL,
              latency_ms INTEGER NOT NULL,
              query_params JSONB,
              provider VARCHAR(64),
              api_key_name VARCHAR(128),
              api_key_last4 VARCHAR(8),
              user_id VARCHAR(64),
              client_ip VARCHAR(64),
              user_agent TEXT,
              error_message TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    db_user.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS api_provider_config (
              provider VARCHAR(64) PRIMARY KEY,
              quota_daily INTEGER NOT NULL DEFAULT 0,
              cost_per_request NUMERIC(12, 6) NOT NULL DEFAULT 0,
              currency VARCHAR(8) NOT NULL DEFAULT 'USD',
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    db_user.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS api_key_registry (
              key_name VARCHAR(128) PRIMARY KEY,
              provider VARCHAR(64) NOT NULL,
              status VARCHAR(24) NOT NULL DEFAULT 'active',
              key_last4 VARCHAR(8),
              last_used_at TIMESTAMP NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    db_user.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at ON api_request_logs (created_at)"
        )
    )
    db_user.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_api_request_logs_path ON api_request_logs (path)"
        )
    )
    db_user.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_api_request_logs_status_code ON api_request_logs (status_code)"
        )
    )
    db_user.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_api_key_registry_provider ON api_key_registry (provider)"
        )
    )
    db_user.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_api_key_registry_last_used_at ON api_key_registry (last_used_at)"
        )
    )
    db_user.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_api_provider_config_active ON api_provider_config (is_active)"
        )
    )
    default_provider_configs = [
        ("Chat", 200000, 0.0025),
        ("Amadeus", 120000, 0.0035),
        ("SerpAPI", 80000, 0.0050),
        ("Sessions", 250000, 0.0),
        ("Trips", 100000, 0.0),
        ("Price Alerts", 100000, 0.0),
        ("OpenWeather", 50000, 0.0010),
        ("Google Maps", 70000, 0.0020),
        ("FlightAware", 20000, 0.0120),
        ("Auth", 150000, 0.0004),
        ("Health", 500000, 0.0),
        ("Internal", 500000, 0.0),
    ]
    # Canonical six external providers shown in the Admin API Monitoring UI.
    external_provider_aliases = {
        "Chat": "OpenAI",
        "OpenAI": "OpenAI",
        "Amadeus": "Amadeus",
        "SerpAPI": "SerpAPI",
        "FlightAware": "FlightAware",
        "OpenWeather": "OpenWeather",
        "Google Maps": "Google Maps",
    }
    tracked_external_providers = [
        "OpenAI",
        "Amadeus",
        "SerpAPI",
        "FlightAware",
        "OpenWeather",
        "Google Maps",
    ]
    for provider, quota_daily, cost_per_request in default_provider_configs:
        db_user.execute(
            text(
                """
                INSERT INTO api_provider_config (provider, quota_daily, cost_per_request, currency, is_active, updated_at)
                VALUES (:provider, :quota_daily, :cost_per_request, 'USD', TRUE, NOW())
                ON CONFLICT (provider) DO NOTHING
                """
            ),
            {
                "provider": provider,
                "quota_daily": quota_daily,
                "cost_per_request": cost_per_request,
            },
        )
    db_user.commit()

    now = datetime.utcnow()
    window_map = {"1h": timedelta(hours=1), "6h": timedelta(hours=6), "24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
    since = now - window_map.get(window, timedelta(hours=24))
    base_query = (
        db_user.query(ApiRequestLog)
        .filter(ApiRequestLog.created_at >= since)
        .filter(~ApiRequestLog.path.like("/api/admin/api-monitoring%"))
        .filter(~ApiRequestLog.path.like("/api/admin/api-keys%"))
    )
    if provider:
        base_query = base_query.filter(ApiRequestLog.provider == provider)
    if endpoint:
        base_query = base_query.filter(ApiRequestLog.path.ilike(f"%{endpoint}%"))
    if status == "failed":
        base_query = base_query.filter(ApiRequestLog.status_code >= 400)
    elif status == "success":
        base_query = base_query.filter(ApiRequestLog.status_code < 400)

    logs = base_query.order_by(ApiRequestLog.created_at.desc()).limit(10000).all()

    total_requests = len(logs)
    failed_requests = sum(1 for log in logs if (log.status_code or 0) >= 400)
    avg_latency_ms = round(sum((log.latency_ms or 0) for log in logs) / total_requests) if total_requests else 0
    error_rate_pct = round((failed_requests / total_requests) * 100, 2) if total_requests else 0
    uptime_pct = round(100 - error_rate_pct, 2) if total_requests else 100

    endpoint_stats: dict[str, dict[str, Any]] = {}
    provider_counter: Counter[str] = Counter()
    key_counter: Counter[str] = Counter()
    hourly_requests: Counter[str] = Counter()
    hourly_errors: Counter[str] = Counter()

    for log in logs:
        endpoint_key = f"{log.method} {log.path}"
        endpoint = endpoint_stats.setdefault(
            endpoint_key,
            {
                "name": endpoint_key,
                "provider": log.provider or "Internal",
                "endpoint": log.path,
                "requests24h": 0,
                "total_latency": 0,
                "error_count": 0,
            },
        )
        endpoint["requests24h"] += 1
        endpoint["total_latency"] += int(log.latency_ms or 0)
        if (log.status_code or 0) >= 400:
            endpoint["error_count"] += 1

        provider_counter[log.provider or "Internal"] += 1
        if log.api_key_name:
            key_counter[log.api_key_name] += 1

        label = (log.created_at or now).strftime("%H:00")
        hourly_requests[label] += 1
        if (log.status_code or 0) >= 400:
            hourly_errors[label] += 1

    all_endpoint_rows = []
    for idx, endpoint in enumerate(
        sorted(endpoint_stats.values(), key=lambda row: row["requests24h"], reverse=True)[:30]
    ):
        req = endpoint["requests24h"] or 1
        avg = round(endpoint["total_latency"] / req)
        err_pct = round((endpoint["error_count"] / req) * 100, 2)
        status = "healthy"
        if err_pct > 2 or avg > 1500:
            status = "error"
        elif err_pct > 0.5 or avg > 700:
            status = "slow"
        all_endpoint_rows.append(
            {
                "id": f"endpoint-{idx}",
                "name": endpoint["name"],
                "provider": endpoint["provider"],
                "endpoint": endpoint["endpoint"],
                "status": status,
                "requests24h": req,
                "avgResponseTimeMs": avg,
                "p95Ms": round(avg * 1.35),
                "p99Ms": round(avg * 1.8),
                "errorRatePct": err_pct,
                "uptimePct": round(100 - err_pct, 2),
            }
        )

    # Keep endpoint table focused on external provider traffic.
    endpoint_rows = [
        row
        for row in all_endpoint_rows
        if external_provider_aliases.get(row["provider"], row["provider"]) in tracked_external_providers
    ]
    # Ensure the six-provider table never renders fully blank.
    if not endpoint_rows:
        endpoint_rows = [
            {
                "id": f"endpoint-empty-{idx}",
                "name": f"GET /{provider.lower().replace(' ', '-')}",
                "provider": provider,
                "endpoint": f"/{provider.lower().replace(' ', '-')}",
                "status": "healthy",
                "requests24h": 0,
                "avgResponseTimeMs": 0,
                "p95Ms": 0,
                "p99Ms": 0,
                "errorRatePct": 0.0,
                "uptimePct": 100.0,
            }
            for idx, provider in enumerate(tracked_external_providers)
        ]

    request_volume = [
        {"label": f"{hour:02d}:00", "requests": hourly_requests.get(f"{hour:02d}:00", 0)}
        for hour in range(24)
    ] if window in ("24h", "7d", "30d") else [
        {"label": minute.strftime("%H:%M"), "requests": 0}
        for minute in [now - timedelta(minutes=i) for i in range(59, -1, -1)]
    ]
    error_rate_trend = [
        {
            "label": row["label"],
            "rate": round(
                (hourly_errors.get(row["label"], 0) / max(row["requests"], 1)) * 100,
                2,
            ),
        }
        for row in request_volume
    ]

    provider_usage = [
        {"provider": provider, "requests": count}
        for provider, count in provider_counter.most_common(8)
    ]
    provider_config_rows = db_user.execute(
        text(
            """
            SELECT provider, quota_daily, cost_per_request, currency, is_active
            FROM api_provider_config
            WHERE is_active = TRUE
            """
        )
    ).fetchall()
    provider_config_map = {row.provider: row for row in provider_config_rows}

    external_usage_window: dict[str, dict[str, Any]] = {
        provider: {
            "provider": provider,
            "requestsWindow": 0,
            "requests24h": 0,
            "successWindow": 0,
            "failedWindow": 0,
            "monthlyRequests": 0,
            "quota": int(provider_config_map.get(provider).quota_daily)
            if provider_config_map.get(provider) is not None
            else 0,
            "percentUsed": 0.0,
            "remaining": 0,
            "keyName": None,
            "status": "idle",
            "lastUsed": None,
            "keyLast4": None,
            "costPerRequest": float(provider_config_map.get(provider).cost_per_request)
            if provider_config_map.get(provider) is not None
            else 0.0,
            "monthlyCost": 0.0,
            "currency": provider_config_map.get(provider).currency
            if provider_config_map.get(provider) is not None
            else "USD",
        }
        for provider in tracked_external_providers
    }

    for log in logs:
        canonical = external_provider_aliases.get(log.provider or "", None)
        if not canonical or canonical not in external_usage_window:
            continue
        row = external_usage_window[canonical]
        row["requestsWindow"] += 1
        if (log.status_code or 0) >= 400:
            row["failedWindow"] += 1
        else:
            row["successWindow"] += 1
        if not row["lastUsed"] and log.created_at:
            row["lastUsed"] = log.created_at.isoformat()

    rate_limits = []
    for provider, usage in provider_counter.items():
        cfg = provider_config_map.get(provider)
        quota = int(cfg.quota_daily) if cfg else 0
        pct = round((usage / quota) * 100, 2) if quota > 0 else 0.0
        rate_limits.append(
            {
                "provider": provider,
                "used": usage,
                "quota": quota,
                "percentUsed": pct,
            }
        )
    rate_limits.sort(key=lambda row: row["percentUsed"], reverse=True)

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_logs = (
        db_user.query(ApiRequestLog.provider, func.count(ApiRequestLog.id))
        .filter(ApiRequestLog.created_at >= month_start)
        .filter(~ApiRequestLog.path.like("/api/admin/api-monitoring%"))
        .filter(~ApiRequestLog.path.like("/api/admin/api-keys%"))
        .group_by(ApiRequestLog.provider)
        .all()
    )
    monthly_usage = {provider or "Internal": count for provider, count in monthly_logs}
    for provider, count in monthly_usage.items():
        canonical = external_provider_aliases.get(provider, None)
        if canonical and canonical in external_usage_window:
            external_usage_window[canonical]["monthlyRequests"] = int(count)
    cost_breakdown = []
    total_monthly_cost = 0.0
    for provider, count in monthly_usage.items():
        cfg = provider_config_map.get(provider)
        cost_per_request = float(cfg.cost_per_request) if cfg else 0.0
        provider_cost = round(count * cost_per_request, 4)
        total_monthly_cost += provider_cost
        cost_breakdown.append(
            {
                "provider": provider,
                "requests": count,
                "costPerRequest": cost_per_request,
                "monthlyCost": round(provider_cost, 2),
            }
        )
    cost_breakdown.sort(key=lambda row: row["monthlyCost"], reverse=True)

    key_usage_24h = {key_name: count for key_name, count in key_counter.items()}
    key_rows = db_user.execute(
        text(
            """
            SELECT key_name, provider, status, key_last4, last_used_at
            FROM api_key_registry
            ORDER BY last_used_at DESC NULLS LAST
            LIMIT 20
            """
        )
    ).fetchall()
    api_keys = [
        {
            "provider": row.provider,
            "keyName": row.key_name,
            "status": row.status,
            "lastUsed": row.last_used_at.isoformat() if row.last_used_at else None,
            "keyLast4": row.key_last4,
            "requests24h": key_usage_24h.get(row.key_name, 0),
            "quotaDaily": int(provider_config_map.get(row.provider).quota_daily)
            if provider_config_map.get(row.provider) is not None
            else 0,
            "costPerRequest": float(provider_config_map.get(row.provider).cost_per_request)
            if provider_config_map.get(row.provider) is not None
            else 0.0,
            "currency": provider_config_map.get(row.provider).currency
            if provider_config_map.get(row.provider) is not None
            else "USD",
        }
        for row in key_rows
    ]

    usage_24h_by_provider = Counter()
    for log in logs:
        canonical = external_provider_aliases.get(log.provider or "", None)
        if canonical and canonical in external_usage_window:
            usage_24h_by_provider[canonical] += 1

    key_rows_by_provider: dict[str, Any] = {}
    for row in key_rows:
        canonical = external_provider_aliases.get(row.provider or "", None)
        if canonical and canonical not in key_rows_by_provider:
            key_rows_by_provider[canonical] = row

    for provider_name, row in external_usage_window.items():
        row["requests24h"] = int(usage_24h_by_provider.get(provider_name, 0))
        row["status"] = "active" if row["requestsWindow"] > 0 else "idle"
        row["monthlyCost"] = round(row["monthlyRequests"] * row["costPerRequest"], 2)
        row["remaining"] = max(int(row["quota"]) - int(row["requests24h"]), 0) if row["quota"] > 0 else 0
        row["percentUsed"] = round((row["requests24h"] / row["quota"]) * 100, 2) if row["quota"] > 0 else 0.0
        key_row = key_rows_by_provider.get(provider_name)
        if key_row is not None:
            row["keyName"] = key_row.key_name
            row["keyLast4"] = key_row.key_last4
            if key_row.last_used_at:
                row["lastUsed"] = key_row.last_used_at.isoformat()

    external_provider_usage = [external_usage_window[p] for p in tracked_external_providers]

    recent_errors = [
        {
            "id": str(log.id),
            "endpoint": f"{log.method} {log.path}",
            "timestamp": log.created_at.isoformat() if log.created_at else None,
            "error": log.error_message or f"HTTP {log.status_code}",
            "statusCode": log.status_code,
        }
        for log in logs
        if (log.status_code or 0) >= 400
    ][:25]

    return {
        "generated_at": now.isoformat(),
        "window": window,
        "totals": {
            "total_requests": total_requests,
            "avg_latency_ms": avg_latency_ms,
            "error_rate_pct": error_rate_pct,
            "uptime_pct": uptime_pct,
            "active_endpoints": len([row for row in endpoint_rows if row["status"] == "healthy"]),
            "total_endpoints": len(endpoint_rows),
        },
        "endpoint_rows": endpoint_rows,
        "request_volume": request_volume,
        "error_rate_trend": error_rate_trend,
        "provider_usage": provider_usage,
        "external_provider_usage": external_provider_usage,
        "success_failed": {
            "success": max(total_requests - failed_requests, 0),
            "failed": failed_requests,
        },
        "api_keys": api_keys,
        "rate_limits": rate_limits,
        "cost_monitoring": {
            "currency": "USD",
            "total_monthly_cost": round(total_monthly_cost, 2),
            "avg_cost_per_request": round(total_monthly_cost / max(sum(monthly_usage.values()), 1), 6),
            "monthly_breakdown": cost_breakdown,
        },
        "recent_errors": recent_errors,
    }


@router.get("/admin/api-keys")
async def admin_api_keys(
    _: None = Depends(require_admin),
    db_user: Session = Depends(get_user_db),
):
    rows = db_user.execute(
        text(
            """
            SELECT
              k.key_name,
              k.provider,
              k.status,
              k.key_last4,
              k.last_used_at,
              p.quota_daily,
              p.cost_per_request,
              p.currency
            FROM api_key_registry k
            LEFT JOIN api_provider_config p ON p.provider = k.provider
            ORDER BY k.last_used_at DESC NULLS LAST, k.key_name ASC
            """
        )
    ).fetchall()
    return {
        "items": [
            {
                "keyName": row.key_name,
                "provider": row.provider,
                "status": row.status,
                "keyLast4": row.key_last4,
                "lastUsed": row.last_used_at.isoformat() if row.last_used_at else None,
                "quotaDaily": int(row.quota_daily) if row.quota_daily is not None else 0,
                "costPerRequest": float(row.cost_per_request) if row.cost_per_request is not None else 0.0,
                "currency": row.currency or "USD",
            }
            for row in rows
        ]
    }


@router.patch("/admin/api-keys")
async def admin_update_api_key(
    payload: AdminApiKeyUpdatePayload = Body(...),
    _: None = Depends(require_admin),
    db_user: Session = Depends(get_user_db),
):
    if payload.status and payload.status not in {"active", "disabled", "rotating"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    key_row = db_user.execute(
        text("SELECT key_name, provider FROM api_key_registry WHERE key_name = :key_name"),
        {"key_name": payload.keyName},
    ).fetchone()
    if not key_row:
        raise HTTPException(status_code=404, detail="API key not found")

    target_provider = payload.provider or key_row.provider
    if payload.provider:
        db_user.execute(
            text("UPDATE api_key_registry SET provider = :provider, updated_at = NOW() WHERE key_name = :key_name"),
            {"provider": payload.provider, "key_name": payload.keyName},
        )
    if payload.status:
        db_user.execute(
            text("UPDATE api_key_registry SET status = :status, updated_at = NOW() WHERE key_name = :key_name"),
            {"status": payload.status, "key_name": payload.keyName},
        )

    if payload.quotaDaily is not None or payload.costPerRequest is not None:
        provider_cfg = db_user.execute(
            text("SELECT quota_daily, cost_per_request FROM api_provider_config WHERE provider = :provider"),
            {"provider": target_provider},
        ).fetchone()
        next_quota = (
            payload.quotaDaily
            if payload.quotaDaily is not None
            else (int(provider_cfg.quota_daily) if provider_cfg and provider_cfg.quota_daily is not None else 0)
        )
        next_cost = (
            payload.costPerRequest
            if payload.costPerRequest is not None
            else (float(provider_cfg.cost_per_request) if provider_cfg and provider_cfg.cost_per_request is not None else 0.0)
        )
        db_user.execute(
            text(
                """
                INSERT INTO api_provider_config (provider, quota_daily, cost_per_request, currency, is_active, updated_at)
                VALUES (:provider, :quota_daily, :cost_per_request, 'USD', TRUE, NOW())
                ON CONFLICT (provider) DO UPDATE SET
                  quota_daily = EXCLUDED.quota_daily,
                  cost_per_request = EXCLUDED.cost_per_request,
                  updated_at = NOW()
                """
            ),
            {
                "provider": target_provider,
                "quota_daily": next_quota,
                "cost_per_request": next_cost,
            },
        )
    db_user.commit()
    return {"ok": True}


@router.get("/admin/sessions")
async def admin_list_sessions(
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
):
    """List recent chat sessions with counts and last preview — batched queries to reduce DB round-trips."""
    sessions = db_chat.query(ChatSession).order_by(ChatSession.updated_at.desc()).limit(50).all()
    if not sessions:
        return {"sessions": []}

    session_ids = [s.id for s in sessions]

    count_rows = (
        db_chat.query(ChatMessage.session_id, func.count(ChatMessage.id))
        .filter(ChatMessage.session_id.in_(session_ids))
        .group_by(ChatMessage.session_id)
        .all()
    )
    counts = {row[0]: row[1] for row in count_rows}

    max_ts_subq = (
        db_chat.query(
            ChatMessage.session_id.label("sid"),
            func.max(ChatMessage.created_at).label("max_ts"),
        )
        .filter(ChatMessage.session_id.in_(session_ids))
        .group_by(ChatMessage.session_id)
        .subquery()
    )
    candidates = (
        db_chat.query(ChatMessage)
        .join(
            max_ts_subq,
            and_(
                ChatMessage.session_id == max_ts_subq.c.sid,
                ChatMessage.created_at == max_ts_subq.c.max_ts,
            ),
        )
        .all()
    )
    last_by_sid: dict[Any, ChatMessage] = {}
    for m in candidates:
        sid = m.session_id
        prev = last_by_sid.get(sid)
        if prev is None or str(m.id) > str(prev.id):
            last_by_sid[sid] = m

    results = []
    for s in sessions:
        msg_count = counts.get(s.id, 0)
        last_msg = last_by_sid.get(s.id)
        preview = None
        if last_msg and last_msg.content:
            preview = last_msg.content[:120] + ("..." if len(last_msg.content) > 120 else "")
        results.append(
            {
                "id": str(s.id),
                "user_id": str(s.user_id) if s.user_id else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                "message_count": msg_count,
                "last_message_preview": preview,
            }
        )
    return {"sessions": results}


@router.get("/admin/sessions/{session_id}")
async def admin_get_session(
    session_id: str,
    _: None = Depends(require_admin),
    db_chat: Session = Depends(get_chat_db),
):
    from uuid import UUID

    try:
        sid = UUID(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session id")

    session = db_chat.query(ChatSession).filter(ChatSession.id == sid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    msgs = (
        db_chat.query(ChatMessage)
        .filter(ChatMessage.session_id == sid)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    return {
        "id": str(session.id),
        "user_id": str(session.user_id) if session.user_id else None,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in msgs
        ],
    }


@router.get("/admin/feedback")
async def admin_list_feedback(
    status: Optional[str] = Query(None),
    _: None = Depends(require_admin),
    db_user: Session = Depends(get_user_db),
):
    q = db_user.query(Feedback).order_by(Feedback.created_at.desc())
    if status:
        q = q.filter(Feedback.status == status)
    items = q.limit(100).all()
    results = []
    for f in items:
        results.append(
            {
                "id": str(f.id),
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "name": f.name,
                "email": f.email,
                "status": f.status,
                "message_preview": (f.message[:120] + "...") if f.message else "",
            }
        )
    return {"feedback": results}


@router.get("/admin/feedback/{feedback_id}")
async def admin_get_feedback(
    feedback_id: str,
    _: None = Depends(require_admin),
    db_user: Session = Depends(get_user_db),
):
    from uuid import UUID

    try:
        fid = UUID(feedback_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid feedback id")

    f = db_user.query(Feedback).filter(Feedback.id == fid).first()
    if not f:
        raise HTTPException(status_code=404, detail="Feedback not found")

    return {
        "id": str(f.id),
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
        "name": f.name,
        "email": f.email,
        "status": f.status,
        "message": f.message,
        "context_chat": f.context_chat,
        "context_flights": f.context_flights,
        "context_page": f.context_page
        if f.context_page
        else (
            f.context_flights.get("page_snapshot")
            if isinstance(f.context_flights, dict)
            else None
        ),
    }


@router.patch("/admin/feedback/{feedback_id}")
async def admin_update_feedback(
    feedback_id: str,
    status: str = Query(...),
    _: None = Depends(require_admin),
    db_user: Session = Depends(get_user_db),
):
    from uuid import UUID

    try:
        fid = UUID(feedback_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid feedback id")

    f = db_user.query(Feedback).filter(Feedback.id == fid).first()
    if not f:
        raise HTTPException(status_code=404, detail="Feedback not found")

    f.status = status
    db_user.commit()
    return {"ok": True}



# ── Price Alerts (User DB; require auth; scoped by user_id) ───

@router.post("/price-alerts/ai-create")
async def create_price_alert_with_ai(
    payload: PriceAlertAiCreatePayload,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        alert = await create_price_alert_from_ai_instruction(
            db,
            user_id=user_id,
            instruction=payload.instruction,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"alert": alert}

@router.get("/price-alerts")
async def list_price_alerts_endpoint(
    refresh: bool = Query(True),
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    return {
        "alerts": await list_price_alerts(db, user_id, refresh_live=refresh),
    }


@router.get("/price-alerts/{alert_id}")
async def get_price_alert_endpoint(
    alert_id: str,
    refresh: bool = Query(False),
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    alert = get_price_alert_for_user(db, alert_id, user_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if refresh:
        return {"alert": await refresh_price_alert(db, alert, force=True)}
    return {"alert": build_alert_snapshot(alert)}


@router.patch("/price-alerts/{alert_id}")
async def update_price_alert_endpoint(
    alert_id: str,
    payload: PriceAlertUpdatePayload,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    alert = get_price_alert_for_user(db, alert_id, user_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    changed_config = False

    if payload.origin is not None:
        origin = payload.origin.strip()
        if not origin:
            raise HTTPException(status_code=400, detail="origin cannot be empty")
        normalized_origin = origin.upper() if len(origin) <= 3 and origin.isalpha() else origin.title()
        if normalized_origin != alert.origin:
            alert.origin = normalized_origin
            changed_config = True

    if payload.destination is not None:
        destination = payload.destination.strip()
        if not destination:
            raise HTTPException(status_code=400, detail="destination cannot be empty")
        normalized_destination = (
            destination.upper()
            if len(destination) <= 3 and destination.isalpha()
            else destination.title()
        )
        if normalized_destination != alert.destination:
            alert.destination = normalized_destination
            changed_config = True

    if payload.airline is not None:
        normalized_airline = payload.airline.strip() or None
        normalized_airline = normalized_airline.title() if normalized_airline else None
        if normalized_airline != alert.airline:
            alert.airline = normalized_airline
            changed_config = True

    if payload.date_range is not None:
        normalized_date_range = payload.date_range.strip() or None
        if normalized_date_range != alert.date_range:
            alert.date_range = normalized_date_range
            changed_config = True

    if payload.is_active is not None:
        alert.is_active = payload.is_active

    if changed_config:
        alert.current_price = None
        alert.lowest_price = None
        alert.trend = None
        alert.change_pct = None

    alert.updated_at = datetime.utcnow()
    db.add(alert)
    db.commit()
    db.refresh(alert)

    if payload.refresh_live or changed_config or payload.is_active:
        return {"alert": await refresh_price_alert(db, alert, force=True)}

    return {"alert": build_alert_snapshot(alert)}


@router.post("/price-alerts/{alert_id}/refresh")
async def refresh_price_alert_endpoint(
    alert_id: str,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    alert = get_price_alert_for_user(db, alert_id, user_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"alert": await refresh_price_alert(db, alert, force=True)}


@router.post("/price-alerts/scheduler/refresh-active")
async def scheduler_refresh_active_alerts_endpoint(
    limit: int = Query(50, ge=1, le=500),
    _: None = Depends(require_admin),
    db: Session = Depends(get_user_db),
):
    """
    Cron-safe endpoint: refresh active alerts in priority order and return
    trigger payloads for downstream notification dispatch.
    """
    return await refresh_active_alerts_for_scheduler(db, limit=limit)


@router.post("/price-alerts/{alert_id}/ai-edit")
async def ai_edit_price_alert_endpoint(
    alert_id: str,
    payload: PriceAlertAiEditPayload,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    alert = get_price_alert_for_user(db, alert_id, user_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    try:
        updated_alert = await apply_ai_edit_to_alert(db, alert, payload.instruction)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"alert": updated_alert}


@router.delete("/price-alerts/{alert_id}")
async def delete_price_alert_endpoint(
    alert_id: str,
    db: Session = Depends(get_user_db),
    user_id: str = Depends(get_current_user_id),
):
    alert = get_price_alert_for_user(db, alert_id, user_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    db.delete(alert)
    db.commit()
    return {"deleted": True}


# ── Sessions (Chat DB; require auth; scoped by user_id) ───

@router.post("/sessions")
async def create_session_endpoint(
    db: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    session = create_session(db, user_id)
    return session


@router.get("/sessions")
async def list_sessions_endpoint(
    db: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
    limit: int = Query(100, ge=1, le=200),
):
    return {"sessions": list_sessions(db, user_id, limit=limit)}


@router.post("/sessions/import")
async def import_sessions_endpoint(
    payload: SessionImportPayload,
    db: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    return import_chat_sessions(
        db,
        user_id,
        [session.dict() for session in payload.sessions],
    )


@router.get("/sessions/{session_id}")
async def get_session_endpoint(
    session_id: str,
    db: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    session = get_session(db, session_id, user_id=user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/sessions/{session_id}")
async def delete_session_endpoint(
    session_id: str,
    db: Session = Depends(get_chat_db),
    user_id: str = Depends(get_current_user_id),
):
    deleted = delete_session(db, session_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}


# ── Tips ────────────────────────────────────────────────

@router.get("/tip")
async def tip_endpoint():
    return {"tip": generate_travel_tip()}
