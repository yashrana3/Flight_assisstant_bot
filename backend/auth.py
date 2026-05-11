"""Auth dependencies for FastAPI.

Supports either:
- trusted internal proxy headers from Next.js (`X-User-Id`, `X-Internal-Auth`)
- legacy Bearer JWTs with `sub = user_id`
"""

import os
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET") or os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM = "HS256"
INTERNAL_PROXY_SECRET = os.getenv("BACKEND_PROXY_SECRET") or JWT_SECRET

security = HTTPBearer(auto_error=False)


def _decode_token(credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[str]:
    """Decode JWT and return user id (sub) or None if missing/invalid."""
    if not JWT_SECRET:
        return None
    if not credentials or credentials.scheme.lower() != "bearer":
        return None
    token = credentials.credentials
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"verify_exp": True},
        )
        sub = payload.get("sub")
        return str(sub) if sub is not None else None
    except Exception:
        return None


def _trusted_proxy_user_id(
    x_user_id: Optional[str],
    x_internal_auth: Optional[str],
) -> Optional[str]:
    """Return the forwarded user id if it comes from our trusted Next proxy."""
    if not x_user_id:
        return None
    if not INTERNAL_PROXY_SECRET:
        return None
    if x_internal_auth != INTERNAL_PROXY_SECRET:
        return None
    return x_user_id


def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_internal_auth: Optional[str] = Header(default=None, alias="X-Internal-Auth"),
) -> str:
    """Require valid JWT; return user id. Raises 401 if missing or invalid."""
    user_id = _trusted_proxy_user_id(x_user_id, x_internal_auth)
    if not user_id:
        user_id = _decode_token(credentials)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


def get_optional_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_internal_auth: Optional[str] = Header(default=None, alias="X-Internal-Auth"),
) -> Optional[str]:
    """Return user id if valid JWT present, else None."""
    return _trusted_proxy_user_id(x_user_id, x_internal_auth) or _decode_token(
        credentials
    )
