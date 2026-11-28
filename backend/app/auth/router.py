from datetime import timedelta
import os
from secrets import token_urlsafe
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert

from app.auth import (
    COOKIE_NAME, CurrentUser, Database, SessionToken, demo_enabled, reject_cross_site_write,
    require_user, token_hash, utc_now,
)
from app.auth.credentials import DUMMY_HASH, verify_password
from app.auth.models import PreferencesRecord, SessionRecord, UserRecord


SESSION_LIFETIME = timedelta(hours=12)
router = APIRouter(prefix="/api/v1/auth", tags=["Авторизация"])
User = Annotated[CurrentUser, Depends(require_user)]


class LoginInput(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=256)]


class Preferences(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    sidebar_collapsed: bool = False
    density: Literal["comfortable", "compact"] = "comfortable"
    summary_expanded: bool = True
    desktop_notifications: bool = False
    sound_notifications: bool = True
    notification_volume: int = Field(default=75, ge=0, le=100)


def secure_cookie(request: Request) -> bool:
    return request.url.scheme == "https" or os.getenv("IRIS_SECURE_COOKIE") == "1"


@router.post("/login", responses={401: {"description": "Неверные учётные данные"}})
def login(data: LoginInput, request: Request, response: Response, db: Database, token: SessionToken) -> CurrentUser:
    reject_cross_site_write(request)
    user = db.scalar(select(UserRecord).where(UserRecord.username == data.username.casefold()))
    valid = verify_password(data.password, user.password_hash if user is not None else DUMMY_HASH)
    if not valid or user is None or (user.demo_only and not demo_enabled()):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    principal = CurrentUser.model_validate(user)
    now = utc_now()
    db.execute(delete(SessionRecord).where(SessionRecord.expires_at <= now))
    if token and len(token) == 43:
        db.execute(delete(SessionRecord).where(SessionRecord.token_hash == token_hash(token)))
    new_token = token_urlsafe(32)
    db.add(SessionRecord(token_hash=token_hash(new_token), user_id=user.id, expires_at=now + SESSION_LIFETIME))
    db.commit()

    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        COOKIE_NAME, new_token, max_age=int(SESSION_LIFETIME.total_seconds()),
        secure=secure_cookie(request), httponly=True, samesite="lax",
    )
    return principal


@router.post("/logout", status_code=204)
def logout(request: Request, db: Database, token: SessionToken) -> Response:
    reject_cross_site_write(request)
    if token and len(token) == 43:
        db.execute(delete(SessionRecord).where(SessionRecord.token_hash == token_hash(token)))
        db.commit()
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(COOKIE_NAME, secure=secure_cookie(request), httponly=True, samesite="lax")
    return response


@router.get("/me", responses={401: {"description": "Требуется вход"}})
def me(user: User, response: Response) -> CurrentUser:
    response.headers["Cache-Control"] = "no-store"
    return user


@router.get("/preferences")
def get_preferences(user: User, response: Response, db: Database) -> Preferences:
    response.headers["Cache-Control"] = "no-store"
    record = db.get(PreferencesRecord, user.id)
    return Preferences.model_validate(record) if record is not None else Preferences()


@router.patch("/preferences")
def update_preferences(change: Preferences, user: User, response: Response, db: Database) -> Preferences:
    changes = change.model_dump(exclude_unset=True)
    if changes:
        statement = insert(PreferencesRecord).values(user_id=user.id, **changes)
        db.execute(statement.on_conflict_do_update(index_elements=[PreferencesRecord.user_id], set_=changes))
        db.commit()
    return get_preferences(user, response, db)
