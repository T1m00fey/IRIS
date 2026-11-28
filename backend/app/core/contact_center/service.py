import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import case, select, text
from sqlalchemy.orm import Session, aliased

from app.core.contact_center.models import (
    AssignmentRecord, DepartmentRecord, QueueRecord, RoutingRule,
    VoiceCommandRecord, VoiceReceipt, WorkforceRecord,
)
from app.core.contact_center.schemas import (
    Assignment, CallControlRequest, DepartmentProfile, EmployeeProfile, OperatorSettings, QueueEntry,
    QueueRequest, VoiceCommand, Workspace,
)
from app.core.operations import OperationConflict, RecordNotFound, duration_seconds, utc, utc_now
from app.core.operations_models import CallRecord, EmployeeRecord, OperationEvent, TicketRecord
from app.core.schemas import CallPhase, CallStatus, EmployeeStatus
from app.database import SessionLocal


LIVE = ("offered", "accepted", "connected")


def enabled() -> bool:
    return os.getenv("IRIS_CONTACT_CENTER", "1") == "1"


def timeout(name: str, default: int) -> timedelta:
    return timedelta(seconds=max(1, int(os.getenv(name, str(default)))))


@contextmanager
def transaction() -> Iterator[Session]:
    with SessionLocal.begin() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        yield db


def _event(db, kind, now, *, call_id=None, ticket_id=None, details=None):
    resources = ["workspace", "queue", "employees"]
    if call_id is not None:
        resources.extend(["calls", "dashboard", "analytics"])
    if ticket_id is not None:
        resources.append("tickets")
    db.add(OperationEvent(
        type=kind, created_at=now, call_id=call_id, ticket_id=ticket_id, details=details, resources=resources,
    ))


def _call(db, call_id):
    record = db.get(CallRecord, call_id)
    if record is None:
        raise RecordNotFound("Звонок не найден")
    return record


def _employee(db, employee_id):
    record = db.get(EmployeeRecord, employee_id)
    profile = db.get(WorkforceRecord, employee_id)
    if record is None or (profile is not None and profile.role != "operator"):
        raise RecordNotFound("Сотрудник не найден")
    return record, profile


def _profile_for_write(db, employee, profile):
    if profile is None:
        profile = WorkforceRecord(employee_id=employee.id, available_since=employee.updated_at)
        db.add(profile)
    return profile


def _live_assignment(db, *, call_id=None, employee_id=None):
    lookup = AssignmentRecord.call_id == call_id if call_id is not None else AssignmentRecord.employee_id == employee_id
    return db.scalar(select(AssignmentRecord).where(lookup, AssignmentRecord.state.in_(LIVE)))


def _which_assignment(db, assignment_id, *, call_id=None, employee_id=None):
    record = db.get(AssignmentRecord, assignment_id)
    if (record is None or (call_id is not None and record.call_id != call_id)
            or (employee_id is not None and record.employee_id != employee_id)):
        raise RecordNotFound("Назначение не найдено")
    return record


def _assignment(record):
    return Assignment(
        id=record.id, call_id=record.call_id, employee_id=record.employee_id, state=record.state,
        offered_at=utc(record.offered_at), expires_at=utc(record.expires_at), accepted_at=utc(record.accepted_at),
        connected_at=utc(record.connected_at), ended_at=utc(record.ended_at),
    )


def _queue_order():
    return (case((QueueRecord.priority == "high", 0), (QueueRecord.priority == "normal", 1), else_=2),
            QueueRecord.queued_at, QueueRecord.call_id)


def _queue_data(record, now, position):
    return QueueEntry(
        call_id=record.call_id, department=record.department, category=record.category, priority=record.priority,
        required_skills=record.required_skills, state=record.state, queued_at=utc(record.queued_at),
        waiting_seconds=duration_seconds(record.queued_at, record.waiting_ended_at or record.closed_at or now), position=position,
    )


