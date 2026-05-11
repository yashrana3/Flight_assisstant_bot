import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dateutil import parser as date_parser
from dotenv import load_dotenv

from services.flight_ai import get_iata


load_dotenv()


AMADEUS_CLIENT_ID = os.getenv("AMADEUS_CLIENT_ID", "")
AMADEUS_CLIENT_SECRET = os.getenv("AMADEUS_CLIENT_SECRET", "")
AMADEUS_ENV = os.getenv("AMADEUS_ENV", "test").lower()
logger = logging.getLogger(__name__)


class AmadeusError(Exception):
    pass


@dataclass
class FlightSearchParams:
    origin: str
    destination: str
    depart_date: str
    return_date: str | None
    adults: int
    currency: str
    max_price: float | None
    cabin: str | None


async def _get_access_token(client: httpx.AsyncClient) -> str:
    if not AMADEUS_CLIENT_ID or not AMADEUS_CLIENT_SECRET:
        raise AmadeusError(
            "Amadeus credentials missing; set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET",
        )

    base_url = (
        "https://test.api.amadeus.com"
        if AMADEUS_ENV != "production"
        else "https://api.amadeus.com"
    )
    resp = await client.post(
        f"{base_url}/v1/security/oauth2/token",
        data={
            "grant_type": "client_credentials",
            "client_id": AMADEUS_CLIENT_ID,
            "client_secret": AMADEUS_CLIENT_SECRET,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("access_token")


async def search_flights_amadeus(
    params: FlightSearchParams,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Call Amadeus Flight Offers Search. Returns (normalized list, reason_if_empty).
    """
    base_url = (
        "https://test.api.amadeus.com"
        if AMADEUS_ENV != "production"
        else "https://api.amadeus.com"
    )
    origin_iata = get_iata(params.origin)
    dest_iata = get_iata(params.destination)
    reason: Optional[str] = None

    async with httpx.AsyncClient() as client:
        try:
            token = await _get_access_token(client)
        except Exception as e:
            reason = f"Amadeus auth failed: {e}"
            logger.warning("Amadeus: %s", reason)
            return ([], reason)

        query: Dict[str, Any] = {
            "originLocationCode": origin_iata,
            "destinationLocationCode": dest_iata,
            "departureDate": params.depart_date,
            "adults": str(max(params.adults, 1)),
            "currencyCode": params.currency.upper(),
            "max": "20",
        }
        if params.return_date:
            query["returnDate"] = params.return_date
        if params.max_price:
            query["maxPrice"] = str(int(params.max_price))

        logger.info(
            "Amadeus request: origin=%s dest=%s date=%s env=%s",
            origin_iata,
            dest_iata,
            params.depart_date,
            AMADEUS_ENV,
        )

        headers = {"Authorization": f"Bearer {token}"}

        try:
            resp = await client.get(
                f"{base_url}/v2/shopping/flight-offers",
                params=query,
                headers=headers,
                timeout=15.0,
            )
            if resp.status_code != 200:
                try:
                    err_body = resp.json()
                    err_msg = err_body.get("errors", [{}])[0].get(
                        "detail",
                        resp.text[:200],
                    )
                except Exception:
                    err_msg = resp.text[:200] if resp.text else str(resp.status_code)
                reason = f"Amadeus HTTP {resp.status_code}: {err_msg}"
                logger.warning("Amadeus: %s", reason)
                return ([], reason)
            data = resp.json()
        except Exception as e:
            reason = f"Amadeus request error: {e}"
            logger.warning("Amadeus: %s", reason)
            return ([], reason)

    offers = data.get("data", []) or []
    if not offers:
        reason = (
            f"Amadeus returned 0 offers for {origin_iata}→{dest_iata} on {params.depart_date}. "
            "Test API has limited routes/dates; production has full inventory."
        )
        logger.info("Amadeus: %s", reason)
    dictionaries = data.get("dictionaries", {})
    carriers = dictionaries.get("carriers", {})
    locations = dictionaries.get("locations", {})

    normalized: List[Dict[str, Any]] = []

    for offer in offers:
        itineraries = offer.get("itineraries", [])
        if not itineraries:
            continue

        itin = itineraries[0]
        segments = itin.get("segments", [])
        if not segments:
            continue

        first = segments[0]
        last = segments[-1]
        dep_time_iso = first.get("departure", {}).get("at")
        arr_time_iso = last.get("arrival", {}).get("at")

        try:
            dep_dt = date_parser.isoparse(dep_time_iso) if dep_time_iso else None
            arr_dt = date_parser.isoparse(arr_time_iso) if arr_time_iso else None
        except Exception:
            dep_dt = arr_dt = None

        marketing_carrier = first.get("carrierCode")
        airline_name = carriers.get(marketing_carrier, marketing_carrier or "")
        flight_number = (
            f"{marketing_carrier} {first.get('number')}"
            if marketing_carrier and first.get("number")
            else ""
        )

        from_iata = first.get("departure", {}).get("iataCode", origin_iata)
        to_iata = last.get("arrival", {}).get("iataCode", dest_iata)

        from_loc = locations.get(from_iata, {})
        to_loc = locations.get(to_iata, {})

        price_info = offer.get("price", {})
        total_price = float(
            price_info.get("grandTotal") or price_info.get("total") or 0.0,
        )
        base_price = (
            float(price_info.get("base") or 0.0)
            if price_info.get("base")
            else None
        )
        currency = price_info.get("currency", params.currency.upper())
        price_taxes = None
        try:
            fees = price_info.get("fees") or []
            if fees:
                price_taxes = sum(float(item.get("amount") or 0.0) for item in fees)
        except Exception:
            price_taxes = None

        included_bags = ""
        meal_services: List[str] = []
        refundable = None
        change_penalty = ""
        fare_family = ""
        try:
            fare = (offer.get("travelerPricings") or [])[0]
            fare_details = (fare.get("fareDetailsBySegment") or [])[0]
            cabin = fare_details.get("cabin")
            fare_family = fare_details.get("fareBasis", "")

            # Extract checked baggage — Amadeus uses either weight (kg) or quantity (pieces)
            bags_info = fare_details.get("includedCheckedBags") or {}
            bags_qty = bags_info.get("quantity")
            bags_weight = bags_info.get("weight")
            bags_weight_unit = bags_info.get("weightUnit", "KG")
            if bags_weight and float(bags_weight) > 0:
                included_bags = f"{int(bags_weight)}{bags_weight_unit}"
            elif bags_qty and int(bags_qty) > 0:
                included_bags = f"{int(bags_qty)} piece{'s' if int(bags_qty) > 1 else ''}"

            # Extract meal and amenity services from Amadeus amenities list
            amenities = fare_details.get("amenities") or []
            for amenity in amenities:
                amenity_type = str(amenity.get("amenityType") or "").upper()
                description = str(amenity.get("description") or "").lower()
                is_chargeable = amenity.get("isChargeable", True)
                if amenity_type == "MEAL" or "meal" in description or "food" in description:
                    if not is_chargeable:
                        meal_services.append("Complimentary meal")
                    else:
                        meal_services.append("Meal for purchase")
                elif amenity_type == "ENTERTAINMENT" or "entertainment" in description:
                    if not is_chargeable:
                        meal_services.append("In-flight entertainment")
                elif amenity_type == "WIFI" or "wifi" in description or "wi-fi" in description:
                    if not is_chargeable:
                        meal_services.append("Free Wi-Fi")
                    else:
                        meal_services.append("Wi-Fi for purchase")
        except Exception:
            cabin = None

        normalized_segments = []
        for seg in segments:
            dep = seg.get("departure", {})
            arr = seg.get("arrival", {})
            marketing = seg.get("carrierCode")
            normalized_segments.append(
                {
                    "marketingCarrier": marketing,
                    "operatingCarrier": (seg.get("operating") or {}).get(
                        "carrierCode",
                    )
                    or marketing,
                    "flightNumber": (
                        f"{marketing} {seg.get('number')}"
                        if marketing and seg.get("number")
                        else seg.get("number")
                    ),
                    "aircraft": (seg.get("aircraft") or {}).get("code"),
                    "departureAt": dep.get("at"),
                    "arrivalAt": arr.get("at"),
                    "originIata": dep.get("iataCode"),
                    "destinationIata": arr.get("iataCode"),
                    "terminalDeparture": dep.get("terminal"),
                    "terminalArrival": arr.get("terminal"),
                },
            )

        normalized.append(
            {
                "provider": "amadeus",
                "provider_offer_id": offer.get("id"),
                "airline": airline_name,
                "airline_code": marketing_carrier,
                "flight_number": flight_number,
                "from_iata": from_iata,
                "to_iata": to_iata,
                "from_city": from_loc.get("cityName") or from_iata,
                "to_city": to_loc.get("cityName") or to_iata,
                "departure_time": dep_dt.isoformat() if dep_dt else dep_time_iso,
                "arrival_time": arr_dt.isoformat() if arr_dt else arr_time_iso,
                "duration": itin.get("duration", ""),
                "stops": max(len(segments) - 1, 0),
                "stop_cities": [
                    seg.get("arrival", {}).get("iataCode") for seg in segments[:-1]
                ],
                "cabin_class": cabin or params.cabin or "ECONOMY",
                "fare_family": fare_family,
                "baggage_cabin": "Standard cabin bag",
                "baggage_checked": included_bags or "",
                "baggage_pieces": (
                    1
                    if included_bags and "piece" in included_bags
                    else (0 if not included_bags else None)
                ),
                "meal_services": meal_services,
                "price_total": total_price,
                "price_base": base_price,
                "price_taxes": price_taxes,
                "price_per_person": (
                    total_price / max(params.adults, 1) if total_price else 0.0
                ),
                "currency": currency,
                "refundable": refundable,
                "change_penalty": change_penalty,
                "perks": list(meal_services),
                "segments": normalized_segments,
                "aircraft": (
                    (segments[0].get("aircraft") or {}).get("code")
                    if segments
                    else None
                ),
                "raw_offer": offer,
            },
        )

    return (normalized, reason)


async def confirm_flight_price(
    flight_offer: Dict[str, Any],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Call Amadeus Flight Offers Price to verify live price and availability.
    Input: raw flight offer dictionary.
    Returns: (confirmed_offer, reason_if_failed).
    """
    base_url = (
        "https://test.api.amadeus.com"
        if AMADEUS_ENV != "production"
        else "https://api.amadeus.com"
    )
    async with httpx.AsyncClient() as client:
        try:
            token = await _get_access_token(client)
        except Exception as e:
            return (None, f"Amadeus auth failed: {e}")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        payload = {
            "data": {
                "type": "flight-offers-pricing",
                "flightOffers": [flight_offer],
            },
        }
        try:
            resp = await client.post(
                f"{base_url}/v1/shopping/flight-offers/pricing",
                headers=headers,
                json=payload,
                timeout=20.0,
            )
            if resp.status_code != 200:
                try:
                    err_body = resp.json()
                    err_msg = err_body.get("errors", [{}])[0].get(
                        "detail",
                        resp.text[:200],
                    )
                except Exception:
                    err_msg = resp.text[:200] if resp.text else str(resp.status_code)
                return (None, f"Amadeus Price HTTP {resp.status_code}: {err_msg}")
            data = resp.json()
            offers = data.get("data", {}).get("flightOffers") or data.get("data") or []
            confirmed = offers[0] if isinstance(offers, list) and offers else data.get("data")
            return (confirmed, None)
        except Exception as e:
            return (None, f"Amadeus price verification error: {e}")


async def get_seatmap_by_offer(
    flight_offer: Dict[str, Any],
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """
    Fetch seatmaps for a given Amadeus flight offer.
    Returns: (seatmaps_list, reason_if_failed).
    """
    base_url = (
        "https://test.api.amadeus.com"
        if AMADEUS_ENV != "production"
        else "https://api.amadeus.com"
    )
    async with httpx.AsyncClient() as client:
        try:
            token = await _get_access_token(client)
        except Exception as e:
            return (None, f"Amadeus auth failed: {e}")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        payload = {"data": [flight_offer]}
        try:
            resp = await client.post(
                f"{base_url}/v1/shopping/seatmaps",
                headers=headers,
                json=payload,
                timeout=20.0,
            )
            if resp.status_code != 200:
                try:
                    err_body = resp.json()
                    err_msg = err_body.get("errors", [{}])[0].get(
                        "detail",
                        resp.text[:200],
                    )
                except Exception:
                    err_msg = resp.text[:200] if resp.text else str(resp.status_code)
                return (None, f"Amadeus SeatMap HTTP {resp.status_code}: {err_msg}")
            data = resp.json()
            return (data.get("data") or [], None)
        except Exception as e:
            return (None, f"Amadeus seatmap error: {e}")
