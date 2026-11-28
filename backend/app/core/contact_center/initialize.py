import argparse
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core import crm_models  # Registers CRM and authorization models with Base.
from app.core import knowledge_models  # Registers the knowledge base table with Base.
from app.core.contact_center.models import DepartmentRecord
from app.database import DATABASE_PATH, Base, enable_wal, engine


MVP_DEPARTMENTS = {
    "technical_support": "Техническая поддержка",
    "billing": "Платежи и расчёты",
    "connection": "Новые подключения",
}


LEGACY_COLUMNS = {
    "cc_workforce": {
        "notifications_enabled": "BOOLEAN NOT NULL DEFAULT 1",
        "sound_enabled": "BOOLEAN NOT NULL DEFAULT 1",
        "retry_available_at": "DATETIME",
    },
    "cc_live_queue": {
        "target_employee_id": "VARCHAR REFERENCES employees (id)",
        "waiting_ended_at": "DATETIME",
    },
}


def missing_schema(inspector) -> list[str]:
    names = set(inspector.get_table_names())
    missing = []
    for table in Base.metadata.sorted_tables:
        if table.name not in names:
            missing.append(table.name)
            continue
        columns = {column["name"] for column in inspector.get_columns(table.name)}
        missing.extend(f"{table.name}.{column.name}" for column in table.columns if column.name not in columns)
        indexes = {index["name"] for index in inspector.get_indexes(table.name)}
        missing.extend(f"{table.name}.{index.name}" for index in table.indexes if index.name not in indexes)
    return sorted(missing)


def require_schema() -> None:
    missing = missing_schema(inspect(engine))
    if missing:
        raise RuntimeError(
            "Схема IRIS требует миграции: " + ", ".join(missing)
            + ". Запустите python -m app.core.contact_center.initialize для согласованной базы."
        )


def add_default_departments(db: Session) -> None:
    db.execute(insert(DepartmentRecord).values([
        {"code": code, "name": name} for code, name in MVP_DEPARTMENTS.items()
    ]).on_conflict_do_nothing(index_elements=[DepartmentRecord.code]))


def initialize() -> None:
    if DATABASE_PATH != ":memory:":
        Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    with engine.begin() as connection:
        # SQLite needs an explicit transaction before DDL.
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        inspector = inspect(connection)
        names = set(inspector.get_table_names())
        for table, additions in LEGACY_COLUMNS.items():
            if table not in names:
                continue
            columns = {column["name"] for column in inspector.get_columns(table)}
            for column, definition in additions.items():
                if column not in columns:
                    connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        Base.metadata.create_all(connection)
        for table in Base.metadata.sorted_tables:
            for index in table.indexes:
                index.create(connection, checkfirst=True)
        missing = missing_schema(inspect(connection))
        if missing:
            raise RuntimeError("Неподдерживаемая схема SQLite: " + ", ".join(missing))
        if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
            raise RuntimeError("Проверка внешних ключей SQLite обнаружила нарушения")
        with Session(bind=connection) as db:
            add_default_departments(db)
    enable_wal()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Инициализировать схему Contact Center в DATABASE_PATH")
    parser.parse_args()
    try:
        initialize()
    except (OSError, RuntimeError, SQLAlchemyError) as error:
        parser.exit(1, f"Не удалось подготовить базу: {error}\n")
