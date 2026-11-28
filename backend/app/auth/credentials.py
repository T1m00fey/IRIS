from hashlib import pbkdf2_hmac
import os
from secrets import compare_digest, token_hex

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.auth import demo_enabled
from app.auth.models import SessionRecord, UserRecord
from app.core.operations_models import EmployeeRecord


ROUNDS = 600_000
DUMMY_HASH = f"{'0' * 32}:{'0' * 64}"


def derive_password(password: str, salt: str) -> str:
    return pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ROUNDS).hex()


def encode_password(password: str) -> str:
    salt = token_hex(16)
    return f"{salt}:{derive_password(password, salt)}"


def verify_password(password: str, stored: str) -> bool:
    salt, expected = stored.split(":", 1)
    return compare_digest(derive_password(password, salt), expected)


def seed_auth(db: Session) -> None:
    demo = demo_enabled()
    roles = (
        ("manager", "Руководитель SkyNet", None, os.getenv("IRIS_MANAGER_PASSWORD")),
        ("operator", "Оператор SkyNet", os.getenv("IRIS_OPERATOR_EMPLOYEE_ID", "operator_1"),
         os.getenv("IRIS_OPERATOR_PASSWORD")),
    )
    for role, display_name, employee_id, configured_password in roles:
        if configured_password is None and not demo:
            continue
        if configured_password is not None and not 12 <= len(configured_password) <= 256:
            raise RuntimeError(f"IRIS_{role.upper()}_PASSWORD должен содержать от 12 до 256 символов")
        employee = db.get(EmployeeRecord, employee_id) if employee_id is not None else None
        if employee_id is not None and employee is None:
            raise RuntimeError("Учётная запись оператора требует существующего сотрудника")

        username = role
        user = db.scalar(select(UserRecord).where(UserRecord.username == username))
        if user is not None and configured_password is None:
            continue
        if user is not None and not user.demo_only and employee_id == user.employee_id and verify_password(
            configured_password, user.password_hash,
        ):
            continue
        values = {
            "id": f"user_{role}", "username": username, "role": role,
            "full_name": employee.full_name if employee else display_name, "company": "SkyNet",
            "employee_id": employee_id,
            "password_hash": encode_password(configured_password or f"iris-{role}"),
            "demo_only": configured_password is None,
        }
        statement = insert(UserRecord).values(**values)
        if configured_password is not None:
            db.execute(statement.on_conflict_do_update(
                index_elements=[UserRecord.username],
                set_={key: value for key, value in values.items() if key not in {"id", "username"}},
            ))
            if user is not None:
                db.execute(delete(SessionRecord).where(SessionRecord.user_id == user.id))
        else:
            db.execute(statement.on_conflict_do_nothing(index_elements=[UserRecord.username]))
