import uuid
from datetime import datetime, timedelta

from sqlalchemy import Column, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID

from database import BaseUser


class SignupOTP(BaseUser):
    __tablename__ = "signup_otps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, index=True)
    phone = Column(String(50), nullable=False)
    otp_code = Column(String(6), nullable=False)
    expires_at = Column(TIMESTAMP, nullable=False)
    created_at = Column(TIMESTAMP, default=datetime.utcnow, nullable=False)

    @staticmethod
    def generate_expiry(ttl_seconds: int = 60) -> datetime:
        return datetime.utcnow() + timedelta(seconds=ttl_seconds)

