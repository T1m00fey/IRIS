from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Department(str, Enum):
    TECHNICAL_SUPPORT = "technical_support"
    BILLING = "billing"
    CONNECTION = "connection"


class CallStatus(str, Enum):
    RINGING = "ringing"
    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"
    FAILED = "failed"


class CallPhase(str, Enum):
    AI_ACTIVE = "ai_active"
    WAITING_FOR_OPERATOR = "waiting_for_operator"
    OPERATOR_JOINING = "operator_joining"
    WITH_OPERATOR = "with_operator"


class CallOutcome(str, Enum):
    UNKNOWN = "unknown"
    ANSWERED = "answered"
    TICKET_CREATED = "ticket_created"
    UNRESOLVED = "unresolved"
    NO_CONFIRMATION = "no_confirmation"


class Call(BaseModel):
    id: str
    status: CallStatus
    phase: CallPhase | None
    outcome: CallOutcome
    department: Department | str | None
    caller_phone_masked: str | None
    started_at: datetime
    connected_at: datetime | None
    ended_at: datetime | None
    customer_id: str | None = None
    customer_name: str | None = None
    account_number: str | None = None
    duration_seconds: int | None = None
    summary: str | None = None


class VerifiedFact(BaseModel):
    text: str
    source: str
    checked_at: datetime


class Handoff(BaseModel):
    ticket_id: str
    customer_request: str
    summary: str
    customer_report: str
    verified_facts: list[VerifiedFact]
    assumptions: list[str] = Field(default_factory=list)
    actions_taken: list[str] = Field(default_factory=list)
    open_question: str
    secondary_questions: list[str]
    confirmed_at: datetime


class TicketStatus(str, Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"


class TicketPriority(str, Enum):
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class EmployeeStatus(str, Enum):
    AVAILABLE = "available"
    BUSY = "busy"
    PAUSED = "paused"
    OFFLINE = "offline"
    LUNCH = "lunch"
    WRAP_UP = "wrap_up"


class Employee(BaseModel):
    id: str
    full_name: str
    department: Department | str
    status: EmployeeStatus
    is_current: bool
    updated_at: datetime


class EmployeeUpdate(BaseModel):
    status: EmployeeStatus


class Ticket(BaseModel):
    id: str
    call_id: str | None
    customer_id: str | None
    customer_name: str | None
    account_number: str | None
    department: Department | str
    status: TicketStatus
    priority: TicketPriority
    title: str
    summary: str
    created_at: datetime
    queued_at: datetime
    started_at: datetime | None
    closed_at: datetime | None
    waiting_seconds: int
    assigned_employee_id: str | None
    assigned_employee_name: str | None


class TicketUpdate(BaseModel):
    status: TicketStatus | None = None
    department: Department | None = None


class TicketList(BaseModel):
    items: list[Ticket]
    total: int
    limit: int
    offset: int


class CallMessage(BaseModel):
    id: int
    speaker: str
    text: str
    created_at: datetime


class CallEvent(BaseModel):
    type: str
    created_at: datetime
    details: str | None


class AIAction(BaseModel):
    action: str
    created_at: datetime
    result: str


class CallDetail(Call):
    handoff: Handoff | None
    can_join: bool
    summary_reviewed_at: datetime | None = None
    transcript: list[CallMessage] = Field(default_factory=list)
    crm_checks: list[VerifiedFact] = Field(default_factory=list)
    ai_actions: list[AIAction] = Field(default_factory=list)
    tickets: list[Ticket] = Field(default_factory=list)
    events: list[CallEvent] = Field(default_factory=list)


class CallList(BaseModel):
    items: list[Call]
    total: int
    limit: int
    offset: int


class JoinCredentials(BaseModel):
    server_url: str
    participant_token: str
    expires_at: datetime


class DepartmentCount(BaseModel):
    department: Department
    count: int


class DashboardIncident(BaseModel):
    id: str
    title: str
    description: str
    status: str
    address: str
    started_at: datetime
    estimated_resolution_at: datetime | None


class Dashboard(BaseModel):
    total_calls: int
    active_calls: int
    completed_calls: int
    total_tickets: int
    average_duration_seconds: int | None
    tickets_by_department: list[DepartmentCount]
    recent_calls: list[Call]
    active_incidents: list[DashboardIncident]