def _waiting(db, department=None):
    query = select(QueueRecord).where(QueueRecord.state == "waiting").order_by(*_queue_order())
    if department is not None:
        query = query.where(QueueRecord.department == department)
    return db.scalars(query).all()


def _queue_entry(db, record, now):
    position = next((index for index, item in enumerate(_waiting(db, record.department), 1)
                     if item.call_id == record.call_id), None) if record.state == "waiting" else None
    return _queue_data(record, now, position)


def _command(record):
    return VoiceCommand(
        id=record.id, call_id=record.call_id, assignment_id=record.assignment_id, kind=record.kind,
        payload=record.payload, created_at=utc(record.created_at), acknowledged_at=utc(record.acknowledged_at),
    )


def _issue_command(db, assignment, kind, now, payload=None, event_id=None):
    command = VoiceCommandRecord(
        id=uuid4().hex, call_id=assignment.call_id, assignment_id=assignment.id, kind=kind,
        payload=payload or {}, event_id=event_id, created_at=now,
    )
    db.add(command)
    return command


def _pending_commands(db, call_id):
    return select(VoiceCommandRecord).where(
        VoiceCommandRecord.call_id == call_id,
        VoiceCommandRecord.acknowledged_at.is_(None), VoiceCommandRecord.cancelled_at.is_(None),
    ).order_by(VoiceCommandRecord.created_at, VoiceCommandRecord.id)


def _retire_assignment(db, assignment, state, now):
    was_connecting = assignment.state == "accepted"
    assignment.state = state
    assignment.ended_at = now
    assignment.expires_at = None
    for command in db.scalars(_pending_commands(db, assignment.call_id).where(
        VoiceCommandRecord.assignment_id == assignment.id, VoiceCommandRecord.kind != "cancel_connect",
    )):
        command.cancelled_at = now
    employee, profile = _employee(db, assignment.employee_id)
    profile = _profile_for_write(db, employee, profile)
    employee.updated_at = now
    if assignment.connected_at is not None:
        employee.status = "wrap_up"
    elif employee.status in ("available", "busy"):
        employee.status = "available"
        profile.available_since = now
    if was_connecting and state in ("failed", "expired"):
        _issue_command(db, assignment, "cancel_connect", now)
    _event(db, "assignment." + state, now, call_id=assignment.call_id, details=f"Сотрудник {employee.id}")


def _requeue(db, record, assignment, state, now):
    _retire_assignment(db, assignment, state, now)
    record.state = "waiting"
    _call(db, record.call_id).phase = CallPhase.WAITING_FOR_OPERATOR
    _event(db, "call.queued", now, call_id=record.call_id)


def dispatch(db: Session, now: datetime | None = None) -> None:
    now = now or utc_now()
    expired = db.scalars(select(AssignmentRecord).where(
        AssignmentRecord.state.in_(["offered", "accepted"]), AssignmentRecord.expires_at <= now,
    )).all()
    for assignment in expired:
        _requeue(db, db.get(QueueRecord, assignment.call_id), assignment, "expired", now)

    queued = _waiting(db)
    if not queued:
        return
    active_department_codes = set(db.scalars(select(DepartmentRecord.code).where(DepartmentRecord.enabled)))
    occupied = set(db.scalars(select(AssignmentRecord.employee_id).where(AssignmentRecord.state.in_(LIVE))))
    candidates = db.execute(select(EmployeeRecord, WorkforceRecord).outerjoin(WorkforceRecord).where(
        EmployeeRecord.status == "available",
    )).all()
    candidates = sorted(candidates, key=lambda row: (row[1].available_since if row[1] else row[0].updated_at, row[0].id))
    offer_timeout = timeout("IRIS_ASSIGNMENT_TIMEOUT_SECONDS", 15)
    for entry in queued:
        if entry.department not in active_department_codes:
            continue
        previous = {
            employee_id: offered_at for employee_id, offered_at in db.execute(
                select(AssignmentRecord.employee_id, AssignmentRecord.offered_at).where(
                    AssignmentRecord.call_id == entry.call_id,
                    AssignmentRecord.state.in_(["expired", "declined", "failed"]),
                ).order_by(AssignmentRecord.offered_at)
            )
        }
        for employee, profile in candidates:
            if employee.id in occupied or employee.department != entry.department:
                continue
            if entry.target_employee_id is not None and employee.id != entry.target_employee_id:
                continue
            if profile is not None and (not profile.on_shift or profile.role != "operator"):
                continue
            if not set(entry.required_skills).issubset(profile.skills if profile else []):
                continue
            # Automatic release changes the fairness clock, but not the last explicit availability transition.
            if employee.id in previous:
                reset = profile.retry_available_at if profile else None
                if reset is None or reset <= previous[employee.id]:
                    continue
            db.add(AssignmentRecord(
                id=uuid4().hex, call_id=entry.call_id, employee_id=employee.id, state="offered",
                offered_at=now, expires_at=now + offer_timeout,
            ))
            entry.state = "offered"
            occupied.add(employee.id)
            _event(db, "assignment.offered", now, call_id=entry.call_id, details=f"Сотрудник {employee.id}")
            break


