"""Chat orchestration helpers for streaming and direct travel shortcuts."""

import json
import re
from typing import Any, Callable, Dict, List, Optional

from fastapi.responses import StreamingResponse

from services.flight_ai import get_iata, should_stream_chat_response, stream_chat_response_text
from services.flightaware_client import get_flight_status
from services.maps import get_destination_map_url
from services.weather import get_city_name, get_weather, get_weather_advice

_LOCATION_CAPTURE = r"([A-Za-z][A-Za-z\s.'-]{1,40})"
_DIRECT_FLIGHT_NUMBER_RE = re.compile(r"\b([A-Z0-9]{2,3}\s?\d{1,4})\b")

_FLIGHT_RESULT_FOLLOWUP_PATTERNS = re.compile(
    r"\b("
    r"cheapest|cheapest one|most expensive|priciest|"
    r"fastest|quickest|shortest flight|shortest duration|longest|"
    r"first one|second one|third one|fourth one|fifth one|"
    r"first flight|second flight|third flight|fourth flight|fifth flight|"
    r"option 1|option 2|option 3|option 4|option 5|"
    r"flight 1|flight 2|flight 3|flight 4|flight 5|"
    r"the first|the second|the third|the fourth|the fifth|"
    r"1st option|2nd option|3rd option|4th option|5th option|"
    r"which one|which is|compare|difference between|"
    r"no layover|no stop|nonstop one|direct one|direct flight|"
    r"with wifi|with meal|with food|with free|with baggage|with bag|"
    r"has wifi|has meal|has food|has bag|"
    r"book that|book this|book it|i.ll take|i.ll go with|"
    r"tell me more|more details|more about|more info|"
    r"show all|all options|remaining options|other options|"
    r"best value|best deal|most stops|fewest stops|"
    r"morning flight|evening flight|afternoon flight|night flight|"
    r"early flight|late flight|"
    r"refundable|non.refundable|cancellable"
    r")\b",
    re.IGNORECASE,
)

_ORDINAL_PATTERN = re.compile(
    r"\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\b",
    re.IGNORECASE,
)


def should_stream_response(message: str) -> bool:
    return should_stream_chat_response(message)


