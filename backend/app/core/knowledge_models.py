from datetime import datetime

from sqlalchemy import Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ArticleRecord(Base):
    __tablename__ = "knowledge_articles"
    __table_args__ = (
        Index("ix_knowledge_articles_status_updated", "status", "updated_at"),
        Index("ix_knowledge_articles_status_published", "status", "published_at"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    title: Mapped[str]
    category: Mapped[str]
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str]
    version: Mapped[int]
    updated_at: Mapped[datetime]
    published_title: Mapped[str | None]
    published_category: Mapped[str | None]
    published_body: Mapped[str | None] = mapped_column(Text)
    published_version: Mapped[int | None]
    published_at: Mapped[datetime | None]
