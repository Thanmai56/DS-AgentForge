"""
SAP Technical Column Name → Business Classification Dictionary.
DETERMINISTIC: no LLM call needed for well-known SAP fields.
LLM is fallback only for unknown columns.

Source: SAP data dictionary / ABAP data elements.
"""
from typing import TypedDict


class ColumnClassification(TypedDict):
    business_name: str
    semantic_role: str          # key | measure | dimension | text | date | unit
    semantic_type: str | None   # currency_amount | customer_id | quantity | etc.
    description: str


# fmt: off
SAP_DICTIONARY: dict[str, ColumnClassification] = {
    # ── Keys / Identifiers ─────────────────────────────────────────────────
    "MANDT":   {"business_name": "Client",              "semantic_role": "key",       "semantic_type": "client_id",        "description": "SAP Client ID"},
    "BUKRS":   {"business_name": "Company Code",        "semantic_role": "dimension", "semantic_type": "company_code",     "description": "FI Company Code"},
    "WERKS":   {"business_name": "Plant",               "semantic_role": "dimension", "semantic_type": "plant",            "description": "Manufacturing/storage plant"},
    "LGORT":   {"business_name": "Storage Location",    "semantic_role": "dimension", "semantic_type": "storage_location", "description": "Inventory storage location"},
    "VKORG":   {"business_name": "Sales Org",           "semantic_role": "dimension", "semantic_type": "sales_org",        "description": "Sales Organization"},
    "VTWEG":   {"business_name": "Distribution Channel","semantic_role": "dimension", "semantic_type": "dist_channel",     "description": "Distribution Channel"},
    "SPART":   {"business_name": "Division",            "semantic_role": "dimension", "semantic_type": "division",         "description": "Product Division"},
    # ── Sales ─────────────────────────────────────────────────────────────
    "VBELN":   {"business_name": "Sales Order",         "semantic_role": "key",       "semantic_type": "order_id",         "description": "Sales order number"},
    "POSNR":   {"business_name": "Order Item",          "semantic_role": "key",       "semantic_type": "item_number",      "description": "Sales order item number"},
    "AUART":   {"business_name": "Order Type",          "semantic_role": "dimension", "semantic_type": "order_type",       "description": "Sales document type"},
    "DOC_CATEGORY": {"business_name": "Doc Category",  "semantic_role": "dimension", "semantic_type": "doc_category",     "description": "Sales document category"},
    "ERDAT":   {"business_name": "Creation Date",       "semantic_role": "date",      "semantic_type": "date",             "description": "Record creation date"},
    "ERZET":   {"business_name": "Creation Time",       "semantic_role": "dimension", "semantic_type": "time",             "description": "Record creation time"},
    "ANGDT":   {"business_name": "Quotation Date",      "semantic_role": "date",      "semantic_type": "date",             "description": "Quotation valid-from date"},
    "BNDDT":   {"business_name": "Valid To Date",       "semantic_role": "date",      "semantic_type": "date",             "description": "Quotation valid-to date"},
    # ── Customer / Partner ─────────────────────────────────────────────────
    "KUNNR":   {"business_name": "Customer",            "semantic_role": "dimension", "semantic_type": "customer_id",      "description": "Customer account number"},
    "KUNAG":   {"business_name": "Sold-To Party",       "semantic_role": "dimension", "semantic_type": "customer_id",      "description": "Sold-to customer"},
    "KUNWE":   {"business_name": "Ship-To Party",       "semantic_role": "dimension", "semantic_type": "customer_id",      "description": "Ship-to customer"},
    "KUNRE":   {"business_name": "Bill-To Party",       "semantic_role": "dimension", "semantic_type": "customer_id",      "description": "Bill-to customer"},
    "LIFNR":   {"business_name": "Vendor",              "semantic_role": "dimension", "semantic_type": "vendor_id",        "description": "Vendor account number"},
    "PARVW":   {"business_name": "Partner Function",    "semantic_role": "dimension", "semantic_type": "partner_function", "description": "Partner function role"},
    "NAME1":   {"business_name": "Name 1",              "semantic_role": "text",      "semantic_type": "name",             "description": "First name / organization name"},
    "NAME2":   {"business_name": "Name 2",              "semantic_role": "text",      "semantic_type": "name",             "description": "Second name"},
    "LAND1":   {"business_name": "Country",             "semantic_role": "dimension", "semantic_type": "country_code",     "description": "Country key"},
    "REGIO":   {"business_name": "Region",              "semantic_role": "dimension", "semantic_type": "region",           "description": "State/province/region"},
    # ── Material / Product ─────────────────────────────────────────────────
    "MATNR":   {"business_name": "Material",            "semantic_role": "dimension", "semantic_type": "material_id",      "description": "Material number"},
    "MATKL":   {"business_name": "Material Group",      "semantic_role": "dimension", "semantic_type": "material_group",   "description": "Material group classification"},
    "MTART":   {"business_name": "Material Type",       "semantic_role": "dimension", "semantic_type": "material_type",    "description": "Material type (FERT, ROH, etc.)"},
    "MBRSH":   {"business_name": "Industry",            "semantic_role": "dimension", "semantic_type": "industry",         "description": "Industry sector"},
    "MEINS":   {"business_name": "Base Unit",           "semantic_role": "unit",      "semantic_type": "unit_of_measure",  "description": "Base unit of measure"},
    "MSEHI":   {"business_name": "Unit of Measure",     "semantic_role": "unit",      "semantic_type": "unit_of_measure",  "description": "Unit of measure"},
    # ── Amounts / Measures ─────────────────────────────────────────────────
    "NETWR":   {"business_name": "Net Value",           "semantic_role": "measure",   "semantic_type": "currency_amount",  "description": "Net order value in document currency"},
    "BRUTTO":  {"business_name": "Gross Value",         "semantic_role": "measure",   "semantic_type": "currency_amount",  "description": "Gross value"},
    "KWMENG":  {"business_name": "Order Quantity",      "semantic_role": "measure",   "semantic_type": "quantity",         "description": "Order quantity"},
    "LFIMG":   {"business_name": "Delivery Quantity",   "semantic_role": "measure",   "semantic_type": "quantity",         "description": "Actual delivery quantity"},
    "FKIMG":   {"business_name": "Billed Quantity",     "semantic_role": "measure",   "semantic_type": "quantity",         "description": "Billing quantity"},
    "DMBTR":   {"business_name": "Amount (LC)",         "semantic_role": "measure",   "semantic_type": "currency_amount",  "description": "Amount in local currency"},
    "WRBTR":   {"business_name": "Amount (DC)",         "semantic_role": "measure",   "semantic_type": "currency_amount",  "description": "Amount in document currency"},
    "MENGE":   {"business_name": "Quantity",            "semantic_role": "measure",   "semantic_type": "quantity",         "description": "Quantity"},
    # ── Currency / Units ───────────────────────────────────────────────────
    "WAERS":   {"business_name": "Currency",            "semantic_role": "unit",      "semantic_type": "currency_key",     "description": "Document currency key"},
    "HWAER":   {"business_name": "Local Currency",      "semantic_role": "unit",      "semantic_type": "currency_key",     "description": "Local (company code) currency"},
    "TWAER":   {"business_name": "Transaction Currency","semantic_role": "unit",      "semantic_type": "currency_key",     "description": "Transaction currency"},
    # ── Dates ──────────────────────────────────────────────────────────────
    "BUDAT":   {"business_name": "Posting Date",        "semantic_role": "date",      "semantic_type": "date",             "description": "Accounting posting date"},
    "BLDAT":   {"business_name": "Document Date",       "semantic_role": "date",      "semantic_type": "date",             "description": "Document date"},
    "FKDAT":   {"business_name": "Billing Date",        "semantic_role": "date",      "semantic_type": "date",             "description": "Billing/invoice date"},
    "LFDAT":   {"business_name": "Delivery Date",       "semantic_role": "date",      "semantic_type": "date",             "description": "Planned delivery date"},
    "GJAHR":   {"business_name": "Fiscal Year",         "semantic_role": "dimension", "semantic_type": "fiscal_year",      "description": "Fiscal year"},
    "MONAT":   {"business_name": "Fiscal Period",       "semantic_role": "dimension", "semantic_type": "fiscal_period",    "description": "Fiscal period / posting period"},
    # ── General ────────────────────────────────────────────────────────────
    "MSEHI":   {"business_name": "Unit",                "semantic_role": "unit",      "semantic_type": "unit_of_measure",  "description": "Unit of measure"},
    "SPRAS":   {"business_name": "Language",            "semantic_role": "dimension", "semantic_type": "language",         "description": "Language key"},
    "KOKRS":   {"business_name": "Controlling Area",    "semantic_role": "dimension", "semantic_type": "controlling_area", "description": "Controlling area"},
    "KOSTL":   {"business_name": "Cost Center",         "semantic_role": "dimension", "semantic_type": "cost_center",      "description": "Cost center"},
    "AUFNR":   {"business_name": "Order",               "semantic_role": "dimension", "semantic_type": "order_id",         "description": "CO internal order number"},
    "PRCTR":   {"business_name": "Profit Center",       "semantic_role": "dimension", "semantic_type": "profit_center",    "description": "Profit center"},
    "GSBER":   {"business_name": "Business Area",       "semantic_role": "dimension", "semantic_type": "business_area",    "description": "Business area"},
    "HKONT":   {"business_name": "GL Account",          "semantic_role": "dimension", "semantic_type": "gl_account",       "description": "General ledger account"},
    "SAKNR":   {"business_name": "GL Account",          "semantic_role": "dimension", "semantic_type": "gl_account",       "description": "G/L account number"},
}
# fmt: on


