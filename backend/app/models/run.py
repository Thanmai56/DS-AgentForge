"""
SQLAlchemy models — Run, ViewSpec, GraphNode, GraphEdge, Artifact, AuditLog, Feedback
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Float, Text, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Run(Base):
    """A complete modelling session from requirement to export."""
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("connections.id"), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=True)
    requirement_text: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(50), default="INTAKE")
    # States: INTAKE | PARSE_REQUIREMENT | SELECT_SOURCES | PROFILE | DETECT_ASSOCIATIONS |
    #         PLAN_VIEW_CHAIN | BUILD_VIEWS | VALIDATE | RENDER_ARTIFACTS | EXPORT | FAILED
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)  # for forks
    agent_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # LangGraph checkpoint
    user_metadata: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)  # Human-provided metadata
    parsed_requirement: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    candidate_tables: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    view_chain_plan: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    validation_report: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    view_specs: Mapped[list["ViewSpec"]] = relationship("ViewSpec", back_populates="run", cascade="all, delete-orphan")
    graph_nodes: Mapped[list["GraphNode"]] = relationship("GraphNode", back_populates="run", cascade="all, delete-orphan")
    graph_edges: Mapped[list["GraphEdge"]] = relationship("GraphEdge", back_populates="run", cascade="all, delete-orphan")


class ViewSpec(Base):
    """
    SINGLE SOURCE OF TRUTH for a generated/edited view.
    Canvas, artifacts, and exports all derive from this.
    LLM writes ViewSpecs; Renderer converts ViewSpec → Datasphere JSON.
    """
    __tablename__ = "view_specs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False, index=True)
    spec_version: Mapped[str] = mapped_column(String(20), default="1.0")
    object_id: Mapped[str] = mapped_column(String(255), nullable=False)  # DS-safe name e.g. V_SALES_FACT
    layer: Mapped[str] = mapped_column(String(10), nullable=False)  # L1|L2|L3|L4
    kind: Mapped[str] = mapped_column(String(50), nullable=False)  # graphical_view|sql_view|business_entity|analytic_model
    business_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    spec_json: Mapped[dict] = mapped_column(JSONB, nullable=False)  # Full ViewSpec per §7.1
    approval_state: Mapped[str] = mapped_column(String(20), default="draft")  # draft|approved|rejected
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    human_edits: Mapped[list] = mapped_column(JSONB, default=list)  # structured diff log
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    run: Mapped["Run"] = relationship("Run", back_populates="view_specs")
    artifact: Mapped["Artifact | None"] = relationship("Artifact", back_populates="view_spec", uselist=False)


class GraphNode(Base):
    """
    A node in the unified graph model that drives all 3 visualizations
    (Canvas, Lineage, Impact).
    """
    __tablename__ = "graph_nodes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False, index=True)
    node_key: Mapped[str] = mapped_column(String(255), nullable=False)  # unique within run
    object_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    # kinds: source_table | operator | view | entity | analytic_model
    label: Mapped[str] = mapped_column(String(512), nullable=True)
    layer: Mapped[str | None] = mapped_column(String(10), nullable=True)
    pos_x: Mapped[float] = mapped_column(Float, default=0.0)
    pos_y: Mapped[float] = mapped_column(Float, default=0.0)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    run: Mapped["Run"] = relationship("Run", back_populates="graph_nodes")


class GraphEdge(Base):
    """
    An edge in the unified graph model.
    edge_kind: data_flow | join_input | association | contains
    """
    __tablename__ = "graph_edges"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False, index=True)
    from_node_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    to_node_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    edge_kind: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # cardinality, join columns

    run: Mapped["Run"] = relationship("Run", back_populates="graph_edges")


class Artifact(Base):
    """Rendered Datasphere-native JSON for a ViewSpec."""
    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    view_spec_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("view_specs.id"), nullable=False, index=True)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False)
    ds_release: Mapped[str] = mapped_column(String(50), nullable=False)
    artifact_json: Mapped[dict] = mapped_column(JSONB, nullable=False)  # Datasphere-native JSON
    is_valid: Mapped[bool] = mapped_column(default=False)
    validation_errors: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    rendered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    view_spec: Mapped["ViewSpec"] = relationship("ViewSpec", back_populates="artifact")


class AuditLog(Base):
    """Immutable audit log — LLM calls + human edits + system events."""
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # event_types: llm_call | human_edit | approval | export | connection_test | error
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    prompt_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    llm_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Feedback(Base):
    """Structured human edit diffs — feeds future golden examples."""
    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False)
    view_spec_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("view_specs.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    diff: Mapped[dict] = mapped_column(JSONB, nullable=False)  # before/after ViewSpec diff
    edit_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Glossary(Base):
    """SAP technical column name → business classification (deterministic, no LLM)."""
    __tablename__ = "glossary"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    technical_name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    business_name: Mapped[str] = mapped_column(String(512), nullable=False)
    semantic_role: Mapped[str] = mapped_column(String(50), nullable=False)  # key|measure|dimension|text|date|unit
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    semantic_type: Mapped[str | None] = mapped_column(String(100), nullable=True)  # e.g. currency_amount, customer_id
    source: Mapped[str] = mapped_column(String(50), default="sap_dictionary")
