from datetime import UTC, datetime
from unittest import TestCase

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.api.customers import CustomerNoteInput, create_note, list_notes
from app.auth import CurrentUser
from app.auth.models import UserRecord
from app.core.crm import get_customer, list_customers
from app.core.crm_models import Customer
from app.core.crm_seed import seed_crm
from app.core.operations_models import CallRecord
from app.database import Base, configure_connection


class CrmTest(TestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(engine.dispose)
        event.listen(engine, "connect", configure_connection)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        seed_crm(self.db)

    def test_customer_search_and_pagination(self):
        seed_crm(self.db)
        for query, expected in (
            ("ПЕТРОВА Анна", "customer_100042"),
            ("8-000-000-00-42", "customer_100042"),
            ("100047", "customer_100046"),
            ("Ковалева", "customer_100048"),
        ):
            with self.subTest(query=query):
                result = list_customers(self.db, query, None, "name", False, 20, 0)
                self.assertEqual([customer.id for customer in result.items], [expected])

        result = list_customers(self.db, None, "active", "balance", True, 1, 1)
        self.assertEqual(result.total, 7)
        self.assertEqual([customer.id for customer in result.items], ["customer_100042"])
        tail = list_customers(self.db, None, None, "name", False, 10, 10)
        self.assertEqual(tail.total, 12)
        self.assertEqual(len(tail.items), 2)
        self.assertEqual(list_customers(self.db, "%", None, "name", False, 20, 0).total, 0)

    def test_account_details_and_latest_contact(self):
        self.db.add(Customer(id="no_accounts", full_name="Клиент без счёта", phone="+7", status="inactive"))
        self.db.add(CallRecord(
            id="check", customer_id="customer_100046", account_number="100047",
            started_at=datetime(2026, 11, 27, 12), status="completed", outcome="answered",
        ))
        customer = get_customer(self.db, "customer_100046")
        self.assertEqual(customer.last_contact_at, datetime(2026, 11, 27, 12, tzinfo=UTC))
        self.assertEqual(customer.account_count, 2)
        first, second = customer.accounts
        self.assertEqual([first.number, second.number], ["100046", "100047"])
        self.assertEqual([payment.id for payment in first.payments], ["payment_100046"])
        self.assertEqual([payment.id for payment in second.payments], ["payment_100047"])
        self.assertEqual(first.active_incidents, [])
        self.assertEqual([incident.id for incident in second.active_incidents], ["NET-104"])
        self.assertEqual(get_customer(self.db, "no_accounts").accounts, [])
        self.assertIsNone(get_customer(self.db, "missing"))

    def test_customer_notes_persist_and_are_scoped_to_customer(self):
        author = CurrentUser(
            id="manager_test", username="manager", full_name="Руководитель SkyNet",
            role="manager", employee_id=None, company="SkyNet",
        )
        self.db.add(UserRecord(**author.model_dump(), password_hash="test", demo_only=True))
        self.db.commit()
        self.assertEqual(list_notes("customer_100042", self.db), [])

        first = create_note("customer_100042", CustomerNoteInput(text="  Проверили платёж.  "), self.db, author)
        second = create_note("customer_100042", CustomerNoteInput(text="Перезвонить клиенту."), self.db, author)
        with Session(self.db.get_bind()) as reader:
            self.assertEqual(list_notes("customer_100042", reader), [second, first])
            self.assertEqual(list_notes("customer_100046", reader), [])
        self.assertEqual(first.text, "Проверили платёж.")
        self.assertEqual(first.author_name, author.full_name)
        self.assertEqual(first.created_at.tzinfo, UTC)

        for invalid in ("   ", "а" * 4001):
            with self.assertRaises(ValidationError):
                CustomerNoteInput(text=invalid)
        for operation in (list_notes, create_note):
            with self.assertRaises(HTTPException) as error:
                if operation is list_notes:
                    operation("missing", self.db)
                else:
                    operation("missing", CustomerNoteInput(text="Заметка"), self.db, author)
            self.assertEqual(error.exception.status_code, 404)
