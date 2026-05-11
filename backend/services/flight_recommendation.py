"""
AI-powered flight ranking and recommendation.
Uses OpenAI to rank options, suggest one best flight, and explain in natural language
considering price, duration, reliability, convenience, and user preferences.
"""

import json
import os
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
FLIGHT_RANKING_MODEL = os.getenv("OPENAI_FLIGHT_RANKING_MODEL", "gpt-4o")
ENABLE_AI_FLIGHT_RANKING = os.getenv("OPENAI_FLIGHT_RANKING_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}

client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


def rank_and_recommend_flights(
    flights: List[Dict[str, Any]],
    budget: Optional[float],
    currency: str,
    weather_origin: Optional[Dict[str, Any]] = None,
    weather_dest: Optional[Dict[str, Any]] = None,
    origin_city: str = "",
    dest_city: str = "",
    preferred_airlines: Optional[List[str]] = None,
    preference_goal: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], int, str]:
    """
    Rank flights, add pros/cons to each, and produce one recommended option with explanation.
    Returns (ranked_flights, recommended_index_0based, recommendation_explanation).
    If OpenAI is unavailable or no flights, falls back to the heuristic score
    already attached to each flight and returns the top 10.
    """
    if not flights:
        return ([], 0, "")

    fallback_order = _build_fallback_order(
        flights,
        budget=budget,
        preferred_airlines=preferred_airlines,
    )
    if not client or not ENABLE_AI_FLIGHT_RANKING:
        return fallback_order

    # Build a compact summary for the model (no huge payloads)
    summary = []
    for i, f in enumerate(flights):
        analysis = f.get("analysis") or {}
        comparison = f.get("comparison") or {}
        convenience = f.get("convenience") or {}
        operations = f.get("operations") or {}
        summary.append({
            "index": i,
            "airline": f.get("airline") or "Unknown",
            "flight_number": f.get("flight_number") or "",
            "price": f.get("price") or 0,
            "duration": f.get("duration") or "",
            "stops": f.get("stops", 0),
            "departure_time": f.get("departure_time") or "",
            "arrival_time": f.get("arrival_time") or "",
            "badge": f.get("badge") or "",
            "overall_score": analysis.get("overallScore", f.get("score")),
            "score_breakdown": {
                "price": analysis.get("priceScore"),
                "duration": analysis.get("durationScore"),
                "reliability": analysis.get("reliabilityScore"),
                "preference": analysis.get("preferenceScore"),
                "convenience": analysis.get("convenienceScore"),
            },
            "score_reason": (f.get("score_reason") or "")[:200],
            "market_position": comparison.get("marketPosition"),
            "price_gap_from_cheapest": comparison.get("priceGapFromCheapest"),
            "provider_quotes": comparison.get("providerQuotes") or {},
            "reliability": {
                "score": operations.get("reliabilityScore"),
                "status": operations.get("status"),
                "delay_risk": operations.get("delayRisk"),
            },
            "convenience": {
                "airport_name": convenience.get("airportName"),
                "distance_km": convenience.get("distanceKm"),
                "travel_minutes": convenience.get("travelMinutes"),
            },
            "within_budget": analysis.get("withinBudget"),
            "preferred_airline_match": analysis.get("preferredAirlineMatch"),
            "perks": f.get("perks") or [],
        })

    weather_origin_str = ""
    if weather_origin:
        weather_origin_str = (
            f"Origin ({origin_city or 'origin'}): {weather_origin.get('temp', '')}°C, "
            f"{weather_origin.get('condition', '')} — {weather_origin.get('description', '')}"
        )
    weather_dest_str = ""
    if weather_dest:
        weather_dest_str = (
            f"Destination ({dest_city or 'destination'}): {weather_dest.get('temp', '')}°C, "
            f"{weather_dest.get('condition', '')} — {weather_dest.get('description', '')}"
        )

    prompt = f"""You are a travel expert ranking flight options for a traveler.

Flights (index, airline, price, duration, stops, reliability, convenience, market position, score breakdown, perks):
{json.dumps(summary, indent=2)}

User budget: {budget if budget else 'Not specified'} {currency}
Preferred airlines: {", ".join(preferred_airlines) if preferred_airlines else 'None specified'}
Ranking goal: {preference_goal or 'best_overall'}
{('Weather at ' + weather_origin_str) if weather_origin_str else ''}
{('Weather at ' + weather_dest_str) if weather_dest_str else ''}

Tasks:
1. Rank the best flight options using these factors: price, duration, reliability, user preferences, and convenience to the departure airport.
2. Return ONLY the top 10 ranked indices, best first.
3. For each returned flight, list 2-4 short pros and 1-3 short cons.
4. Pick exactly one recommended flight from the returned set and explain in 2-4 sentences why it is the best overall choice.

Return ONLY a single JSON object (no markdown, no code block) with this exact structure:
{{
  "ranked_indices": [0, 2, 1, ...],
  "recommended_index": 0,
  "recommendation_explanation": "Your 2-4 sentence explanation here.",
  "flights": [
    {{ "index": 0, "pros": ["pro1", "pro2"], "cons": ["con1"] }},
    ...
  ]
}}
Rules:
- ranked_indices must contain at most 10 items.
- recommended_index must be one of the ranked_indices.
- Favor options that are good overall, not just cheapest.
- Use convenience and reliability as meaningful differentiators when prices are close.
- Each entry in "flights" must have index, pros (array of strings), and cons (array of strings)."""

    try:
        resp = client.chat.completions.create(
            model=FLIGHT_RANKING_MODEL,
            messages=[
                {"role": "system", "content": "You output only valid JSON. No markdown, no explanation outside the JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1400,
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()
        data = json.loads(raw)
    except Exception:
        return fallback_order

    ranked_indices = data.get("ranked_indices") or list(range(len(flights)))
    recommended_index = data.get("recommended_index", 0)
    recommendation_explanation = data.get("recommendation_explanation") or ""
    flight_meta = {item["index"]: item for item in (data.get("flights") or [])}
    ranked_indices, recommended_index = _normalize_ranked_choice(
        ranked_indices,
        recommended_index,
        len(flights),
    )

    # Build new list: order by rank, attach pros/cons and is_recommended
    ordered: List[Dict[str, Any]] = []
    for rank_pos, idx in enumerate(ranked_indices[:10]):
        if idx < 0 or idx >= len(flights):
            continue
        f = dict(flights[idx])
        f["rank"] = rank_pos + 1
        meta = flight_meta.get(idx, {})
        fallback_pros, fallback_cons = _rule_based_pros_cons(
            f,
            budget=budget,
            preferred_airlines=preferred_airlines,
        )
        f["pros"] = meta.get("pros") or fallback_pros
        f["cons"] = meta.get("cons") or fallback_cons
        f["is_recommended"] = idx == recommended_index
        ranking = f.setdefault("ranking", {})
        ranking["pros"] = f["pros"]
        ranking["cons"] = f["cons"]
        ranking["recommended"] = f["is_recommended"]
        ranking["aiScore"] = rank_pos + 1
        ordered.append(f)

    # If we didn't get a proper order, use fallback heuristic ordering
    if not ordered:
        return fallback_order

    rec_idx_in_ordered = next((i for i, f in enumerate(ordered) if f.get("is_recommended")), 0)
    if not recommendation_explanation and ordered:
        recommendation_explanation = _fallback_recommendation_explanation(ordered[rec_idx_in_ordered])
    return (ordered, rec_idx_in_ordered, recommendation_explanation)


def _build_fallback_order(
    flights: List[Dict[str, Any]],
    budget: Optional[float],
    preferred_airlines: Optional[List[str]],
) -> Tuple[List[Dict[str, Any]], int, str]:
    ordered = sorted(
        (dict(flight) for flight in flights),
        key=lambda flight: float(((flight.get("analysis") or {}).get("overallScore")) or flight.get("score") or 0.0),
        reverse=True,
    )[:10]
    for index, flight in enumerate(ordered):
        pros, cons = _rule_based_pros_cons(
            flight,
            budget=budget,
            preferred_airlines=preferred_airlines,
        )
        flight["rank"] = index + 1
        flight["pros"] = pros
        flight["cons"] = cons
        flight["is_recommended"] = index == 0
        ranking = flight.setdefault("ranking", {})
        ranking["pros"] = pros
        ranking["cons"] = cons
        ranking["recommended"] = index == 0
        ranking["aiScore"] = index + 1

    explanation = _fallback_recommendation_explanation(ordered[0]) if ordered else ""
    return (ordered, 0, explanation)


def _normalize_ranked_choice(
    ranked_indices: List[Any],
    recommended_index: Any,
    total_flights: int,
) -> Tuple[List[int], int]:
    """
    Sanitize the AI response so the recommended flight is always part of the
    returned set and is placed first, matching the user-facing "Best Match".
    """
    valid_ranked: List[int] = []
    seen: set[int] = set()
    for raw_index in ranked_indices:
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if index < 0 or index >= total_flights or index in seen:
            continue
        seen.add(index)
        valid_ranked.append(index)

    if not valid_ranked:
        valid_ranked = list(range(total_flights))

    try:
        recommended = int(recommended_index)
    except (TypeError, ValueError):
        recommended = valid_ranked[0]

    if recommended not in valid_ranked:
        recommended = valid_ranked[0]
    elif valid_ranked[0] != recommended:
        valid_ranked.remove(recommended)
        valid_ranked.insert(0, recommended)

    return valid_ranked[:10], recommended


def _rule_based_pros_cons(
    flight: Dict[str, Any],
    budget: Optional[float],
    preferred_airlines: Optional[List[str]],
) -> Tuple[List[str], List[str]]:
    analysis = flight.get("analysis") or {}
    comparison = flight.get("comparison") or {}
    convenience = flight.get("convenience") or {}
    operations = flight.get("operations") or {}
    allowances = flight.get("allowances") or {}

    pros: List[str] = []
    cons: List[str] = []

    if analysis.get("withinBudget"):
        pros.append("Within budget")
    if comparison.get("marketPosition") == "cheapest":
        pros.append("Lowest price in this result set")
    elif comparison.get("marketPosition") == "competitive":
        pros.append("Competitively priced")

    stops = int(flight.get("stops") or 0)
    if stops == 0:
        pros.append("Non-stop journey")
    elif stops >= 2:
        cons.append("Multiple layovers")

    if analysis.get("preferredAirlineMatch"):
        pros.append("Matches preferred airline")
    elif preferred_airlines:
        cons.append("Not a preferred airline")

    reliability = operations.get("reliabilityScore")
    if reliability is not None:
        reliability_value = float(reliability)
        if reliability_value >= 8:
            pros.append("Strong on-time reliability")
        elif reliability_value <= 5:
            cons.append("Higher delay risk")

    distance_km = convenience.get("distanceKm")
    if distance_km is not None:
        if float(distance_km) <= 25:
            pros.append("Close to departure airport")
        elif float(distance_km) >= 60:
            cons.append("Far from departure airport")

    duration = flight.get("duration")
    if duration:
        pros.append(f"{duration} total journey")

    has_checked_baggage = bool(
        ((flight.get("baggage") or {}).get("checked"))
        or flight.get("baggage_checked")
        or allowances.get("checkedBaggage")
    )
    if has_checked_baggage:
        pros.append("Checked baggage included")
    else:
        cons.append("Checked baggage not clearly included")

    meal_services = (
        flight.get("meal_services")
        or allowances.get("mealServices")
        or []
    )
    if meal_services:
        pros.append("Meal service available")

    perks = flight.get("perks") or allowances.get("perks") or []
    if any("wifi" in str(perk).lower() or "wi-fi" in str(perk).lower() for perk in perks):
        pros.append("In-flight Wi-Fi available")

    refundable = flight.get("refundable")
    if refundable is True:
        pros.append("Refundable fare")
    elif refundable is False:
        cons.append("Non-refundable fare")

    if budget and float(flight.get("price") or 0) > budget:
        cons.append("Over budget")

    if not pros:
        pros.append("Balanced overall option")
    if not cons:
        cons.append("Not the absolute cheapest")

    return (pros[:4], cons[:3])


def _fallback_recommendation_explanation(flight: Dict[str, Any]) -> str:
    airline = flight.get("airline") or "This option"
    flight_number = flight.get("flight_number") or ""
    pros = flight.get("pros") or []
    key_reasons = ", ".join(pros[:3]) if pros else "a strong overall balance"
    return (
        f"{airline} {flight_number} is the best overall pick because it offers {key_reasons}. "
        "It ranks highly across price, travel time, reliability, and overall convenience."
    ).strip()
