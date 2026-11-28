from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.core.schemas import EmployeeStatus, Specialization, TicketPriority


SPECIALIZATION_DEPARTMENTS = {
    code: f"specialization_{code.value.lower()}" for code in Specialization
}
DEPARTMENT_SPECIALIZATIONS = {department: code for code, department in SPECIALIZATION_DEPARTMENTS.items()}


Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Code = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")]
QueueState = Literal["waiting", "offered", "connecting", "connected", "closed"]
AssignmentState = Literal["offered", "accepted", "connected", "expired", "declined", "failed", "ended"]
CommandKind = Literal["connect", "hold", "resume", "transfer", "end", "cancel_connect"]


class QueueRequest(BaseModel):
    event_id: Identifier
    department: Code | None = None
    category: Code | None = Field(
        default=None, description="Категория Voice AI (SALES, L1, L2 или настроенный код маршрутизации)",
    )
    priority: TicketPriority = TicketPriority.NORMAL
    required_skills: list[Code] = Field(default_factory=list, max_length=32)


class SpecializationsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    specializations: set[Specialization]


class QueueEntry(BaseModel):
    call_id: str
    department: str
    category: str | None
    priority: TicketPriority
    required_skills: list[str]
    state: QueueState
    queued_at: datetime
    waiting_seconds: int
    position: int | None


class Assignment(BaseModel):
    id: str
    call_id: str
    employee_id: str
    state: AssignmentState
    offered_at: datetime
    expires_at: datetime | None
    accepted_at: datetime | None
    connected_at: datetime | None
    ended_at: datetime | None


class DepartmentProfile(BaseModel):
    code: str
    name: str


class EmployeeProfile(BaseModel):
    id: str
    full_name: str
    role: str
    company: str | None
    department: str
    skills: list[str]
    on_shift: bool
    status: EmployeeStatus
    updated_at: datetime
    active_call_id: str | None = None
    available_for_assignment: bool


class Workspace(BaseModel):
    employee: EmployeeProfile
    assignment: Assignment | None
    call_id: str | None


class OperatorSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notifications_enabled: bool = True
    sound_enabled: bool = True


class CallControlRequest(BaseModel):
    event_id: Identifier
    action: Literal["hold", "resume", "transfer", "end"]
    department: Code | None = None
    target_employee_id: Identifier | None = None


class VoiceCommand(BaseModel):
    id: str
    call_id: str
    assignment_id: str
    kind: CommandKind
    payload: dict
    created_at: datetime
    acknowledged_at: datetime | None


class DepartmentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Code
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
    enabled: bool = True


class RoutingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Code
    department: Code
    required_skills: list[Code] = Field(default_factory=list, max_length=32)


class WorkforceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: Identifier
    department: Code
    role: Code = "operator"
    company: Identifier | None = None
    skills: list[Code] = Field(default_factory=list, max_length=32)
    on_shift: bool = True


class ContactCenterConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    departments: list[DepartmentConfig] = Field(default_factory=list)
    routing: list[RoutingConfig] = Field(default_factory=list)
    workforce: list[WorkforceConfig] = Field(default_factory=list)
