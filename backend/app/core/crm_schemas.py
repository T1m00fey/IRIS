from typing import Literal

from pydantic import AwareDatetime, BaseModel


CustomerStatus = Literal["active", "suspended", "inactive"]
ServiceStatus = Literal["active", "suspended", "disconnected"]
CustomerSort = Literal[
    "name", "balance", "last_contact_at", "account_count", "address", "tariff",
    "phone", "status", "account_number",
]


class AccountSummary(BaseModel):
    number: str
    address: str
    tariff_name: str
    balance_kopecks: int
    service_status: ServiceStatus


class PaymentDetail(BaseModel):
    id: str
    amount_kopecks: int
    status: Literal["credited", "pending", "failed"]
    paid_at: AwareDatetime
    credited_at: AwareDatetime | None


class IncidentDetail(BaseModel):
    id: str
    title: str
    description: str
    status: Literal["open", "investigating", "resolved"]
    started_at: AwareDatetime
    estimated_resolution_at: AwareDatetime | None


class AccountDetail(AccountSummary):
    speed_mbps: int
    monthly_fee_kopecks: int
    equipment: str | None
    active_incidents: list[IncidentDetail]
    payments: list[PaymentDetail]


class CustomerSummary(BaseModel):
    id: str
    full_name: str
    phone: str
    status: CustomerStatus
    account_count: int
    primary_account: AccountSummary | None
    last_contact_at: AwareDatetime | None


class CustomerDetail(CustomerSummary):
    accounts: list[AccountDetail]


class CustomerList(BaseModel):
    items: list[CustomerSummary]
    total: int
    limit: int
    offset: int
