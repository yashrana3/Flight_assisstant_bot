"""
Two-database setup:
- User DB: users, trips, alerts, travel docs, settings, stats, consent, feedback (CRUD + login details).
- Chat DB: chat_sessions, chat_messages, guest_passenger_profiles (sessions and chats by user_id).
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool

load_dotenv()

# Resolve database URLs strictly from environment (no hardcoded credentials).
# Prefer explicit USER_DATABASE_URL / CHAT_DATABASE_URL, falling back to a shared DATABASE_URL.
DEFAULT_DATABASE_URL = os.getenv("DATABASE_URL")

# User DB: user details, trips, price alerts, preferences, settings, stats, consent, feedback
USER_DATABASE_URL = os.getenv("USER_DATABASE_URL", DEFAULT_DATABASE_URL)
# Chat DB: fall back to the user DB when a separate chat DB is not configured.
CHAT_DATABASE_URL = (
    os.getenv("CHAT_DATABASE_URL")
    or USER_DATABASE_URL
    or DEFAULT_DATABASE_URL
)

def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


# Vercel/serverless instances should not hold onto connection pools between
# invocations. Supabase session poolers can reject new sessions when many warm
# lambdas each retain idle pooled connections, so default to NullPool there.
_db_pool_mode = os.getenv("DB_POOL_MODE", "").strip().lower()
_use_null_pool = _db_pool_mode == "null" or (
    _db_pool_mode == "" and _env_flag("VERCEL")
)

if _use_null_pool:
    _engine_kwargs = {
        "echo": False,
        "poolclass": NullPool,
    }
else:
    # QueuePool is still fine for long-lived local/dev processes.
    _engine_kwargs = {
        "echo": False,
        "pool_pre_ping": True,
        "pool_recycle": int(os.getenv("DB_POOL_RECYCLE", "1800")),
    "pool_size": int(os.getenv("DB_POOL_SIZE", "2")),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "3")),
        "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "30")),
    }

engine_user = (
    create_engine(USER_DATABASE_URL, **_engine_kwargs)
    if USER_DATABASE_URL
    else None
)
engine_chat = (
    create_engine(CHAT_DATABASE_URL, **_engine_kwargs)
    if CHAT_DATABASE_URL
    else None
)

SessionUser = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine_user,
)
SessionChat = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine_chat,
)

BaseUser = declarative_base()
BaseChat = declarative_base()


def _safe_close_session(db) -> None:
    """Close session; if the DB connection is already dead, avoid secondary OperationalErrors on rollback."""
    try:
        db.close()
    except DBAPIError:
        pass


def _ensure_user_db_configured() -> None:
    if engine_user is None:
        raise RuntimeError(
            "USER_DATABASE_URL or DATABASE_URL must be set in the environment for the User DB."
        )


def _ensure_chat_db_configured() -> None:
    if engine_chat is None:
        raise RuntimeError(
            "CHAT_DATABASE_URL or DATABASE_URL must be set in the environment for the Chat DB."
        )


def get_user_db():
    """FastAPI dependency: yields a session for the User DB (users, trips, alerts, etc.)."""
    _ensure_user_db_configured()
    db = SessionUser()
    try:
        yield db
    finally:
        _safe_close_session(db)


def get_chat_db():
    """FastAPI dependency: yields a session for the Chat DB (sessions, messages)."""
    _ensure_chat_db_configured()
    db = SessionChat()
    try:
        yield db
    finally:
        _safe_close_session(db)


# Backward compatibility: default get_db points to user DB for routes that only need user data
get_db = get_user_db
