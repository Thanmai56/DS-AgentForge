"""
Lightweight In-Memory Data Profiler (DuckDB + pandas).

Produces the concise DATA PROFILE section required by planner_system.md:
- Row counts per table
- Distinct counts, null counts, low-cardinality values
- Key match % between candidate join tables
- Rows-per-key (1:1, 1:N, N:1, N:M)
- Natural language evidence sentences that the LLM quotes when planning joins
- Works with mock data (CSV/DataFrames) or falls back cleanly to metadata-inferred profiles.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any
import duckdb
import pandas as pd
from pydantic import BaseModel, Field, ConfigDict

from app.agent.cds_extractor import ExtractedMetadata


class ColumnProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    distinct_count: int = 0
    null_count: int = 0
    is_low_cardinality: bool = False
    low_cardinality_values: list[str] = Field(default_factory=list)


class TableProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    table_name: str
    row_count: int = 0
    columns: dict[str, ColumnProfile] = Field(default_factory=dict)
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)


class JoinProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    table_a: str
    col_a: str
    table_b: str
    col_b: str
    match_pct_a_to_b: float = 0.0
    match_pct_b_to_a: float = 0.0
    max_rows_per_key_a: int = 1
    max_rows_per_key_b: int = 1
    cardinality: str = "1:1"  # 1:1, 1:N, N:1, N:M
    evidence_sentence: str = ""


class DataProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tables: dict[str, TableProfile] = Field(default_factory=dict)
    joins: list[JoinProfile] = Field(default_factory=list)
    has_mock_data: bool = False

    def to_text(self) -> str:
        """Formats the plain-English DATA PROFILE section for the planner prompt."""
        if not self.tables:
            return "No data profile available."

        lines = ["=== DATA PROFILE ==="]
        if not self.has_mock_data:
            lines.append("[METADATA-INFERRED PROFILE (No mock CSV data provided)]\n")

        # 1. Table Profiles
        for tbl in self.tables.values():
            if self.has_mock_data:
                lines.append(f"TABLE {tbl.table_name}: {tbl.row_count} rows")
            else:
                lines.append(f"TABLE/VIEW {tbl.table_name}: (row count unknown)")

            for col in tbl.columns.values():
                col_parts = []
                if self.has_mock_data:
                    col_parts.append(f"{col.distinct_count} distinct")
                    if col.null_count > 0:
                        col_parts.append(f"{col.null_count} nulls")
                    if col.is_low_cardinality and col.low_cardinality_values:
                        col_parts.append(f"values: {col.low_cardinality_values}")
                else:
                    col_parts.append("distinct count unprofiled")

                lines.append(f"  - {col.name}: {', '.join(col_parts)}")
            lines.append("")

        # 2. Join Candidates & Cardinality Evidence
        if self.joins:
            lines.append("JOIN CANDIDATES & CARDINALITY EVIDENCE:")
            for j in self.joins:
                lines.append(f"  - {j.table_a}.{j.col_a} <-> {j.table_b}.{j.col_b}:")
                lines.append(f"    * Cardinality: {j.cardinality}")
                if self.has_mock_data:
                    lines.append(f"    * Key Match: {j.match_pct_a_to_b:.1f}% ({j.table_a} in {j.table_b})")
                    lines.append(f"    * Max rows per key: {j.table_a}={j.max_rows_per_key_a}, {j.table_b}={j.max_rows_per_key_b}")
                lines.append(f"    * Evidence: \"{j.evidence_sentence}\"")
                lines.append("")

        return "\n".join(lines).strip()

    def sample_rows_text(self) -> str:
        """Formats sample rows for the SAMPLE ROWS prompt section."""
        if not self.has_mock_data:
            return "No sample rows available."

        sections = ["=== SAMPLE ROWS ==="]
        for tbl in self.tables.values():
            if not tbl.sample_rows:
                continue
            sections.append(f"--- {tbl.table_name} (top {len(tbl.sample_rows)} rows) ---")
            for i, row in enumerate(tbl.sample_rows, 1):
                clean_row = {k: (str(v) if v is not None else "NULL") for k, v in row.items()}
                sections.append(f"Row {i}: {clean_row}")
            sections.append("")

        return "\n".join(sections).strip()


def profile_data(
    metadata: ExtractedMetadata,
    tables_data: dict[str, Any] | None = None,
) -> DataProfile:
    """
    Profiles uploaded mock data using DuckDB. If no data provided, infers
    cardinality and join candidates from metadata.
    """
    # Clean input tables data
    data_dfs: dict[str, pd.DataFrame] = {}
    if tables_data:
        for name, val in tables_data.items():
            df = _load_to_dataframe(val)
            if df is not None and not df.empty:
                data_dfs[name] = df

    if data_dfs:
        return _profile_with_duckdb(metadata, data_dfs)
    else:
        return _profile_from_metadata(metadata)


def _load_to_dataframe(val: Any) -> pd.DataFrame | None:
    """Converts string CSV, file path, or existing DataFrame to a DataFrame."""
    if isinstance(val, pd.DataFrame):
        return val
    if isinstance(val, (str, Path)):
        s_val = str(val).strip()
        if "\n" in s_val or "," in s_val:
            try:
                return pd.read_csv(io.StringIO(s_val))
            except Exception:
                pass
        p = Path(s_val)
        if p.exists() and p.is_file():
            try:
                return pd.read_csv(p)
            except Exception:
                pass
    return None


def _profile_with_duckdb(metadata: ExtractedMetadata, data_dfs: dict[str, pd.DataFrame]) -> DataProfile:
    """Profiles data using DuckDB in-memory engine."""
    con = duckdb.connect(":memory:")

    # Register each table in DuckDB
    for name, df in data_dfs.items():
        # Standardize column names to string
        df.columns = [str(c) for c in df.columns]
        con.register(name, df)

    table_profiles: dict[str, TableProfile] = {}

    # 1. Profile individual tables
    for name, df in data_dfs.items():
        row_count = len(df)
        cols_profile: dict[str, ColumnProfile] = {}

        for col in df.columns:
            # Query distinct and null count safely
            try:
                res = con.execute(
                    f'SELECT count(distinct "{col}"), count(*) - count("{col}") FROM "{name}"'
                ).fetchone()
                distinct_cnt = res[0] if res else 0
                null_cnt = res[1] if res else 0
            except Exception:
                distinct_cnt = int(df[col].nunique(dropna=True))
                null_cnt = int(df[col].isna().sum())

            # Detect low-cardinality values
            is_low_card = 1 <= distinct_cnt <= 10
            low_card_vals: list[str] = []
            if is_low_card:
                try:
                    val_rows = con.execute(
                        f'SELECT distinct cast("{col}" as varchar) FROM "{name}" WHERE "{col}" IS NOT NULL LIMIT 10'
                    ).fetchall()
                    low_card_vals = [str(r[0]) for r in val_rows]
                except Exception:
                    low_card_vals = [str(v) for v in df[col].dropna().unique()[:10]]

            cols_profile[col] = ColumnProfile(
                name=col,
                distinct_count=distinct_cnt,
                null_count=null_cnt,
                is_low_cardinality=is_low_card,
                low_cardinality_values=low_card_vals,
            )

        # Collect top 3 sample rows
        sample_rows: list[dict[str, Any]] = []
        try:
            head_df = df.head(3)
            sample_rows = head_df.to_dict(orient="records")
        except Exception:
            pass

        table_profiles[name] = TableProfile(
            table_name=name,
            row_count=row_count,
            columns=cols_profile,
            sample_rows=sample_rows,
        )

    # 2. Profile join candidates between pairs of tables
    join_profiles: list[JoinProfile] = []
    table_names = list(data_dfs.keys())

    for i in range(len(table_names)):
        for j in range(i + 1, len(table_names)):
            t_a = table_names[i]
            t_b = table_names[j]

            # Find matching column names
            cols_a = set(data_dfs[t_a].columns)
            cols_b = set(data_dfs[t_b].columns)
            common_cols = cols_a.intersection(cols_b)

            for col in common_cols:
                join_prof = _calculate_join_profile(con, t_a, t_b, col)
                if join_prof:
                    join_profiles.append(join_prof)

    return DataProfile(
        tables=table_profiles,
        joins=join_profiles,
        has_mock_data=True,
    )


def _calculate_join_profile(
    con: duckdb.DuckDBPyConnection,
    t_a: str,
    t_b: str,
    col: str,
) -> JoinProfile | None:
    """Calculates key match % and cardinality between two tables on a common column."""
    try:
        # Total distinct in A and B
        dist_a = con.execute(f'SELECT count(distinct "{col}") FROM "{t_a}" WHERE "{col}" IS NOT NULL').fetchone()[0]
        dist_b = con.execute(f'SELECT count(distinct "{col}") FROM "{t_b}" WHERE "{col}" IS NOT NULL').fetchone()[0]

        if dist_a == 0 or dist_b == 0:
            return None

        # Distinct matching keys
        match_count = con.execute(
            f'SELECT count(distinct a."{col}") FROM "{t_a}" a INNER JOIN "{t_b}" b ON a."{col}" = b."{col}"'
        ).fetchone()[0]

        match_pct_a = (match_count / dist_a) * 100.0
        match_pct_b = (match_count / dist_b) * 100.0

        # Max rows per key in A and B
        max_a = con.execute(
            f'SELECT coalesce(max(cnt), 1) FROM (SELECT count(*) as cnt FROM "{t_a}" GROUP BY "{col}")'
        ).fetchone()[0]
        max_b = con.execute(
            f'SELECT coalesce(max(cnt), 1) FROM (SELECT count(*) as cnt FROM "{t_b}" GROUP BY "{col}")'
        ).fetchone()[0]

        # Determine cardinality
        if max_a == 1 and max_b == 1:
            card = "1:1"
            evidence = (
                f"{col} key match between {t_a} and {t_b} is {match_pct_a:.1f}% "
                f"(1:1 unique cardinality on both sides)."
            )
        elif max_a == 1 and max_b > 1:
            card = "1:N"
            evidence = (
                f"{col} key match between {t_a} and {t_b} is {match_pct_a:.1f}% "
                f"(1:N cardinality; {t_b} has up to {max_b} rows per key)."
            )
        elif max_a > 1 and max_b == 1:
            card = "N:1"
            evidence = (
                f"{col} key match between {t_a} and {t_b} is {match_pct_a:.1f}% "
                f"(N:1 cardinality; {t_a} has up to {max_a} rows per key)."
            )
        else:
            card = "N:M"
            evidence = (
                f"{col} key match between {t_a} and {t_b} is {match_pct_a:.1f}% "
                f"(N:M cardinality; {t_a} has up to {max_a} rows and {t_b} has up to {max_b} rows per key)."
            )

        return JoinProfile(
            table_a=t_a,
            col_a=col,
            table_b=t_b,
            col_b=col,
            match_pct_a_to_b=round(match_pct_a, 2),
            match_pct_b_to_a=round(match_pct_b, 2),
            max_rows_per_key_a=int(max_a),
            max_rows_per_key_b=int(max_b),
            cardinality=card,
            evidence_sentence=evidence,
        )
    except Exception:
        return None


def _profile_from_metadata(metadata: ExtractedMetadata) -> DataProfile:
    """Fallback: builds inferred profile from column metadata and primary keys."""
    table_profiles: dict[str, TableProfile] = {}

    for name, obj in metadata.objects.items():
        cols_profile = {
            c_name: ColumnProfile(name=c_name)
            for c_name in obj.columns.keys()
        }
        table_profiles[name] = TableProfile(
            table_name=name,
            row_count=0,
            columns=cols_profile,
        )

    # Inferred join candidates based on shared keys
    join_profiles: list[JoinProfile] = []
    obj_names = list(metadata.objects.keys())

    for i in range(len(obj_names)):
        for j in range(i + 1, len(obj_names)):
            name_a = obj_names[i]
            name_b = obj_names[j]
            obj_a = metadata.objects[name_a]
            obj_b = metadata.objects[name_b]

            cols_a = obj_a.column_names()
            cols_b = obj_b.column_names()
            common = cols_a.intersection(cols_b)

            for col in common:
                # If key in both or in one
                is_key_a = col in obj_a.keys
                is_key_b = col in obj_b.keys

                if is_key_a and is_key_b:
                    card = "1:1" if len(obj_a.keys) == 1 and len(obj_b.keys) == 1 else "1:N"
                elif is_key_a and not is_key_b:
                    card = "1:N"
                elif not is_key_a and is_key_b:
                    card = "N:1"
                else:
                    card = "1:N"

                join_profiles.append(
                    JoinProfile(
                        table_a=name_a,
                        col_a=col,
                        table_b=name_b,
                        col_b=col,
                        cardinality=card,
                        evidence_sentence=f"Key match for {col} between {name_a} and {name_b} inferred from schema ({card} cardinality).",
                    )
                )

    return DataProfile(
        tables=table_profiles,
        joins=join_profiles,
        has_mock_data=False,
    )
