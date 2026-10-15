import asyncio
from datetime import datetime, timezone
from typing import Any

from app.core.database import AsyncSessionLocal
from app.models.run import AuditLog


async def _write_audit(
    run_id: str | None,
    event_type: str,
    prompt_hash: str | None,
    llm_model: str | None,
    llm_cost_usd: float,
    status: str,
    error: str | None,
    payload: dict[str, Any] | None = None,
) -> None:
    async with AsyncSessionLocal() as db:
        entry = AuditLog(
            run_id=None if run_id is None else __import__('uuid').UUID(run_id),
            user_id=None,
            event_type=event_type,
            entity_type="llm_call",
            entity_id=prompt_hash,
            prompt_hash=prompt_hash,
            llm_model=llm_model,
            llm_cost_usd=llm_cost_usd,
            payload={"status": status, "error": error, **(payload or {})},
            created_at=datetime.now(timezone.utc),
        )
        db.add(entry)
        await db.commit()


def log_llm_call_sync(
    run_id: str | None,
    call_type: str,
    prompt_hash: str | None,
    model: str | None,
    cost: float,
    status: str,
    error: str | None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Best-effort audit sync helper used by the LLM wrapper."""
    try:
        asyncio.run(
            _write_audit(
                run_id=run_id,
                event_type=call_type,
                prompt_hash=prompt_hash,
                llm_model=model,
                llm_cost_usd=cost,
                status=status,
                error=error,
                payload=payload,
            )
        )
    except Exception:
        return
