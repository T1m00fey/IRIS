from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, union_all
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.crm_models import ACTIVE_INCIDENT_STATUSES, Account, Address, Customer, Incident, Tariff
from app.core.crm_schemas import (
    AccountDetail,
    AccountSummary,
    CustomerDetail,
    CustomerList,
    CustomerSort,
    CustomerStatus,
    CustomerSummary,
    IncidentDetail,
    PaymentDetail,
)
from app.core.operations_models import CallRecord, TicketRecord
from app.database import address_key, district_key, normalize_text, phone_digits


def with_utc(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=UTC) if value is not None else None


def account_summary(account: Account, address: Address, tariff: Tariff) -> AccountSummary:
    return AccountSummary(
        number=account.number,
        address=f"{address.label}, кв. {account.apartment}" if account.apartment else address.label,
        tariff_name=tariff.name,
        balance_kopecks=account.balance_kopecks,
        service_status=account.service_status,
    )


def account_detail(db: Session, account: Account) -> AccountDetail:
    address = account.address
    district = district_key(address.label, address.district)
    incidents = db.scalars(
        select(Incident).join(Address, Address.id == Incident.address_id).where(
            Incident.status.in_(ACTIVE_INCIDENT_STATUSES),
            or_(
                and_(Incident.district_key.is_(None), func.address_key(Address.label) == address_key(address.label)),
                Incident.district_key == district if district else False,
            ),
        ).order_by(Incident.started_at.desc(), Incident.id)
    )
    return AccountDetail(
        **account_summary(account, address, account.tariff).model_dump(),
        speed_mbps=account.tariff.speed_mbps,
        monthly_fee_kopecks=account.tariff.monthly_fee_kopecks,
        equipment=account.equipment,
        active_incidents=[
            IncidentDetail(
                id=incident.id,
                title=incident.title,
                description=incident.description,
                status=incident.status,
                started_at=incident.started_at.replace(tzinfo=UTC),
                estimated_resolution_at=with_utc(incident.estimated_resolution_at),
            )
            for incident in incidents
        ],
        payments=[
            PaymentDetail(
                id=payment.id,
                amount_kopecks=payment.amount_kopecks,
                status=payment.status,
                paid_at=payment.paid_at.replace(tzinfo=UTC),
                credited_at=with_utc(payment.credited_at),
            )
            for payment in account.payments
        ],
    )


def customer_summary(
    customer: Customer,
    primary_account: AccountSummary | None,
    account_count: int,
    last_contact_at: datetime | None,
) -> CustomerSummary:
    return CustomerSummary(
        id=customer.id,
        full_name=customer.full_name,
        phone=customer.phone,
        status=customer.status,
        account_count=account_count,
        primary_account=primary_account,
        last_contact_at=with_utc(last_contact_at),
    )


def contact_times(customer_id: str | None = None):
    calls = select(CallRecord.customer_id, CallRecord.started_at.label("contact_at"))
    tickets = select(TicketRecord.customer_id, TicketRecord.created_at.label("contact_at"))
    if customer_id is not None:
        calls = calls.where(CallRecord.customer_id == customer_id)
        tickets = tickets.where(TicketRecord.customer_id == customer_id)
    contacts = union_all(calls, tickets).subquery()
    return select(contacts.c.customer_id, func.max(contacts.c.contact_at).label("last_contact_at")).group_by(
        contacts.c.customer_id
    )


def list_customers(
    db: Session,
    query: str | None,
    status: CustomerStatus | None,
    sort: CustomerSort,
    descending: bool,
    limit: int,
    offset: int,
) -> CustomerList:
    filters = []
    if status is not None:
        filters.append(Customer.status == status)
    query = " ".join(query.split()) if query else ""
    if query:
        name = func.normalize_text(Customer.full_name)
        matches = [
            and_(*(name.contains(token, autoescape=True) for token in normalize_text(query).split())),
            Customer.accounts.any(Account.number.contains(query, autoescape=True)),
        ]
        digits = phone_digits(query)
        if digits and all(character.isdecimal() or character in " +().-" for character in query):
            matches.append(func.phone_digits(Customer.phone).contains(digits, autoescape=True))
        filters.append(or_(*matches))

    account_stats = (
        select(
            Account.customer_id,
            func.min(Account.number).label("primary_number"),
            func.count().label("account_count"),
        )
        .group_by(Account.customer_id)
        .subquery()
    )
    last_contacts = contact_times().subquery()
    account_count = func.coalesce(account_stats.c.account_count, 0)
    sort_columns = {
        "name": func.normalize_text(Customer.full_name),
        "balance": Account.balance_kopecks,
        "last_contact_at": last_contacts.c.last_contact_at,
        "account_count": account_count,
        "address": func.normalize_text(Address.label),
        "tariff": func.normalize_text(Tariff.name),
        "phone": func.phone_digits(Customer.phone),
        "status": Customer.status,
        "account_number": Account.number,
    }
    order = sort_columns[sort].desc() if descending else sort_columns[sort].asc()
    rows = db.execute(
        select(Customer, Account, Address, Tariff, account_count, last_contacts.c.last_contact_at)
        .outerjoin(account_stats, account_stats.c.customer_id == Customer.id)
        .outerjoin(Account, Account.number == account_stats.c.primary_number)
        .outerjoin(Address, Address.id == Account.address_id)
        .outerjoin(Tariff, Tariff.id == Account.tariff_id)
        .outerjoin(last_contacts, last_contacts.c.customer_id == Customer.id)
        .where(*filters)
        .order_by(order.nulls_last(), Customer.id)
        .limit(limit)
        .offset(offset)
    )
    items = []
    for customer, account, address, tariff, count, last_contact in rows:
        primary = account_summary(account, address, tariff) if account else None
        items.append(customer_summary(customer, primary, count, last_contact))
    return CustomerList(
        items=items,
        total=db.scalar(select(func.count()).select_from(Customer).where(*filters)),
        limit=limit,
        offset=offset,
    )


def get_customer(db: Session, customer_id: str) -> CustomerDetail | None:
    customer = db.scalar(
        select(Customer)
        .where(Customer.id == customer_id)
        .options(
            selectinload(Customer.accounts).joinedload(Account.address),
            selectinload(Customer.accounts).joinedload(Account.tariff),
            selectinload(Customer.accounts).selectinload(Account.payments),
        )
    )
    if customer is None:
        return None

    last_contact = db.execute(contact_times(customer_id)).first()
    accounts = [account_detail(db, account) for account in customer.accounts]
    summary = customer_summary(
        customer, accounts[0] if accounts else None, len(accounts), last_contact[1] if last_contact else None,
    )
    return CustomerDetail(**summary.model_dump(), accounts=accounts)
