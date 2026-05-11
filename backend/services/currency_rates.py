"""Exchange-rate utilities for deterministic currency conversion."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_OPEN_ER_API_URL = "https://open.er-api.com/v6/latest/{base}"


def _parse_provider_timestamp(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def fetch_exchange_rate(
    *,
    source_currency: str,
    target_currency: str,
) -> dict[str, Any] | None:
    """
    Fetch a direct exchange rate from Open ER API.

    Returns None when provider data is unavailable.
    """
    source = (source_currency or "").upper().strip()
    target = (target_currency or "").upper().strip()
    if not source or not target:
        return None
    if source == target:
        now = datetime.now(timezone.utc)
        return {
            "rate": 1.0,
            "provider": "identity",
            "fetched_at": now.isoformat(),
            "provider_timestamp": now.isoformat(),
        }

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.get(_OPEN_ER_API_URL.format(base=source))
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    rates = payload.get("rates")
    if not isinstance(rates, dict):
        return None
    raw_rate = rates.get(target)
    try:
        rate = float(raw_rate)
    except (TypeError, ValueError):
        return None
    if rate <= 0:
        return None

    provider_timestamp = _parse_provider_timestamp(payload.get("time_last_update_utc"))
    fetched_at = datetime.now(timezone.utc)
    return {
        "rate": rate,
        "provider": "open_er_api",
        "fetched_at": fetched_at.isoformat(),
        "provider_timestamp": (provider_timestamp or fetched_at).isoformat(),
    }
