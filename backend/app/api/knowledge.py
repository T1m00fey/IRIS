import os
import re
from datetime import UTC
from secrets import compare_digest
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select, update

from app.auth import Database, utc_now
from app.core.knowledge_models import ArticleRecord
from app.database import normalize_text


Category = Literal["company", "offers", "instructions", "troubleshooting", "faq"]
ArticleStatus = Literal["draft", "published", "archived"]
SearchQuery = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Offset = Annotated[int, Query(ge=0, le=2_147_483_647)]


class ArticleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    category: Category
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]


class ArticleVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Annotated[int, Field(strict=True, ge=1, le=9_223_372_036_854_775_806)]


class ArticleEdit(ArticleInput, ArticleVersion):
    pass


class ArticleSummary(BaseModel):
    id: UUID
    title: str
    category: Category
    status: ArticleStatus
    updated_at: AwareDatetime
    published_at: AwareDatetime | None
    has_unpublished_changes: bool


class ArticleDetail(ArticleSummary):
    body: str
    version: int


class ArticleList(BaseModel):
    items: list[ArticleSummary]
    total: int


class PublishedArticleSummary(BaseModel):
    id: UUID
    title: str
    category: Category
    excerpt: str
    published_at: AwareDatetime


class PublishedArticle(BaseModel):
    id: UUID
    title: str
    category: Category
    body: str
    published_at: AwareDatetime


class PublishedSearch(BaseModel):
    items: list[PublishedArticleSummary]
    limit: int
    offset: int


knowledge_bearer = HTTPBearer(scheme_name="VoiceKnowledgeBearer", auto_error=False)


def authorize_knowledge_voice(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(knowledge_bearer)],
) -> None:
    token = os.getenv("IRIS_VOICE_KNOWLEDGE_TOKEN", "").strip()
    if not token:
        raise HTTPException(503, "Доступ Voice AI к базе знаний не настроен", headers={"Cache-Control": "no-store"})
    if credentials is None or not compare_digest(credentials.credentials.encode(), token.encode()):
        raise HTTPException(401, "Требуется токен базы знаний Voice AI", headers={
            "WWW-Authenticate": "Bearer", "Cache-Control": "no-store",
        })


def disable_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


not_found = {404: {"description": "Статья не найдена"}}
mutation_errors = {**not_found, 409: {"description": "Версия статьи изменилась"}}
manager_router = APIRouter(
    prefix="/api/v1/knowledge/articles", tags=["База знаний"], dependencies=[Depends(disable_cache)],
)
voice_router = APIRouter(
    prefix="/api/v1/voice/knowledge", tags=["Voice AI · База знаний"],
    dependencies=[Depends(authorize_knowledge_voice), Depends(disable_cache)],
    responses={401: {"description": "Требуется токен базы знаний Voice AI"},
               503: {"description": "Доступ Voice AI к базе знаний не настроен"}},
)


def apply_search(statement, q: str, title, body):
    terms = list(dict.fromkeys(re.findall(r"[^\W_]+", normalize_text(q))))
    if not terms:
        return statement.where(False)

    normalized_title = func.normalize_text(title)
    normalized_body = func.normalize_text(body)
    matches = sum(func.instr(normalized_title, term) + func.instr(normalized_body, term) > 0 for term in terms)
    title_matches = sum(func.instr(normalized_title, term) > 0 for term in terms)
    return statement.where(matches > 0).order_by(matches.desc(), title_matches.desc())


def article_summary(article: ArticleRecord) -> ArticleSummary:
    return ArticleSummary(
        id=article.id, title=article.title, category=article.category,
        status=article.status, updated_at=article.updated_at.replace(tzinfo=UTC),
        published_at=article.published_at.replace(tzinfo=UTC) if article.published_at else None,
        has_unpublished_changes=article.status == "published" and article.version != article.published_version,
    )


def article_detail(article: ArticleRecord) -> ArticleDetail:
    return ArticleDetail(**article_summary(article).model_dump(), body=article.body, version=article.version)


def missing_article() -> HTTPException:
    return HTTPException(404, "Статья не найдена", headers={"Cache-Control": "no-store"})


