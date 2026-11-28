import json
import os
from collections.abc import Callable, Coroutine, Iterator
from datetime import datetime
from functools import partial
from hashlib import sha256
from hmac import compare_digest
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import and_, case as sql_case, func, or_, select, text
from sqlalchemy.orm import Session

from app import database
from app.api.operations import event_payload, stream_events
from app.core import crm, operations
from app.core.contact_center import service
from app.core.contact_center.models import AssignmentRecord, WorkforceRecord
from app.core.contact_center.schemas import (
    Assignment, CallControlRequest, DepartmentProfile, EmployeeProfile, Identifier, OperatorSettings, QueueEntry,
    VoiceCommand, Workspace,
)
from app.core.crm_models import Account
from app.core.crm_schemas import AccountDetail, IncidentDetail
from app.core.operations_models import CallRecord, EmployeeRecord, OperationEvent, TicketRecord
from app.core.schemas import (
    CallDetail, CallEvent, CallOutcome, CallStatus, EmployeeStatus, Handoff, Ticket, TicketList, TicketPriority,
    TicketStatus, TicketUpdate,
)


class ContactCenterRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await handler(request)
            except operations.RecordNotFound as error:
                raise HTTPException(404, str(error)) from error
            except operations.OperationConflict as error:
                raise HTTPException(409, str(error)) from error

        return handle


router = APIRouter(prefix="/api/v1/contact-center", tags=["Рабочее место оператора"], route_class=ContactCenterRoute)
bearer = HTTPBearer(auto_error=False, scheme_name="OperatorBearer")


def read_database(db: Annotated[Session, Depends(database.get_db)]) -> Session:
    # SQLite's legacy transaction mode does not start a snapshot on SELECT.
    db.execute(text("BEGIN"))
    return db


Database = Annotated[Session, Depends(read_database)]


def require_operator(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> str:
    if not service.enabled():
        raise HTTPException(404, "Контакт-центр отключён")
    if credentials is None or len(credentials.credentials) > 4096:
        raise HTTPException(401, "Требуется токен оператора", headers={"WWW-Authenticate": "Bearer"})
    try:
        tokens = json.loads(os.getenv("IRIS_OPERATOR_TOKENS", "{}"))
    except json.JSONDecodeError as error:
        raise HTTPException(503, "Токены операторов не настроены") from error
    if not isinstance(tokens, dict) or os.getenv("IRIS_VOICE_TOKEN") in tokens:
        raise HTTPException(503, "Токены операторов не настроены")

    supplied_digest = sha256(credentials.credentials.encode()).digest()
    employee_id = None
    for token, authorized_employee in tokens.items():
        if (not token or not token.isascii() or any(character.isspace() for character in token)
                or not isinstance(authorized_employee, str) or not authorized_employee.strip()
                or authorized_employee != authorized_employee.strip()):
            raise HTTPException(503, "Токены операторов не настроены")
        if compare_digest(supplied_digest, sha256(token.encode()).digest()):
            employee_id = authorized_employee
    if employee_id is not None:
        with database.SessionLocal() as db:
            employee = db.scalar(select(EmployeeRecord.id).outerjoin(WorkforceRecord).where(
                EmployeeRecord.id == employee_id,
                or_(WorkforceRecord.role == "operator", WorkforceRecord.employee_id.is_(None)),
            ))
            if employee is not None:
                return employee_id
    raise HTTPException(401, "Неверный токен оператора", headers={"WWW-Authenticate": "Bearer"})


Operator = Annotated[str, Depends(require_operator)]
PageSize = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0)]


class PresenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: EmployeeStatus


class CaseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: TicketStatus


class CaseQueueEntry(BaseModel):
    id: str
    department: str
    priority: TicketPriority
    queued_at: datetime


class CaseContext(BaseModel):
    ticket: Ticket
    handoff: Handoff | None
    call_outcome: CallOutcome | None


class OperatorAnalytics(BaseModel):
    calls_handled: int
    calls_finished: int
    total_talk_seconds: int
    average_talk_seconds: int | None
    outcomes: dict[CallOutcome, int]


class OperatorDashboard(BaseModel):
    employee: EmployeeProfile
    queue: list[QueueEntry]
    recent_cases: list[Ticket]
    active_incidents: list[IncidentDetail]


class NoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: Identifier
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class OperatorNote(BaseModel):
    id: int
    event_id: str
    text: str
    created_at: datetime


class OperatorPermissionProfile(BaseModel):
    role: str
    permissions: list[str]


@router.get("/dashboard")
def dashboard(employee_id: Operator) -> OperatorDashboard:
    with service.transaction() as db:
        queue = service.list_queue(db, employee_id)
        employee = service.employee_profile(db, employee_id)
        recent_cases = operations.list_tickets(db, [case_visibility(db, employee_id)], 6, 0, "newest").items
        account = account_for_call(db, employee.active_call_id) if employee.active_call_id else None
        return OperatorDashboard(
            employee=employee, queue=queue, recent_cases=recent_cases,
            active_incidents=crm.account_detail(account).active_incidents if account else [],
        )


