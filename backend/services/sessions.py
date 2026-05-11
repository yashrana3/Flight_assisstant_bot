"""DB-backed chat session / message storage using SQLAlchemy."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from models.chat import ChatSession, ChatMessage
from services.chat_titles import build_fallback_chat_title

_SESSION_USER_NAMESPACE = uuid.UUID("8af7be1f-66b0-4c6b-b0fa-5b9dd2fb6a7f")


def to_session_user_uuid(user_id: str) -> uuid.UUID:
    """
    Map any authenticated user id to a stable UUID for chat DB rows.
    Supports both UUID-shaped ids and arbitrary text ids.
    """
    try:
        return uuid.UUID(user_id)
    except (TypeError, ValueError):
        return uuid.uuid5(_SESSION_USER_NAMESPACE, str(user_id))


def _parse_optional_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed


def create_session(db: Session, user_id: Optional[str] = None) -> dict:
    """Create a new conversation session in the database."""
    session = ChatSession(
        id=uuid.uuid4(),
        user_id=to_session_user_uuid(user_id) if user_id else None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "session_id": str(session.id),
        "created_at": session.created_at.isoformat() if session.created_at else datetime.utcnow().isoformat(),
    }


def get_session(db: Session, session_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Get a session by ID with all its messages. If user_id is set, return None unless the session belongs to that user."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        return None

    q = db.query(ChatSession).filter(ChatSession.id == sid)
    if user_id:
        uid = to_session_user_uuid(user_id)
        q = q.filter(ChatSession.user_id == uid)
    session = q.first()
    if not session:
        return None

    messages = [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "msg_type": m.msg_type or "text",
            "metadata": m.metadata_ or {},
            "timestamp": m.created_at.isoformat() if m.created_at else None,
        }
        for m in session.messages
    ]

    return {
        "id": str(session.id),
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "messages": messages,
    }


def add_message(
    db: Session,
    session_id: str,
    role: str,
    content: str,
    metadata: dict = None,
    user_id: Optional[str] = None,
) -> dict:
    """Add a message to a session. Auto-sets session title from first user message."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        return {}

    q = db.query(ChatSession).filter(ChatSession.id == sid)
    if user_id:
        uid = to_session_user_uuid(user_id)
        q = q.filter(ChatSession.user_id == uid)

    session = q.first()
    if not session:
        return {}

    msg = ChatMessage(
        id=uuid.uuid4(),
        session_id=sid,
        role=role,
        content=content,
        msg_type=(metadata or {}).get("type", "text"),
        metadata_=metadata,
    )
    db.add(msg)

    # Auto-set a short sidebar title from the first user message
    if role == "user" and not session.title:
        session.title = build_fallback_chat_title([{"role": role, "content": content}])

    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(msg)

    return {
        "id": str(msg.id),
        "role": msg.role,
        "content": msg.content,
        "timestamp": msg.created_at.isoformat() if msg.created_at else None,
    }


def import_sessions(db: Session, user_id: str, sessions: list[dict[str, Any]]) -> dict:
    """Import cached guest sessions into the DB for a newly created user."""
    uid = to_session_user_uuid(user_id)
    imported = 0
    skipped = 0

    for session_payload in sessions:
        raw_session_id = session_payload.get("id")
        try:
            session_uuid = uuid.UUID(str(raw_session_id)) if raw_session_id else uuid.uuid4()
        except ValueError:
            session_uuid = uuid.uuid4()

        existing = db.query(ChatSession).filter(ChatSession.id == session_uuid).first()
        if existing:
            if existing.user_id == uid:
                skipped += 1
                continue
            session_uuid = uuid.uuid4()

        raw_messages = session_payload.get("messages") or []
        messages = raw_messages if isinstance(raw_messages, list) else []
        first_user_message = next(
            (
                str(message.get("content") or "").strip()
                for message in messages
                if str(message.get("role") or "") == "user" and str(message.get("content") or "").strip()
            ),
            "",
        )

        updated_at = _parse_optional_datetime(session_payload.get("updated_at")) or datetime.utcnow()
        created_at = updated_at - timedelta(milliseconds=max(len(messages) - 1, 0))
        title = str(session_payload.get("title") or "").strip() or None
        if not title and first_user_message:
            title = build_fallback_chat_title([{"role": "user", "content": first_user_message}])

        session = ChatSession(
            id=session_uuid,
            user_id=uid,
            title=title[:255] if title else None,
            created_at=created_at,
            updated_at=updated_at,
        )
        db.add(session)

        for index, message_payload in enumerate(messages):
            content = str(message_payload.get("content") or "")
            role = str(message_payload.get("role") or "assistant")[:20]
            raw_metadata = message_payload.get("metadata")
            metadata = raw_metadata if isinstance(raw_metadata, dict) else None
            message_time = created_at + timedelta(milliseconds=index)
            db.add(
                ChatMessage(
                    id=uuid.uuid4(),
                    session_id=session_uuid,
                    role=role,
                    content=content,
                    msg_type=(metadata or {}).get("type", "text"),
                    metadata_=metadata,
                    created_at=message_time,
                )
            )

        imported += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}


def list_sessions(db: Session, user_id: Optional[str] = None, limit: int = 20) -> list:
    """List recent sessions with summary info. If user_id is set, filter to that user."""
    q = db.query(ChatSession).order_by(ChatSession.updated_at.desc())
    if user_id:
        uid = to_session_user_uuid(user_id)
        q = q.filter(ChatSession.user_id == uid)
    sessions = q.limit(limit).all()

    results = []
    for s in sessions:
        msg_count = len(s.messages)
        # Preview = session title or first user message
        preview = s.title or "New conversation"
        results.append({
            "id": str(s.id),
            "title": s.title,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            "message_count": msg_count,
            "preview": preview,
        })

    return results


def delete_session(db: Session, session_id: str, user_id: Optional[str] = None) -> bool:
    """Delete a session. Returns True if deleted, False if not found."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        return False

    q = db.query(ChatSession).filter(ChatSession.id == sid)
    if user_id:
        uid = to_session_user_uuid(user_id)
        q = q.filter(ChatSession.user_id == uid)

    session = q.first()
    if not session:
        return False

    db.delete(session)
    db.commit()
    return True
