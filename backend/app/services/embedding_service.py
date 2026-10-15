"""
Embedding Service — local sentence-transformers vector search.
No external API call needed: model runs locally (all-MiniLM-L6-v2).
Stores embeddings in PostgreSQL via pgvector.
"""
import asyncio
import logging
from functools import lru_cache
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal

settings = get_settings()
logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_model():
    """Load sentence-transformers model once, cached for the process lifetime."""
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        logger.info("Loading embedding model: %s", settings.embedding_model)
        return SentenceTransformer(settings.embedding_model)
    except ImportError:
        logger.warning("sentence-transformers not installed — using keyword fallback")
        return None


def _embed(text_input: str) -> list[float] | None:
    """Embed a string. Returns None if model unavailable (triggers keyword fallback)."""
    model = _get_model()
    if model is None:
        return None
    vec = model.encode(text_input, normalize_embeddings=True)
    return vec.tolist()


# ── Vector search ─────────────────────────────────────────────────────────────

async def search_tables_by_requirement(
    query: str,
    connection_id: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """
    Find catalog tables relevant to the query using:
    1. pgvector cosine similarity (if embeddings exist), OR
    2. Keyword ILIKE fallback (always works even without embeddings)

    Returns ranked list with match reasons.
    """
    async with AsyncSessionLocal() as db:
        # Try vector search first
        embedding = await asyncio.get_event_loop().run_in_executor(None, _embed, query)

        if embedding is not None:
            candidates = await _vector_search(db, connection_id, embedding, top_k)
        else:
            candidates = await _keyword_search(db, connection_id, query, top_k)

        # Keyword boost: if a table name/description contains query words directly, rank higher
        query_words = {w.lower() for w in query.split() if len(w) > 3}
        for c in candidates:
            name = (c.get("object_name") or "").lower()
            desc = (c.get("business_name") or c.get("description") or "").lower()
            word_hits = sum(1 for w in query_words if w in name or w in desc)
            c["match_score"] = c.get("match_score", 0.5) + (word_hits * 0.05)

        candidates.sort(key=lambda x: x.get("match_score", 0), reverse=True)
        return candidates[:top_k]


async def _vector_search(db: AsyncSession, connection_id: str, embedding: list[float], top_k: int) -> list[dict]:
    """pgvector cosine similarity search. Falls back to keyword if no embeddings stored."""
    try:
        vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
        sql = text("""
            SELECT ct.id::text, ct.object_name, ct.object_type, ct.business_name,
                   ct.description, ct.row_count, ct.is_remote, ct.remote_source,
                   1 - (ct.embedding <=> :vec::vector) AS match_score
            FROM catalog_tables ct
            WHERE ct.connection_id = :cid AND ct.embedding IS NOT NULL
            ORDER BY ct.embedding <=> :vec::vector
            LIMIT :k
        """)
        result = await db.execute(sql, {"vec": vec_str, "cid": connection_id, "k": top_k})
        rows = result.mappings().all()
        if rows:
            return [_row_to_candidate(r) for r in rows]
    except Exception as exc:
        logger.warning("Vector search failed, falling back to keyword: %s", exc)

    return await _keyword_search(db, connection_id, "", top_k)


async def _keyword_search(db: AsyncSession, connection_id: str, query: str, top_k: int) -> list[dict]:
    """Keyword ILIKE search as fallback (always works)."""
    from app.models.catalog import CatalogTable
    stmt = select(CatalogTable).where(CatalogTable.connection_id == connection_id)

    if query.strip():
        words = [w for w in query.split() if len(w) > 2]
        filters = []
        for word in words[:5]:  # limit to avoid huge queries
            pattern = f"%{word}%"
            filters.append(CatalogTable.object_name.ilike(pattern))
            filters.append(CatalogTable.business_name.ilike(pattern))
            filters.append(CatalogTable.description.ilike(pattern))

        if filters:
            from sqlalchemy import or_
            stmt = stmt.where(or_(*filters))

    stmt = stmt.limit(top_k)
    result = await db.execute(stmt)
    tables = result.scalars().all()

    return [
        {
            "id": str(t.id),
            "object_name": t.object_name,
            "object_type": t.object_type,
            "business_name": t.business_name,
            "description": t.description,
            "row_count": t.row_count,
            "is_remote": getattr(t, "is_remote", False),
            "remote_source": getattr(t, "remote_source", None),
            "match_score": 0.6,
            "match_reason": "keyword match",
        }
        for t in tables
    ]


def _row_to_candidate(row: Any) -> dict:
    return {
        "id": row["id"],
        "object_name": row["object_name"],
        "object_type": row.get("object_type", "TABLE"),
        "business_name": row.get("business_name"),
        "description": row.get("description"),
        "row_count": row.get("row_count"),
        "is_remote": row.get("is_remote", False),
        "remote_source": row.get("remote_source"),
        "match_score": float(row.get("match_score", 0.5)),
        "match_reason": "vector similarity",
    }


# ── Embed and store catalog table ─────────────────────────────────────────────

async def embed_catalog_table(table_id: str, text_for_embedding: str) -> None:
    """Generate and store embedding for a catalog table (called after scan/profile)."""
    embedding = await asyncio.get_event_loop().run_in_executor(None, _embed, text_for_embedding)
    if embedding is None:
        return

    async with AsyncSessionLocal() as db:
        try:
            vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
            await db.execute(
                text("UPDATE catalog_tables SET embedding = :vec::vector WHERE id = :id"),
                {"vec": vec_str, "id": table_id},
            )
            await db.commit()
        except Exception as exc:
            logger.warning("Failed to store embedding for table %s: %s", table_id, exc)


# ── Golden examples for RAG ───────────────────────────────────────────────────

async def get_golden_examples(query: str, top_k: int = 3) -> list[dict]:
    """
    Retrieve golden ViewSpec examples from the feedback/glossary tables.
    Used to inject successful human-edited examples into the build_view_spec prompt.
    """
    async with AsyncSessionLocal() as db:
        try:
            from app.models.run import Feedback, ViewSpec
            from sqlalchemy import select
            # Get the most recently approved ViewSpecs that had human edits
            stmt = (
                select(ViewSpec)
                .where(ViewSpec.approval_state == "approved")
                .where(ViewSpec.human_edits != [])
                .order_by(ViewSpec.updated_at.desc())
                .limit(top_k * 3)
            )
            result = await db.execute(stmt)
            specs = result.scalars().all()

            examples = []
            for spec in specs[:top_k]:
                examples.append({
                    "object_id": spec.object_id,
                    "layer": spec.layer,
                    "kind": spec.kind,
                    "spec_summary": {
                        "columns_count": len(spec.spec_json.get("operators", [{}])[0].get("columns", [])),
                        "has_joins": any(op.get("op") == "join" for op in spec.spec_json.get("operators", [])),
                        "has_filters": any(op.get("op") == "filter" for op in spec.spec_json.get("operators", [])),
                    },
                    "human_edits_count": len(spec.human_edits or []),
                })
            return examples
        except Exception as exc:
            logger.warning("Could not retrieve golden examples: %s", exc)
            return []
