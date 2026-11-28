import argparse
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import SQLAlchemyError

from app.core.contact_center.initialize import require_schema
from app.core.contact_center.models import AssignmentRecord, DepartmentRecord, QueueRecord, RoutingRule, WorkforceRecord
from app.core.contact_center.schemas import ContactCenterConfig
from app.core.contact_center.service import LIVE, transaction
from app.core.operations_models import EmployeeRecord


def upsert(db, model, data, key):
    statement = insert(model).values(data)
    db.execute(statement.on_conflict_do_update(
        index_elements=[key], set_={name: value for name, value in data.items() if name != key},
    ))


def configure(config: ContactCenterConfig) -> None:
    with transaction() as db:
        for department in config.departments:
            if not department.enabled and db.scalar(select(QueueRecord.call_id).where(
                QueueRecord.department == department.code, QueueRecord.state != "closed",
            ).limit(1)) is not None:
                raise ValueError(f"В отделе {department.code} есть живые звонки")
            upsert(db, DepartmentRecord, department.model_dump(), "code")
        for rule in config.routing:
            if db.get(DepartmentRecord, rule.department) is None:
                raise ValueError(f"Неизвестный отдел {rule.department}")
            upsert(db, RoutingRule, rule.model_dump(), "category")
        for profile in config.workforce:
            employee = db.get(EmployeeRecord, profile.employee_id)
            if employee is None or db.get(DepartmentRecord, profile.department) is None:
                raise ValueError(f"Проверьте сотрудника {profile.employee_id} и отдел {profile.department}")
            if db.scalar(select(AssignmentRecord.id).where(
                AssignmentRecord.employee_id == employee.id, AssignmentRecord.state.in_(LIVE),
            )) is not None:
                raise ValueError(f"У сотрудника {employee.id} есть активное назначение")
            employee.department = profile.department
            data = profile.model_dump(exclude={"department"})
            existing = db.get(WorkforceRecord, employee.id)
            data["available_since"] = existing.available_since if existing else employee.updated_at
            upsert(db, WorkforceRecord, data, "employee_id")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Применить настройки маршрутизации к базе DATABASE_PATH")
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    try:
        require_schema()
        configure(ContactCenterConfig.model_validate_json(args.config.read_text(encoding="utf-8-sig")))
    except (OSError, RuntimeError, SQLAlchemyError, ValueError) as error:
        parser.exit(1, f"Не удалось применить настройки: {error}\n")
