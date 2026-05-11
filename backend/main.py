import json
import logging
import os
import re
import time
import uuid
from threading import Lock
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router as api_router
from sqlalchemy import text

from database import SessionUser, engine_user

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CORS origins — read from environment so nothing is hardcoded
# Set ALLOWED_ORIGINS as a comma-separated list in production, e.g.:
#   ALLOWED_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com
# ---------------------------------------------------------------------------
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS: list[str] = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else []
)

# In development fall back to the local Next.js dev server only
if not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000","http://localhost:3001"]

AUTO_CREATE_TABLES = os.getenv("AUTO_CREATE_TABLES", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if AUTO_CREATE_TABLES:
        import models  # noqa: F401 — register all ORM tables on BaseUser / BaseChat metadata
        from database import BaseUser, BaseChat, engine_chat, engine_user

        BaseUser.metadata.create_all(bind=engine_user)
        BaseChat.metadata.create_all(bind=engine_chat)
    yield


_app_kwargs = dict(
    title="Book With AI API",
    description="AI-powered travel assistant backend",
    version="1.0.0",
)

if AUTO_CREATE_TABLES:
    # Avoid DDL on every Vercel cold start. Use migrations in deployed envs,
    # and opt into auto-create locally when needed.
    _app_kwargs["lifespan"] = lifespan

app = FastAPI(**_app_kwargs)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

app.include_router(api_router, prefix="/api")

_MONITORING_TABLE_READY = False
_MONITORING_LOCK = Lock()
_HASH_RE = re.compile(r"^[A-Za-z0-9_\-]{20,}$")


def _ensure_monitoring_table() -> None:
    global _MONITORING_TABLE_READY
    if _MONITORING_TABLE_READY or engine_user is None:
        return
    with _MONITORING_LOCK:
        if _MONITORING_TABLE_READY or engine_user is None:
            return
        with engine_user.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS api_request_logs (
                      id UUID PRIMARY KEY,
                      request_id VARCHAR(64),
                      method VARCHAR(16) NOT NULL,
                      path VARCHAR(255) NOT NULL,
                      status_code INTEGER NOT NULL,
                      latency_ms INTEGER NOT NULL,
                      query_params JSONB,
                      provider VARCHAR(64),
                      api_key_name VARCHAR(128),
                      api_key_last4 VARCHAR(8),
                      user_id VARCHAR(64),
                      client_ip VARCHAR(64),
                      user_agent TEXT,
                      error_message TEXT,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS api_metrics_1m (
                      bucket_start TIMESTAMP NOT NULL,
                      method VARCHAR(16) NOT NULL,
                      path VARCHAR(255) NOT NULL,
                      provider VARCHAR(64) NOT NULL,
                      request_count INTEGER NOT NULL DEFAULT 0,
                      success_count INTEGER NOT NULL DEFAULT 0,
                      error_count INTEGER NOT NULL DEFAULT 0,
                      total_latency_ms BIGINT NOT NULL DEFAULT 0,
                      max_latency_ms INTEGER NOT NULL DEFAULT 0,
                      PRIMARY KEY (bucket_start, method, path, provider)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS api_key_registry (
                      key_name VARCHAR(128) PRIMARY KEY,
                      provider VARCHAR(64) NOT NULL,
                      status VARCHAR(24) NOT NULL DEFAULT 'active',
                      key_last4 VARCHAR(8),
                      last_used_at TIMESTAMP NULL,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS api_provider_config (
                      provider VARCHAR(64) PRIMARY KEY,
                      quota_daily INTEGER NOT NULL DEFAULT 0,
                      cost_per_request NUMERIC(12, 6) NOT NULL DEFAULT 0,
                      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
                      is_active BOOLEAN NOT NULL DEFAULT TRUE,
                      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at ON api_request_logs (created_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_request_logs_path ON api_request_logs (path)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_request_logs_status_code ON api_request_logs (status_code)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_key_registry_provider ON api_key_registry (provider)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_key_registry_last_used_at ON api_key_registry (last_used_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_provider_config_active ON api_provider_config (is_active)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_metrics_1m_bucket_start ON api_metrics_1m (bucket_start)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_api_metrics_1m_path ON api_metrics_1m (path)"))
        _MONITORING_TABLE_READY = True


def _provider_for_path(path: str) -> str:
    p = (path or "").lower()
    if p.startswith("/api/admin/"):
        return "Admin"
    if "/chat" in p or "/ai/" in p:
        return "Chat"
    if "/sessions" in p:
        return "Sessions"
    if "/price-alert" in p or "/price_alert" in p or "/alert" in p:
        return "Price Alerts"
    if "/trip" in p:
        return "Trips"
    if "serp" in p:
        return "SerpAPI"
    if "amadeus" in p or "flight-search" in p or "/flights" in p:
        return "Amadeus"
    if "weather" in p:
        return "OpenWeather"
    if "map" in p or "geocode" in p or "directions" in p:
        return "Google Maps"
    if "flightaware" in p:
        return "FlightAware"
    if "auth" in p or "register" in p or "login" in p or "otp" in p:
        return "Auth"
    if "/health" in p:
        return "Health"
    if "/frontend" in p:
        return "Frontend"
    if "/api/" in p:
        return "OpenAI"
    return "Internal"


def _key_name_for_provider(provider: str) -> str:
    mapping = {
        "Admin": "ADMIN_API_TOKEN",
        "Chat": "OPENAI_API_KEY",
        "Sessions": "SESSION_SERVICE",
        "Trips": "TRIP_SERVICE",
        "Price Alerts": "PRICE_ALERT_SERVICE",
        "SerpAPI": "SERPAPI_API_KEY",
        "Amadeus": "AMADEUS_CLIENT_SECRET",
        "OpenWeather": "OPENWEATHER_API_KEY",
        "Google Maps": "GOOGLE_MAPS_API_KEY",
        "FlightAware": "FLIGHTAWARE_API_KEY",
        "Auth": "JWT_SECRET",
        "Health": "HEALTH_PROBE",
        "Frontend": "FRONTEND_PROXY",
        "OpenAI": "OPENAI_API_KEY",
        "Internal": "INTERNAL_BACKEND",
    }
    return mapping.get(provider, "INTERNAL_BACKEND")


def _safe_last4(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.startswith("Bearer "):
        cleaned = cleaned[7:].strip()
    if _HASH_RE.match(cleaned):
        return cleaned[-4:]
    # Keep non-hash secrets masked but still traceable in monitoring.
    if len(cleaned) >= 8:
        return cleaned[-4:]
    return None


@app.middleware("http")
async def api_request_logging(request: Request, call_next) -> Response:
    started = time.perf_counter()
    response: Response | None = None
    error_message = None
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception as exc:
        error_message = str(exc)
        logger.exception(
            "Unhandled API error on %s %s",
            request.method,
            request.url.path,
        )
        raise
    finally:
        path = request.url.path or ""
        if path.startswith("/api/"):
            latency_ms = max(int((time.perf_counter() - started) * 1000), 0)
            try:
                _ensure_monitoring_table()
                if _MONITORING_TABLE_READY and engine_user is not None:
                    provider = _provider_for_path(path)
                    key_name = _key_name_for_provider(provider)
                    auth_header = request.headers.get("authorization")
                    x_admin_token = request.headers.get("x-admin-token")
                    key_last4 = _safe_last4(auth_header) or _safe_last4(x_admin_token)
                    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
                    query_params = dict(request.query_params)
                    db = SessionUser()
                    try:
                        db.execute(
                            text(
                                """
                                INSERT INTO api_request_logs (
                                  id, request_id, method, path, status_code, latency_ms, query_params,
                                  provider, api_key_name, api_key_last4, user_id, client_ip, user_agent, error_message, created_at
                                ) VALUES (
                                  :id, :request_id, :method, :path, :status_code, :latency_ms, CAST(:query_params AS JSONB),
                                  :provider, :api_key_name, :api_key_last4, :user_id, :client_ip, :user_agent, :error_message, NOW()
                                )
                                """
                            ),
                            {
                                "id": str(uuid.uuid4()),
                                "request_id": request.headers.get("x-request-id"),
                                "method": request.method,
                                "path": path,
                                "status_code": status_code,
                                "latency_ms": latency_ms,
                                "query_params": "{}" if not query_params else json.dumps(query_params),
                                "provider": provider,
                                "api_key_name": key_name,
                                "api_key_last4": key_last4,
                                "user_id": request.headers.get("x-user-id"),
                                "client_ip": (client_ip or "").split(",")[0].strip()[:64] or None,
                                "user_agent": request.headers.get("user-agent"),
                                "error_message": error_message,
                            },
                        )
                        db.execute(
                            text(
                                """
                                INSERT INTO api_metrics_1m (
                                  bucket_start, method, path, provider, request_count,
                                  success_count, error_count, total_latency_ms, max_latency_ms
                                ) VALUES (
                                  date_trunc('minute', NOW()), :method, :path, :provider, 1,
                                  :success_inc, :error_inc, :latency_ms, :latency_ms
                                )
                                ON CONFLICT (bucket_start, method, path, provider)
                                DO UPDATE SET
                                  request_count = api_metrics_1m.request_count + 1,
                                  success_count = api_metrics_1m.success_count + EXCLUDED.success_count,
                                  error_count = api_metrics_1m.error_count + EXCLUDED.error_count,
                                  total_latency_ms = api_metrics_1m.total_latency_ms + EXCLUDED.total_latency_ms,
                                  max_latency_ms = GREATEST(api_metrics_1m.max_latency_ms, EXCLUDED.max_latency_ms)
                                """
                            ),
                            {
                                "method": request.method,
                                "path": path,
                                "provider": provider,
                                "success_inc": 1 if status_code < 400 else 0,
                                "error_inc": 1 if status_code >= 400 else 0,
                                "latency_ms": latency_ms,
                            },
                        )
                        db.execute(
                            text(
                                """
                                INSERT INTO api_key_registry (
                                  key_name, provider, status, key_last4, last_used_at, updated_at
                                ) VALUES (
                                  :key_name, :provider, 'active', :key_last4, NOW(), NOW()
                                )
                                ON CONFLICT (key_name) DO UPDATE SET
                                  provider = EXCLUDED.provider,
                                  status = 'active',
                                  key_last4 = COALESCE(EXCLUDED.key_last4, api_key_registry.key_last4),
                                  last_used_at = NOW(),
                                  updated_at = NOW()
                                """
                            ),
                            {
                                "key_name": key_name,
                                "provider": provider,
                                "key_last4": key_last4,
                            },
                        )
                        db.commit()
                    finally:
                        db.close()
            except Exception:
                pass

    if response is None:
        return Response(status_code=status_code)
    return response
