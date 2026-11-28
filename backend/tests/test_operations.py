import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core import call_ingest, operations
from app.core.contact_center.initialize import add_default_departments
from app.core.contact_center.models import VoiceReceipt
from app.core.crm_seed import seed_crm
from app.core.operations_models import CallRecord, OperationEvent, TicketRecord
from app.core.operations_seed import seed_operations
from app.core.schemas import CallOutcome, CallPhase, CallStatus, Department, TicketStatus, TicketUpdate
from app.database import Base, configure_connection


class OperationsTest(TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.engine = create_engine(f"sqlite+pysqlite:///{Path(directory) / 'test.sqlite3'}")
        self.addCleanup(self.engine.dispose)
        event.listen(self.engine, "connect", configure_connection)
        Base.metadata.create_all(self.engine)
        self.db = self.enterContext(Session(self.engine))
        seed_crm(self.db)
        seed_operations(self.db)
        add_default_departments(self.db)
        self.db.commit()

    def test_history_and_dashboard(self):
        call = operations.get_call(self.db, "call_1042")
        self.assertFalse(call.can_join)
        self.assertEqual(call.account_number, "100042")
        self.assertEqual(call.tickets[0].id, call.handoff.ticket_id)
        self.assertEqual(call.transcript[-1].speaker, "customer")
        self.assertEqual(call.events[-1].type, "call.ended")

        dashboard = operations.get_dashboard(self.db)
        self.assertEqual(dashboard.total_calls, self.db.scalar(select(func.count()).select_from(CallRecord)))
        self.assertEqual(dashboard.total_tickets, self.db.scalar(select(func.count()).select_from(TicketRecord)))
        self.assertEqual(dashboard.active_calls, 0)
        self.assertEqual(dashboard.completed_calls, dashboard.total_calls)
        self.assertGreater(dashboard.average_duration_seconds, 0)

    def test_ticket_transitions_and_seed_retry(self):
        ticket_id = "T-1042"
        with self.assertRaises(operations.OperationConflict):
            operations.update_ticket(self.db, ticket_id, TicketUpdate(status=TicketStatus.CLOSED))

        current = operations.update_ticket(self.db, ticket_id, TicketUpdate(status=TicketStatus.IN_PROGRESS))
        self.assertEqual(current.assigned_employee_id, "operator_1")
        self.assertIsNotNone(current.started_at)
        event_count = self.db.scalar(select(func.count()).select_from(OperationEvent))
        operations.update_ticket(self.db, ticket_id, TicketUpdate(status=TicketStatus.IN_PROGRESS))
        self.assertEqual(self.db.scalar(select(func.count()).select_from(OperationEvent)), event_count)

        current = operations.update_ticket(self.db, ticket_id, TicketUpdate(department=Department.BILLING))
        self.assertEqual(current.status, TicketStatus.QUEUED)
        self.assertGreater(current.queued_at, current.created_at)
        self.assertIsNone(current.assigned_employee_id)
        self.assertIsNone(current.started_at)
        operations.update_ticket(self.db, ticket_id, TicketUpdate(status=TicketStatus.IN_PROGRESS))
        closed = operations.update_ticket(self.db, ticket_id, TicketUpdate(status=TicketStatus.CLOSED))
        self.assertIsNotNone(closed.closed_at)
        seed_operations(self.db)
        self.db.commit()
        self.assertEqual(operations.get_ticket(self.db, ticket_id), closed)

    def test_stale_transition_preserves_new_department(self):
        ticket_id = "T-1042"
        stale = self.db.get(TicketRecord, ticket_id)
        self.assertEqual(stale.department, Department.TECHNICAL_SUPPORT)
        with Session(self.engine) as concurrent:
            operations.update_ticket(concurrent, ticket_id, TicketUpdate(department=Department.BILLING))

        with self.assertRaises(operations.OperationConflict):
            operations.update_ticket(self.db, ticket_id, TicketUpdate(status=TicketStatus.IN_PROGRESS))
        self.db.rollback()
        current = operations.get_ticket(self.db, ticket_id)
        self.assertEqual(current.department, Department.BILLING)
        self.assertEqual(current.status, TicketStatus.QUEUED)
        events = self.db.scalars(select(OperationEvent).where(OperationEvent.type == "ticket.updated")).all()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].ticket_id, ticket_id)

    def test_summary_confirmation_is_idempotent(self):
        call = operations.confirm_summary(self.db, "call_1042")
        self.assertIsNotNone(call.summary_reviewed_at)
        reviewed = operations.confirm_summary(self.db, "call_1042")
        self.assertEqual(reviewed.summary_reviewed_at, call.summary_reviewed_at)
        self.assertEqual([event.type for event in reviewed.events].count("call.summary_reviewed"), 1)

    def test_summary_retry_preserves_latest_revision_and_review(self):
        with patch.object(call_ingest, "SessionLocal", sessionmaker(bind=self.engine)):
            call = call_ingest.start_call("voice/summary")
            call_ingest.mark_connected(call.id)
            first = call_ingest.SummaryInput(event_id="s1", summary="Первое уточнение")
            second = call_ingest.SummaryInput(event_id="s2", summary="Второе уточнение")
            self.assertEqual(call_ingest.update_summary(call.id, first).summary, first.summary)
            self.assertIsNotNone(operations.confirm_summary(self.db, call.id).summary_reviewed_at)
            call_ingest.update_summary(call.id, second)
            self.db.expire_all()
            self.assertIsNone(operations.get_call(self.db, call.id).summary_reviewed_at)
            reviewed = operations.confirm_summary(self.db, call.id)

            self.assertEqual(call_ingest.update_summary(call.id, first).summary, second.summary)
            with self.assertRaises(operations.OperationConflict):
                call_ingest.update_summary(call.id, first.model_copy(update={"summary": "Другой текст"}))
            current = operations.get_call(self.db, call.id)
            self.assertEqual(current.summary_reviewed_at, reviewed.summary_reviewed_at)
            self.assertEqual([event.type for event in current.events].count("call.summary_updated"), 2)
            self.assertIsNotNone(self.db.get(VoiceReceipt, (call.id, "summary", first.event_id)))

    def test_contact_center_ticket_preserves_live_routing_on_save_and_replay(self):
        with (
            patch.dict(os.environ, {"IRIS_CONTACT_CENTER": "1"}),
            patch.object(call_ingest, "SessionLocal", sessionmaker(bind=self.engine)),
        ):
            call = call_ingest.start_call("voice/ticket")
            call_ingest.mark_connected(call.id)
            message = call_ingest.append_message(call.id, call_ingest.MessageInput(
                event_id="confirmation", speaker="customer", text="Да, передайте.",
            ))
            record = self.db.get(CallRecord, call.id)
            record.phase = CallPhase.WITH_OPERATOR
            record.department = Department.TECHNICAL_SUPPORT
            self.db.commit()

            handoff = operations.get_call(self.db, "call_1042").handoff.model_copy(update={"ticket_id": "T-voice"})
            saved = call_ingest.confirm_ticket(call.id, handoff, message.id, Department.BILLING)
            self.db.expire_all()
            current = operations.get_call(self.db, call.id)
            self.assertEqual(current.phase, CallPhase.WITH_OPERATOR)
            self.assertEqual(current.department, Department.TECHNICAL_SUPPORT)
            self.assertEqual(saved.department, Department.BILLING)
            self.assertEqual(call_ingest.confirm_ticket(call.id, handoff, message.id, Department.BILLING).id, saved.id)
            with self.assertRaises(operations.OperationConflict):
                call_ingest.confirm_ticket(call.id, handoff, message.id, Department.CONNECTION)

    def test_account_details_are_scoped_to_verified_call(self):
        with patch.object(call_ingest, "SessionLocal", sessionmaker(bind=self.engine)):
            call = call_ingest.start_call("voice/scope", "+70000000046")
            call_ingest.mark_connected(call.id)
            self.assertFalse(call_ingest.identify_customer(call.id, "100047", "12"))
            with self.assertRaises(operations.OperationConflict):
                call_ingest.get_account_details(call.id)

            self.assertTrue(call_ingest.identify_customer(call.id, "100046", "12"))
            first_account = call_ingest.get_account_details(call.id)
            self.assertEqual(first_account.number, "100046")
            self.assertEqual([payment.id for payment in first_account.payments], ["payment_100046"])
            self.assertEqual(first_account.active_incidents, [])

            self.assertTrue(call_ingest.identify_customer(call.id, "100047", "304"))
            second_account = call_ingest.get_account_details(call.id)
            self.assertEqual(second_account.number, "100047")
            self.assertEqual([payment.id for payment in second_account.payments], ["payment_100047"])
            self.assertEqual([incident.id for incident in second_account.active_incidents], ["NET-104"])
            self.assertFalse(call_ingest.identify_customer(call.id, "100042", "42"))
            self.assertEqual(call_ingest.get_account_details(call.id), second_account)

            call_ingest.finish_call(call.id, CallStatus.COMPLETED, CallOutcome.ANSWERED)
            with self.assertRaises(operations.OperationConflict):
                call_ingest.get_account_details(call.id)

    def test_ingest_rolls_back_conflicts_and_replays_provider_events(self):
        with (
            patch.dict(os.environ, {"IRIS_CONTACT_CENTER": "0"}),
            patch.object(call_ingest, "SessionLocal", sessionmaker(bind=self.engine)),
        ):
            call = call_ingest.start_call("voice/a", "+70000000042")
            self.assertEqual(call.status, CallStatus.RINGING)
            self.assertEqual(call.caller_phone_masked, "*** 42")
            self.assertEqual(call_ingest.start_call("voice/a").id, call.id)
            with self.assertRaises(operations.OperationConflict):
                call_ingest.finish_call(call.id, CallStatus.COMPLETED, CallOutcome.ANSWERED)

            active = call_ingest.mark_connected(call.id)
            self.assertEqual(active.phase, CallPhase.AI_ACTIVE)
            self.assertFalse(call_ingest.identify_customer(call.id, "100042", "15"))
            self.assertTrue(call_ingest.identify_customer(call.id, "100042", "42"))
            message = call_ingest.MessageInput(event_id="provider-event-1", speaker="customer", text="Да, передайте.")
            with ThreadPoolExecutor(max_workers=2) as executor:
                first, second = executor.map(lambda _: call_ingest.append_message(call.id, message), range(2))
            self.assertEqual(first, second)
            with self.assertRaises(operations.OperationConflict):
                call_ingest.append_message(call.id, message.model_copy(update={"text": "Не надо"}))

            handoff = operations.get_call(self.db, "call_1042").handoff.model_copy(update={"ticket_id": "T-new"})
            with self.assertRaises(operations.OperationConflict):
                call_ingest.confirm_ticket(call.id, handoff, first.id, Department.BILLING, "100043")
            with self.assertRaises(operations.OperationConflict):
                call_ingest.confirm_ticket(call.id, handoff, first.id + 1, Department.BILLING)
            with self.assertRaises(operations.RecordNotFound):
                operations.get_ticket(self.db, handoff.ticket_id)

            confirmed = call_ingest.confirm_ticket(call.id, handoff, first.id, Department.BILLING, "100042")
            saved = operations.get_call(self.db, call.id)
            self.assertEqual(saved.phase, CallPhase.WAITING_FOR_OPERATOR)
            self.assertEqual(saved.handoff.confirmed_at, first.created_at)
            self.assertEqual([ticket.id for ticket in saved.tickets], [confirmed.id])
            ended = call_ingest.finish_call(call.id, CallStatus.ABANDONED, CallOutcome.UNRESOLVED)
            self.assertEqual(ended.outcome, CallOutcome.TICKET_CREATED)
            self.assertEqual(call_ingest.finish_call(call.id, CallStatus.COMPLETED, CallOutcome.ANSWERED), ended)
            self.assertEqual(call_ingest.mark_connected(call.id), ended)
            retried = call_ingest.confirm_ticket(call.id, handoff, first.id, Department.BILLING)
            self.assertEqual(retried.id, confirmed.id)
            self.assertEqual(call_ingest.append_message(call.id, message), first)

            events = operations.get_call(self.db, call.id).events
            self.assertEqual([event.type for event in events], [
                "call.started", "call.connected", "call.identified", "call.transcript", "ticket.created", "call.ended",
            ])
