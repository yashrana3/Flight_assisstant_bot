"""OpenWeather API service for destination weather data."""

import os
from collections import Counter, defaultdict
from datetime import date
import httpx
from dotenv import load_dotenv

load_dotenv()

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
OPENWEATHER_BASE = "https://api.openweathermap.org/data/2.5/weather"
OPENWEATHER_FORECAST_BASE = "https://api.openweathermap.org/data/2.5/forecast"

# Map city names to common search queries for OpenWeather
CITY_NAMES = {
    "DEL": "New Delhi", "BOM": "Mumbai", "BLR": "Bangalore", "MAA": "Chennai",
    "CCU": "Kolkata", "HYD": "Hyderabad", "PNQ": "Pune", "GOI": "Goa",
    "DXB": "Dubai", "BKK": "Bangkok", "SIN": "Singapore", "LHR": "London",
    "CDG": "Paris", "NRT": "Tokyo", "JFK": "New York", "LAX": "Los Angeles",
    "SYD": "Sydney", "KUL": "Kuala Lumpur", "HKG": "Hong Kong", "ICN": "Seoul",
    "IST": "Istanbul", "FCO": "Rome", "AMS": "Amsterdam", "FRA": "Frankfurt",
    "DOH": "Doha", "AUH": "Abu Dhabi", "YYZ": "Toronto", "SFO": "San Francisco",
    "MIA": "Miami", "SEA": "Seattle", "BER": "Berlin", "MAD": "Madrid",
    "BCN": "Barcelona", "LIS": "Lisbon", "MLE": "Male", "DPS": "Bali",
    "CAI": "Cairo", "NBO": "Nairobi", "GRU": "Sao Paulo", "MEX": "Mexico City",
    "JAI": "Jaipur", "LKO": "Lucknow", "COK": "Kochi", "VNS": "Varanasi",
    "AMD": "Ahmedabad", "IXC": "Chandigarh", "GAU": "Guwahati",
}


def get_city_name(iata_code: str) -> str:
    """Get city name from IATA code."""
    return CITY_NAMES.get(iata_code.upper(), iata_code)


async def get_weather(city: str) -> dict | None:
    """Fetch current weather for a city. Returns None on failure."""
    if not OPENWEATHER_API_KEY:
        return None

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                OPENWEATHER_BASE,
                params={
                    "q": city,
                    "appid": OPENWEATHER_API_KEY,
                    "units": "metric",
                },
            )
            if resp.status_code != 200:
                return None

            data = resp.json()
            weather = data.get("weather", [{}])[0]
            main = data.get("main", {})
            wind = data.get("wind", {})

            return {
                "city": city,
                "temp": round(main.get("temp", 0)),
                "feels_like": round(main.get("feels_like", 0)),
                "temp_min": round(main.get("temp_min", 0)),
                "temp_max": round(main.get("temp_max", 0)),
                "humidity": main.get("humidity", 0),
                "condition": weather.get("main", "Unknown"),
                "description": weather.get("description", ""),
                "icon": weather.get("icon", "01d"),
                "icon_url": f"https://openweathermap.org/img/wn/{weather.get('icon', '01d')}@2x.png",
                "wind_speed": round(wind.get("speed", 0), 1),
            }
    except Exception:
        return None


async def get_weather_range(city: str, start_date: str, end_date: str) -> list[dict]:
    """Fetch daily weather summaries for an inclusive date range."""
    if not OPENWEATHER_API_KEY:
        return []

    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        return []
    if end < start:
        return []

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                OPENWEATHER_FORECAST_BASE,
                params={
                    "q": city,
                    "appid": OPENWEATHER_API_KEY,
                    "units": "metric",
                },
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
    except Exception:
        return []

    points = data.get("list") or []
    grouped: dict[str, list[dict]] = defaultdict(list)
    for point in points:
        dt_txt = str(point.get("dt_txt") or "")
        day_key = dt_txt.split(" ")[0]
        if not day_key:
            continue
        try:
            point_day = date.fromisoformat(day_key)
        except ValueError:
            continue
        if start <= point_day <= end:
            grouped[day_key].append(point)

    daily: list[dict] = []
    for day_key in sorted(grouped.keys()):
        samples = grouped[day_key]
        temps = [float((sample.get("main") or {}).get("temp", 0.0)) for sample in samples]
        humidities = [int((sample.get("main") or {}).get("humidity", 0)) for sample in samples]
        conditions = [str(((sample.get("weather") or [{}])[0] or {}).get("main") or "Unknown") for sample in samples]
        descriptions = [str(((sample.get("weather") or [{}])[0] or {}).get("description") or "") for sample in samples]
        if not temps:
            continue
        primary_condition = Counter(conditions).most_common(1)[0][0] if conditions else "Unknown"
        primary_description = Counter(descriptions).most_common(1)[0][0] if descriptions else ""
        daily.append(
            {
                "date": day_key,
                "city": city,
                "temp_min": round(min(temps)),
                "temp_max": round(max(temps)),
                "temp_avg": round(sum(temps) / len(temps)),
                "humidity_avg": round(sum(humidities) / len(humidities)) if humidities else 0,
                "condition": primary_condition,
                "description": primary_description,
            }
        )

    return daily


def get_weather_advice(weather_data: dict | None) -> str:
    """Generate travel advice based on weather conditions."""
    if not weather_data:
        return ""

    temp = weather_data["temp"]
    condition = weather_data["condition"].lower()

    advice_parts = []

    # Temperature advice
    if temp > 35:
        advice_parts.append(f"🌡️ It's very hot ({temp}°C) — pack light, breathable clothes and stay hydrated")
    elif temp > 28:
        advice_parts.append(f"☀️ Warm weather ({temp}°C) — sunscreen and light clothes recommended")
    elif temp > 18:
        advice_parts.append(f"🌤️ Pleasant weather ({temp}°C) — great for sightseeing")
    elif temp > 10:
        advice_parts.append(f"🧥 Cool weather ({temp}°C) — carry a jacket or layered clothing")
    else:
        advice_parts.append(f"❄️ Cold weather ({temp}°C) — pack warm clothes, gloves, and a heavy coat")

    # Condition advice
    if "rain" in condition or "drizzle" in condition:
        advice_parts.append("🌧️ Expect rain — pack an umbrella and waterproof shoes")
    elif "snow" in condition:
        advice_parts.append("🌨️ Snowy conditions — winter boots and warm layers essential")
    elif "cloud" in condition:
        advice_parts.append("☁️ Overcast skies — a light layer is a good idea")
    elif "clear" in condition:
        advice_parts.append("☀️ Clear skies — perfect travel weather!")

    return ". ".join(advice_parts)


def get_weather_range_advice(daily_weather: list[dict]) -> str:
    """Generate simple planning advice for a weather date range."""
    if not daily_weather:
        return ""

    hottest = max(daily_weather, key=lambda item: item.get("temp_max", 0))
    coldest = min(daily_weather, key=lambda item: item.get("temp_min", 0))
    rainy_days = [
        item for item in daily_weather
        if "rain" in str(item.get("condition", "")).lower() or "drizzle" in str(item.get("condition", "")).lower()
    ]

    notes = [
        f"Expected range is {coldest.get('temp_min', 'N/A')}°C to {hottest.get('temp_max', 'N/A')}°C."
    ]
    if rainy_days:
        notes.append(f"Rain is likely on {len(rainy_days)} day(s), so pack light rain protection.")
    else:
        notes.append("No strong rain signal in the available forecast window.")
    return " ".join(notes)
