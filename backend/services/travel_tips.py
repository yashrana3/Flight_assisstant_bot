"""Generate fresh travel tips for the chat landing state."""

import os
import random
import re
from datetime import datetime
from collections import deque

from openai import OpenAI

TIP_MODEL = os.getenv("OPENAI_TRAVEL_TIP_MODEL", os.getenv("OPENAI_CHAT_MODEL", "gpt-4o"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
TIP_REQUEST_TIMEOUT_SECONDS = float(os.getenv("OPENAI_TRAVEL_TIP_TIMEOUT_SECONDS", "1.4"))

FALLBACK_TIPS = [
    "Check the baggage rules before booking so a cheap fare does not turn expensive at checkout.",
    "Flights with longer layovers can cost less, but protect tight international connections with extra buffer time.",
    "Morning departures are usually less disruption-prone than late-evening flights on busy routes.",
    "Compare total trip cost, not just fare, when a far airport adds extra taxi or train expense.",
    "If your dates are flexible, shifting by one day can unlock a noticeably better fare on the same route.",
    "Pick the airport first in multi-airport cities because convenience can matter more than a small fare difference.",
]

TIP_FOCUS_AREAS = [
    "booking timing",
    "airport choice",
    "layovers",
    "baggage",
    "check-in prep",
    "seat selection",
    "loyalty programs",
    "weather readiness",
    "budget planning",
    "long-haul comfort",
]

_RECENT_TIPS = deque(maxlen=25)


def _normalize_tip(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    cleaned = cleaned.strip("\"'`")
    cleaned = re.sub(r"^(tip|travel tip|pro tip|did you know)\s*[:\-]\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.rstrip()
    if not cleaned:
        return ""
    if cleaned[-1] not in ".!?":
        cleaned += "."
    return cleaned[:180].rstrip()


def generate_travel_tip() -> str:
    fallback = random.choice(FALLBACK_TIPS)
    if client is None:
        # Keep tips dynamic even in fallback mode by avoiding immediate repeats.
        for _ in range(len(FALLBACK_TIPS)):
            candidate = random.choice(FALLBACK_TIPS)
            if candidate not in _RECENT_TIPS:
                _RECENT_TIPS.append(candidate)
                return candidate
        _RECENT_TIPS.append(fallback)
        return fallback

    focus_area = random.choice(TIP_FOCUS_AREAS)
    today = datetime.utcnow().strftime("%Y-%m-%d")

    try:
        response = client.chat.completions.create(
            model=TIP_MODEL,
            temperature=0.9,
            max_completion_tokens=40,
            timeout=TIP_REQUEST_TIMEOUT_SECONDS,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You write one short, fresh, practical travel tip for a flight booking app. "
                        "Return exactly one sentence. Keep it actionable, specific, and under 24 words. "
                        "No bullets, no emoji, no intro labels, no quotation marks."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Give a fresh travel tip focused on {focus_area}. "
                        f"Make it feel current as of {today} and useful for a traveler opening the app right now."
                    ),
                },
            ],
        )
    except Exception:
        return fallback

    tip = _normalize_tip(response.choices[0].message.content or "")
    candidate = tip or fallback

    if candidate in _RECENT_TIPS:
        for _ in range(len(FALLBACK_TIPS)):
            alt = random.choice(FALLBACK_TIPS)
            if alt not in _RECENT_TIPS:
                candidate = alt
                break

    _RECENT_TIPS.append(candidate)
    return candidate
