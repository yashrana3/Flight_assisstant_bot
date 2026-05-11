"""Reverse geocoding using OpenWeather Geocoding API."""

import os
import httpx
from dotenv import load_dotenv

load_dotenv()

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")


async def reverse_geocode(lat: float, lng: float) -> str | None:
    """Convert lat/lng to a city name using OpenWeather reverse geocoding.

    Returns the city name string, or None on failure.
    """
    if not OPENWEATHER_API_KEY:
        return None

    url = (
        f"http://api.openweathermap.org/geo/1.0/reverse"
        f"?lat={lat}&lon={lng}&limit=1&appid={OPENWEATHER_API_KEY}"
    )

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            if data and len(data) > 0:
                # Prefer "name" (city), fall back to "state"
                return data[0].get("name") or data[0].get("state")
    except Exception:
        pass

    return None
