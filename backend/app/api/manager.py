from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_, select

from app.api.contact_center import Database
from app.api.operator import local_day, utc_start
from app.core import operations
from app.core.contact_center import service
from app.core.contact_center.models import AssignmentRecord, QueueRecord
from app.core.contact_center.schemas import Code, DepartmentProfile, Identifier
from app.core.operations_models import CallRecord, EmployeeRecord, TicketRecord
from app.core.schemas import CallOutcome, CallStatus, TicketPriority, TicketStatus


router = APIRouter(prefix="/api/v1/manager", tags=["Руководитель"])
SnapshotState = Literal["waiting", "offered", "connecting", "connected"]


class ManagerAssignment(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    state: Literal["offered", "accepted", "connected"]
    offered_at: datetime
    expires_at: datetime | None
    accepted_at: datetime | None
    connected_at: datetime | None


class ManagerQueueItem(BaseModel):
    call_id: str
    department: str
    state: SnapshotState
    priority: TicketPriority
    category: str | None
    queued_at: datetime
    waiting_seconds: int
    assignment: ManagerAssignment | None


class ContactCenterSnapshot(BaseModel):
    enabled: bool
    departments: list[DepartmentProfile]
    total: int
    limit: int
    offset: int
    items: list[ManagerQueueItem]


@router.get("/contact-center")
def contact_center_snapshot(
    db: Database,
    department: Code | None = None,
    state: SnapshotState | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ContactCenterSnapshot:
    now = operations.utc_now()
    queue = select(QueueRecord).join(CallRecord).where(
        CallRecord.status == CallStatus.ACTIVE,
        QueueRecord.state.in_(("waiting", "offered", "connecting", "connected")),
    )
    if department is not None:
        queue = queue.where(QueueRecord.department == department)
    if state is not None:
        queue = queue.where(QueueRecord.state == state)

    total = db.scalar(select(func.count()).select_from(queue.subquery()))
    rows = db.execute(
        queue.add_columns(AssignmentRecord, EmployeeRecord.full_name)
        .outerjoin(AssignmentRecord, and_(
            AssignmentRecord.call_id == QueueRecord.call_id,
            or_(
                AssignmentRecord.state == "connected",
                and_(AssignmentRecord.state.in_(("offered", "accepted")), AssignmentRecord.expires_at > now),
            ),
        ))
        .outerjoin(EmployeeRecord, EmployeeRecord.id == AssignmentRecord.employee_id)
        .order_by(
            case((QueueRecord.priority == "high", 0), (QueueRecord.priority == "normal", 1), else_=2),
            QueueRecord.queued_at, QueueRecord.call_id,
        )
        .limit(limit).offset(offset)
    )
    items = []
    for entry, assignment, employee_name in rows:
        operator = None
        if assignment is not None and employee_name is not None:
            operator = ManagerAssignment(
                id=assignment.id, employee_id=assignment.employee_id, employee_name=employee_name,
                state=assignment.state, offered_at=operations.utc(assignment.offered_at),
                expires_at=operations.utc(assignment.expires_at), accepted_at=operations.utc(assignment.accepted_at),
                connected_at=operations.utc(assignment.connected_at),
            )
        items.append(ManagerQueueItem(
            call_id=entry.call_id, department=entry.department, state=entry.state,
            priority=entry.priority, category=entry.category, queued_at=operations.utc(entry.queued_at),
            waiting_seconds=operations.duration_seconds(entry.queued_at, entry.waiting_ended_at or now),
            assignment=operator,
        ))

    return ContactCenterSnapshot(
        enabled=service.enabled(), departments=service.list_departments(db),
        total=total, limit=limit, offset=offset, items=items,
    )


class ActivityCounts(BaseModel):
    total_calls: int = 0
    accepted_calls: int = 0
    abandoned_calls: int = 0
    total_tickets: int = 0
    resolved_tickets: int = 0


class ActivityMetrics(ActivityCounts):
    average_answer_seconds: int | None = None
    average_duration_seconds: int | None = None
    average_wait_seconds: int | None = None


class DailyActivity(ActivityCounts):
    date: date


class DepartmentActivity(ActivityMetrics):
    department: str | None
    name: str


class OutcomeCount(BaseModel):
    outcome: CallOutcome
    count: int


class CompanyAnalytics(ActivityMetrics):
    from_date: date
    to_date: date
    departments: list[DepartmentProfile]
    daily: list[DailyActivity]
    by_department: list[DepartmentActivity]
    outcomes: list[OutcomeCount]


@router.get("/analytics")
def company_analytics(
    db: Database,
    from_date: date | None = None,
    to_date: date | None = None,
    department: Code | None = None,
    employee_id: Identifier | None = None,
) -> CompanyAnalytics:
    end = to_date or local_day(operations.utc_now())
    if end <= date.min + timedelta(days=6) or end == date.max:
        raise HTTPException(422, "Некорректная дата завершения периода")
    start = from_date or end - timedelta(days=6)
    if start > end or start == date.min or (end - start).days >= 366:
        raise HTTPException(422, "Укажите период от 1 до 366 дней")
    lower, upper = utc_start(start), utc_start(end + timedelta(days=1))

    answer_at = CallRecord.connected_at
    answered = CallRecord.connected_at.is_not(None)
    duration = case((CallRecord.ended_at >= CallRecord.connected_at,
                     func.julianday(CallRecord.ended_at) - func.julianday(CallRecord.connected_at)))
    call_filters = [CallRecord.started_at >= lower, CallRecord.started_at < upper]
    ticket_filters = []
    if department is not None:
        call_filters.append(CallRecord.department == department)
        ticket_filters.append(TicketRecord.department == department)
    if employee_id is not None:
        own = select(
            AssignmentRecord.call_id,
            func.min(AssignmentRecord.accepted_at).label("accepted_at"),
            func.sum(case((AssignmentRecord.ended_at >= AssignmentRecord.connected_at,
                           func.julianday(AssignmentRecord.ended_at) - func.julianday(AssignmentRecord.connected_at))))
            .label("duration"),
        ).where(AssignmentRecord.employee_id == employee_id, AssignmentRecord.accepted_at.is_not(None))
        own = own.group_by(AssignmentRecord.call_id).cte()
        call_filters.append(CallRecord.id == own.c.call_id)
        ticket_filters.append(TicketRecord.assigned_employee_id == employee_id)
        answer_at = own.c.accepted_at
        answered = own.c.accepted_at.is_not(None)
        duration = own.c.duration

    answer = case((answer_at >= CallRecord.started_at, func.julianday(answer_at) - func.julianday(CallRecord.started_at)))
    call_day = func.date(CallRecord.started_at, "+3 hours")
    calls = db.execute(select(
        call_day, CallRecord.department, CallRecord.outcome, func.count(), func.count(case((answered, 1))),
        func.count(case((CallRecord.status == CallStatus.ABANDONED, 1))),
        func.sum(answer), func.count(answer), func.sum(duration), func.count(duration),
    ).where(*call_filters).group_by(call_day, CallRecord.department, CallRecord.outcome))

    ticket_day = func.date(TicketRecord.created_at, "+3 hours")
    wait = case((TicketRecord.started_at >= TicketRecord.queued_at,
                 func.julianday(TicketRecord.started_at) - func.julianday(TicketRecord.queued_at)))
    tickets = db.execute(select(
        ticket_day, TicketRecord.department, func.count(), func.sum(wait), func.count(wait),
    ).where(*ticket_filters, TicketRecord.created_at >= lower, TicketRecord.created_at < upper)
        .group_by(ticket_day, TicketRecord.department))
    closure_day = func.date(TicketRecord.closed_at, "+3 hours")
    resolved = db.execute(select(closure_day, TicketRecord.department, func.count()).where(
        *ticket_filters, TicketRecord.status == TicketStatus.CLOSED,
        TicketRecord.closed_at >= lower, TicketRecord.closed_at < upper,
    ).group_by(closure_day, TicketRecord.department))

    departments = service.list_departments(db)
    names = {item.code: item.name for item in departments}
    departments_in_report = {department: ActivityAccumulator()} if department else {
        item.code: ActivityAccumulator() for item in departments
    }
    daily = {start + timedelta(days=offset): ActivityAccumulator() for offset in range((end - start).days + 1)}
    company = ActivityAccumulator()
    outcomes: dict[CallOutcome, int] = {}
    for day, code, outcome, total, accepted, abandoned, answer_sum, answer_count, duration_sum, duration_count in calls:
        outcomes[outcome] = outcomes.get(outcome, 0) + total
        for bucket in (company, daily[date.fromisoformat(day)], departments_in_report.setdefault(code, ActivityAccumulator())):
            bucket.counts.total_calls += total
            bucket.counts.accepted_calls += accepted
            bucket.counts.abandoned_calls += abandoned
            bucket.answer_days += answer_sum or 0
            bucket.answer_count += answer_count
            bucket.duration_days += duration_sum or 0
            bucket.duration_count += duration_count
    for day, code, count, wait_sum, wait_count in tickets:
        for bucket in (company, daily[date.fromisoformat(day)], departments_in_report.setdefault(code, ActivityAccumulator())):
            bucket.counts.total_tickets += count
            bucket.wait_days += wait_sum or 0
            bucket.wait_count += wait_count
    for day, code, count in resolved:
        for bucket in (company, daily[date.fromisoformat(day)], departments_in_report.setdefault(code, ActivityAccumulator())):
            bucket.counts.resolved_tickets += count

    return CompanyAnalytics(
        **company.metrics(), from_date=start, to_date=end, departments=departments,
        daily=[DailyActivity(date=day, **activity.counts.model_dump()) for day, activity in daily.items()],
        by_department=[
            DepartmentActivity(department=code, name=names.get(code, code or "Без отдела"), **activity.metrics())
            for code, activity in departments_in_report.items()
        ],
        outcomes=[OutcomeCount(outcome=outcome, count=count) for outcome, count in sorted(outcomes.items())],
    )


class ActivityAccumulator:
    def __init__(self) -> None:
        self.counts = ActivityCounts()
        self.answer_days = self.duration_days = self.wait_days = 0.0
        self.answer_count = self.duration_count = self.wait_count = 0

    def metrics(self) -> dict:
        return dict(
            **self.counts.model_dump(),
            average_answer_seconds=round(self.answer_days * 86400 / self.answer_count) if self.answer_count else None,
            average_duration_seconds=round(self.duration_days * 86400 / self.duration_count) if self.duration_count else None,
            average_wait_seconds=round(self.wait_days * 86400 / self.wait_count) if self.wait_count else None,
        )
