from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.auth.models import UserRecord
from app.database import Base


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(primary_key=True)
    full_name: Mapped[str]
    phone: Mapped[str]
    status: Mapped[str] = mapped_column(String, index=True)

    accounts: Mapped[list["Account"]] = relationship(order_by="Account.number")


class CustomerNoteRecord(Base):
    __tablename__ = "crm_customer_notes"
    __table_args__ = (Index("ix_crm_customer_notes_customer_created", "customer_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey(Customer.id))
    author_id: Mapped[str] = mapped_column(ForeignKey(UserRecord.id))
    author_name: Mapped[str]
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime]


class Address(Base):
    __tablename__ = "addresses"

    id: Mapped[str] = mapped_column(primary_key=True)
    label: Mapped[str]

    incidents: Mapped[list["Incident"]] = relationship(order_by="Incident.started_at.desc()")


class Tariff(Base):
    __tablename__ = "tariffs"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    speed_mbps: Mapped[int]
    monthly_fee_kopecks: Mapped[int]


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (Index("ix_accounts_customer_number", "customer_id", "number"),)

    number: Mapped[str] = mapped_column(primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    address_id: Mapped[str] = mapped_column(ForeignKey("addresses.id"))
    apartment: Mapped[str | None]
    tariff_id: Mapped[str] = mapped_column(ForeignKey("tariffs.id"))
    balance_kopecks: Mapped[int]
    service_status: Mapped[str]
    equipment: Mapped[str | None]

    address: Mapped[Address] = relationship()
    tariff: Mapped[Tariff] = relationship()
    payments: Mapped[list["Payment"]] = relationship(order_by="Payment.paid_at.desc()")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(primary_key=True)
    account_number: Mapped[str] = mapped_column(ForeignKey("accounts.number"), index=True)
    amount_kopecks: Mapped[int]
    status: Mapped[str]
    paid_at: Mapped[datetime] = mapped_column(DateTime)
    credited_at: Mapped[datetime | None] = mapped_column(DateTime)


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(primary_key=True)
    address_id: Mapped[str] = mapped_column(ForeignKey("addresses.id"), index=True)
    title: Mapped[str]
    description: Mapped[str]
    status: Mapped[str]
    started_at: Mapped[datetime] = mapped_column(DateTime)
    estimated_resolution_at: Mapped[datetime | None] = mapped_column(DateTime)