def _department(db, code):
    department = db.get(DepartmentRecord, code) if code is not None else None
    if department is None or not department.enabled:
        raise OperationConflict("Укажите доступный отдел или настроенную категорию обращения")
    return department


def request_operator(db: Session, call_id: str, request: QueueRequest) -> QueueEntry:
    call = _call(db, call_id)
    receipt = db.get(VoiceReceipt, (call_id, "handoff", request.event_id))
    payload_hash = sha256(request.model_dump_json(exclude={"event_id"}).encode()).hexdigest()
    record = db.get(QueueRecord, call_id)
    now = utc_now()
    if receipt is not None:
        if receipt.payload_hash != payload_hash:
            raise OperationConflict("Событие передачи уже сохранено с другими параметрами")
        return _queue_entry(db, record, now)
    if call.status != CallStatus.ACTIVE or record is not None:
        raise OperationConflict("Передача доступна для активного звонка вне живой очереди")
    rule = db.get(RoutingRule, request.category) if request.category is not None else None
    department = _department(db, request.department or (rule.department if rule else call.department))
    skills = sorted(set(request.required_skills) | set(rule.required_skills if rule else []))
    record = QueueRecord(
        call_id=call_id, department=department.code, category=request.category, priority=request.priority,
        required_skills=skills, state="waiting", queued_at=now,
    )
    db.add_all([record, VoiceReceipt(
        call_id=call_id, operation="handoff", event_id=request.event_id, payload_hash=payload_hash,
    )])
    call.department = department.code
    call.phase = CallPhase.WAITING_FOR_OPERATOR
    _event(db, "call.queued", now, call_id=call_id)
    dispatch(db, now)
    return _queue_entry(db, record, now)


def assignment_for_call(db: Session, call_id: str) -> Assignment | None:
    _call(db, call_id)
    assignment = _live_assignment(db, call_id=call_id)
    return _assignment(assignment) if assignment is not None else None


def accept_assignment(db: Session, employee_id: str, assignment_id: str) -> Assignment:
    assignment = _which_assignment(db, assignment_id, employee_id=employee_id)
    if assignment.state in ("accepted", "connected"):
        if assignment.expires_at is not None and assignment.expires_at <= utc_now():
            raise OperationConflict("Срок подключения истёк")
        return _assignment(assignment)
    now = utc_now()
    employee, profile = _employee(db, employee_id)
    if (assignment.state != "offered" or assignment.expires_at <= now or employee.status != "available"
            or (profile is not None and not profile.on_shift)):
        raise OperationConflict("Предложение больше недоступно")
    call = _call(db, assignment.call_id)
    entry = db.get(QueueRecord, call.id)
    if call.status != CallStatus.ACTIVE or entry.state != "offered" or employee.department != entry.department:
        raise OperationConflict("Предложение больше недоступно")
    assignment.state = "accepted"
    assignment.accepted_at = now
    assignment.expires_at = now + timeout("IRIS_CONNECTION_TIMEOUT_SECONDS", 30)
    employee.status = "busy"
    employee.updated_at = now
    entry.state = "connecting"
    call.phase = CallPhase.OPERATOR_JOINING
    _issue_command(db, assignment, "connect", now, {"employee_id": employee_id})
    _event(db, "assignment.accepted", now, call_id=call.id, details=f"Сотрудник {employee_id}")
    return _assignment(assignment)


