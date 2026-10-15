"""
SQLAlchemy models — Catalog (tables, columns, profiles discovered from Datasphere)
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Boolean, BigInteger, Float, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class CatalogTable(Base):
    """Represents a table or view discovered in a Datasphere space."""
    __tablename__ = "catalog_tables"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("connections.id"), nullable=False, index=True)
    space: Mapped[str] = mapped_column(String(255), nullable=False)
    schema_name: Mapped[str] = mapped_column(String(255), nullable=True)
    object_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    object_type: Mapped[str] = mapped_column(String(50), nullable=False)  # TABLE | VIEW | GRAPHICAL_VIEW | ANALYTIC_MODEL etc.
    business_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # for incremental refresh
    row_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    is_pii: Mapped[bool] = mapped_column(Boolean, default=False)
    profile_status: Mapped[str] = mapped_column(String(50), default="pending")  # pending|running|done|failed
    profiled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    is_remote: Mapped[bool] = mapped_column(Boolean, default=False)
    is_replicated: Mapped[bool] = mapped_column(Boolean, default=False)
    remote_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remote_object_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    replication_status: Mapped[str | None] = mapped_column(String(50), nullable=True)  # active | inactive | error | not_configured
    replication_mode: Mapped[str | None] = mapped_column(String(50), nullable=True)  # realtime | scheduled | snapshot | none
    existing_associations: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    custom_attributes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    columns: Mapped[list["CatalogColumn"]] = relationship("CatalogColumn", back_populates="table", cascade="all, delete-orphan")


class CatalogColumn(Base):
    """Column-level metadata for a catalog table/view."""
    __tablename__ = "catalog_columns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    table_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_tables.id"), nullable=False, index=True)
    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    data_type: Mapped[str] = mapped_column(String(100), nullable=True)
    length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scale: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_nullable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_key: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Classified by SAP dictionary or LLM
    semantic_role: Mapped[str | None] = mapped_column(String(50), nullable=True)  # key|measure|dimension|text|date|unit
    business_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    classification_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    classification_source: Mapped[str | None] = mapped_column(String(50), nullable=True)  # dictionary|llm
    is_pii: Mapped[bool] = mapped_column(Boolean, default=False)

    table: Mapped["CatalogTable"] = relationship("CatalogTable", back_populates="columns")


class CatalogProfile(Base):
    """Statistical profile results for a catalog column (from profiling SQL pack §9)."""
    __tablename__ = "catalog_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    column_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_columns.id"), nullable=False, index=True)
    table_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("catalog_tables.id"), nullable=False, index=True)
    # P1 stats
    n_rows: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    n_distinct: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    n_null: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    min_val: Mapped[str | None] = mapped_column(Text, nullable=True)
    max_val: Mapped[str | None] = mapped_column(Text, nullable=True)
    # P2 key uniqueness
    key_duplicates: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # P5 top-k (only non-PII)
    top_k_values: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Join candidates (computed)
    join_candidates: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    sampled: Mapped[bool] = mapped_column(Boolean, default=False)
    profiled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
