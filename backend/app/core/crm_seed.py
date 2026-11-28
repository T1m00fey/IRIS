from datetime import UTC, datetime

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.core.crm_models import Account, Address, Customer, Incident, Payment, Tariff


def demo_time(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC).replace(tzinfo=None)


def seed_crm(db: Session) -> None:
    customers = [
        ("100042", "Анна Петрова", "+7 (000) 000-00-42", "active"),
        ("100043", "Максим Соколов", "+7 (000) 000-00-43", "suspended"),
        ("100044", "Ирина Кузнецова", "+7 (000) 000-00-44", "suspended"),
        ("100045", "Алексей Волков", "+7 (000) 000-00-45", "active"),
        ("100046", "Мария Смирнова", "+7 (000) 000-00-46", "active"),
        ("100048", "Елена Ковалёва", "+7 (000) 000-00-48", "inactive"),
        ("100049", "Дмитрий Орлов", "+7 (000) 000-00-49", "active"),
        ("100050", "Ольга Лебедева", "+7 (000) 000-00-50", "active"),
        ("100051", "Сергей Новиков", "+7 (000) 000-00-51", "suspended"),
        ("100052", "Наталья Васильева", "+7 (000) 000-00-52", "active"),
        ("100053", "Артём Савельев", "+7 (000) 000-00-53", "inactive"),
        ("100054", "Татьяна Воронова", "+7 (000) 000-00-54", "active"),
    ]
    db.execute(insert(Customer).on_conflict_do_nothing(index_elements=["id"]), [
        {"id": f"customer_{number}", "full_name": name, "phone": phone, "status": status}
        for number, name, phone, status in customers
    ])

    addresses = [
        ("100042", "Санкт-Петербург, ул. Модельная, д. 12"),
        ("100043", "Санкт-Петербург, ул. Демонстрационная, д. 31"),
        ("100044", "Санкт-Петербург, пр. Учебный, д. 78, к. 2"),
        ("100045", "Санкт-Петербург, пер. Проверочный, д. 5"),
        ("100046", "Санкт-Петербург, ул. Примерная, д. 18"),
        ("100047", "Санкт-Петербург, наб. Тренировочная, д. 40"),
        ("100048", "Санкт-Петербург, пр. Демонстрационного Подключения, д. 120, к. 5"),
        ("100049", "Санкт-Петербург, аллея Макетная, д. 3"),
        ("100050", "Санкт-Петербург, ул. Экспериментальная, д. 19, к. 1"),
        ("100051", "Санкт-Петербург, пер. Пилотный, д. 9"),
        ("100052", "Санкт-Петербург, ул. Испытательная, д. 84"),
        ("100053", "Санкт-Петербург, наб. Тестовая, д. 28"),
        ("100054", "Санкт-Петербург, пр. Условный, д. 143, к. 3"),
    ]
    db.execute(insert(Address).on_conflict_do_nothing(index_elements=["id"]), [
        {"id": f"address_{number}", "label": label} for number, label in addresses
    ])
    db.execute(insert(Tariff).on_conflict_do_nothing(index_elements=["id"]), [
        {"id": "home_100", "name": "Домашний 100", "speed_mbps": 100, "monthly_fee_kopecks": 50000},
        {"id": "home_200", "name": "Домашний 200", "speed_mbps": 200, "monthly_fee_kopecks": 65000},
        {"id": "home_500", "name": "Домашний 500", "speed_mbps": 500, "monthly_fee_kopecks": 85000},
    ])

    accounts = [
        ("100042", "100042", "42", "home_200", 45000, "active", "Keenetic Giga KN-1011"),
        ("100043", "100043", "19", "home_100", -50000, "suspended", "TP-Link Archer C6"),
        ("100044", "100044", "108", "home_500", -100000, "suspended", "Keenetic Hopper KN-3811"),
        ("100045", "100045", "8", "home_200", 90000, "active", "TP-Link Archer AX55"),
        ("100046", "100046", "12", "home_500", 22000, "active", "Keenetic Ultra KN-1811"),
        ("100047", "100046", "304", "home_100", 18000, "active", "TP-Link Archer C64"),
        ("100048", "100048", "207", "home_100", 0, "disconnected", None),
        ("100049", "100049", "85", "home_200", 30000, "active", "Keenetic Sprinter KN-3710"),
        ("100050", "100050", "46", "home_500", 6800, "active", "TP-Link Archer AX73"),
        ("100051", "100051", "72", "home_100", -32000, "suspended", "TP-Link Archer C6"),
        ("100052", "100052", "16", "home_100", 9500, "active", "Keenetic Speedster KN-3012"),
        ("100053", "100053", "109", "home_200", 0, "disconnected", None),
        ("100054", "100054", "217", "home_500", 10500, "active", "Keenetic Giga KN-1011"),
    ]
    db.execute(insert(Account).on_conflict_do_nothing(index_elements=["number"]), [
        {
            "number": number,
            "customer_id": f"customer_{customer_number}",
            "address_id": f"address_{number}",
            "apartment": apartment,
            "tariff_id": tariff,
            "balance_kopecks": balance,
            "service_status": status,
            "equipment": equipment,
        }
        for number, customer_number, apartment, tariff, balance, status, equipment in accounts
    ])

    payments = [
        ("100042", 65000, "credited", demo_time(27, 10, 45), demo_time(27, 10, 46)),
        ("100043", 50000, "failed", demo_time(26, 13, 12), None),
        ("100044", 100000, "pending", demo_time(27, 10, 52), None),
        ("100045", 90000, "credited", demo_time(24, 8, 44), demo_time(24, 8, 46)),
        ("100046", 85000, "credited", demo_time(25, 11, 37), demo_time(25, 11, 38)),
        ("100047", 50000, "credited", demo_time(23, 17, 14), demo_time(23, 17, 16)),
    ]
    db.execute(insert(Payment).on_conflict_do_nothing(index_elements=["id"]), [
        {
            "id": f"payment_{number}", "account_number": number, "amount_kopecks": amount,
            "status": status, "paid_at": paid_at, "credited_at": credited_at,
        }
        for number, amount, status, paid_at, credited_at in payments
    ])

    db.execute(insert(Incident).on_conflict_do_nothing(index_elements=["id"]), [
        {
            "id": "NET-102", "address_id": "address_100042", "title": "Повреждение линии связи",
            "description": "Инженеры восстанавливают магистральный участок. Возможны перебои связи.",
            "status": "open", "started_at": demo_time(27, 11, 15),
            "estimated_resolution_at": demo_time(27, 15, 30),
        },
        {
            "id": "NET-104", "address_id": "address_100047", "title": "Потери пакетов на узле доступа",
            "description": "Инженеры проверяют оборудование по сообщениям о нестабильном подключении.",
            "status": "investigating", "started_at": demo_time(27, 10, 40),
            "estimated_resolution_at": None,
        },
        {
            "id": "NET-099", "address_id": "address_100045", "title": "Обновление оборудования",
            "description": "Инженеры завершили плановое обновление оборудования.",
            "status": "resolved", "started_at": demo_time(24, 7),
            "estimated_resolution_at": demo_time(24, 8),
        },
    ])
