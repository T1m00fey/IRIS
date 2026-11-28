import asyncio
import json
from collections.abc import Callable
from time import monotonic
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth import session_is_active
from app.core import operations as core
from app.core.contact_center import service
from app.core.contact_center.models import WorkforceRecord
from app.core.contact_center.schemas import SpecializationsUpdate
from app.core.operations_models import CallRecord, EmployeeRecord, OperationEvent, TicketRecord
from app.core.schemas import (
    CallDetail, CallList, CallMessage, CallOutcome, CallStatus, Dashboard, Department,
    Employee, EmployeeUpdate, JoinCredentials, Ticket, TicketList, TicketPriority, TicketStatus, TicketUpdate,
)
from app.database import SessionLocal, get_db


router = APIRouter(prefix="/api/v1", tags=["Операции"])
Database = Annotated[Session, Depends(get_db)]
PageSize = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0)]


@router.get("/calls", response_model=CallList)
def list_calls(
    db: Database, status: CallStatus | None = None, outcome: CallOutcome | None = None,
    department: Department | None = None, customer_id: str | None = None, account_number: str | None = None,
    live: bool = False, limit: PageSize = 50, offset: PageOffset = 0,
) -> CallList:
    filters = [field == value for field, value in (
        (CallRecord.status, status), (CallRecord.outcome, outcome), (CallRecord.department, department),
        (CallRecord.customer_id, customer_id), (CallRecord.account_number, account_number),
    ) if value is not None]
    if live:
        filters.append(CallRecord.status.in_([CallStatus.RINGING, CallStatus.ACTIVE]))
    return core.list_calls(db, filters, limit, offset)


@router.get("/calls/{call_id}", response_model=CallDetail, responses={404: {"description": "Звонок не найден"}})
def get_call(call_id: str, db: Database) -> CallDetail:
    try:
        return core.get_call(db, call_id)
    except core.RecordNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/calls/{call_id}/messages", response_model=list[CallMessage])
def call_messages(call_id: str, db: Database) -> list[CallMessage]:
    if db.get(CallRecord, call_id) is None:
        raise HTTPException(status_code=404, detail="Звонок не найден")
    return core.call_messages(db, call_id)


@router.post(
    "/calls/{call_id}/join", response_model=JoinCredentials,
    summary="Получить доступ к аудио текущего звонка",
    responses={
        401: {"description": "Требуется вход в кабинет"},
        404: {"description": "Звонок не найден или недоступен отделу"},
        409: {"description": "Звонок уже занят или завершён"},
        501: {"description": "Учебный API. Подключение аудио ещё не реализовано"},
    },
)
def join_call(call_id: str, db: Database) -> JoinCredentials:
    if db.get(CallRecord, call_id) is None:
        raise HTTPException(status_code=404, detail="Звонок не найден")
    raise HTTPException(status_code=501, detail="Подключение аудио ещё не реализовано")


@router.post("/calls/{call_id}/confirm-summary", response_model=CallDetail)
def confirm_summary(call_id: str, db: Database) -> CallDetail:
    try:
        return core.confirm_summary(db, call_id)
    except core.RecordNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except core.OperationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/tickets", response_model=TicketList)
def list_tickets(
    db: Database, status: TicketStatus | None = None, department: Department | None = None,
    priority: TicketPriority | None = None, customer_id: str | None = None, account_number: str | None = None,
    sort: Literal["newest", "queue"] = "newest", limit: PageSize = 50, offset: PageOffset = 0,
) -> TicketList:
    filters = [field == value for field, value in (
        (TicketRecord.status, status), (TicketRecord.department, department), (TicketRecord.priority, priority),
        (TicketRecord.customer_id, customer_id), (TicketRecord.account_number, account_number),
    ) if value is not None]
    return core.list_tickets(db, filters, limit, offset, sort)


@router.get("/tickets/{ticket_id}", response_model=Ticket)
def get_ticket(ticket_id: str, db: Database) -> Ticket:
    try:
        return core.get_ticket(db, ticket_id)
    except core.RecordNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.patch("/tickets/{ticket_id}", response_model=Ticket)
def update_ticket(ticket_id: str, patch: TicketUpdate, db: Database) -> Ticket:
    try:
        return core.update_ticket(db, ticket_id, patch)
    except core.RecordNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except core.OperationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/dashboard", response_model=Dashboard)
def get_dashboard(db: Database) -> Dashboard:
    return core.get_dashboard(db)


@router.get("/employees", response_model=list[Employee])
def list_employees(db: Database) -> list[Employee]:
    return core.list_employees(db)


@router.patch("/employees/{employee_id}", response_model=Employee, responses={
    404: {"description": "Оператор не найден"},
    409: {"description": "Статус несовместим с текущим назначением или постобработкой"},
})
def update_employee(employee_id: str, change: EmployeeUpdate) -> Employee:
    try:
        with service.transaction() as db:
            service.set_presence(db, employee_id, change.status)
            return core.employee_item(db.get(EmployeeRecord, employee_id), db.get(WorkforceRecord, employee_id))
    except core.RecordNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except core.OperationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.put("/employees/{employee_id}/specializations", response_model=Employee, responses={
    404: {"description": "Оператор не найден"},
})
def update_employee_specializations(employee_id: str, change: SpecializationsUpdate) -> Employee:
    try:
        with service.transaction() as db:
            employee, profile = service.set_specializations(db, employee_id, change.specializations)
            return core.employee_item(employee, profile)
    except core.RecordNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def latest_event_id() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.max(OperationEvent.id))) or 0


def event_payload(event: OperationEvent, *, resources: list[str] | None = None) -> str:
    return json.dumps({
        "resources": event.resources if resources is None else resources,
        "type": event.type, "call_id": event.call_id, "ticket_id": event.ticket_id,
    })


def events_after(last_id: int) -> list[tuple[int, str | None]]:
    with SessionLocal() as db:
        events = db.scalars(select(OperationEvent).where(OperationEvent.id > last_id).order_by(OperationEvent.id).limit(100))
        return [(event.id, event_payload(event) if event.type != "call.operator_note" else None) for event in events]


@router.get(
    "/events", response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def event_stream(request: Request, last_event_id: Annotated[str | None, Header()] = None):
    return await stream_events(request, last_event_id, events_after, session_is_active)


async def stream_events(
    request: Request, last_event_id: str | None,
    load_events: Callable[[int], list[tuple[int, str | None]]],
    authorized: Callable[[Request], bool] | None = None,
) -> StreamingResponse:
    latest = await run_in_threadpool(latest_event_id)
    try:
        cursor = min(max(0, int(last_event_id)), latest) if last_event_id else latest
    except ValueError:
        cursor = latest

    async def stream():
        nonlocal cursor
        yield "retry: 2000\n\n"
        last_send = monotonic()
        while not await request.is_disconnected():
            if authorized is not None and not await run_in_threadpool(authorized, request):
                return
            events = await run_in_threadpool(load_events, cursor)
            for cursor, payload in events:
                if payload is not None:
                    yield f"id: {cursor}\nevent: change\ndata: {payload}\n\n"
                    last_send = monotonic()
            if monotonic() - last_send >= 15:
                yield ": heartbeat\n\n"
                last_send = monotonic()
            await asyncio.sleep(1)

    return StreamingResponse(
        stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
