from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_manager, utc_now
from app.core.crm import get_customer, list_customers, with_utc
from app.core.crm_models import Customer, CustomerNoteRecord
from app.core.crm_schemas import CustomerDetail, CustomerList, CustomerSort, CustomerStatus
from app.database import get_db


router = APIRouter(prefix="/api/v1/customers", tags=["CRM"])
Database = Annotated[Session, Depends(get_db)]


class CustomerNoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class CustomerNote(BaseModel):
    id: int
    text: str
    author_name: str
    created_at: AwareDatetime


def note_data(record: CustomerNoteRecord) -> CustomerNote:
    return CustomerNote(
        id=record.id, text=record.text, author_name=record.author_name, created_at=with_utc(record.created_at),
    )


def require_customer(db: Session, customer_id: str) -> None:
    if db.get(Customer, customer_id) is None:
        raise HTTPException(status_code=404, detail="Клиент не найден")


@router.get("")
def customers(
    db: Database,
    q: Annotated[str | None, Query(max_length=200)] = None,
    status: CustomerStatus | None = None,
    sort: CustomerSort = "name",
    order: Literal["asc", "desc"] = "asc",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> CustomerList:
    return list_customers(db, q, status, sort, order == "desc", limit, offset)


@router.get("/{customer_id}", responses={404: {"description": "Клиент не найден"}})
def customer(customer_id: str, db: Database) -> CustomerDetail:
    result = get_customer(db, customer_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    return result


@router.get("/{customer_id}/notes", responses={404: {"description": "Клиент не найден"}})
def list_notes(customer_id: str, db: Database) -> list[CustomerNote]:
    require_customer(db, customer_id)
    notes = db.scalars(
        select(CustomerNoteRecord).where(CustomerNoteRecord.customer_id == customer_id)
        .order_by(CustomerNoteRecord.created_at.desc(), CustomerNoteRecord.id.desc())
    )
    return [note_data(note) for note in notes]


@router.post("/{customer_id}/notes", status_code=201, responses={404: {"description": "Клиент не найден"}})
def create_note(
    customer_id: str, note: CustomerNoteInput, db: Database,
    author: Annotated[CurrentUser, Depends(require_manager)],
) -> CustomerNote:
    require_customer(db, customer_id)
    record = CustomerNoteRecord(
        customer_id=customer_id, author_id=author.id, author_name=author.full_name,
        text=note.text, created_at=utc_now(),
    )
    db.add(record)
    db.flush()
    data = note_data(record)
    db.commit()
    return data
