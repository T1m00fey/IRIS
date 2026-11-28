from datetime import datetime, timedelta
from unittest import TestCase

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.analytics import get_analytics
from app.core.crm_models import Customer
from app.core.operations_models import EmployeeRecord, TicketRecord
from app.core.schemas import Department, EmployeeStatus, TicketStatus


class AnalyticsTest(TestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(engine.dispose)
        Customer.metadata.create_all(engine)
        self.db = self.enterContext(Session(engine))

    def test_empty_and_populated_workload(self):
        empty = get_analytics(self.db)
        self.assertEqual(empty.employees_online, 0)
        self.assertIsNone(empty.average_wait_seconds)
        self.assertEqual([row.department for row in empty.departments], list(Department))
        self.assertTrue(all(row.queued == row.in_progress == row.online == 0 for row in empty.departments))

        created_at = datetime(2026, 11, 27, 12)
        queued_at = created_at + timedelta(minutes=7)
        support, billing, connection = Department
        self.db.add_all([
            EmployeeRecord(id="e1", full_name="Анна", department=support, status=EmployeeStatus.AVAILABLE,
                           updated_at=created_at),
            EmployeeRecord(id="e2", full_name="Максим", department=billing, status=EmployeeStatus.PAUSED,
                           updated_at=created_at),
            EmployeeRecord(id="e3", full_name="Ирина", department=connection, status=EmployeeStatus.OFFLINE,
                           updated_at=created_at),
        ])
        for ticket_id, department, status, wait in (
            ("t1", support, TicketStatus.QUEUED, None),
            ("t2", support, TicketStatus.IN_PROGRESS, 60),
            ("t3", billing, TicketStatus.CLOSED, 120),
            ("t4", billing, TicketStatus.CLOSED, -30),
        ):
            self.db.add(TicketRecord(
                id=ticket_id, department=department, status=status, priority="normal", title="Учебное обращение",
                summary="Обращение для проверки аналитики", created_at=created_at, queued_at=queued_at,
                started_at=queued_at + timedelta(seconds=wait) if wait is not None else None,
            ))

        analytics = get_analytics(self.db)
        self.assertEqual(analytics.employees_online, 2)
        self.assertEqual(analytics.average_wait_seconds, 90)
        self.assertEqual(
            [(row.department, row.queued, row.in_progress, row.online) for row in analytics.departments],
            [(support, 1, 1, 1), (billing, 0, 0, 1), (connection, 0, 0, 0)],
        )
