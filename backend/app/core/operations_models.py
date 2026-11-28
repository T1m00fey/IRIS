from datetime import datetime

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EmployeeRecord(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(primary_key=True)
    full_name: Mapped[str]
    department: Mapped[str]
    status: Mapped[str]
    is_current: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime]


class CallRecord(Base):
    __tablename__ = "calls"

    id: Mapped[str] = mapped_column(primary_key=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), index=True)
    account_number: Mapped[str | None] = mapped_column(ForeignKey("accounts.number"), index=True)
    caller_phone_masked: Mapped[str | None]
    started_at: Mapped[datetime] = mapped_column(index=True)
    connected_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    status: Mapped[str] = mapped_column(index=True)
    phase: Mapped[str | None]
    outcome: Mapped[str]
    department: Mapped[str | None]
    summary: Mapped[str | None]
    handoff: Mapped[dict | None] = mapped_column(JSON)
    summary_reviewed_at: Mapped[datetime | None]


class CallMessageRecord(Base):
    __tablename__ = "call_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), index=True)
    speaker: Mapped[str]
    text: Mapped[str]
    created_at: Mapped[datetime]


class CallMessageSource(Base):
    __tablename__ = "call_message_sources"
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), primary_key=True)
    event_id: Mapped[str] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("call_messages.id"), unique=True)


class TicketRecord(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(primary_key=True)
    call_id: Mapped[str | None] = mapped_column(ForeignKey("calls.id"), index=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), index=True)
    account_number: Mapped[str | None] = mapped_column(ForeignKey("accounts.number"), index=True)
    department: Mapped[str] = mapped_column(index=True)
    status: Mapped[str] = mapped_column(index=True)
    priority: Mapped[str]
    title: Mapped[str]
    summary: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(index=True)
    queued_at: Mapped[datetime]
    started_at: Mapped[datetime | None]
    closed_at: Mapped[datetime | None]
    assigned_employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"))


class HandoffConfirmation(Base):
    __tablename__ = "handoff_confirmations"
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("call_messages.id"), unique=True)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), unique=True)


class OperationEvent(Base):
    __tablename__ = "operation_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    call_id: Mapped[str | None] = mapped_column(ForeignKey("calls.id"), index=True)
    ticket_id: Mapped[str | None] = mapped_column(ForeignKey("tickets.id"), index=True)
    type: Mapped[str]
    created_at: Mapped[datetime]
    details: Mapped[str | None]
    resources: Mapped[list[str]] = mapped_column(JSON)