@router.get("/workspace")
def workspace(employee_id: Operator) -> Workspace:
    with service.transaction() as db:
        return service.workspace(db, employee_id)


@router.get("/queue")
def queue(employee_id: Operator) -> list[QueueEntry]:
    with service.transaction() as db:
        return service.list_queue(db, employee_id)


@router.get("/departments")
def departments(employee_id: Operator, db: Database) -> list[DepartmentProfile]:
    return service.list_departments(db)


@router.get("/team")
def team(employee_id: Operator, db: Database) -> list[EmployeeProfile]:
    return service.list_team(db, employee_id)


@router.get("/profile")
def profile(employee_id: Operator, db: Database) -> EmployeeProfile:
    return service.employee_profile(db, employee_id)


@router.get("/profile/permissions")
def profile_permissions(employee_id: Operator) -> OperatorPermissionProfile:
    return OperatorPermissionProfile(role="operator", permissions=[
        "workspace:read", "queue:read", "team:read", "profile:write", "assignment:respond", "call:control",
        "call:read", "call:confirm-summary", "call:write-notes", "crm:read-call-account", "case:read",
        "case:change-status", "case:claim", "analytics:read-own", "events:subscribe",
    ])


@router.get("/profile/settings")
def settings(employee_id: Operator, db: Database) -> OperatorSettings:
    return service.operator_settings(db, employee_id)


@router.put("/profile/settings")
def save_settings(employee_id: Operator, value: OperatorSettings) -> OperatorSettings:
    with service.transaction() as db:
        return service.save_operator_settings(db, employee_id, value)


@router.patch("/profile/status")
def update_status(employee_id: Operator, change: PresenceUpdate) -> EmployeeProfile:
    with service.transaction() as db:
        return service.set_presence(db, employee_id, change.status)


@router.post("/profile/complete-wrap-up")
def complete_wrap_up(employee_id: Operator) -> EmployeeProfile:
    with service.transaction() as db:
        return service.complete_wrap_up(db, employee_id)


@router.post("/assignments/{assignment_id}/accept")
def accept(assignment_id: str, employee_id: Operator) -> Assignment:
    with service.transaction() as db:
        return service.accept_assignment(db, employee_id, assignment_id)


@router.post("/assignments/{assignment_id}/decline")
def decline(assignment_id: str, employee_id: Operator) -> Assignment:
    with service.transaction() as db:
        return service.decline_assignment(db, employee_id, assignment_id)


@router.post("/assignments/{assignment_id}/control")
def control(assignment_id: str, command: CallControlRequest, employee_id: Operator) -> VoiceCommand:
    with service.transaction() as db:
        return service.request_call_control(db, employee_id, assignment_id, command)


def case_visibility(db: Session, employee_id: str):
    return or_(
        TicketRecord.assigned_employee_id == employee_id,
        and_(TicketRecord.assigned_employee_id.is_(None), TicketRecord.call_id.in_(service.operator_call_ids(db, employee_id))),
    )


def require_case(db: Session, employee_id: str, ticket_id: str) -> None:
    visible = db.scalar(select(TicketRecord.id).where(TicketRecord.id == ticket_id, case_visibility(db, employee_id)))
    if visible is None:
        raise operations.RecordNotFound("Обращение не найдено")


def visible_call_detail(db: Session, employee_id: str, detail: CallDetail) -> CallDetail:
    visible_cases = set(db.scalars(select(TicketRecord.id).where(
        TicketRecord.call_id == detail.id, case_visibility(db, employee_id),
    )))
    return detail.model_copy(update={
        "tickets": [ticket for ticket in detail.tickets if ticket.id in visible_cases],
        "handoff": detail.handoff if detail.handoff and detail.handoff.ticket_id in visible_cases else None,
    })


@router.get("/calls/{call_id}")
def call(call_id: str, employee_id: Operator, db: Database) -> CallDetail:
    service.require_operator_call(db, employee_id, call_id)
    return visible_call_detail(db, employee_id, operations.get_call(db, call_id))


def account_for_call(db: Session, call_id: str) -> Account | None:
    return db.scalar(select(Account).join(CallRecord, and_(
        Account.number == CallRecord.account_number, Account.customer_id == CallRecord.customer_id,
    )).where(CallRecord.id == call_id))


@router.get("/calls/{call_id}/account")
def call_account(call_id: str, employee_id: Operator, db: Database) -> AccountDetail:
    service.require_operator_call(db, employee_id, call_id)
    account = account_for_call(db, call_id)
    if account is None:
        raise operations.RecordNotFound("Подтверждённый лицевой счёт не найден")
    return crm.account_detail(account)