def update_article(db: Database, article_id: UUID, version: int, **changes) -> ArticleDetail:
    # Keep the version check and the publication change in the same SQLite write.
    article = db.scalars(
        update(ArticleRecord)
        .where(ArticleRecord.id == str(article_id), ArticleRecord.version == version)
        .values(**changes, version=version + 1, updated_at=utc_now())
        .returning(ArticleRecord)
    ).one_or_none()
    if article is None:
        if db.get(ArticleRecord, str(article_id)) is None:
            raise missing_article()
        raise HTTPException(409, "Статья изменилась. Обновите страницу перед повторной попыткой")
    result = article_detail(article)
    db.commit()
    return result


@manager_router.get("")
def list_articles(
    db: Database, q: Annotated[SearchQuery | None, Query()] = None,
    category: Category | None = None, status: ArticleStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20, offset: Offset = 0,
) -> ArticleList:
    statement = select(ArticleRecord)
    if category:
        statement = statement.where(ArticleRecord.category == category)
    if status:
        statement = statement.where(ArticleRecord.status == status)
    if q:
        statement = apply_search(statement, q, ArticleRecord.title, ArticleRecord.body)
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    articles = db.scalars(statement.order_by(ArticleRecord.updated_at.desc(), ArticleRecord.id).limit(limit).offset(offset))
    return ArticleList(items=[article_summary(article) for article in articles], total=total)


@manager_router.post("", status_code=201)
def create_article(data: ArticleInput, db: Database) -> ArticleDetail:
    article = ArticleRecord(id=str(uuid4()), **data.model_dump(), status="draft", version=1, updated_at=utc_now())
    db.add(article)
    result = article_detail(article)
    db.commit()
    return result


@manager_router.get("/{article_id}", responses=not_found)
def get_article(article_id: UUID, db: Database) -> ArticleDetail:
    article = db.get(ArticleRecord, str(article_id))
    if article is None:
        raise missing_article()
    return article_detail(article)


@manager_router.put("/{article_id}", responses=mutation_errors)
def edit_article(article_id: UUID, data: ArticleEdit, db: Database) -> ArticleDetail:
    return update_article(db, article_id, data.version, **data.model_dump(exclude={"version"}))


@manager_router.post("/{article_id}/publish", responses=mutation_errors)
def publish_article(article_id: UUID, data: ArticleVersion, db: Database) -> ArticleDetail:
    return update_article(
        db, article_id, data.version, status="published", published_at=utc_now(),
        published_title=ArticleRecord.title, published_category=ArticleRecord.category,
        published_body=ArticleRecord.body, published_version=data.version + 1,
    )


@manager_router.post("/{article_id}/archive", responses=mutation_errors)
def archive_article(article_id: UUID, data: ArticleVersion, db: Database) -> ArticleDetail:
    return update_article(db, article_id, data.version, status="archived")


@voice_router.get("/search")
def search_published(
    q: Annotated[SearchQuery, Query()], db: Database, category: Category | None = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 5, offset: Offset = 0,
) -> PublishedSearch:
    statement = select(
        ArticleRecord.id, ArticleRecord.published_title, ArticleRecord.published_category,
        func.substr(ArticleRecord.published_body, 1, 280), ArticleRecord.published_at,
    ).where(ArticleRecord.status == "published")
    if category:
        statement = statement.where(ArticleRecord.published_category == category)
    statement = apply_search(statement, q, ArticleRecord.published_title, ArticleRecord.published_body)
    articles = db.execute(statement.order_by(ArticleRecord.published_at.desc(), ArticleRecord.id).limit(limit).offset(offset))
    return PublishedSearch(limit=limit, offset=offset, items=[
        PublishedArticleSummary(id=article_id, title=title, category=category, excerpt=excerpt,
                                published_at=published_at.replace(tzinfo=UTC))
        for article_id, title, category, excerpt, published_at in articles
    ])


@voice_router.get("/articles/{article_id}", responses=not_found)
def get_published(article_id: UUID, db: Database) -> PublishedArticle:
    article = db.scalar(select(ArticleRecord).where(ArticleRecord.id == str(article_id), ArticleRecord.status == "published"))
    if article is None:
        raise missing_article()
    return PublishedArticle(
        id=article.id, title=article.published_title, category=article.published_category,
        body=article.published_body, published_at=article.published_at.replace(tzinfo=UTC),
    )
