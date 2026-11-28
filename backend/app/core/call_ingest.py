from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC
from hashlib import sha256
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, PositiveInt, StringConstraints, validate_call
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.crm import account_detail
from app.core.crm_models import Account, Customer
from app.core.crm_schemas import AccountDetail
from app.core.operations import OperationConflict, RecordNotFound, call_item, get_ticket, message_item, utc_now
from app.core.operations_models import (
    CallMessageRecord, CallMessageSource, CallRecord, HandoffConfirmation, OperationEvent, TicketRecord,
)
from app.core.outages import detect_outage
from app.core.schemas import Call, CallMessage, CallOutcome, CallPhase, CallStatus, Department, Handoff, Ticket
from app.database import SessionLocal, phone_digits


Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
FinalStatus = Literal[CallStatus.COMPLETED, CallStatus.ABANDONED, CallStatus.FAILED]


class MessageInput(BaseModel):
    event_id: Identifier
    speaker: Literal["customer", "assistant", "operator"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]
    created_at: AwareDatetime | None = None


class SummaryInput(BaseModel):
    event_id: Identifier
    summary: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


@contextmanager
def write_session() -> Iterator[Session]:
    with SessionLocal.begin() as db:
        # Reserve SQLite's writer slot before reading the state used for a transition.
        db.execute(text("BEGIN IMMEDIATE"))
        yield db


def require_call(db: Session, call_id: str) -> CallRecord:
    record = db.get(CallRecord, call_id)
    if record is None:
        raise RecordNotFound("Звонок не найден")
    return record


def current_call(db: Session, record: CallRecord) -> Call:
    customer = db.get(Customer, record.customer_id) if record.customer_id else None
    return call_item(record, customer.full_name if customer else None)


@validate_call
def start_call(provider_call_id: Identifier, caller_phone: str | None = None) -> Call:
    call_id = "call_" + sha256(provider_call_id.encode("utf-8")).hexdigest()
    with write_session() as db:
        record = db.get(CallRecord, call_id)
        if record is None:
            timestamp = utc_now()
            digits = phone_digits(caller_phone or "")
            phone_masked = f"*** {digits[-2:]}" if len(digits) >= 7 else None
            record = CallRecord(
                id=call_id, caller_phone_masked=phone_masked, started_at=timestamp,
                status=CallStatus.RINGING, outcome=CallOutcome.UNKNOWN,
            )
            db.add(record)
            db.flush()
            db.add(OperationEvent(
                call_id=call_id, type="call.started", created_at=timestamp,
                details="Звонок поступил", resources=["calls", "dashboard", "workspace"],
            ))
        return current_call(db, record)


def mark_connected(call_id: str) -> Call:
    with write_session() as db:
        record = require_call(db, call_id)
        if record.status == CallStatus.RINGING:
            record.connected_at = utc_now()
            record.status = CallStatus.ACTIVE
            record.phase = CallPhase.AI_ACTIVE
            db.add(OperationEvent(
                call_id=call_id, type="call.connected", created_at=record.connected_at,
                details="Звонок принят", resources=["calls", "dashboard"],
            ))
        return current_call(db, record)


def identify_customer(call_id: str, account_id: str, apartment: str) -> bool:
    with write_session() as db:
        record = require_call(db, call_id)
        account = db.get(Account, account_id)
        apartment = apartment.strip()
        if account is None or not apartment or account.apartment != apartment:
            return False
        if record.customer_id is not None and record.customer_id != account.customer_id:
            return False
        if record.status != CallStatus.ACTIVE or record.handoff:
            raise OperationConflict("Идентификация доступна во время звонка до сохранения обращения")
        if record.account_number != account.number:
            record.customer_id = account.customer_id
            record.account_number = account.number
            db.add(OperationEvent(
                call_id=call_id, type="call.identified", created_at=utc_now(),
                details="Счёт абонента подтверждён", resources=["calls", "customers", "dashboard"],
            ))
        return True


def get_account_details(call_id: str) -> AccountDetail:
    with SessionLocal() as db:
        record = require_call(db, call_id)
        if record.status != CallStatus.ACTIVE or record.customer_id is None or record.account_number is None:
            raise OperationConflict("Данные счёта доступны после идентификации в активном звонке")
        account = db.get(Account, record.account_number)
        if account is None or account.customer_id != record.customer_id:
            raise OperationConflict("Лицевой счёт не подтверждён для звонка")
        return account_detail(db, account)


def append_message(call_id: str, message: MessageInput) -> CallMessage:
    with write_session() as db:
        record = require_call(db, call_id)
        source = db.get(CallMessageSource, (call_id, message.event_id))
        if source is not None:
            existing = db.get(CallMessageRecord, source.message_id)
            if existing.speaker != message.speaker or existing.text != message.text:
                raise OperationConflict("У реплики с таким идентификатором другое содержимое")
            return message_item(existing)
        if record.status != CallStatus.ACTIVE:
            raise OperationConflict("Реплика доступна только для активного звонка")
        received_at = utc_now()
        spoken_at = message.created_at.astimezone(UTC).replace(tzinfo=None) if message.created_at else received_at
        row = CallMessageRecord(
            call_id=call_id, speaker=message.speaker, text=message.text, created_at=spoken_at,
        )
        db.add(row)
        db.flush()
        db.add_all([
            CallMessageSource(call_id=call_id, event_id=message.event_id, message_id=row.id),
            OperationEvent(call_id=call_id, type="call.transcript", created_at=received_at, resources=["calls"]),
        ])
        return message_item(row)


