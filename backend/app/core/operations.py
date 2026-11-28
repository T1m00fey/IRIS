from datetime import datetime, timezone

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from app.core.crm_models import ACTIVE_INCIDENT_STATUSES, Address, Customer, Incident
from app.core.operations_models import CallMessageRecord, CallRecord, EmployeeRecord, OperationEvent, TicketRecord
from app.core.schemas import (
    AIAction, Call, CallDetail, CallEvent, CallList, CallMessage, CallStatus, Dashboard,
    DashboardIncident, Department, DepartmentCount, Employee, Handoff,
    Ticket, TicketList, TicketStatus, TicketUpdate,
)


class RecordNotFound(Exception):
    pass


class OperationConflict(Exception):
    pass


def utc(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value is not None else None


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def duration_seconds(start: datetime, end: datetime) -> int:
    return max(0, int((end - start).total_seconds()))


def call_item(record: CallRecord, customer_name: str | None) -> Call:
    elapsed_until = record.ended_at
    if elapsed_until is None and record.status == CallStatus.ACTIVE:
        elapsed_until = utc_now()
    return Call(
        id=record.id, customer_id=record.customer_id, customer_name=customer_name,
        account_number=record.account_number, caller_phone_masked=record.caller_phone_masked,
        status=record.status, phase=record.phase, outcome=record.outcome, department=record.department,
        started_at=utc(record.started_at), connected_at=utc(record.connected_at), ended_at=utc(record.ended_at),
        duration_seconds=(
            duration_seconds(record.connected_at, elapsed_until)
            if record.connected_at and elapsed_until else None
        ),
        summary=record.summary,
    )


def call_query():
    return select(CallRecord, Customer.full_name).outerjoin(Customer, CallRecord.customer_id == Customer.id)


def list_calls(db: Session, filters: list, limit: int, offset: int) -> CallList:
    total = db.scalar(select(func.count()).select_from(CallRecord).where(*filters))
    rows = db.execute(
        call_query().where(*filters).order_by(CallRecord.started_at.desc(), CallRecord.id).limit(limit).offset(offset)
    )
    return CallList(items=[call_item(*row) for row in rows], total=total, limit=limit, offset=offset)


def call_messages(db: Session, call_id: str) -> list[CallMessage]:
    rows = db.scalars(
        select(CallMessageRecord).where(CallMessageRecord.call_id == call_id).order_by(CallMessageRecord.id)
    )
    return [message_item(row) for row in rows]


def message_item(row: CallMessageRecord) -> CallMessage:
    return CallMessage(id=row.id, speaker=row.speaker, text=row.text, created_at=utc(row.created_at))


def get_call(db: Session, call_id: str) -> CallDetail:
    row = db.execute(call_query().where(CallRecord.id == call_id)).one_or_none()
    if row is None:
        raise RecordNotFound("Звонок не найден")
    record, customer_name = row
    handoff = Handoff.model_validate(record.handoff) if record.handoff else None
    checks = handoff.verified_facts if handoff else []
    history = db.scalars(
        select(OperationEvent).where(OperationEvent.call_id == call_id, OperationEvent.type != "call.operator_note")
        .order_by(OperationEvent.id)
    )
    tickets = db.execute(
        ticket_query().where(TicketRecord.call_id == call_id).order_by(TicketRecord.created_at.desc())
    )
    now = utc_now()
    return CallDetail(
        **call_item(record, customer_name).model_dump(), handoff=handoff, can_join=False,
        summary_reviewed_at=utc(record.summary_reviewed_at), transcript=call_messages(db, call_id),
        crm_checks=checks, ai_actions=[
            AIAction(action=fact.source, created_at=fact.checked_at, result=fact.text) for fact in checks
        ],
        tickets=[ticket_item(*ticket, now) for ticket in tickets],
        events=[CallEvent(type=event.type, created_at=utc(event.created_at), details=event.details) for event in history],
    )


def confirm_summary(db: Session, call_id: str, *, commit: bool = True) -> CallDetail:
    record = db.get(CallRecord, call_id)
    if record is None:
        raise RecordNotFound("Звонок не найден")
    if not record.summary:
        raise OperationConflict("У звонка нет сводки для проверки")

    now = utc_now()
    result = db.execute(
        update(CallRecord).where(CallRecord.id == call_id, CallRecord.summary_reviewed_at.is_(None))
        .values(summary_reviewed_at=now)
    )
    if result.rowcount:
        db.add(OperationEvent(
            call_id=call_id, type="call.summary_reviewed", created_at=now,
            resources=["calls"], details="Оператор проверил итоговую сводку",
        ))
    if commit:
        db.commit()
    return get_call(db, call_id)


def ticket_item(record: TicketRecord, customer_name: str | None, assignee_name: str | None, now: datetime) -> Ticket:
    return Ticket(
        id=record.id, call_id=record.call_id, customer_id=record.customer_id, customer_name=customer_name,
        account_number=record.account_number, department=record.department, status=record.status,
        priority=record.priority, title=record.title, summary=record.summary, created_at=utc(record.created_at),
        queued_at=utc(record.queued_at), started_at=utc(record.started_at), closed_at=utc(record.closed_at),
        waiting_seconds=duration_seconds(record.queued_at, record.started_at or record.closed_at or now),
        assigned_employee_id=record.assigned_employee_id, assigned_employee_name=assignee_name,
    )


def ticket_query():
    return (
        select(TicketRecord, Customer.full_name, EmployeeRecord.full_name)
        .outerjoin(Customer, TicketRecord.customer_id == Customer.id)
        .outerjoin(EmployeeRecord, TicketRecord.assigned_employee_id == EmployeeRecord.id)
    )


def list_tickets(db: Session, filters: list, limit: int, offset: int, sort: str) -> TicketList:
    total = db.scalar(select(func.count()).select_from(TicketRecord).where(*filters))
    newest = (TicketRecord.created_at.desc(), TicketRecord.id)
    queue_order = (
        case((TicketRecord.status == TicketStatus.QUEUED, 0), (TicketRecord.status == TicketStatus.IN_PROGRESS, 1), else_=2),
        case((TicketRecord.priority == "high", 0), (TicketRecord.priority == "normal", 1), else_=2),
        TicketRecord.queued_at, TicketRecord.id,
    )
    rows = db.execute(
        ticket_query().where(*filters).order_by(*(queue_order if sort == "queue" else newest)).limit(limit).offset(offset)
    )
    now = utc_now()
    return TicketList(items=[ticket_item(*row, now) for row in rows], total=total, limit=limit, offset=offset)


def get_ticket(db: Session, ticket_id: str) -> Ticket:
    row = db.execute(ticket_query().where(TicketRecord.id == ticket_id)).one_or_none()
    if row is None:
        raise RecordNotFound("Обращение не найдено")
    return ticket_item(*row, utc_now())


def update_ticket(
    db: Session, ticket_id: str, patch: TicketUpdate, *, employee_id: str | None = None, commit: bool = True,
) -> Ticket:
    record = db.get(TicketRecord, ticket_id)
    if record is None:
        raise RecordNotFound("Обращение не найдено")

    wants_transfer = patch.department is not None and patch.department != record.department
    wants_status_change = patch.status is not None and patch.status != record.status
    if not wants_transfer and not wants_status_change:
        return get_ticket(db, ticket_id)
    if record.status == TicketStatus.CLOSED:
        raise OperationConflict("Закрытое обращение нельзя изменить")
    if wants_transfer and wants_status_change:
        raise OperationConflict("Перенаправление и изменение статуса выполняются отдельными действиями")

    now = utc_now()
    if wants_transfer:
        values = dict(
            department=patch.department, status=TicketStatus.QUEUED, queued_at=now,
            started_at=None, assigned_employee_id=None,
        )
        details = "Обращение перенаправлено в другой отдел"
    elif record.status == TicketStatus.QUEUED and patch.status == TicketStatus.IN_PROGRESS:
        if employee_id is None:
            employee_id = db.scalar(select(EmployeeRecord.id).where(EmployeeRecord.is_current).limit(1))
        values = dict(status=TicketStatus.IN_PROGRESS, started_at=now, assigned_employee_id=employee_id)
        details = "Обращение принято в работу"
    elif record.status == TicketStatus.IN_PROGRESS and patch.status == TicketStatus.CLOSED:
        values = dict(status=TicketStatus.CLOSED, closed_at=now)
        details = "Обращение закрыто"
    else:
        raise OperationConflict("Нельзя перейти к выбранному статусу обращения")

    result = db.execute(
        update(TicketRecord).where(
            TicketRecord.id == record.id, TicketRecord.status == record.status,
            TicketRecord.department == record.department, TicketRecord.queued_at == record.queued_at,
        ).values(**values)
    )
    if not result.rowcount:
        raise OperationConflict("Обращение уже изменилось. Обновите карточку")
    db.add(OperationEvent(
        call_id=record.call_id, ticket_id=ticket_id, type="ticket.updated", created_at=now,
        resources=["tickets", "calls", "dashboard"], details=details,
    ))
    if commit:
        db.commit()
    return get_ticket(db, ticket_id)


def get_dashboard(db: Session) -> Dashboard:
    call_counts = dict(db.execute(select(CallRecord.status, func.count()).group_by(CallRecord.status)).all())
    ticket_counts = dict(db.execute(select(TicketRecord.department, func.count()).group_by(TicketRecord.department)).all())
    average_duration = db.scalar(
        select(func.avg(func.unixepoch(CallRecord.ended_at) - func.unixepoch(CallRecord.connected_at)))
        .where(CallRecord.ended_at >= CallRecord.connected_at)
    )
    incidents = db.execute(
        select(Incident, func.coalesce(Incident.district_label, Address.label)).join(Address)
        .where(Incident.status.in_(ACTIVE_INCIDENT_STATUSES)).order_by(Incident.started_at.desc(), Incident.id)
    )
    recent = db.execute(call_query().order_by(CallRecord.started_at.desc(), CallRecord.id).limit(6))
    return Dashboard(
        total_calls=sum(call_counts.values()), active_calls=call_counts.get(CallStatus.ACTIVE, 0),
        completed_calls=call_counts.get(CallStatus.COMPLETED, 0), total_tickets=sum(ticket_counts.values()),
        average_duration_seconds=round(average_duration) if average_duration is not None else None,
        tickets_by_department=[DepartmentCount(department=dep, count=ticket_counts.get(dep, 0)) for dep in Department],
        recent_calls=[call_item(*row) for row in recent],
        pending_incidents=db.scalar(select(func.count()).select_from(Incident).where(Incident.status == "suspected")),
        active_incidents=[DashboardIncident(
            id=row.id, title=row.title, description=row.description, status=row.status, address=address,
            started_at=utc(row.started_at), estimated_resolution_at=utc(row.estimated_resolution_at),
        ) for row, address in incidents],
    )


def employee_item(record: EmployeeRecord) -> Employee:
    return Employee(
        id=record.id, full_name=record.full_name, department=record.department,
        status=record.status, is_current=record.is_current, updated_at=utc(record.updated_at),
    )


def list_employees(db: Session) -> list[Employee]:
    employees = db.scalars(select(EmployeeRecord).order_by(EmployeeRecord.is_current.desc(), EmployeeRecord.id))
    return [employee_item(record) for record in employees]
