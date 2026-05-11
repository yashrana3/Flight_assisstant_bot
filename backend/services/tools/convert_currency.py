"""Async currency conversion tool."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, Field, model_validator

from services.currency_rates import fetch_exchange_rate
from services.tools.async_base import AsyncBaseTool
from services.tools.context import ToolExecutionContext


class ConvertCurrencyInput(BaseModel):
    amount: float | None = None
    amounts: list[float] = Field(default_factory=list)
    source_currency: str
    target_currency: str
    max_age_minutes: int = Field(default=180, ge=1, le=1440)

    @model_validator(mode="after")
    def validate_payload(self) -> "ConvertCurrencyInput":
        if self.amount is None and not self.amounts:
            raise ValueError("Either amount or amounts must be provided.")
        if self.amount is not None and self.amount < 0:
            raise ValueError("amount must be >= 0")
        if any(item < 0 for item in self.amounts):
            raise ValueError("all amounts must be >= 0")
        return self


class ConvertCurrencyTool(AsyncBaseTool[ConvertCurrencyInput]):
    name = "convert_currency"
    description = "Convert one or many amounts between currencies with rate metadata."
    input_model = ConvertCurrencyInput

    def __init__(
        self,
        *,
        rate_resolver: Callable[..., Awaitable[dict[str, Any] | None]] = fetch_exchange_rate,
    ) -> None:
        self._rate_resolver = rate_resolver

    async def run(
        self,
        payload: ConvertCurrencyInput,
        context: ToolExecutionContext,
    ) -> dict:
        source = payload.source_currency.upper().strip()
        target = payload.target_currency.upper().strip()
        rate_data = await self._rate_resolver(
            source_currency=source,
            target_currency=target,
        )
        if not rate_data:
            raise ValueError(f"Exchange rate unavailable for {source} -> {target}.")

        rate = float(rate_data["rate"])
        provider_timestamp = self._as_utc(rate_data.get("provider_timestamp"))
        age_minutes = max(
            0.0,
            (datetime.now(timezone.utc) - provider_timestamp).total_seconds() / 60.0,
        )
        is_stale = age_minutes > payload.max_age_minutes

        input_amounts = list(payload.amounts)
        if payload.amount is not None:
            input_amounts.insert(0, payload.amount)
        converted_amounts = [round(value * rate, 2) for value in input_amounts]

        return {
            "source_currency": source,
            "target_currency": target,
            "rate": rate,
            "provider": rate_data.get("provider") or "unknown",
            "fetched_at": rate_data.get("fetched_at"),
            "provider_timestamp": provider_timestamp.isoformat(),
            "age_minutes": round(age_minutes, 2),
            "is_stale": is_stale,
            "max_age_minutes": payload.max_age_minutes,
            "converted_amounts": converted_amounts,
            "converted_amount": converted_amounts[0] if payload.amount is not None else None,
        }

    @staticmethod
    def _as_utc(raw: Any) -> datetime:
        if isinstance(raw, datetime):
            if raw.tzinfo is None:
                return raw.replace(tzinfo=timezone.utc)
            return raw.astimezone(timezone.utc)
        if isinstance(raw, str):
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=timezone.utc)
                return parsed.astimezone(timezone.utc)
            except ValueError:
                pass
        return datetime.now(timezone.utc)
