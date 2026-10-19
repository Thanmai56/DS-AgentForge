"""
Inspection & Logging Module for DS-AgentForge.

Makes the complete pipeline inspectable without console truncation:
  Uploaded File -> Python Parser -> Extracted Metadata -> Compact Planner Context -> Exact LLM Input -> LLM Response -> Validated Plan

Provides:
- Request ID correlation across all pipeline stages.
- Detailed introspection of discovered objects, types, column counts, key status, filter capabilities, warnings.
- Metadata compaction details (retained objects vs omitted attributes).
- Sample row mapping status, unknown columns, and malformed rows.
- Exact system prompt and user prompt sent to LLM, provider/model info.
- Full retry attempt logs, errors, and validation results.
- Sensitive credential / API key redaction.
- In-memory inspection store for development endpoints.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import re
from typing import Any, Optional
import uuid
from pydantic import BaseModel, Field, ConfigDict

from app.agent.cds_extractor import ExtractedMetadata
from app.agent.sample_mapper import SampleMappingResult

logger = logging.getLogger(__name__)


def _redact_sensitive_text(text: str) -> str:
    """Redacts potential API keys, passwords, and bearer tokens from text."""
    if not text:
        return ""
    # Redact OpenAI sk-..., Gemini keys, Bearer tokens
    text = re.sub(r"sk-[A-Za-z0-9_\-]{20,}", "[REDACTED_API_KEY]", text)
    text = re.sub(r"AIza[0-9A-Za-z-_]{35}", "[REDACTED_GEMINI_KEY]", text)
    text = re.sub(r"AQ\.[A-Za-z0-9_\-]{40,}", "[REDACTED_API_KEY]", text)
    text = re.sub(r"Bearer\s+[A-Za-z0-9_\-\.]{20,}", "Bearer [REDACTED_TOKEN]", text, flags=re.IGNORECASE)
    return text


class ColumnInspection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    data_type: str
    label: str = ""
    is_key: bool = False
    is_measure: bool = False
    aggregation: str = ""
    filter_capable: bool = True


class ObjectInspection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    object_type: str
    label: str = ""
    is_existing: bool = True
    column_count: int
    columns: list[ColumnInspection] = Field(default_factory=list)
    keys: list[str] = Field(default_factory=list)
    joins_count: int = 0
    filters_count: int = 0
    calculated_columns_count: int = 0


class StageMetadataInspection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    filename: str = "uploaded_metadata.json"
    parsing_status: str = "success"  # "success", "warnings", "failed"
    total_objects_discovered: int = 0
    discovered_objects: list[ObjectInspection] = Field(default_factory=list)
    parsing_warnings: list[str] = Field(default_factory=list)
    unsupported_structures: list[str] = Field(default_factory=list)
    structured_summary: str = ""


class StageCompactionInspection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    retained_objects: list[str] = Field(default_factory=list)
    omitted_attributes: list[str] = Field(default_factory=list)
    compact_text_chars: int = 0
    compact_text_preview: str = ""


class StageSampleMappingInspection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    has_samples: bool = False
    mapped_tables: list[str] = Field(default_factory=list)
    total_rows_parsed: int = 0
    total_rows_retained: int = 0
    unknown_columns: dict[str, list[str]] = Field(default_factory=dict)
    ambiguous_blocks_count: int = 0
    malformed_rows_count: int = 0
    warnings: list[str] = Field(default_factory=list)
    compact_sample_preview: str = ""


class LLMAttemptLog(BaseModel):
    model_config = ConfigDict(extra="ignore")

    attempt_number: int
    timestamp: str
    prompt_chars: int
    user_prompt_sent: str
    raw_response: str
    json_parse_status: str = "success"  # "success" | "error"
    pydantic_status: str = "success"
    plan_checker_status: str = "success"
    errors: list[str] = Field(default_factory=list)


class StageLLMInspection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    provider: str = "fake"
    model: str = "default"
    system_prompt: str = ""
    total_attempts: int = 1
    attempts: list[LLMAttemptLog] = Field(default_factory=list)
    final_status: str = "success"  # "success" | "failed"
    final_error: Optional[str] = None


class InspectionTrace(BaseModel):
    """Correlated end-to-end trace of a single requirement modeling run."""
    model_config = ConfigDict(extra="ignore")

    request_id: str
    plan_id: Optional[str] = None
    timestamp: str
    requirement: str
    stage_metadata: StageMetadataInspection = Field(default_factory=StageMetadataInspection)
    stage_compaction: StageCompactionInspection = Field(default_factory=StageCompactionInspection)
    stage_sample_mapping: StageSampleMappingInspection = Field(default_factory=StageSampleMappingInspection)
    stage_llm: StageLLMInspection = Field(default_factory=StageLLMInspection)
    final_plan_node_count: int = 0

    def to_human_readable_summary(self) -> str:
        """Generates an untruncated human-readable report of the full pipeline."""
        lines = [
            "=" * 70,
            f"DS MODELFORGE PIPELINE INSPECTION TRACE",
            f"Request ID: {self.request_id}",
            f"Plan ID:    {self.plan_id or 'N/A'}",
            f"Timestamp:  {self.timestamp}",
            "=" * 70,
            "",
            "1. BUSINESS REQUIREMENT:",
            f"   {self.requirement}",
            "",
            "2. PARSER & METADATA EXTRACTION:",
            f"   Source File:      {self.stage_metadata.filename}",
            f"   Status:           {self.stage_metadata.parsing_status.upper()}",
            f"   Objects Found:    {self.stage_metadata.total_objects_discovered}",
        ]

        for obj in self.stage_metadata.discovered_objects:
            lines.append(
                f"   - [{obj.object_type.upper()}] {obj.name} (Columns: {obj.column_count}, Keys: {obj.keys}, Joins: {obj.joins_count})"
            )
            for c in obj.columns:
                role = " [KEY]" if c.is_key else (" [MEASURE]" if c.is_measure else "")
                lines.append(f"       * {c.name} ({c.data_type}){role} (Label: '{c.label}', Filterable: {c.filter_capable})")

        if self.stage_metadata.parsing_warnings:
            lines.append("   Parsing Warnings:")
            for w in self.stage_metadata.parsing_warnings:
                lines.append(f"     ! {w}")

        if self.stage_metadata.unsupported_structures:
            lines.append("   Unsupported Structures Omitted:")
            for u in self.stage_metadata.unsupported_structures:
                lines.append(f"     ! {u}")

        lines.extend([
            "",
            "3. METADATA COMPACTION:",
            f"   Retained Objects:     {', '.join(self.stage_compaction.retained_objects)}",
            f"   Omitted Non-Critical: {', '.join(self.stage_compaction.omitted_attributes)}",
            f"   Compact Context Size: {self.stage_compaction.compact_text_chars} chars",
            "",
            "4. SAMPLE ROW MAPPING:",
            f"   Samples Supplied:     {self.stage_sample_mapping.has_samples}",
            f"   Mapped Tables:        {', '.join(self.stage_sample_mapping.mapped_tables) or 'None'}",
            f"   Rows Parsed/Retained: {self.stage_sample_mapping.total_rows_parsed} / {self.stage_sample_mapping.total_rows_retained}",
            f"   Ambiguous Blocks:     {self.stage_sample_mapping.ambiguous_blocks_count}",
            f"   Malformed Rows:       {self.stage_sample_mapping.malformed_rows_count}",
        ])

        if self.stage_sample_mapping.unknown_columns:
            lines.append("   Unknown Columns In Samples:")
            for tbl, cols in self.stage_sample_mapping.unknown_columns.items():
                lines.append(f"     ! {tbl}: {', '.join(cols)}")

        lines.extend([
            "",
            "5. LLM CONTEXT & REASONING:",
            f"   Provider / Model: {self.stage_llm.provider} / {self.stage_llm.model}",
            f"   Total Attempts:   {self.stage_llm.total_attempts}",
            f"   Final Status:     {self.stage_llm.final_status.upper()}",
        ])

        for attempt in self.stage_llm.attempts:
            lines.extend([
                f"   --- Attempt {attempt.attempt_number} ---",
                f"       JSON Parsing:    {attempt.json_parse_status}",
                f"       Pydantic Valid:  {attempt.pydantic_status}",
                f"       Checker Status:  {attempt.plan_checker_status}",
            ])
            if attempt.errors:
                lines.append("       Errors Reported:")
                for err in attempt.errors:
                    lines.append(f"         x {err}")

        lines.extend([
            "",
            f"6. RESULTING MODELING PLAN:",
            f"   Plan Node Count: {self.final_plan_node_count}",
            "=" * 70,
        ])

        return "\n".join(lines)


# ── In-Memory Trace Storage ──────────────────────────────────────────────────

INSPECTION_TRACES: dict[str, InspectionTrace] = {}


def record_metadata_stage(
    metadata: ExtractedMetadata,
    filename: str = "uploaded_metadata.json",
) -> StageMetadataInspection:
    """Builds a StageMetadataInspection from parsed metadata."""
    discovered: list[ObjectInspection] = []

    for obj in metadata.objects.values():
        cols: list[ColumnInspection] = []
        for col in obj.columns.values():
            cols.append(
                ColumnInspection(
                    name=col.name,
                    data_type=col.data_type,
                    label=col.label or col.name,
                    is_key=col.is_key,
                    is_measure=col.is_measure,
                    aggregation=col.aggregation,
                    filter_capable=getattr(col, "filter_capable", True),
                )
            )

        discovered.append(
            ObjectInspection(
                name=obj.name,
                object_type=obj.object_type,
                label=obj.label,
                is_existing=obj.is_existing,
                column_count=len(obj.columns),
                columns=cols,
                keys=list(obj.keys),
                joins_count=len(obj.joins),
                filters_count=len(obj.filters),
                calculated_columns_count=len(obj.calculated_columns),
            )
        )

    status_str = "warnings" if metadata.parsing_warnings else "success"
    if not discovered:
        status_str = "failed"

    return StageMetadataInspection(
        filename=filename,
        parsing_status=status_str,
        total_objects_discovered=len(discovered),
        discovered_objects=discovered,
        parsing_warnings=list(metadata.parsing_warnings),
        unsupported_structures=list(metadata.unsupported_structures),
        structured_summary=metadata.to_compact_text(),
    )


def record_compaction_stage(
    metadata: ExtractedMetadata,
) -> StageCompactionInspection:
    """Records which metadata items are retained vs omitted during compaction."""
    compact_text = metadata.to_compact_text()
    retained = list(metadata.objects.keys())
    omitted = [
        "Internal CSN UI layout coordinates",
        "Raw database catalog hashes",
        "Unreferenced intermediate SQL subquery strings",
        "Redundant display annotations",
    ]

    return StageCompactionInspection(
        retained_objects=retained,
        omitted_attributes=omitted,
        compact_text_chars=len(compact_text),
        compact_text_preview=compact_text[:300] + ("..." if len(compact_text) > 300 else ""),
    )


def record_sample_mapping_stage(
    sample_result: SampleMappingResult,
) -> StageSampleMappingInspection:
    """Builds a StageSampleMappingInspection from SampleMappingResult."""
    total_parsed = sum(t.total_rows_parsed for t in sample_result.tables.values())
    total_retained = sum(t.rows_retained for t in sample_result.tables.values())

    return StageSampleMappingInspection(
        has_samples=sample_result.has_samples,
        mapped_tables=list(sample_result.tables.keys()),
        total_rows_parsed=total_parsed,
        total_rows_retained=total_retained,
        unknown_columns=dict(sample_result.unknown_columns),
        ambiguous_blocks_count=len(sample_result.ambiguous_blocks),
        malformed_rows_count=len(sample_result.malformed_rows),
        warnings=list(sample_result.warnings),
        compact_sample_preview=sample_result.to_compact_text()[:300],
    )


def save_inspection_trace(trace: InspectionTrace) -> None:
    """Saves trace in memory keyed by request_id and plan_id."""
    # Redact sensitive text in prompts and outputs before saving
    trace.stage_llm.system_prompt = _redact_sensitive_text(trace.stage_llm.system_prompt)
    for att in trace.stage_llm.attempts:
        att.user_prompt_sent = _redact_sensitive_text(att.user_prompt_sent)
        att.raw_response = _redact_sensitive_text(att.raw_response)

    INSPECTION_TRACES[trace.request_id] = trace
    if trace.plan_id:
        INSPECTION_TRACES[trace.plan_id] = trace

    logger.info(
        "Saved inspection trace request_id=%s plan_id=%s objects=%d status=%s",
        trace.request_id,
        trace.plan_id,
        trace.stage_metadata.total_objects_discovered,
        trace.stage_llm.final_status,
    )


def get_inspection_trace(trace_id: str) -> Optional[InspectionTrace]:
    """Retrieves an inspection trace by request_id or plan_id."""
    return INSPECTION_TRACES.get(trace_id)


def clear_inspection_traces() -> None:
    """Clears all stored inspection traces (useful in tests)."""
    INSPECTION_TRACES.clear()