@router.post("/calls/{call_id}/confirm-summary")
def confirm_summary(call_id: str, employee_id: Operator) -> CallDetail:
    with service.transaction() as db:
        service.require_operator_call(db, employee_id, call_id)
        detail = operations.confirm_summary(db, call_id, commit=False)
        return visible_call_detail(db, employee_id, detail)


def own_notes(db: Session, employee_id: str, call_id: str) -> Iterator[OperatorNote]:
    for event in db.scalars(select(OperationEvent).where(
        OperationEvent.call_id == call_id, OperationEvent.type == "call.operator_note",
    ).order_by(OperationEvent.id)):
        details = json.loads(event.details)
        if details["employee_id"] == employee_id:
            yield OperatorNote(
                id=event.id, event_id=details["event_id"], text=details["text"], created_at=operations.utc(event.created_at),
            )


@router.get("/calls/{call_id}/notes")
def notes(call_id: str, employee_id: Operator, db: Database) -> list[OperatorNote]:
    service.require_operator_call(db, employee_id, call_id)
    return list(own_notes(db, employee_id, call_id))


@router.post("/calls/{call_id}/notes")
def add_note(call_id: str, employee_id: Operator, note: NoteInput) -> OperatorNote:
    with service.transaction() as db:
        service.require_operator_call(db, employee_id, call_id)
        existing = next((saved for saved in own_notes(db, employee_id, call_id) if saved.event_id == note.event_id), None)
        if existing is not None:
            if existing.text != note.text:
                raise operations.OperationConflict("Заметка с таким идентификатором содержит другой текст")
            return existing
        event = OperationEvent(
            call_id=call_id, type="call.operator_note", created_at=operations.utc_now(),
            details=json.dumps({"employee_id": employee_id, **note.model_dump()}, ensure_ascii=False),
            resources=["calls", "notes"],
        )
        db.add(event)
        db.flush()
        return OperatorNote(id=event.id, **note.model_dump(), created_at=operations.utc(event.created_at))


@router.get("/cases")
def cases(
    employee_id: Operator, db: Database, q: Annotated[str | None, Query(max_length=200)] = None,
    status: TicketStatus | None = None, priority: TicketPriority | None = None,
    limit: PageSize = 50, offset: PageOffset = 0,
) -> TicketList:
    filters = [case_visibility(db, employee_id)]
    if status is not None:
        filters.append(TicketRecord.status == status)
    if priority is not None:
        filters.append(TicketRecord.priority == priority)
    if q and (query := database.normalize_text(q.strip())):
        filters.append(or_(*(
            func.normalize_text(column).contains(query, autoescape=True)
            for column in (TicketRecord.id, TicketRecord.title, TicketRecord.summary)
        )))
    return operations.list_tickets(db, filters, limit, offset, "newest")


def claimable_cases(employee_id: str):
    department = select(EmployeeRecord.department).where(EmployeeRecord.id == employee_id).scalar_subquery()
    terminal_calls = select(CallRecord.id).where(CallRecord.status.in_(
        (CallStatus.COMPLETED, CallStatus.ABANDONED, CallStatus.FAILED),
    ))
    return select(TicketRecord).where(
        TicketRecord.department == department, TicketRecord.status == TicketStatus.QUEUED,
        TicketRecord.assigned_employee_id.is_(None),
        or_(TicketRecord.call_id.is_(None), TicketRecord.call_id.in_(terminal_calls)),
    )


@router.get("/cases/queue")
def case_queue(employee_id: Operator, db: Database, limit: PageSize = 50, offset: PageOffset = 0) -> list[CaseQueueEntry]:
    priority_order = sql_case((TicketRecord.priority == "high", 0), (TicketRecord.priority == "normal", 1), else_=2)
    queue = db.scalars(claimable_cases(employee_id).order_by(
        priority_order, TicketRecord.queued_at, TicketRecord.id,
    ).limit(limit).offset(offset))
    return [CaseQueueEntry(
        id=ticket.id, department=ticket.department, priority=ticket.priority, queued_at=operations.utc(ticket.queued_at),
    ) for ticket in queue]


@router.get("/cases/{ticket_id}")
def case(ticket_id: str, employee_id: Operator, db: Database) -> Ticket:
    require_case(db, employee_id, ticket_id)
    return operations.get_ticket(db, ticket_id)


@router.get("/cases/{ticket_id}/context")
def case_context(ticket_id: str, employee_id: Operator, db: Database) -> CaseContext:
    require_case(db, employee_id, ticket_id)
    ticket = operations.get_ticket(db, ticket_id)
    call = db.get(CallRecord, ticket.call_id) if ticket.call_id else None
    data = call.handoff if call else None
    handoff = Handoff.model_validate(data) if data and data.get("ticket_id") == ticket_id else None
    return CaseContext(ticket=ticket, handoff=handoff, call_outcome=call.outcome if call else None)


