from datetime import UTC, datetime
from hashlib import sha256
import os
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyCookie
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import SessionRecord, UserRecord
from app.database import SessionLocal, get_db


Role = Literal["operator", "manager"]
COOKIE_NAME = "iris_session"
cookie_scheme = APIKeyCookie(name=COOKIE_NAME, scheme_name="IrisSession", auto_error=False)
SessionToken = Annotated[str | None, Depends(cookie_scheme)]
Database = Annotated[Session, Depends(get_db, scope="function")]


class CurrentUser(BaseModel):
    model_config = ConfigDict(from_attributes=True, frozen=True)

    id: str
    username: str
    full_name: str
    role: Role
    employee_id: str | None
    company: str | None


def demo_enabled() -> bool:
    return os.getenv("IRIS_DEMO") == "1"


def token_hash(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def reject_cross_site_write(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = request.headers.get("origin")
    try:
        same_host = origin is None or urlsplit(origin).netloc.casefold() == request.url.netloc.casefold()
    except ValueError:
        same_host = False
    if not same_host or request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(status_code=403, detail="Запрос должен исходить из IRIS")


def find_session_user(db: Session, token: str | None) -> UserRecord | None:
    if not token or len(token) != 43:
        return None
    return db.scalar(
        select(UserRecord)
        .join(SessionRecord, SessionRecord.user_id == UserRecord.id)
        .where(
            SessionRecord.token_hash == token_hash(token),
            SessionRecord.expires_at > utc_now(),
            UserRecord.demo_only.in_([False, demo_enabled()]),
        )
    )


def require_user(request: Request, db: Database, token: SessionToken) -> CurrentUser:
    reject_cross_site_write(request)
    user = find_session_user(db, token)
    if user is None:
        raise HTTPException(status_code=401, detail="Войдите в IRIS")
    return CurrentUser.model_validate(user)


def require_manager(user: Annotated[CurrentUser, Depends(require_user)]) -> CurrentUser:
    if user.role != "manager":
        raise HTTPException(status_code=403, detail="Требуются права руководителя")
    return user


def require_operator(user: Annotated[CurrentUser, Depends(require_user)]) -> CurrentUser:
    if user.role != "operator" or user.employee_id is None:
        raise HTTPException(status_code=403, detail="Требуется учётная запись оператора")
    return user


def session_is_active(request: Request) -> bool:
    with SessionLocal() as db:
        return find_session_user(db, request.cookies.get(COOKIE_NAME)) is not None
