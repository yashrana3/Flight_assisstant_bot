"""Google Maps utilities for airport directions, embeds, and convenience scoring."""

import os
from math import asin, cos, radians, sin, sqrt
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

load_dotenv()

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

# Airport coordinates and names for popular airports
AIRPORT_INFO = {
    "DEL": {"name": "Indira Gandhi International Airport", "lat": 28.5562, "lng": 77.1000},
    "BOM": {"name": "Chhatrapati Shivaji Maharaj International Airport", "lat": 19.0896, "lng": 72.8656},
    "BLR": {"name": "Kempegowda International Airport", "lat": 13.1986, "lng": 77.7066},
    "MAA": {"name": "Chennai International Airport", "lat": 12.9941, "lng": 80.1709},
    "CCU": {"name": "Netaji Subhas Chandra Bose International Airport", "lat": 22.6547, "lng": 88.4467},
    "HYD": {"name": "Rajiv Gandhi International Airport", "lat": 17.2403, "lng": 78.4294},
    "PNQ": {"name": "Pune Airport", "lat": 18.5822, "lng": 73.9197},
    "GOI": {"name": "Goa International Airport", "lat": 15.3808, "lng": 73.8314},
    "DXB": {"name": "Dubai International Airport", "lat": 25.2532, "lng": 55.3657},
    "BKK": {"name": "Suvarnabhumi Airport", "lat": 13.6900, "lng": 100.7501},
    "SIN": {"name": "Changi Airport", "lat": 1.3644, "lng": 103.9915},
    "LHR": {"name": "Heathrow Airport", "lat": 51.4700, "lng": -0.4543},
    "CDG": {"name": "Charles de Gaulle Airport", "lat": 49.0097, "lng": 2.5479},
    "NRT": {"name": "Narita International Airport", "lat": 35.7720, "lng": 140.3929},
    "JFK": {"name": "John F. Kennedy International Airport", "lat": 40.6413, "lng": -73.7781},
    "LAX": {"name": "Los Angeles International Airport", "lat": 33.9425, "lng": -118.4081},
    "SYD": {"name": "Sydney Airport", "lat": -33.9461, "lng": 151.1772},
    "KUL": {"name": "Kuala Lumpur International Airport", "lat": 2.7456, "lng": 101.7099},
    "HKG": {"name": "Hong Kong International Airport", "lat": 22.3080, "lng": 113.9185},
    "ICN": {"name": "Incheon International Airport", "lat": 37.4602, "lng": 126.4407},
    "IST": {"name": "Istanbul Airport", "lat": 41.2753, "lng": 28.7519},
    "FCO": {"name": "Leonardo da Vinci–Fiumicino Airport", "lat": 41.8003, "lng": 12.2389},
    "AMS": {"name": "Amsterdam Airport Schiphol", "lat": 52.3105, "lng": 4.7683},
    "DOH": {"name": "Hamad International Airport", "lat": 25.2731, "lng": 51.6082},
    "AUH": {"name": "Zayed International Airport", "lat": 24.4330, "lng": 54.6511},
    "JAI": {"name": "Jaipur International Airport", "lat": 26.8242, "lng": 75.8122},
    "LKO": {"name": "Chaudhary Charan Singh International Airport", "lat": 26.7606, "lng": 80.8893},
    "AMD": {"name": "Sardar Vallabhbhai Patel International Airport", "lat": 23.0772, "lng": 72.6347},
}


def get_airport_name(iata_code: str) -> str:
    """Get airport name from IATA code."""
    info = AIRPORT_INFO.get(iata_code.upper())
    return info["name"] if info else f"{iata_code} Airport"


def get_directions_url(origin_iata: str, destination_iata: str) -> dict:
    """Generate Google Maps directions URL from origin airport to destination airport."""
    origin_info = AIRPORT_INFO.get(origin_iata.upper())
    dest_info = AIRPORT_INFO.get(destination_iata.upper())

    origin_name = origin_info["name"] if origin_info else f"{origin_iata} Airport"
    dest_name = dest_info["name"] if dest_info else f"{destination_iata} Airport"

    # Google Maps directions URL
    directions_url = (
        f"https://www.google.com/maps/dir/?api=1"
        f"&destination={quote(origin_name)}"
        f"&travelmode=driving"
    )

    # Google Maps embed URL for origin airport (directions to departure airport)
    embed_url = ""
    if GOOGLE_MAPS_API_KEY and origin_info:
        embed_url = (
            f"https://www.google.com/maps/embed/v1/place"
            f"?key={GOOGLE_MAPS_API_KEY}"
            f"&q={quote(origin_name)}"
            f"&center={origin_info['lat']},{origin_info['lng']}"
            f"&zoom=13"
        )

    return {
        "origin_airport": origin_name,
        "destination_airport": dest_name,
        "directions_url": directions_url,
        "embed_url": embed_url,
        "origin_coords": {"lat": origin_info["lat"], "lng": origin_info["lng"]} if origin_info else None,
        "destination_coords": {"lat": dest_info["lat"], "lng": dest_info["lng"]} if dest_info else None,
    }


