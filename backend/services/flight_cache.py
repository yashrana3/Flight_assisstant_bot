"""
Flight search result cache: in-memory TTL by default, optional Redis when REDIS_URL is set.
Cache key: route/date inputs plus a personalization variant hash.
TTL: 10 minutes for in-memory; 10 minutes for Redis.
"""

import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "").strip()
CACHE_TTL_SECONDS = int(os.getenv("FLIGHT_CACHE_TTL_SECONDS", "600"))  # 10 min

# In-memory fallback: key -> (expires_at, value)
_memory_cache: Dict[str, Tuple[float, Any]] = {}
_memory_max_entries = 500


def _cache_key(
    origin: str,
    destination: str,
    depart_date: str,
    return_date: Optional[str],
    passengers: int,
    currency: str,
    budget: Optional[float],
    variant: str = "",
) -> str:
    raw = (
        f"{origin}|{destination}|{depart_date}|{return_date or ''}|"
        f"{passengers}|{currency}|{budget or ''}|{variant}"
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def get_cached(
    origin: str,
    destination: str,
    depart_date: str,
    return_date: Optional[str],
    passengers: int,
    currency: str,
    budget: Optional[float],
    variant: str = "",
) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, Any]]]:
    """Return (flights, search_info) if cached and not expired, else None."""
    key = _cache_key(
        origin,
        destination,
        depart_date,
        return_date,
        passengers,
        currency,
        budget,
        variant,
    )

    if REDIS_URL:
        try:
            import redis.asyncio as redis
            import redis
            r = redis.from_url(REDIS_URL)
            raw = r.get(f"flight:{key}")
            r.close()
            if raw is None:
                return None
            data = json.loads(raw)
            return (data.get("flights", []), data.get("search_info", {}))
        except Exception:
            pass
        return None

    now = time.time()
    if key in _memory_cache:
        expires_at, value = _memory_cache[key]
        if now < expires_at:
            return value
        del _memory_cache[key]
    return None


def set_cached(
    origin: str,
    destination: str,
    depart_date: str,
    return_date: Optional[str],
    passengers: int,
    currency: str,
    budget: Optional[float],
    flights: List[Dict[str, Any]],
    search_info: Dict[str, Any],
    variant: str = "",
) -> None:
    """Store (flights, search_info) in cache."""
    key = _cache_key(
        origin,
        destination,
        depart_date,
        return_date,
        passengers,
        currency,
        budget,
        variant,
    )
    payload = {"flights": flights, "search_info": search_info}

    if REDIS_URL:
        try:
            import redis
            r = redis.from_url(REDIS_URL)
            r.setex(f"flight:{key}", CACHE_TTL_SECONDS, json.dumps(payload, default=str))
            r.close()
        except Exception:
            pass
        return

    # In-memory: evict oldest if over limit
    while len(_memory_cache) >= _memory_max_entries and _memory_cache:
        oldest_key = min(_memory_cache, key=lambda k: _memory_cache[k][0])
        del _memory_cache[oldest_key]
    _memory_cache[key] = (time.time() + CACHE_TTL_SECONDS, (flights, search_info))
