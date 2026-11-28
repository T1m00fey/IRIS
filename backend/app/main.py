import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.api.analytics import router as analytics_router
from app.api.contact_center import router as contact_center_router
from app.api.contact_center_voice import router as voice_router
from app.api.customers import router as customers_router
from app.api.manager import router as manager_router
from app.api.operations import router as operations_router
from app.api.operator import router as operator_router
from app.auth import demo_enabled, require_manager
from app.auth.credentials import seed_auth
from app.auth.router import router as auth_router
from app.core.contact_center import service
from app.core.contact_center.initialize import initialize, require_schema
from app.core.crm_seed import seed_crm
from app.core.operations_seed import seed_operations
from app.database import DATABASE_PATH, SessionLocal


logger = logging.getLogger(__name__)


def dispatch_pending_calls() -> None:
    with service.transaction() as db:
        service.dispatch(db)


async def run_dispatcher() -> None:
    while True:
        try:
            await asyncio.to_thread(dispatch_pending_calls)
        except OperationalError:
            logger.exception("Не удалось обновить назначения Contact Center")
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if service.enabled():
        service.timeout("IRIS_ASSIGNMENT_TIMEOUT_SECONDS", 15)
        service.timeout("IRIS_CONNECTION_TIMEOUT_SECONDS", 30)
    if DATABASE_PATH == ":memory:" or not Path(DATABASE_PATH).exists():
        initialize()
    else:
        require_schema()
    with SessionLocal.begin() as session:
        if demo_enabled():
            seed_crm(session)
            seed_operations(session)
        seed_auth(session)
    dispatcher = asyncio.create_task(run_dispatcher()) if service.enabled() else None
    try:
        yield
    finally:
        if dispatcher is not None:
            dispatcher.cancel()
            with suppress(asyncio.CancelledError):
                await dispatcher


app = FastAPI(
    title="IRIS API",
    version="0.2.1",
    description=(
        "Единый API CRM и Contact Center Core. Кабинеты используют сессию IRIS и SSE. "
        "Сервисные вызовы Voice используют отдельный Bearer-токен."
    ),
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url="/api/redoc",
    swagger_ui_oauth2_redirect_url="/api/docs/oauth2-redirect",
    lifespan=lifespan,
)
manager_access = {
    "dependencies": [Depends(require_manager)],
    "responses": {
        401: {"description": "Требуется вход"},
        403: {"description": "Требуются права руководителя"},
    },
}
app.include_router(auth_router)
app.include_router(analytics_router, **manager_access)
app.include_router(customers_router, **manager_access)
app.include_router(manager_router, **manager_access)
app.include_router(operations_router, **manager_access)
app.include_router(operator_router)
if service.enabled():
    app.include_router(contact_center_router)
    app.include_router(voice_router)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    with SessionLocal() as session:
        session.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/docs", include_in_schema=False)
def docs_redirect():
    return RedirectResponse("/api/docs")


@app.get("/openapi.json", include_in_schema=False)
def legacy_openapi():
    return app.openapi()
