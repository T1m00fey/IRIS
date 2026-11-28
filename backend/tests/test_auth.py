from datetime import timedelta
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException, Request, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, find_session_user, require_manager, require_operator, token_hash, utc_now
from app.auth.credentials import seed_auth
from app.auth.models import SessionRecord
from app.auth.router import LoginInput, Preferences, get_preferences, login, logout, update_preferences
from app.core.crm_models import Customer
from app.core.operations_models import EmployeeRecord


def request(method: str = "POST", headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    return Request({"type": "http", "method": method, "headers": headers or [], "path": "/"})


class AuthTest(TestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(engine.dispose)
        Customer.metadata.create_all(engine)
        self.db = self.enterContext(Session(engine))
        self.env = self.enterContext(patch.dict("os.environ", {"IRIS_DEMO": "1"}, clear=True))
        self.db.add(EmployeeRecord(
            id="operator_1", full_name="Александра Орлова", department="technical_support",
            status="available", updated_at=utc_now(),
        ))
        self.db.flush()
        seed_auth(self.db)
        self.db.commit()

    def sign_in(self, role: str, previous: str | None = None):
        response = Response()
        user = login(LoginInput(username=role, password=f"iris-{role}"), request(), response, self.db, previous)
        cookie = response.headers["set-cookie"]
        token = cookie.split(";", 1)[0].removeprefix(f"{COOKIE_NAME}=")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=lax", cookie)
        return user, token

    def test_roles_and_session_revocation(self):
        operator, operator_token = self.sign_in("operator")
        self.assertEqual(require_operator(operator).employee_id, "operator_1")
        with self.assertRaises(HTTPException) as denied:
            require_manager(operator)
        self.assertEqual(denied.exception.status_code, 403)

        manager, manager_token = self.sign_in("manager", operator_token)
        self.assertEqual(require_manager(manager).role, "manager")
        self.assertIsNone(find_session_user(self.db, operator_token))
        stored_hash = self.db.scalar(select(SessionRecord.token_hash))
        self.assertEqual(stored_hash, token_hash(manager_token))

        result = logout(request(), self.db, manager_token)
        self.assertEqual(result.status_code, 204)
        self.assertIsNone(find_session_user(self.db, manager_token))

    def test_expiration_and_demo_mode(self):
        _, token = self.sign_in("manager")
        self.env["IRIS_DEMO"] = "0"
        self.assertIsNone(find_session_user(self.db, token))
        with self.assertRaises(HTTPException) as invalid:
            self.sign_in("manager")
        self.assertEqual(invalid.exception.status_code, 401)

        self.env["IRIS_DEMO"] = "1"
        session = self.db.get(SessionRecord, token_hash(token))
        session.expires_at = utc_now() - timedelta(seconds=1)
        self.db.commit()
        self.assertIsNone(find_session_user(self.db, token))

    def test_preferences_stay_with_each_user(self):
        manager, _ = self.sign_in("manager")
        operator, _ = self.sign_in("operator")
        updated = update_preferences(Preferences(density="compact", notification_volume=20), operator, Response(), self.db)
        self.assertEqual(updated.density, "compact")
        self.assertEqual(updated.notification_volume, 20)
        updated = update_preferences(Preferences(sidebar_collapsed=True), operator, Response(), self.db)
        self.assertTrue(updated.sidebar_collapsed)
        self.assertEqual(updated.density, "compact")
        self.assertEqual(get_preferences(manager, Response(), self.db), Preferences())
