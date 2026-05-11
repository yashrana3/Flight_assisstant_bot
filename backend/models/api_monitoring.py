"""API monitoring request log model for admin analytics."""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB, UUID

from database import BaseUser


class ApiRequestLog(BaseUser):
    __tablename__ = "api_request_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(String(64), nullable=True, index=True)
    method = Column(String(16), nullable=False)
    path = Column(String(255), nullable=False, index=True)
    status_code = Column(Integer, nullable=False, index=True)
    latency_ms = Column(Integer, nullable=False)
    query_params = Column(JSONB, nullable=True)
    provider = Column(String(64), nullable=True, index=True)
    api_key_name = Column(String(128), nullable=True)
    api_key_last4 = Column(String(8), nullable=True)
    user_id = Column(String(64), nullable=True, index=True)
    client_ip = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow, index=True)

