from datetime import timedelta, timezone
from pathlib import Path

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.core.crm_seed import demo_time
from app.core.operations_models import CallMessageRecord, CallRecord, EmployeeRecord, OperationEvent, TicketRecord
from app.core.schemas import CallDetail


FIXTURE = Path(__file__).resolve().parents[3] / "contracts" / "examples" / "queued-call.json"


def seed_operations(db: Session) -> None:
    fixture = CallDetail.model_validate_json(FIXTURE.read_text(encoding="utf-8"))
    handoff = fixture.handoff
    assert handoff is not None and fixture.connected_at is not None
    start = fixture.started_at.astimezone(timezone.utc).replace(tzinfo=None)
    connected = fixture.connected_at.astimezone(timezone.utc).replace(tzinfo=None)
    confirmed = handoff.confirmed_at.astimezone(timezone.utc).replace(tzinfo=None)
    ended = confirmed + timedelta(seconds=42)

    db.execute(insert(EmployeeRecord).values([
        dict(id="operator_1", full_name="Александра Орлова", department="technical_support",
             status="available", is_current=True, updated_at=demo_time(27, 8, 0)),
        dict(id="operator_2", full_name="Дмитрий Беляев", department="billing",
             status="offline", is_current=False, updated_at=demo_time(27, 8, 0)),
        dict(id="operator_3", full_name="Лидия Морозова", department="connection",
             status="available", is_current=False, updated_at=demo_time(27, 8, 0)),
    ]).on_conflict_do_nothing(index_elements=[EmployeeRecord.id]))

    inserted = db.execute(insert(CallRecord).values(
        id=fixture.id, customer_id="customer_100042", account_number="100042",
        caller_phone_masked=fixture.caller_phone_masked, started_at=start, connected_at=connected, ended_at=ended,
        status="completed", outcome=fixture.outcome, department=fixture.department,
        summary=handoff.summary, handoff=handoff.model_dump(mode="json"),
    ).on_conflict_do_nothing(index_elements=[CallRecord.id]))
    if inserted.rowcount:
        db.execute(insert(TicketRecord).values(
            id=handoff.ticket_id, call_id=fixture.id, customer_id="customer_100042", account_number="100042",
            department=fixture.department, status="queued", priority="high",
            title="Интернет недоступен после оплаты", summary=handoff.summary, created_at=confirmed, queued_at=confirmed,
        ).on_conflict_do_nothing(index_elements=[TicketRecord.id]))
        messages = [
            ("customer", "Я оплатила интернет, но он пропал перед видеозвонком.", connected + timedelta(seconds=7)),
            ("assistant", "Подскажите, на каких устройствах сейчас не работает интернет?", connected + timedelta(seconds=16)),
            ("customer", handoff.customer_report, connected + timedelta(seconds=23)),
            ("assistant", handoff.summary + " Передать обращение в техподдержку?", confirmed - timedelta(seconds=11)),
            ("customer", "Да, передайте, пожалуйста.", confirmed),
        ]
        db.add_all([CallMessageRecord(call_id=fixture.id, speaker=speaker, text=text, created_at=at)
                    for speaker, text, at in messages])
        db.add_all([
            OperationEvent(call_id=fixture.id, type="call.started", created_at=start,
                           details="Звонок поступил", resources=["calls", "dashboard"]),
            OperationEvent(call_id=fixture.id, type="call.connected", created_at=connected,
                           details="ИИ принял звонок", resources=["calls"]),
            OperationEvent(call_id=fixture.id, ticket_id=handoff.ticket_id, type="ticket.created", created_at=confirmed,
                           details="Клиент согласовал сводку и передачу в поддержку", resources=["calls", "tickets", "dashboard"]),
            OperationEvent(call_id=fixture.id, type="call.ended", created_at=ended,
                           details="Разговор завершён, обращение осталось в очереди", resources=["calls", "dashboard"]),
        ])

    history = [
        ("call_1043", "100043", "100043", "billing", "ticket_created", "Платёж не прошёл. Клиент просит проверить причину отказа.", 26, 14, 20, 174),
        ("call_1044", "100044", "100044", "billing", "answered", "Платёж в обработке. Клиенту сообщили текущий статус.", 27, 12, 50, 83),
        ("call_1045", "100045", "100045", "technical_support", "answered", "Уточнили подключение и параметры домашней сети.", 26, 11, 35, 121),
        ("call_1047", "100046", "100047", "technical_support", "ticket_created", "На втором адресе прерывается связь. Нужна диагностика линии.", 27, 13, 15, 213),
        ("call_1048", None, None, "connection", "ticket_created", "Уточнить возможность подключения по новому адресу.", 27, 10, 40, 105),
    ]
    for call_id, customer_key, account, department, outcome, summary, day, hour, minute, seconds in history:
        started_at = demo_time(day, hour, minute)
        db.execute(insert(CallRecord).values(
            id=call_id, customer_id=f"customer_{customer_key}" if customer_key else None, account_number=account,
            caller_phone_masked=f"+7 *** *** ** {call_id[-2:]}", started_at=started_at, connected_at=started_at,
            ended_at=started_at + timedelta(seconds=seconds), status="completed", department=department,
            outcome=outcome, summary=summary,
        ).on_conflict_do_nothing(index_elements=[CallRecord.id]))

    tickets = [
        ("T-1043", "call_1043", "100043", "100043", "billing", "normal", "Проверить отклонённый платёж", "Клиент просит проверить причину отказа в оплате."),
        ("T-1047", "call_1047", "100046", "100047", "technical_support", "high", "Нестабильная связь на втором адресе", "Нужна диагностика линии по счёту 100047."),
        ("T-1048", "call_1048", None, None, "connection", "low", "Уточнить условия подключения", "Клиент запросил оценку подключения по новому адресу."),
    ]
    for ticket_id, call_id, customer_key, account, department, priority, title, summary in tickets:
        created_at = db.get(CallRecord, call_id).ended_at
        db.execute(insert(TicketRecord).values(
            id=ticket_id, call_id=call_id, customer_id=f"customer_{customer_key}" if customer_key else None,
            account_number=account, department=department, status="queued", priority=priority,
            title=title, summary=summary, created_at=created_at, queued_at=created_at,
        ).on_conflict_do_nothing(index_elements=[TicketRecord.id]))
