"""Mocked flight search data for popular routes (no OpenAI call needed)."""

from typing import List, Optional

# Realistic mock flight data for popular routes (used only by legacy endpoints if needed)
_MOCK_ROUTES = {
    ("DEL", "DXB"): [
        {"airline": "Emirates", "flight_number": "EK 511", "departure_time": "03:45", "arrival_time": "06:00", "duration": "4h 15m", "stops": 0, "stop_cities": [], "price": 18499, "cabin_class": "Economy", "baggage": "1 carry-on + 30kg checked", "score": 9.2, "score_reason": "Best rated direct flight", "perks": ["Free meal", "ICE entertainment", "USB charging"]},
        {"airline": "Air India", "flight_number": "AI 995", "departure_time": "10:30", "arrival_time": "12:50", "duration": "4h 20m", "stops": 0, "stop_cities": [], "price": 14200, "cabin_class": "Economy", "baggage": "1 carry-on + 25kg checked", "score": 8.1, "score_reason": "Best value direct", "perks": ["Free meal", "In-flight entertainment"]},
        {"airline": "IndiGo", "flight_number": "6E 1403", "departure_time": "14:15", "arrival_time": "16:30", "duration": "4h 15m", "stops": 0, "stop_cities": [], "price": 12800, "cabin_class": "Economy", "baggage": "1 carry-on + 15kg checked", "score": 7.5, "score_reason": "Budget friendly direct", "perks": ["On-time guarantee"]},
        {"airline": "Etihad", "flight_number": "EY 215", "departure_time": "22:00", "arrival_time": "00:15", "duration": "4h 15m", "stops": 0, "stop_cities": [], "price": 16900, "cabin_class": "Economy", "baggage": "1 carry-on + 23kg checked", "score": 8.8, "score_reason": "Great late-night option", "perks": ["Free meal", "Chauffeur service", "Wi-Fi"]},
    ],
    ("BOM", "BKK"): [
        {"airline": "Thai Airways", "flight_number": "TG 318", "departure_time": "07:45", "arrival_time": "13:50", "duration": "4h 35m", "stops": 0, "stop_cities": [], "price": 14200, "cabin_class": "Economy", "baggage": "1 carry-on + 30kg checked", "score": 9.0, "score_reason": "Top-rated direct flight", "perks": ["Thai cuisine", "In-flight entertainment", "Priority check-in"]},
        {"airline": "Air India", "flight_number": "AI 330", "departure_time": "11:20", "arrival_time": "17:30", "duration": "4h 40m", "stops": 0, "stop_cities": [], "price": 12500, "cabin_class": "Economy", "baggage": "1 carry-on + 25kg checked", "score": 7.8, "score_reason": "Affordable direct", "perks": ["Free meal"]},
        {"airline": "IndiGo", "flight_number": "6E 1053", "departure_time": "23:55", "arrival_time": "06:10", "duration": "4h 45m", "stops": 0, "stop_cities": [], "price": 10900, "cabin_class": "Economy", "baggage": "1 carry-on + 15kg checked", "score": 7.2, "score_reason": "Cheapest overnight option", "perks": []},
    ],
    ("DEL", "SIN"): [
        {"airline": "Singapore Airlines", "flight_number": "SQ 407", "departure_time": "10:00", "arrival_time": "18:00", "duration": "5h 30m", "stops": 0, "stop_cities": [], "price": 21500, "cabin_class": "Economy", "baggage": "1 carry-on + 30kg checked", "score": 9.5, "score_reason": "World's best airline — direct", "perks": ["KrisFlyer miles", "Premium meal", "Wi-Fi", "USB charging"]},
        {"airline": "Air India", "flight_number": "AI 381", "departure_time": "13:30", "arrival_time": "21:45", "duration": "5h 45m", "stops": 0, "stop_cities": [], "price": 16800, "cabin_class": "Economy", "baggage": "1 carry-on + 25kg checked", "score": 7.6, "score_reason": "Good value direct", "perks": ["Free meal", "In-flight entertainment"]},
        {"airline": "IndiGo", "flight_number": "6E 1025", "departure_time": "06:30", "arrival_time": "14:55", "duration": "5h 55m", "stops": 0, "stop_cities": [], "price": 13500, "cabin_class": "Economy", "baggage": "1 carry-on + 15kg checked", "score": 7.0, "score_reason": "Budget option", "perks": []},
    ],
    ("BLR", "LHR"): [
        {"airline": "British Airways", "flight_number": "BA 118", "departure_time": "02:30", "arrival_time": "08:10", "duration": "9h 40m", "stops": 0, "stop_cities": [], "price": 38900, "cabin_class": "Economy", "baggage": "1 carry-on + 23kg checked", "score": 8.9, "score_reason": "Only direct BLR-LHR", "perks": ["Free meal", "Entertainment", "Wi-Fi"]},
        {"airline": "Emirates", "flight_number": "EK 565", "departure_time": "09:00", "arrival_time": "18:45", "duration": "13h 45m", "stops": 1, "stop_cities": ["Dubai (DXB)"], "price": 32500, "cabin_class": "Economy", "baggage": "1 carry-on + 30kg checked", "score": 8.5, "score_reason": "Premium 1-stop via Dubai", "perks": ["Free meal", "ICE entertainment", "Dubai lounge access"]},
        {"airline": "Air India", "flight_number": "AI 175", "departure_time": "14:00", "arrival_time": "01:30", "duration": "11h 30m", "stops": 1, "stop_cities": ["Delhi (DEL)"], "price": 28700, "cabin_class": "Economy", "baggage": "1 carry-on + 25kg checked", "score": 7.3, "score_reason": "Budget 1-stop via Delhi", "perks": ["Free meal"]},
    ],
    ("DEL", "CDG"): [
        {"airline": "Air France", "flight_number": "AF 225", "departure_time": "01:30", "arrival_time": "07:20", "duration": "8h 50m", "stops": 0, "stop_cities": [], "price": 34500, "cabin_class": "Economy", "baggage": "1 carry-on + 23kg checked", "score": 9.0, "score_reason": "Direct to Paris", "perks": ["French cuisine", "In-flight entertainment", "Wi-Fi"]},
        {"airline": "Air India", "flight_number": "AI 143", "departure_time": "13:45", "arrival_time": "19:30", "duration": "8h 45m", "stops": 0, "stop_cities": [], "price": 29800, "cabin_class": "Economy", "baggage": "1 carry-on + 25kg checked", "score": 8.0, "score_reason": "Good value non-stop", "perks": ["Free meal", "Entertainment"]},
        {"airline": "Emirates", "flight_number": "EK 510", "departure_time": "04:00", "arrival_time": "14:30", "duration": "13h 30m", "stops": 1, "stop_cities": ["Dubai (DXB)"], "price": 26200, "cabin_class": "Economy", "baggage": "1 carry-on + 30kg checked", "score": 8.3, "score_reason": "Cheapest with Dubai transit", "perks": ["Free meal", "ICE entertainment"]},
    ],
    ("BOM", "NRT"): [
        {"airline": "ANA", "flight_number": "NH 830", "departure_time": "20:30", "arrival_time": "09:00", "duration": "7h 30m", "stops": 0, "stop_cities": [], "price": 32800, "cabin_class": "Economy", "baggage": "1 carry-on + 23kg checked", "score": 9.3, "score_reason": "5-star airline direct", "perks": ["Japanese cuisine", "Premium entertainment", "Wi-Fi"]},
        {"airline": "Air India", "flight_number": "AI 306", "departure_time": "17:00", "arrival_time": "06:30", "duration": "8h 30m", "stops": 0, "stop_cities": [], "price": 27500, "cabin_class": "Economy", "baggage": "1 carry-on + 25kg checked", "score": 7.5, "score_reason": "Budget direct option", "perks": ["Free meal"]},
        {"airline": "Singapore Airlines", "flight_number": "SQ 423", "departure_time": "10:00", "arrival_time": "04:30", "duration": "12h 30m", "stops": 1, "stop_cities": ["Singapore (SIN)"], "price": 29200, "cabin_class": "Economy", "baggage": "1 carry-on + 30kg checked", "score": 8.7, "score_reason": "Premium 1-stop with SIN lounge", "perks": ["Free meal", "KrisFlyer miles", "Wi-Fi"]},
    ],
}

