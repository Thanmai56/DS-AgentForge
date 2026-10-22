"""
Replication Builder Service (§1, §2).
Plans and generates Datasphere-native replication configurations for remote tables.
Decides whether to federate (live query) or replicate (scheduled/realtime) into local tables.
"""
from typing import Any
import logging

logger = logging.getLogger(__name__)

def plan_replication_strategy(
    table_name: str,
    row_count: int | None,
    is_remote: bool,
    access_frequency: str = "daily_reporting",
) -> dict[str, Any]:
    """
    Decide whether to federate or replicate a table.
    
    Rules:
    - If not remote -> LOCAL_TABLE (already local)
    - If remote and row_count > 500,000 -> REPLICATE to avoid heavy federation load on S/4
    - If remote and row_count <= 50,000 -> FEDERATE (live query is cheap)
    - Remote tables selected for replication use a full snapshot.
    """
    if not is_remote:
        return {
            "strategy": "LOCAL",
            "mode": "none",
            "reason": "Table is already local to the Datasphere space.",
            "target_table": table_name,
        }

    count = row_count or 0
    if count > 100000:
        strategy = "REPLICATE"
        mode = "SNAPSHOT"
        reason = f"High volume ({count:,} rows) — replication recommended to eliminate federation latency."
    else:
        strategy = "FEDERATE"
        mode = "none"
        reason = f"Manageable volume ({count:,} rows) — direct live federated query is sufficient."

    return {
        "strategy": strategy,
        "mode": mode,
        "full_load_first": True,
        "reason": reason,
        "target_table": f"{table_name}_LOCAL" if strategy == "REPLICATE" else table_name,
    }


def generate_replication_spec(
    remote_source: str,
    remote_object: str,
    space: str,
    local_table_name: str | None = None,
    mode: str = "SNAPSHOT",
    full_load_first: bool = True,
    columns: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Generate Datasphere-compliant replication configuration spec.
    """
    target_name = local_table_name or f"{remote_object}_LOCAL"
    
    return {
        "kind": "replication_config",
        "objectId": target_name,
        "space": space,
        "remote_source": remote_source,
        "remote_object": remote_object,
        "target_local_table": target_name,
        "replication_mode": mode.upper(),
        "full_load_first": full_load_first,
        "projected_columns": [
            {
                "name": c.get("column_name") or c.get("name"),
                "dataType": c.get("data_type") or c.get("dataType", "NVARCHAR"),
                "isKey": c.get("is_key", False),
            }
            for c in (columns or [])
        ],
        "schedule": {
            "frequency": "HOURLY" if mode.upper() == "SCHEDULED" else "NONE",
            "interval": 1,
        },
        "description": f"Replication of {remote_object} from remote source {remote_source} into {target_name}",
    }
