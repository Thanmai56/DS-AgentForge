"""
Export Service (§11, §14).
Generates native Datasphere zip bundle, manifest.json, and validation report.
"""
import io
import json
import logging
import zipfile
from typing import Any

from app.ds.export_import_adapter import DatasphereExportImportAdapter

logger = logging.getLogger(__name__)


def create_export_bundle(
    views: list[dict[str, Any]],
    space: str,
    validation_report: dict[str, Any] | None = None,
    ds_release: str = "2024.Q3",
) -> bytes:
    """
    Creates complete downloadable zip bundle for Datasphere native import.
    Contains:
      - objects/<view_name>.datasphere.json
      - manifest.json
      - validation_report.json
      - README_IMPORT_INSTRUCTIONS.md
    """
    adapter = DatasphereExportImportAdapter(release=ds_release)
    base_zip = adapter.compile_bundle(views=views, space=space)

    # Reopen to insert validation_report.json if present
    if validation_report:
        buf = io.BytesIO(base_zip)
        with zipfile.ZipFile(buf, mode="a", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("validation_report.json", json.dumps(validation_report, indent=2))
        buf.seek(0)
        return buf.getvalue()

    return base_zip
