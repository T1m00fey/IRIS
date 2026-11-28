from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.operations_models import CallRecord, EmployeeRecord
from app.database import Base


class DepartmentRecord(Base):
    __tablename__ = "cc_departments"
    code: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    enabled: Mapped[bool] = mapped_column(default=True)


class RoutingRule(Base):
    __tablename__ = "cc_routing_rules"
    category: Mapped[str] = mapped_column(primary_key=True)
    department: Mapped[str] = mapped_column(ForeignKey(DepartmentRecord.code))
    required_skills: Mapped[list[str]] = mapped_column(JSON, default=list)


class WorkforceRecord(Base):
    __tablename__ = "cc_workforce"
    employee_id: Mapped[str] = mapped_column(ForeignKey(EmployeeRecord.id), primary_key=True)
    role: Mapped[str] = mapped_column(default="operator")
    company: Mapped[str | None]
    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    on_shift: Mapped[bool] = mapped_column(default=True)
    notifications_enabled: Mapped[bool] = mapped_column(default=True)
    sound_enabled: Mapped[bool] = mapped_column(default=True)
    available_since: Mapped[datetime]
    retry_available_at: Mapped[datetime | None]


class QueueRecord(Base):
    __tablename__ = "cc_live_queue"
    call_id: Mapped[str] = mapped_column(ForeignKey(CallRecord.id), primary_key=True)
    department: Mapped[str] = mapped_column(ForeignKey(DepartmentRecord.code), index=True)
    category: Mapped[str | None]
    priority: Mapped[str]
    required_skills: Mapped[list[str]] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(index=True)
    queued_at: Mapped[datetime]
    target_employee_id: Mapped[str | None] = mapped_column(ForeignKey(EmployeeRecord.id))
    waiting_ended_at: Mapped[datetime | None]
    closed_at: Mapped[datetime | None]


LIVE_ASSIGNMENT = text("state IN ('offered', 'accepted', 'connected')")


class AssignmentRecord(Base):
    __tablename__ = "cc_assignments"
    __table_args__ = (
        Index("cc_one_live_assignment_per_call", "call_id", unique=True, sqlite_where=LIVE_ASSIGNMENT),
        Index("cc_one_live_assignment_per_employee", "employee_id", unique=True, sqlite_where=LIVE_ASSIGNMENT),
    )
    id: Mapped[str] = mapped_column(primary_key=True)
    call_id: Mapped[str] = mapped_column(ForeignKey(QueueRecord.call_id), index=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey(EmployeeRecord.id), index=True)
    state: Mapped[str] = mapped_column(index=True)
    offered_at: Mapped[datetime]
    expires_at: Mapped[datetime | None]
    accepted_at: Mapped[datetime | None]
    connected_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]


class VoiceReceipt(Base):
    __tablename__ = "cc_voice_receipts"
    call_id: Mapped[str] = mapped_column(ForeignKey(CallRecord.id), primary_key=True)
    operation: Mapped[str] = mapped_column(primary_key=True)
    event_id: Mapped[str] = mapped_column(primary_key=True)
    payload_hash: Mapped[str]


class VoiceCommandRecord(Base):
    __tablename__ = "cc_voice_commands"
    id: Mapped[str] = mapped_column(primary_key=True)
    call_id: Mapped[str] = mapped_column(ForeignKey(CallRecord.id), index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey(AssignmentRecord.id), index=True)
    kind: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)
    event_id: Mapped[str | None]
    created_at: Mapped[datetime]
    acknowledged_at: Mapped[datetime | None]
    cancelled_at: Mapped[datetime | None]