def decline_assignment(db: Session, employee_id: str, assignment_id: str) -> Assignment:
    assignment = _which_assignment(db, assignment_id, employee_id=employee_id)
    if assignment.state == "declined":
        return _assignment(assignment)
    now = utc_now()
    if assignment.state != "offered" or assignment.expires_at <= now:
        raise OperationConflict("Предложение больше недоступно")
    _requeue(db, db.get(QueueRecord, assignment.call_id), assignment, "declined", now)
    dispatch(db, now)
    return _assignment(assignment)


def confirm_connection(db: Session, call_id: str, assignment_id: str) -> Assignment:
    assignment = _which_assignment(db, assignment_id, call_id=call_id)
    if assignment.connected_at is not None:
        return _assignment(assignment)
    now = utc_now()
    call = _call(db, call_id)
    if assignment.state != "accepted" or assignment.expires_at <= now or call.status != CallStatus.ACTIVE:
        raise OperationConflict("Назначение больше не ожидает соединения")
    assignment.state = "connected"
    assignment.connected_at = now
    assignment.expires_at = None
    entry = db.get(QueueRecord, call_id)
    entry.state = "connected"
    entry.waiting_ended_at = now
    call.phase = CallPhase.WITH_OPERATOR
    for command in db.scalars(_pending_commands(db, call_id).where(
        VoiceCommandRecord.assignment_id == assignment_id, VoiceCommandRecord.kind == "connect",
    )):
        command.acknowledged_at = now
    _event(db, "assignment.connected", now, call_id=call_id, details=f"Сотрудник {assignment.employee_id}")
    return _assignment(assignment)


def fail_connection(db: Session, call_id: str, assignment_id: str) -> Assignment:
    assignment = _which_assignment(db, assignment_id, call_id=call_id)
    if assignment.state == "failed":
        return _assignment(assignment)
    now = utc_now()
    if assignment.state != "accepted" or assignment.expires_at <= now:
        raise OperationConflict("Назначение больше не ожидает соединения")
    _requeue(db, db.get(QueueRecord, call_id), assignment, "failed", now)
    dispatch(db, now)
    return _assignment(assignment)


def release_call(db: Session, call_id: str) -> None:
    record = db.get(QueueRecord, call_id)
    if record is None or record.state == "closed":
        return
    now = utc_now()
    assignment = _live_assignment(db, call_id=call_id)
    if assignment is not None:
        _retire_assignment(db, assignment, "ended", now)
    for command in db.scalars(_pending_commands(db, call_id)):
        command.cancelled_at = now
    record.state = "closed"
    record.closed_at = now
    _event(db, "queue.closed", now, call_id=call_id)
    dispatch(db, now)


def list_commands(db: Session, call_id: str) -> list[VoiceCommand]:
    _call(db, call_id)
    return [_command(record) for record in db.scalars(_pending_commands(db, call_id))]


def acknowledge_command(db: Session, call_id: str, command_id: str) -> VoiceCommand:
    record = db.get(VoiceCommandRecord, command_id)
    if record is None or record.call_id != call_id:
        raise RecordNotFound("Команда не найдена")
    if record.acknowledged_at is not None:
        return _command(record)
    if record.cancelled_at is not None:
        raise OperationConflict("Команда больше не действует")
    now = utc_now()
    record.acknowledged_at = now
    if record.kind == "transfer":
        assignment = db.get(AssignmentRecord, record.assignment_id)
        entry = db.get(QueueRecord, call_id)
        call = _call(db, call_id)
        department = record.payload["department"]
        entry.department = department
        entry.target_employee_id = record.payload.get("target_employee_id")
        entry.queued_at = now
        entry.waiting_ended_at = None
        entry.required_skills = []
        call.department = department
        _requeue(db, entry, assignment, "ended", now)
        dispatch(db, now)
    return _command(record)


