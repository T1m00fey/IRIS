import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import URL, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


DATABASE_PATH = os.getenv(
    "DATABASE_PATH", str(Path(__file__).resolve().parents[1] / "iris.sqlite3")
)
engine = create_engine(
    URL.create("sqlite+pysqlite", database=DATABASE_PATH),
    connect_args={"check_same_thread": False, "timeout": 5},
    **({"poolclass": StaticPool} if DATABASE_PATH == ":memory:" else {}),
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def phone_digits(value: str) -> str:
    digits = "".join(character for character in value if character.isdecimal())
    if len(digits) == 11 and digits.startswith("8"):
        return "7" + digits[1:]
    return digits


def normalize_text(value: str | None) -> str | None:
    return value.casefold().replace("ё", "е") if value is not None else None


@event.listens_for(engine, "connect")
def configure_connection(connection, _connection_record) -> None:
    connection.execute("PRAGMA foreign_keys=ON")
    connection.create_function("normalize_text", 1, normalize_text, deterministic=True)
    connection.create_function("phone_digits", 1, phone_digits, deterministic=True)


def enable_wal() -> None:
    if DATABASE_PATH != ":memory:":
        Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL")


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db