def classify_column(*args: str) -> ColumnClassification | None:
    """
    Look up a column in the SAP dictionary.
    Supports both classify_column('VBELN') and classify_column('VBAK', 'VBELN').
    """
    if len(args) == 0:
        return None
    if len(args) == 1:
        column_name = str(args[0])
        return SAP_DICTIONARY.get(column_name.upper())
    if len(args) == 2:
        table_name, column_name = str(args[0]), str(args[1])
        normalized = column_name.upper()
        # The table argument is ignored for lookup because the dictionary is keyed by column name.
        return SAP_DICTIONARY.get(normalized)
    return None


def get_table_metadata(table_name: str) -> dict[str, str]:
    """Return canonical business metadata for a known SAP table."""
    table_key = (table_name or "").upper()
    metadata = {
        "VBAK": {"business_name": "Sales Document Header", "description": "Sales document header table"},
        "VBAP": {"business_name": "Sales Document Item", "description": "Sales document item table"},
        "KNA1": {"business_name": "Customer Master", "description": "Customer master data"},
        "MARA": {"business_name": "Material Master", "description": "Material master data"},
        "BKPF": {"business_name": "Accounting Document Header", "description": "Accounting document header"},
        "BSEG": {"business_name": "Accounting Document Segment", "description": "Accounting document line items"},
    }
    return metadata.get(table_key, {"business_name": table_name, "description": "SAP table metadata"})


def is_known_column(column_name: str) -> bool:
    return column_name.upper() in SAP_DICTIONARY


def get_all_known_names() -> list[str]:
    return list(SAP_DICTIONARY.keys())