def request_call_control(db: Session, employee_id: str, assignment_id: str, request: CallControlRequest) -> VoiceCommand:
    assignment = _which_assignment(db, assignment_id, employee_id=employee_id)
    parameters = request.model_dump(include={"department", "target_employee_id"}, exclude_none=True)
    previous = db.scalar(select(VoiceCommandRecord).where(
        VoiceCommandRecord.assignment_id == assignment_id, VoiceCommandRecord.event_id == request.event_id,
    ))
    if previous is not None:
        original = previous.payload.get("request", previous.payload)
        if previous.kind != request.action or original != parameters:
            raise OperationConflict("Команда уже сохранена с другими параметрами")
        return _command(previous)
    if assignment.state != "connected":
        raise OperationConflict("Управление доступно после подтверждения аудиосоединения")
    if db.scalar(_pending_commands(db, assignment.call_id).where(VoiceCommandRecord.kind != "cancel_connect")):
        raise OperationConflict("Ожидается выполнение предыдущей команды")
    if request.action == "transfer":
        target = None
        if request.target_employee_id is not None:
            target, profile = _employee(db, request.target_employee_id)
            if (target.id == employee_id or target.status != "available" or (profile and not profile.on_shift)
                    or _live_assignment(db, employee_id=target.id)):
                raise OperationConflict("Сотрудник недоступен для перевода")
            if request.department is not None and request.department != target.department:
                raise OperationConflict("Сотрудник работает в другом отделе")
        department = _department(db, target.department if target else request.department)
        if target is None and department.code == db.get(QueueRecord, assignment.call_id).department:
            raise OperationConflict("Звонок уже обслуживается в этом отделе")
        payload = {**parameters, "department": department.code, "request": parameters}
    else:
        if parameters:
            raise OperationConflict("Отдел и сотрудник задаются для команды перевода")
        payload = {}
    return _command(_issue_command(db, assignment, request.action, utc_now(), payload, request.event_id))


def _employee_profile(record, profile, assignment, *, own=True):
    on_shift = profile.on_shift if profile else True
    return EmployeeProfile(
        id=record.id, full_name=record.full_name, department=record.department, status=record.status,
        role=profile.role if profile else "operator", company=profile.company if profile else None,
        skills=profile.skills if profile else [], on_shift=on_shift, updated_at=utc(record.updated_at),
        active_call_id=assignment.call_id if own and assignment and assignment.accepted_at else None,
        available_for_assignment=on_shift and record.status == "available" and assignment is None,
    )


def employee_profile(db: Session, employee_id: str) -> EmployeeProfile:
    employee, profile = _employee(db, employee_id)
    return _employee_profile(employee, profile, _live_assignment(db, employee_id=employee_id))


def operator_settings(db: Session, employee_id: str) -> OperatorSettings:
    _, profile = _employee(db, employee_id)
    if profile is None:
        return OperatorSettings()
    return OperatorSettings(notifications_enabled=profile.notifications_enabled, sound_enabled=profile.sound_enabled)


def save_operator_settings(db: Session, employee_id: str, settings: OperatorSettings) -> OperatorSettings:
    employee, profile = _employee(db, employee_id)
    profile = _profile_for_write(db, employee, profile)
    profile.notifications_enabled = settings.notifications_enabled
    profile.sound_enabled = settings.sound_enabled
    return settings