def get_destination_map_url(iata_code: str) -> str:
    """Get a Google Maps embed URL for the destination city/airport."""
    info = AIRPORT_INFO.get(iata_code.upper())
    if not info or not GOOGLE_MAPS_API_KEY:
        return ""

    return (
        f"https://www.google.com/maps/embed/v1/place"
        f"?key={GOOGLE_MAPS_API_KEY}"
        f"&q={quote(info['name'])}"
        f"&center={info['lat']},{info['lng']}"
        f"&zoom=12"
    )


def get_airport_info(iata_code: str) -> Optional[Dict[str, Any]]:
    """Return known airport metadata for a given IATA code, if available."""
    if not iata_code:
        return None
    return AIRPORT_INFO.get(iata_code.upper())


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Compute straight-line distance between two coordinates in kilometers."""
    lat1_r, lng1_r = radians(lat1), radians(lng1)
    lat2_r, lng2_r = radians(lat2), radians(lng2)
    dlat = lat2_r - lat1_r
    dlng = lng2_r - lng1_r
    a = sin(dlat / 2) ** 2 + cos(lat1_r) * cos(lat2_r) * sin(dlng / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(a))


def _fallback_airport_convenience(
    origin_iata: str,
    user_lat: float,
    user_lng: float,
    airport_info: Dict[str, Any],
) -> Dict[str, Any]:
    """Fallback convenience estimate when Google Maps routing is unavailable."""
    distance_km = round(
        _haversine_km(user_lat, user_lng, airport_info["lat"], airport_info["lng"]),
        1,
    )
    # Rough driving estimate with city traffic buffer.
    duration_minutes = max(10, round((distance_km / 35.0) * 60))
    return {
        "origin_iata": origin_iata.upper(),
        "airport_name": airport_info["name"],
        "distance_km": distance_km,
        "duration_minutes": duration_minutes,
        "source": "haversine_fallback",
        "is_estimate": True,
    }


async def get_airport_convenience(
    origin_iata: str,
    user_lat: Optional[float],
    user_lng: Optional[float],
) -> Optional[Dict[str, Any]]:
    """
    Estimate how convenient a departure airport is for the user.

    Prefers Google Maps Distance Matrix when a key and airport coordinates are
    available, and falls back to straight-line distance plus a simple driving
    time estimate.
    """
    if user_lat is None or user_lng is None or not origin_iata:
        return None

    airport_info = get_airport_info(origin_iata)
    if not airport_info:
        return {
            "origin_iata": origin_iata.upper(),
            "airport_name": get_airport_name(origin_iata),
            "distance_km": None,
            "duration_minutes": None,
            "source": "unavailable",
            "is_estimate": True,
        }

    fallback = _fallback_airport_convenience(
        origin_iata,
        user_lat,
        user_lng,
        airport_info,
    )

    if not GOOGLE_MAPS_API_KEY:
        return fallback

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://maps.googleapis.com/maps/api/distancematrix/json",
                params={
                    "origins": f"{user_lat},{user_lng}",
                    "destinations": f"{airport_info['lat']},{airport_info['lng']}",
                    "mode": "driving",
                    "units": "metric",
                    "key": GOOGLE_MAPS_API_KEY,
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return fallback

    rows = data.get("rows") or []
    elements = rows[0].get("elements") if rows and isinstance(rows[0], dict) else None
    element = elements[0] if elements and isinstance(elements, list) else None
    if not element or element.get("status") != "OK":
        return fallback

    distance_value = (element.get("distance") or {}).get("value")
    duration_value = (element.get("duration") or {}).get("value")
    if distance_value is None or duration_value is None:
        return fallback

    return {
        "origin_iata": origin_iata.upper(),
        "airport_name": airport_info["name"],
        "distance_km": round(float(distance_value) / 1000, 1),
        "duration_minutes": max(1, round(float(duration_value) / 60)),
        "source": "google_maps",
        "is_estimate": False,
    }
