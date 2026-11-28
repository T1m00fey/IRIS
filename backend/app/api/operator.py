import os
from datetime import UTC, date, datetime, time, timedelta, timezone
from functools import partial
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api import contact_center
from app.api.operations import stream_events
from app.auth import CurrentUser, require_operator, session_is_active
from app.core import operations
from app.core.contact_center import service
from app.core.contact_center.models import AssignmentRecord
from app.core.contact_center.schemas import (
    Assignment, CallControlRequest, DepartmentProfile, EmployeeProfile, Identifier, VoiceCommand,
)
from app.core.crm import account_detail, customer_summary
from app.core.crm_models import Account, Customer
from app.core.crm_schemas import CustomerDetail
from app.core.operations_models import CallRecord, TicketRecord
from app.core.schemas import Call, CallDetail, CallEvent, CallStatus, Ticket, TicketStatus


router = APIRouter(prefix="/api/v1/operator", tags=["Оператор"], route_class=contact_center.ContactCenterRoute)
Database = contact_center.Database
LIVE_CALLS = (CallStatus.RINGING, CallStatus.ACTIVE)
MOSCOW = timezone(timedelta(hours=3))


def current_employee_id(user: Annotated[CurrentUser, Depends(require_operator)]) -> str:
    if user.employee_id is None:
        raise HTTPException(403, "Требуется учётная запись оператора")
    return user.employee_id


Operator = Annotated[str, Depends(current_employee_id)]


class OperatorNote(contact_center.OperatorNote):
    call_id: str


class NoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: Identifier | None = None
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class OperatorCall(CallDetail):
    notes: list[OperatorNote]


class OperatorTicket(contact_center.CaseContext):
    events: list[CallEvent]


class OperatorWorkspace(BaseModel):
    employee: EmployeeProfile
    assignment: Assignment | None
    call_id: str | None
    calls: list[Call]
    history: list[Call]
    tickets: list[Ticket]
    waiting_calls: int
    voice_available: bool


class PersonalDay(BaseModel):
    date: date
    accepted_calls: int = 0
    resolved_tickets: int = 0


class PersonalAnalytics(BaseModel):
    from_date: date
    to_date: date
    accepted_calls: int
    resolved_tickets: int
    average_duration_seconds: int | None
    line_seconds: int | None
    daily: list[PersonalDay]


@router.get("/workspace")
def workspace(employee_id: Operator) -> OperatorWorkspace:
    with service.transaction() as db:
        context = service.workspace(db, employee_id)
        waiting = service.list_queue(db, employee_id)
        calls = []
        if context.call_id:
            calls = operations.list_calls(db, [CallRecord.id == context.call_id], 1, 0).items
        history = operations.list_calls(db, [
            CallRecord.status.not_in(LIVE_CALLS), CallRecord.id.in_(service.operator_call_ids(db, employee_id)),
        ], 30, 0)
        tickets = operations.list_tickets(db, [contact_center.case_visibility(db, employee_id)], 20, 0, "newest")
    return OperatorWorkspace(
        **context.model_dump(), calls=calls, history=history.items, tickets=tickets.items,
        waiting_calls=len(waiting), voice_available=voice_available(),
    )


@router.get("/calls/{call_id}")
def call_details(call_id: str, db: Database, employee_id: Operator) -> OperatorCall:
    detail = contact_center.call(call_id, employee_id, db)
    notes = [OperatorNote(call_id=call_id, **note.model_dump()) for note in contact_center.own_notes(db, employee_id, call_id)]
    return OperatorCall(**detail.model_copy(update={
        "events": [event for event in detail.events if event.type != "call.operator_note"],
    }).model_dump(), notes=notes)


@router.post("/calls/{call_id}/notes", status_code=201)
def add_note(call_id: str, note: NoteInput, employee_id: Operator) -> OperatorNote:
    result = contact_center.add_note(call_id, employee_id, contact_center.NoteInput(
        event_id=note.event_id or uuid4().hex, text=note.text,
    ))
    return OperatorNote(call_id=call_id, **result.model_dump())


@router.get("/customers/{customer_id}")
def customer_details(customer_id: str, db: Database, employee_id: Operator) -> CustomerDetail:
    assigned_calls = service.operator_call_ids(db, employee_id)
    calls = select(CallRecord.account_number, CallRecord.started_at).where(
        CallRecord.customer_id == customer_id, CallRecord.id.in_(assigned_calls),
    )
    tickets = select(TicketRecord.account_number, TicketRecord.created_at).where(
        TicketRecord.customer_id == customer_id, contact_center.case_visibility(db, employee_id),
    )
    contacts = db.execute(calls.union_all(tickets)).all()
    if not contacts:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    numbers = {number for number, _ in contacts if number is not None}
    accounts = [account_detail(account) for account in db.scalars(
        select(Account).where(Account.customer_id == customer.id, Account.number.in_(numbers)).order_by(Account.number)
    )]
    summary = customer_summary(customer, accounts[0] if accounts else None, len(accounts), max(at for _, at in contacts))
    return CustomerDetail(**summary.model_dump(), accounts=accounts)


