"""SQLAlchemy models: User DB (BaseUser) and Chat DB (BaseChat)."""

from database import BaseUser, BaseChat

from models.user import User, TravelPreference, GuestPassengerProfile
from models.trip import Trip
from models.chat import ChatSession, ChatMessage
from models.price_alert import PriceAlert
from models.settings import UserSettings
from models.stats import TravelStats, Achievement, UserAchievement
from models.consent import ConsentRecord
from models.feedback import Feedback
from models.otp import SignupOTP
from models.api_monitoring import ApiRequestLog
from models.admin_user import AdminUser

__all__ = [
    "BaseUser",
    "BaseChat",
    "User",
    "TravelPreference",
    "Trip",
    "ChatSession",
    "ChatMessage",
    "GuestPassengerProfile",
    "PriceAlert",
    "UserSettings",
    "TravelStats",
    "Achievement",
    "UserAchievement",
    "ConsentRecord",
    "Feedback",
    "SignupOTP",
    "ApiRequestLog",
    "AdminUser",
]