def update_summary(call_id: str, change: SummaryInput) -> Call:
    from app.core.contact_center.models import VoiceReceipt

    with write_session() as db:
        record = require_call(db, call_id)
        operation = "summary"
        payload_hash = sha256(change.summary.encode("utf-8")).hexdigest()
        receipt = db.get(VoiceReceipt, (call_id, operation, change.event_id))
        if receipt is not None:
            if receipt.payload_hash != payload_hash:
                raise OperationConflict("У события сводки с таким идентификатором другое содержимое")
            return current_call(db, record)
        if record.status != CallStatus.ACTIVE:
            raise OperationConflict("Сводку можно обновить только во время активного звонка")

        db.add(VoiceReceipt(
            call_id=call_id, operation=operation, event_id=change.event_id, payload_hash=payload_hash,
        ))
        if record.summary != change.summary:
            record.summary = change.summary
            record.summary_reviewed_at = None
            db.add(OperationEvent(
                call_id=call_id, type="call.summary_updated", created_at=utc_now(),
                details="Голосовой ИИ обновил сводку", resources=["calls"],
            ))
        return current_call(db, record)


@validate_call
def confirm_ticket(
    call_id: Identifier, handoff: Handoff, confirmation_message_id: PositiveInt, department: Department | str,
    account_number: str | None = None,
) -> Ticket:
    from app.core.contact_center import service
    from app.core.contact_center.models import DepartmentRecord, VoiceReceipt

    contact_center_enabled = service.enabled()
    receipt_key = (call_id, "ticket", str(confirmation_message_id))
    department_hash = sha256(department.encode()).hexdigest()
    with write_session() as db:
        record = require_call(db, call_id)
        existing = db.get(HandoffConfirmation, call_id)
        if existing is not None:
            saved_handoff = Handoff.model_validate(record.handoff)
            receipt = db.get(VoiceReceipt, receipt_key) if contact_center_enabled else None
            department_matches = record.department == department
            if receipt is not None:
                department_matches = receipt.payload_hash == department_hash
            if (existing.message_id != confirmation_message_id or not department_matches
                    or (account_number is not None and account_number != record.account_number)
                    or saved_handoff.model_dump(exclude={"confirmed_at"}) != handoff.model_dump(exclude={"confirmed_at"})):
                raise OperationConflict("Для звонка уже подтверждено другое обращение")
            return get_ticket(db, existing.ticket_id)
        if record.status != CallStatus.ACTIVE or record.handoff:
            raise OperationConflict("Обращение можно подтвердить только для активного звонка")
        if contact_center_enabled:
            target_department = db.get(DepartmentRecord, department)
            if target_department is None or not target_department.enabled:
                raise OperationConflict("Отдел обращения недоступен")
        elif department not in tuple(Department):
            raise OperationConflict("Отдел обращения недоступен")
        if account_number is not None and account_number != record.account_number:
            raise OperationConflict("Лицевой счёт не подтверждён для звонка")
        confirmation = db.get(CallMessageRecord, confirmation_message_id)
        if confirmation is None or confirmation.call_id != call_id or confirmation.speaker != "customer":
            raise OperationConflict("Для подтверждения нужна реплика абонента из текущего звонка")
        if db.get(TicketRecord, handoff.ticket_id) is not None:
            raise OperationConflict("Идентификатор обращения уже использован")

        now = utc_now()
        confirmed_handoff = handoff.model_copy(update={"confirmed_at": message_item(confirmation).created_at})
        ticket = TicketRecord(
            id=handoff.ticket_id, call_id=call_id, customer_id=record.customer_id, account_number=record.account_number,
            department=department, status="queued", priority="normal", title=handoff.customer_request,
            summary=handoff.summary, created_at=now, queued_at=now,
        )
        db.add(ticket)
        if contact_center_enabled:
            db.add(VoiceReceipt(
                call_id=call_id, operation="ticket", event_id=str(confirmation_message_id),
                payload_hash=department_hash,
            ))
        else:
            record.department = department
            record.phase = CallPhase.WAITING_FOR_OPERATOR
        record.outcome = CallOutcome.TICKET_CREATED
        if record.summary != handoff.summary:
            record.summary_reviewed_at = None
        record.summary = handoff.summary
        record.handoff = confirmed_handoff.model_dump(mode="json")
        db.flush()
        detect_outage(db, ticket)
        db.add_all([
            HandoffConfirmation(call_id=call_id, message_id=confirmation_message_id, ticket_id=handoff.ticket_id),
            OperationEvent(
                call_id=call_id, ticket_id=handoff.ticket_id, type="ticket.created", created_at=now,
                details="Абонент подтвердил обращение", resources=["calls", "tickets", "dashboard", "customers"],
            ),
        ])
        return get_ticket(db, handoff.ticket_id)


@validate_call
def finish_call(call_id: Identifier, status: FinalStatus, outcome: CallOutcome) -> Call:
    from app.core.contact_center import service

    with write_session() as db:
        record = require_call(db, call_id)
        if record.status in (CallStatus.RINGING, CallStatus.ACTIVE):
            if record.status == CallStatus.RINGING and status == CallStatus.COMPLETED:
                raise OperationConflict("Для завершения разговора звонок должен быть принят")
            if record.outcome == CallOutcome.TICKET_CREATED:
                outcome = CallOutcome.TICKET_CREATED
            elif outcome == CallOutcome.TICKET_CREATED:
                raise OperationConflict("Подтверждённое обращение для звонка отсутствует")
            record.ended_at = utc_now()
            record.status = status
            record.phase = None
            record.outcome = outcome
            db.add(OperationEvent(
                call_id=call_id, type="call.ended", created_at=record.ended_at,
                details="Звонок завершён", resources=["calls", "dashboard", "customers"],
            ))
            if service.enabled():
                service.release_call(db, call_id)
        return current_call(db, record)
