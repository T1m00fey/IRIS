import json
import os
from secrets import compare_digest
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, PositiveInt, StringConstraints

from app.api.contact_center import ContactCenterRoute
from app.core import call_ingest
from app.core.contact_center import service
from app.core.contact_center.schemas import Assignment, Code, QueueEntry, QueueRequest, VoiceCommand
from app.core.crm_schemas import AccountDetail
from app.core.schemas import Call, CallMessage, CallOutcome, Handoff, Ticket
from app.database import SessionLocal


voice_bearer = HTTPBearer(scheme_name="VoiceBearer", auto_error=False)
VoiceCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(voice_bearer)]


def authorize_voice(credentials: VoiceCredentials) -> None:
    token = os.getenv("IRIS_VOICE_TOKEN")
    if not service.enabled() or not token:
        raise HTTPException(status_code=503, detail="Интеграция Voice не настроена")
    try:
        operator_tokens = json.loads(os.getenv("IRIS_OPERATOR_TOKENS", "{}"))
    except ValueError:
        operator_tokens = {}
    if isinstance(operator_tokens, dict) and token in operator_tokens:
        raise HTTPException(status_code=503, detail="Интеграция Voice не настроена")
    if credentials is None or not compare_digest(credentials.credentials.encode(), token.encode()):
        raise HTTPException(
            status_code=401, detail="Нужен сервисный токен Voice", headers={"WWW-Authenticate": "Bearer"},
        )


router = APIRouter(
    prefix="/api/v1/voice", tags=["Voice"], route_class=ContactCenterRoute, dependencies=[Depends(authorize_voice)],
    responses={
        401: {"description": "Нужен сервисный токен Voice"},
        404: {"description": "Звонок или связанная запись не найдены"},
        409: {"description": "Событие несовместимо с текущим состоянием"},
        503: {"description": "Интеграция Voice не настроена"},
    },
)


class StartCall(BaseModel):
    provider_call_id: call_ingest.Identifier
    caller_phone: Annotated[str, StringConstraints(max_length=64)] | None = None


class IdentifyCustomer(BaseModel):
    account_id: call_ingest.Identifier
    apartment: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]


class IdentificationResult(BaseModel):
    identified: bool


class ConfirmTicket(BaseModel):
    handoff: Handoff
    confirmation_message_id: PositiveInt
    department: Code
    account_number: call_ingest.Identifier | None = None


class FinishCall(BaseModel):
    status: call_ingest.FinalStatus
    outcome: CallOutcome


@router.post("/calls")
def start_call(data: StartCall) -> Call:
    return call_ingest.start_call(data.provider_call_id, data.caller_phone)


@router.post("/calls/{call_id}/connected")
def mark_connected(call_id: str) -> Call:
    return call_ingest.mark_connected(call_id)


@router.post("/calls/{call_id}/identify")
def identify_customer(call_id: str, data: IdentifyCustomer) -> IdentificationResult:
    return IdentificationResult(identified=call_ingest.identify_customer(call_id, data.account_id, data.apartment))


@router.get("/calls/{call_id}/account")
def get_account_details(call_id: str) -> AccountDetail:
    return call_ingest.get_account_details(call_id)


@router.post("/calls/{call_id}/messages")
def append_message(call_id: str, message: call_ingest.MessageInput) -> CallMessage:
    return call_ingest.append_message(call_id, message)


@router.post("/calls/{call_id}/summary")
def update_summary(call_id: str, change: call_ingest.SummaryInput) -> Call:
    return call_ingest.update_summary(call_id, change)


@router.post("/calls/{call_id}/ticket")
def confirm_ticket(call_id: call_ingest.Identifier, data: ConfirmTicket) -> Ticket:
    return call_ingest.confirm_ticket(
        call_id, data.handoff, data.confirmation_message_id, data.department, data.account_number,
    )


@router.post("/calls/{call_id}/handoff")
def request_operator(call_id: str, data: QueueRequest) -> QueueEntry:
    with service.transaction() as db:
        return service.request_operator(db, call_id, data)


@router.get("/calls/{call_id}/assignment")
def get_assignment(call_id: str) -> Assignment | None:
    with SessionLocal() as db:
        return service.assignment_for_call(db, call_id)


@router.post("/calls/{call_id}/assignments/{assignment_id}/connected")
def confirm_connection(call_id: str, assignment_id: str) -> Assignment:
    with service.transaction() as db:
        return service.confirm_connection(db, call_id, assignment_id)


@router.post("/calls/{call_id}/assignments/{assignment_id}/failed")
def fail_connection(call_id: str, assignment_id: str) -> Assignment:
    with service.transaction() as db:
        return service.fail_connection(db, call_id, assignment_id)


@router.get("/calls/{call_id}/commands")
def list_commands(call_id: str) -> list[VoiceCommand]:
    with SessionLocal() as db:
        return service.list_commands(db, call_id)


@router.post("/calls/{call_id}/commands/{command_id}/ack")
def acknowledge_command(call_id: str, command_id: str) -> VoiceCommand:
    with service.transaction() as db:
        return service.acknowledge_command(db, call_id, command_id)


@router.post("/calls/{call_id}/finish")
def finish_call(call_id: call_ingest.Identifier, data: FinishCall) -> Call:
    return call_ingest.finish_call(call_id, data.status, data.outcome)