@router.get("/cases/{ticket_id}/events")
def case_events(ticket_id: str, employee_id: Operator, db: Database) -> list[CallEvent]:
    require_case(db, employee_id, ticket_id)
    events = db.scalars(select(OperationEvent).where(OperationEvent.ticket_id == ticket_id).order_by(OperationEvent.id))
    return [CallEvent(type=event.type, created_at=operations.utc(event.created_at), details=event.details) for event in events]


@router.post("/cases/{ticket_id}/claim")
def claim_case(ticket_id: str, employee_id: Operator) -> Ticket:
    with service.transaction() as db:
        existing_owner = db.scalar(select(TicketRecord.assigned_employee_id).where(TicketRecord.id == ticket_id))
        if existing_owner == employee_id:
            return operations.get_ticket(db, ticket_id)
        ticket = db.scalar(claimable_cases(employee_id).where(TicketRecord.id == ticket_id))
        if ticket is None:
            raise operations.RecordNotFound("Обращение не найдено")
        return operations.update_ticket(
            db, ticket_id, TicketUpdate(status=TicketStatus.IN_PROGRESS), employee_id=employee_id, commit=False,
        )


@router.patch("/cases/{ticket_id}")
def update_case(ticket_id: str, employee_id: Operator, change: CaseUpdate) -> Ticket:
    with service.transaction() as db:
        require_case(db, employee_id, ticket_id)
        return operations.update_ticket(
            db, ticket_id, TicketUpdate(status=change.status), employee_id=employee_id, commit=False,
        )


@router.get("/analytics")
def analytics(employee_id: Operator, db: Database) -> OperatorAnalytics:
    durations = select(
        AssignmentRecord.call_id,
        func.sum(func.unixepoch(AssignmentRecord.ended_at) - func.unixepoch(AssignmentRecord.connected_at)).label("seconds"),
    ).where(
        AssignmentRecord.employee_id == employee_id, AssignmentRecord.connected_at.is_not(None),
    ).group_by(AssignmentRecord.call_id).subquery()
    handled, total, average = db.execute(select(
        func.count(), func.coalesce(func.sum(durations.c.seconds), 0), func.avg(durations.c.seconds),
    ).select_from(durations)).one()
    outcomes = dict(db.execute(select(CallRecord.outcome, func.count()).join(
        durations, durations.c.call_id == CallRecord.id,
    ).where(CallRecord.ended_at.is_not(None)).group_by(CallRecord.outcome)).all())
    return OperatorAnalytics(
        calls_handled=handled, calls_finished=sum(outcomes.values()), total_talk_seconds=total,
        average_talk_seconds=round(average) if average is not None else None, outcomes=outcomes,
    )


OPERATOR_REFRESH_RESOURCES = {"queue", "workspace", "employees"}


def operator_events_after(employee_id: str, cursor: int) -> list[tuple[int, str | None]]:
    with database.SessionLocal() as db:
        visible_cases = select(TicketRecord.id).where(case_visibility(db, employee_id))
        department = select(EmployeeRecord.department).where(EmployeeRecord.id == employee_id).scalar_subquery()
        department_cases = select(TicketRecord.id).where(TicketRecord.department == department)
        department_case_calls = select(TicketRecord.call_id).where(TicketRecord.department == department)
        events = db.execute(select(
            OperationEvent, OperationEvent.call_id.in_(service.operator_call_ids(db, employee_id)),
            OperationEvent.ticket_id.in_(visible_cases),
            or_(OperationEvent.ticket_id.in_(department_cases), and_(
                OperationEvent.type == "call.ended", OperationEvent.call_id.in_(department_case_calls),
            )),
        ).where(OperationEvent.id > cursor).order_by(OperationEvent.id).limit(100))
        return [
            (event.id, operator_event_payload(event, employee_id, own_call, own_case, department_case))
            for event, own_call, own_case, department_case in events
        ]


def operator_event_payload(
    event: OperationEvent, employee_id: str, own_call: bool | None, own_case: bool | None, department_case: bool | None,
) -> str | None:
    if event.type == "call.operator_note" and json.loads(event.details)["employee_id"] != employee_id:
        return None
    resources = OPERATOR_REFRESH_RESOURCES.intersection(event.resources)
    if department_case:
        resources.add("tickets")
    if own_case or (own_call and event.ticket_id is None):
        return event_payload(event, resources=sorted(set(event.resources).union(resources)))
    if resources:
        return json.dumps({"type": "contact_center.refresh", "resources": sorted(resources), "call_id": None, "ticket_id": None})
    return None


@router.get(
    "/events", response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def event_stream(
    request: Request, employee_id: Operator, last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    return await stream_events(request, last_event_id, partial(operator_events_after, employee_id))
