from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.operations_models import EmployeeRecord, TicketRecord
from app.core.schemas import Department, EmployeeStatus, TicketStatus
from app.database import get_db


router = APIRouter(prefix="/api/v1", tags=["Аналитика"])


class DepartmentWorkload(BaseModel):
    department: Department
    queued: int
    in_progress: int
    online: int


class Analytics(BaseModel):
    employees_online: int
    average_wait_seconds: int | None
    departments: list[DepartmentWorkload]


@router.get("/analytics")
def get_analytics(db: Annotated[Session, Depends(get_db)]) -> Analytics:
    online = dict(db.execute(
        select(EmployeeRecord.department, func.count())
        .where(EmployeeRecord.status.in_([EmployeeStatus.AVAILABLE, EmployeeStatus.BUSY, EmployeeStatus.PAUSED]))
        .group_by(EmployeeRecord.department)
    ).all())
    workload = {
        (department, status): count
        for department, status, count in db.execute(
            select(TicketRecord.department, TicketRecord.status, func.count())
            .where(TicketRecord.status.in_([TicketStatus.QUEUED, TicketStatus.IN_PROGRESS]))
            .group_by(TicketRecord.department, TicketRecord.status)
        )
    }
    wait_days = func.julianday(TicketRecord.started_at) - func.julianday(TicketRecord.queued_at)
    average_wait = db.scalar(
        select(func.avg(wait_days * 86400)).where(TicketRecord.started_at >= TicketRecord.queued_at)
    )
    return Analytics(
        employees_online=sum(online.values()),
        average_wait_seconds=round(average_wait) if average_wait is not None else None,
        departments=[
            DepartmentWorkload(
                department=department,
                queued=workload.get((department, TicketStatus.QUEUED), 0),
                in_progress=workload.get((department, TicketStatus.IN_PROGRESS), 0),
                online=online.get(department, 0),
            )
            for department in Department
        ],
    )
