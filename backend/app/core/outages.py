import re
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.crm_models import ACTIVE_INCIDENT_STATUSES, Account, Address, Incident
from app.core.operations_models import CallRecord, OperationEvent, TicketRecord
from app.core.schemas import Department
from app.database import address_district, address_key, normalize_text


REPORT_WINDOW = timedelta(minutes=30)
MIN_CUSTOMERS = 3
PROBLEMS = {
    "unstable": (
        "Нестабильное подключение",
        r"нестабильн|перебо|обрыв|пропада(?:ет|ют)|потер[ия] пакет|отвалива",
    ),
    "slow": (
        "Низкая скорость интернета",
        r"(?:низк|упал|пада|снизил)\w*\s+скорост|скорост\w*\s+(?:упал|пада|снизил|низк)|"
        r"медленн|тормоз|высок\w* пинг",
    ),
    "offline": (
        "Интернет недоступен",
        r"нет\s+(?:интернета|связи|подключения|сигнала)|не\s+работает\s+(?:интернет|связь)|"
        r"интернет\w*\s+(?:не\s+работает|недоступен|пропал|отсутствует)|"
        r"пропал\s+(?:интернет|сигнал)|отсутств\w*\s+(?:интернет|связь)|"
        r"восстановить\s+(?:связь|интернет)|не\s+(?:подключается|грузится)",
    ),
}


def classify_problem(*texts: str) -> str | None:
    for value in texts:
        normalized = normalize_text(value)
        for problem, (_, pattern) in PROBLEMS.items():
            if re.search(pattern, normalized):
                return problem
    return None


def incident_event(db: Session, kind: str, now: datetime, *, published: bool = False) -> None:
    resources = ["incident_alerts", "dashboard"]
    if published:
        resources.extend(["incidents", "customers"])
    db.add(OperationEvent(type=kind, created_at=now, resources=resources))


def detect_outage(db: Session, ticket: TicketRecord) -> None:
    if ticket.department != Department.TECHNICAL_SUPPORT or not ticket.customer_id or not ticket.account_number:
        return
    account = db.get(Account, ticket.account_number)
    if account is None or account.customer_id != ticket.customer_id or account.service_status != "active":
        return
    call = db.get(CallRecord, ticket.call_id) if ticket.call_id else None
    problem = classify_problem(ticket.title, (call.handoff or {}).get("customer_report", "") if call else "", ticket.summary)
    if problem is None:
        return

    address = account.address
    building = address_key(address.label)
    if not building:
        return
    district = address_district(address.label, address.district)
    district_id, district_label = district or (None, None)
    same_building = func.address_key(Address.label) == building
    in_district = func.district_key(Address.label, Address.district) == district_id if district else False
    now = ticket.created_at
    earliest = now - REPORT_WINDOW
    reports = db.execute(
        select(TicketRecord, CallRecord.handoff, Address.label, Address.district)
        .join(Account, Account.number == TicketRecord.account_number)
        .join(Address, Address.id == Account.address_id)
        .outerjoin(CallRecord, CallRecord.id == TicketRecord.call_id)
        .where(
            TicketRecord.department == Department.TECHNICAL_SUPPORT,
            TicketRecord.customer_id == Account.customer_id, Account.service_status == "active",
            TicketRecord.created_at.between(earliest, now), or_(same_building, in_district),
        ).order_by(TicketRecord.created_at.desc(), TicketRecord.id)
    )
    incidents = db.execute(
        select(Incident, Address.label).join(Address, Address.id == Incident.address_id).where(
            or_(same_building, in_district, Incident.district_key == district_id if district else False),
            or_(
                Incident.status.in_((*ACTIVE_INCIDENT_STATUSES, "suspected")),
                Incident.status_changed_at >= earliest,
            ),
        ).order_by(Incident.started_at, Incident.id)
    ).all()
    building_incidents = [
        incident for incident, label in incidents if incident.district_key is None and address_key(label) == building
    ]
    district_incidents = [
        incident for incident, _ in incidents if district and incident.district_key == district_id
    ]
    if any(incident.status in ACTIVE_INCIDENT_STATUSES and incident.problem in (None, problem)
           for incident in district_incidents):
        return

    covered_buildings = {
        address_key(label) for incident, label in incidents
        if incident.district_key is None and incident.status in ACTIVE_INCIDENT_STATUSES
        and incident.problem in (None, problem)
    }
    building_cutoff = report_cutoff(building_incidents + district_incidents, problem, earliest)
    district_cutoff = report_cutoff(district_incidents, problem, earliest)
    building_reports: dict[str, TicketRecord] = {}
    district_reports: dict[str, tuple[TicketRecord, str]] = {}
    for report, handoff, label, report_district in reports:
        if classify_problem(report.title, (handoff or {}).get("customer_report", ""), report.summary) != problem:
            continue
        report_building = address_key(label)
        if report_building in covered_buildings:
            continue
        if report_building == building and report.created_at >= building_cutoff:
            building_reports.setdefault(report.customer_id, report)
        report_area = address_district(label, report_district)
        if district and report_area and report_area[0] == district_id and report.created_at >= district_cutoff:
            district_reports.setdefault(report.customer_id, (report, report_building))

    district_buildings = {key for _, key in district_reports.values()}
    if len(district_reports) >= MIN_CUSTOMERS and len(district_buildings) >= 2:
        evidence = [report for report, _ in district_reports.values()]
        scoped_incidents = district_incidents + [
            incident for incident, label in incidents if incident.district_key is None
            and address_key(label) in district_buildings and incident.last_report_at is not None
            and incident.last_report_at >= earliest
        ]
    elif len(building_reports) >= MIN_CUSTOMERS:
        if any(incident.status == "suspected" and incident.problem == problem for incident in district_incidents):
            return
        evidence = list(building_reports.values())
        scoped_incidents = building_incidents
        district_id, district_label = None, None
    else:
        return

    pending_incidents = [incident for incident in scoped_incidents
                         if incident.status == "suspected" and incident.problem == problem]
    pending = next(iter(pending_incidents), None)
    if pending is None:
        pending = Incident(
            id=f"NET-{uuid4().hex[:12].upper()}", address_id=address.id, status="suspected", problem=problem,
            title=PROBLEMS[problem][0], description="Зарегистрированы похожие жалобы на подключение.",
        )
        db.add(pending)
    for duplicate in pending_incidents[1:]:
        # A district alert supersedes its still-pending building alerts.
        db.delete(duplicate)
    pending.district_key = district_id
    pending.district_label = district_label
    pending.started_at = min(report.created_at for report in evidence)
    pending.last_report_at = now
    pending.report_ids = [report.id for report in evidence]
    incident_event(db, "incident.suspected", now)


def report_cutoff(incidents: list[Incident], problem: str, earliest: datetime) -> datetime:
    decisions = [incident.status_changed_at for incident in incidents if incident.problem == problem
                 and incident.status in ("rejected", "resolved") and incident.status_changed_at]
    return max([earliest, *decisions])