# IATA lookup (subset — extend as needed)
_CITY_IATA = {
    "delhi": "DEL", "new delhi": "DEL", "mumbai": "BOM", "bombay": "BOM",
    "bangalore": "BLR", "bengaluru": "BLR", "chennai": "MAA",
    "kolkata": "CCU", "hyderabad": "HYD", "pune": "PNQ", "goa": "GOI",
    "dubai": "DXB", "bangkok": "BKK", "singapore": "SIN",
    "london": "LHR", "paris": "CDG", "tokyo": "NRT",
    "new york": "JFK", "los angeles": "LAX", "sydney": "SYD",
    "kuala lumpur": "KUL", "bali": "DPS", "maldives": "MLE",
}


def _get_iata(city: str) -> str:
    return _CITY_IATA.get(city.lower().strip(), city.upper().strip()[:3])


def search_flights(origin: str, destination: str, date: str, passengers: int = 1) -> dict:
    """Search for flights. Returns mocked data for known routes, fallback for unknown."""
    o = _get_iata(origin)
    d = _get_iata(destination)

    flights = _MOCK_ROUTES.get((o, d), [])

    # Try reverse key pattern too
    if not flights:
        flights = _MOCK_ROUTES.get((d, o), [])
        # Swap departure/arrival for reverse routes (approximate)
        if flights:
            flights = [
                {**f, "departure_time": f["arrival_time"], "arrival_time": f["departure_time"]}
                for f in flights
            ]

    # If no mock data, return generic fallback
    if not flights:
        flights = [
            {"airline": "Air India", "flight_number": "AI 100", "departure_time": "10:00", "arrival_time": "16:00", "duration": "6h 00m", "stops": 0, "stop_cities": [], "price": 22000, "cabin_class": "Economy", "baggage": "1 carry-on + 25kg checked", "score": 7.5, "score_reason": "Standard direct flight", "perks": ["Free meal"]},
            {"airline": "Emirates", "flight_number": "EK 200", "departure_time": "22:00", "arrival_time": "04:00", "duration": "8h 00m", "stops": 1, "stop_cities": ["Dubai (DXB)"], "price": 28000, "cabin_class": "Economy", "baggage": "1 carry-on + 30kg checked", "score": 8.5, "score_reason": "Premium via Dubai", "perks": ["Free meal", "ICE entertainment", "Wi-Fi"]},
        ]

    # Adjust prices for passenger count
    if passengers > 1:
        flights = [{**f, "price": f["price"] * passengers, "price_per_person": f["price"]} for f in flights]

    return {
        "origin": origin,
        "origin_code": o,
        "destination": destination,
        "destination_code": d,
        "date": date,
        "passengers": passengers,
        "flight_count": len(flights),
        "flights": flights,
    }