def _clean_location_candidate(value: Optional[str]) -> Optional[str]:
    cleaned = re.sub(r"\s+", " ", (value or "").strip())
    cleaned = re.sub(
        r"\b(?:today|tomorrow|now|right now|please|thanks|thank you)\b",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = cleaned.strip(" .,!?:;")
    return cleaned[:60] if cleaned else None


def _extract_first_location(message: str, patterns: List[str]) -> Optional[str]:
    for pattern in patterns:
        match = re.search(pattern, message or "", re.IGNORECASE)
        if match:
            location = _clean_location_candidate(match.group(1))
            if location:
                return location
    return None


def _extract_direct_weather_location(message: str) -> Optional[str]:
    if not re.search(
        r"\b(weather|temperature|forecast|raining|rain|snow|sunny|humid|windy|climate)\b",
        message or "",
        re.IGNORECASE,
    ):
        return None

    return _extract_first_location(
        message,
        [
            rf"\b(?:weather|temperature|forecast)\s+(?:in|for|at)\s+{_LOCATION_CAPTURE}",
            rf"\bis it (?:raining|snowing|sunny|humid|windy|hot|cold) in\s+{_LOCATION_CAPTURE}",
            rf"\b(?:in|for|at)\s+{_LOCATION_CAPTURE}\s+(?:weather|temperature|forecast)\b",
        ],
    )


def _extract_direct_map_location(message: str) -> Optional[str]:
    if not re.search(r"\b(map|directions|navigate|navigation)\b", message or "", re.IGNORECASE):
        return None

    return _extract_first_location(
        message,
        [
            rf"\bmap\s+(?:of|for)\s+{_LOCATION_CAPTURE}",
            rf"\b(?:directions|navigate|navigation)\s+(?:to|for)\s+{_LOCATION_CAPTURE}",
            rf"\bshow\s+(?:me\s+)?(?:the\s+)?map\s+(?:of|for)?\s*{_LOCATION_CAPTURE}",
        ],
    )


def _extract_direct_flight_number(message: str) -> Optional[str]:
    if not re.search(r"\b(status|track|tracking|where is|flight status)\b", message or "", re.IGNORECASE):
        return None

    match = _DIRECT_FLIGHT_NUMBER_RE.search((message or "").upper())
    if not match:
        return None

    return re.sub(r"\s+", "", match.group(1))


async def _build_weather_chat_response(
    location: str,
    sid: Optional[str],
    text_prefix: Optional[str] = None,
) -> Dict[str, Any]:
    location_iata = get_iata(location)
    dest_city = location
    try:
        dest_city = get_city_name(location_iata)
    except Exception:
        pass

    response: Dict[str, Any] = {
        "type": "flights",
        "text": text_prefix or f"Here's the latest weather for {dest_city}:",
        "session_id": sid,
        "flights": [],
    }

    try:
        weather_data = await get_weather(dest_city)
        if weather_data:
            response["weather"] = weather_data
            response["weather_advice"] = get_weather_advice(weather_data)
    except Exception:
        pass

    return response


async def _build_map_chat_response(
    location: str,
    sid: Optional[str],
    text_prefix: Optional[str] = None,
) -> Dict[str, Any]:
    location_iata = get_iata(location)
    dest_city = location
    try:
        dest_city = get_city_name(location_iata)
    except Exception:
        pass

    response: Dict[str, Any] = {
        "type": "flights",
        "text": text_prefix or f"Here's the map for {dest_city}:",
        "session_id": sid,
        "flights": [],
    }

    try:
        response["destination_map_url"] = get_destination_map_url(location_iata)
    except Exception:
        pass

    return response


async def _build_flight_status_chat_response(
    flight_number: str,
    sid: Optional[str],
    text_prefix: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        status_info = await get_flight_status(flight_number)
    except Exception as exc:
        status_info = f"I ran into a problem while checking that flight. {exc}"

    return {
        "type": "text",
        "text": f"{text_prefix}\n\n{status_info}".strip() if text_prefix else status_info.strip(),
        "session_id": sid,
    }


async def maybe_handle_direct_travel_request(
    message: str,
    sid: Optional[str],
) -> Optional[Dict[str, Any]]:
    weather_location = _extract_direct_weather_location(message)
    if weather_location:
        return await _build_weather_chat_response(weather_location, sid)

    map_location = _extract_direct_map_location(message)
    if map_location:
        return await _build_map_chat_response(map_location, sid)

    flight_number = _extract_direct_flight_number(message)
    if flight_number:
        return await _build_flight_status_chat_response(flight_number, sid)

    return None


def is_flight_result_followup(msg: str, recent_flights: List[Dict[str, Any]]) -> bool:
    if not recent_flights:
        return False

    lowered = (msg or "").lower().strip()
    if _FLIGHT_RESULT_FOLLOWUP_PATTERNS.search(lowered):
        return True
    if _ORDINAL_PATTERN.search(lowered):
        return True
    return False


def _encode_chat_stream_event(event: str, payload: Dict[str, Any]) -> bytes:
    return (json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n").encode("utf-8")


def build_streaming_chat_response(
    *,
    message: str,
    sid: Optional[str],
    history: List[Dict[str, str]],
    user_city: Optional[str],
    recent_flights: List[Dict[str, Any]],
    persist_chat_exchange: Callable[[Dict[str, Any]], None],
    on_final_text: Optional[Callable[[str], None]] = None,
) -> StreamingResponse:
    async def stream_text():
        yield _encode_chat_stream_event(
            "start",
            {"response": {"type": "text", "session_id": sid}},
        )

        try:
            chunks: List[str] = []
            for chunk in stream_chat_response_text(
                message,
                history,
                user_city=user_city,
                recent_flights=recent_flights,
            ):
                if not chunk:
                    continue
                chunks.append(chunk)
                yield _encode_chat_stream_event("delta", {"delta": chunk})

            final_text = "".join(chunks).strip()
            if not final_text:
                final_text = "I ran into a temporary issue while answering. Please try again in a moment."

            if on_final_text:
                on_final_text(final_text)

            response = {"type": "text", "text": final_text, "session_id": sid}
            persist_chat_exchange(response)
            yield _encode_chat_stream_event("final", {"response": response})
        except Exception:
            response = {
                "type": "text",
                "text": "I ran into a temporary issue while answering. Please try again in a moment.",
                "session_id": sid,
            }
            persist_chat_exchange(response)
            yield _encode_chat_stream_event("final", {"response": response})

    return StreamingResponse(
        stream_text(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
