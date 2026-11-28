from datetime import datetime

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserRecord(Base):
    __tablename__ = "auth_users"

    id: Mapped[str] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(unique=True)
    full_name: Mapped[str]
    role: Mapped[str]
    company: Mapped[str | None]
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), unique=True)
    password_hash: Mapped[str]
    demo_only: Mapped[bool]


class SessionRecord(Base):
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey(UserRecord.id), index=True)
    expires_at: Mapped[datetime] = mapped_column(index=True)


class PreferencesRecord(Base):
    __tablename__ = "auth_preferences"

    user_id: Mapped[str] = mapped_column(ForeignKey(UserRecord.id), primary_key=True)
    sidebar_collapsed: Mapped[bool] = mapped_column(default=False)
    density: Mapped[str] = mapped_column(default="comfortable")
    summary_expanded: Mapped[bool] = mapped_column(default=True)
    desktop_notifications: Mapped[bool] = mapped_column(default=False)
    sound_notifications: Mapped[bool] = mapped_column(default=True)
    notification_volume: Mapped[int] = mapped_column(default=75)