@router.get("/tickets/{ticket_id}")
def ticket_details(ticket_id: str, db: Database, employee_id: Operator) -> OperatorTicket:
    context = contact_center.case_context(ticket_id, employee_id, db)
    return OperatorTicket(**context.model_dump(), events=contact_center.case_events(ticket_id, employee_id, db))


@router.patch("/status")
def update_status(change: contact_center.PresenceUpdate, employee_id: Operator) -> EmployeeProfile:
    return contact_center.update_status(employee_id, change)


@router.get("/departments")
def departments(db: Database, employee_id: Operator) -> list[DepartmentProfile]:
    return contact_center.departments(employee_id, db)


@router.post("/profile/complete-wrap-up")
def complete_wrap_up(employee_id: Operator) -> EmployeeProfile:
    return contact_center.complete_wrap_up(employee_id)


def voice_available() -> bool:
    return service.enabled() and bool(os.getenv("IRIS_VOICE_TOKEN"))


def require_voice_integration() -> None:
    if not voice_available():
        raise HTTPException(503, "Подключение Voice недоступно")


@router.post("/assignments/{assignment_id}/accept")
def accept(assignment_id: str, employee_id: Operator) -> Assignment:
    require_voice_integration()
    return contact_center.accept(assignment_id, employee_id)


@router.post("/assignments/{assignment_id}/decline")
def decline(assignment_id: str, employee_id: Operator) -> Assignment:
    require_voice_integration()
    return contact_center.decline(assignment_id, employee_id)


@router.post("/assignments/{assignment_id}/control")
def control(assignment_id: str, command: CallControlRequest, employee_id: Operator) -> VoiceCommand:
    require_voice_integration()
    return contact_center.control(assignment_id, command, employee_id)


@router.post("/calls/{call_id}/confirm-summary")
def confirm_summary(call_id: str, employee_id: Operator) -> CallDetail:
    detail = contact_center.confirm_summary(call_id, employee_id)
    return detail.model_copy(update={"events": [event for event in detail.events if event.type != "call.operator_note"]})


@router.get(
    "/events", response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def event_stream(
    request: Request, employee_id: Operator, last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    return await stream_events(
        request, last_event_id, partial(contact_center.operator_events_after, employee_id), authorized=session_is_active,
    )


def local_day(value: datetime) -> date:
    return value.replace(tzinfo=UTC).astimezone(MOSCOW).date()


def utc_start(day: date) -> datetime:
    return datetime.combine(day, time.min, MOSCOW).astimezone(UTC).replace(tzinfo=None)


@router.get("/analytics")
def personal_analytics(
    db: Database, employee_id: Operator, from_date: date | None = None, to_date: date | None = None,
) -> PersonalAnalytics:
    end = to_date or local_day(operations.utc_now())
    if end < date(2, 1, 1) or end == date.max:
        raise HTTPException(status_code=422, detail="Некорректная дата завершения периода")
    start = from_date or end - timedelta(days=6)
    if end < start or (end - start).days >= 366 or start == date.min:
        raise HTTPException(status_code=422, detail="Укажите период от 1 до 366 дней")
    lower, upper = utc_start(start), utc_start(end + timedelta(days=1))
    daily = {start + timedelta(days=offset): PersonalDay(date=start + timedelta(days=offset))
             for offset in range((end - start).days + 1)}
    accepted = db.scalars(select(AssignmentRecord.accepted_at).where(
        AssignmentRecord.employee_id == employee_id,
        AssignmentRecord.accepted_at >= lower, AssignmentRecord.accepted_at < upper,
    )).all()
    resolved = db.scalars(select(TicketRecord.closed_at).where(
        TicketRecord.assigned_employee_id == employee_id, TicketRecord.status == TicketStatus.CLOSED,
        TicketRecord.closed_at >= lower, TicketRecord.closed_at < upper,
    )).all()
    intervals = db.execute(select(AssignmentRecord.connected_at, AssignmentRecord.ended_at).where(
        AssignmentRecord.employee_id == employee_id, AssignmentRecord.connected_at < upper,
        or_(AssignmentRecord.ended_at > lower, AssignmentRecord.ended_at.is_(None)),
    )).all()
    now = operations.utc_now()
    durations = [operations.duration_seconds(connected, ended) for connected, ended in intervals
                 if ended is not None and lower <= connected < upper]
    line_seconds = sum(operations.duration_seconds(max(connected, lower), min(ended or now, upper))
                       for connected, ended in intervals)
    for timestamp in accepted:
        daily[local_day(timestamp)].accepted_calls += 1
    for timestamp in resolved:
        daily[local_day(timestamp)].resolved_tickets += 1
    return PersonalAnalytics(
        from_date=start, to_date=end, accepted_calls=len(accepted), resolved_tickets=len(resolved),
        average_duration_seconds=round(sum(durations) / len(durations)) if durations else None,
        line_seconds=line_seconds, daily=list(daily.values()),
    )