def workspace(db: Session, employee_id: str) -> Workspace:
    employee, profile = _employee(db, employee_id)
    dispatch(db)
    assignment = _live_assignment(db, employee_id=employee_id)
    return Workspace(
        employee=_employee_profile(employee, profile, assignment),
        assignment=_assignment(assignment) if assignment else None,
        call_id=assignment.call_id if assignment else None,
    )


def list_departments(db: Session) -> list[DepartmentProfile]:
    return [DepartmentProfile(code=record.code, name=record.name) for record in db.scalars(
        select(DepartmentRecord).where(DepartmentRecord.enabled).order_by(DepartmentRecord.code),
    )]


def list_queue(db: Session, employee_id: str) -> list[QueueEntry]:
    employee, _ = _employee(db, employee_id)
    now = utc_now()
    dispatch(db, now)
    return [_queue_data(record, now, index) for index, record in enumerate(_waiting(db, employee.department), 1)]


def list_team(db: Session, employee_id: str) -> list[EmployeeProfile]:
    _, caller = _employee(db, employee_id)
    company = caller.company if caller else None
    assignments = {record.employee_id: record for record in db.scalars(
        select(AssignmentRecord).where(AssignmentRecord.state.in_(LIVE)),
    )}
    rows = db.execute(select(EmployeeRecord, WorkforceRecord).outerjoin(WorkforceRecord).order_by(EmployeeRecord.id))
    return [_employee_profile(employee, profile, assignments.get(employee.id), own=employee.id == employee_id)
            for employee, profile in rows if (profile.company if profile else None) == company]


def _set_presence(db, employee, profile, status, now):
    if employee.status == status:
        return
    employee.status = status
    employee.updated_at = now
    if status == "available":
        profile = _profile_for_write(db, employee, profile)
        profile.available_since = now
        profile.retry_available_at = now
    _event(db, "employee.updated", now)


def set_presence(db: Session, employee_id: str, status: EmployeeStatus) -> EmployeeProfile:
    employee, profile = _employee(db, employee_id)
    assignment = _live_assignment(db, employee_id=employee_id)
    if (employee.status == "wrap_up" and employee.status != status) or (assignment and assignment.accepted_at):
        raise OperationConflict("Завершите звонок и постобработку перед сменой статуса")
    if status in ("busy", "wrap_up") and employee.status != status:
        raise OperationConflict("Статус устанавливается автоматически по состоянию звонка")
    now = utc_now()
    _set_presence(db, employee, profile, status, now)
    if assignment and status != "available":
        _requeue(db, db.get(QueueRecord, assignment.call_id), assignment, "declined", now)
    dispatch(db, now)
    return employee_profile(db, employee_id)


def complete_wrap_up(db: Session, employee_id: str) -> EmployeeProfile:
    employee, profile = _employee(db, employee_id)
    if employee.status not in ("wrap_up", "available"):
        raise OperationConflict("Нет постобработки для завершения")
    now = utc_now()
    _set_presence(db, employee, profile, "available", now)
    dispatch(db, now)
    return employee_profile(db, employee_id)


def operator_call_ids(db: Session, employee_id: str):
    later_assignment = aliased(AssignmentRecord)
    last_connected = select(later_assignment.id).where(
        later_assignment.call_id == CallRecord.id, later_assignment.connected_at.is_not(None),
    ).order_by(later_assignment.connected_at.desc(), later_assignment.id.desc()).limit(1).correlate(CallRecord)
    return select(AssignmentRecord.call_id).join(CallRecord, CallRecord.id == AssignmentRecord.call_id).where(
        AssignmentRecord.employee_id == employee_id, AssignmentRecord.accepted_at.is_not(None),
        (AssignmentRecord.state.in_(("accepted", "connected"))) | (
            CallRecord.ended_at.is_not(None) & (AssignmentRecord.id == last_connected.scalar_subquery())
        ),
    )


def require_operator_call(db: Session, employee_id: str, call_id: str) -> None:
    if db.scalar(operator_call_ids(db, employee_id).where(AssignmentRecord.call_id == call_id).limit(1)) is None:
        raise RecordNotFound("Звонок не найден")
