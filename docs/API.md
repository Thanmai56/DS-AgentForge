# DS ModelForge — API Documentation

This document describes the database-free REST API endpoints for **Phase 1: LLM Plan Generation & Interactive Revision**.

Base URL: `http://localhost:8000/api`

---

## 1. Generate Plan (`POST /api/plan`)

Takes a natural language modeling requirement, uploaded SAP Datasphere CSN / JSON definitions, and optional mock CSV data, and produces a validated, multi-layer modeling plan.

### Request

- **Endpoint**: `POST /api/plan`
- **Content-Type**: `application/json`

#### Body Schema
```json
{
  "requirement": "Build a purchasing view chain joining PO headers, history, and vendor master data to compute PO Average Processing Time (APT). Filter for completed transactions.",
  "metadata": {
    "definitions": {
      "ZIPOHDRAPT": { ... },
      "V_PO_FINAL_DELIVERY_APT": { ... }
    }
  },
  "mock_data": {
    "ZIPOHDRAPT": "PURCHASEORDER,COMPANYCODE,SUPPLIER\nPO100,1000,SUP_A\n",
    "ZIPOHISTEXT": "PURCHASEORDER,GOODSMOVEMENTTYPE,POSTINGDATE\nPO100,101,20260115\n"
  }
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `requirement` | string | **Yes** | Business KPI requirement text. |
| `metadata` | object / array | **Yes** | SAP CSN definitions (`{"definitions": {...}}`), list of tables, or dictionary. |
| `mock_data` | object | *Optional* | Map of table name to CSV string content. If omitted, profiler infers cardinality from metadata. |

### Response (`201 Created`)
```json
{
  "plan_id": "8d3e9150-1f9e-4bca-8e2b-2a21051515bb",
  "plan": {
    "analysis": [
      "Requirement: Compute Purchase Order Average Processing Time (APT).",
      "Source metadata includes existing view V_PO_FINAL_DELIVERY_APT which filters movement type 101."
    ],
    "nodes": [
      {
        "id": "V_PO_FINAL_DELIVERY_APT",
        "operation": "projection",
        "inputs": ["ZIPOHISTEXT"],
        "columns": ["PURCHASEORDER", "FINAL_DELIVERY_DATE"],
        "details": {
          "join_type": "",
          "on": [],
          "condition": "GOODSMOVEMENTTYPE = '101'",
          "formula": "MAX(POSTINGDATE)",
          "aggregation": "MAX"
        },
        "reason": "Reuses existing CDS view V_PO_FINAL_DELIVERY_APT.",
        "is_existing": true,
        "layer": "L2"
      },
      {
        "id": "F_PO_PROCESSING_TIME_APT",
        "operation": "join",
        "inputs": ["ZIPOHDRAPT", "V_PO_FINAL_DELIVERY_APT"],
        "columns": ["PURCHASEORDER", "COMPANYCODE", "SUPPLIER", "CREATIONDATE", "FINAL_DELIVERY_DATE"],
        "details": {
          "join_type": "inner",
          "on": [["ZIPOHDRAPT.PURCHASEORDER", "V_PO_FINAL_DELIVERY_APT.PURCHASEORDER"]],
          "condition": "",
          "formula": "",
          "aggregation": ""
        },
        "reason": "Inner join header and existing final delivery view on PURCHASEORDER.",
        "is_existing": false,
        "layer": "L3"
      }
    ],
    "measures": [
      {"name": "Total_Delivered_Order", "aggregation": "SUM", "column": "Total_Delivered_Order"},
      {"name": "APT", "aggregation": "FORMULA", "column": "Processing_Days"}
    ],
    "dimensions": ["PURCHASEORDER", "SUPPLIER", "COMPANYCODE"],
    "assumptions": ["Dates are formatted as YYYYMMDD strings."],
    "blockers": []
  },
  "metadata_summary": "[TABLE] ZIPOHDRAPT...\n[VIEW] V_PO_FINAL_DELIVERY_APT...",
  "profile_summary": "=== DATA PROFILE ===\nTABLE ZIPOHDRAPT: 100 rows...",
  "created_at": "2026-10-15T22:30:00.000000+00:00"
}
```

Plan nodes may also include `calculated_fields` to represent multiple calculated outputs on one fact node:

```json
{
  "id": "F_ORDER",
  "operation": "join",
  "inputs": ["WRAP_ORDERS"],
  "columns": ["QUANTITY", "UNIT_PRICE", "ORDER_VALUE", "ORDER_VALUE_WITH_TAX"],
  "calculated_fields": [
    {
      "name": "ORDER_VALUE",
      "formula": "QUANTITY * UNIT_PRICE",
      "label": "Order value",
      "data_type": "cds.Decimal(15,2)"
    },
    {
      "name": "ORDER_VALUE_WITH_TAX",
      "formula": "QUANTITY * UNIT_PRICE * 1.2",
      "label": "Order value with tax",
      "data_type": "cds.Decimal(15,2)"
    }
  ],
  "details": { "join_type": "", "on": [], "condition": "", "formula": "", "aggregation": "" },
  "reason": "Calculate both order-value outputs."
}
```

Each calculated field is an independent output column. Include its name in the node's `columns`. The legacy `details.formula` property remains supported for older single-formula plans.

---

## 2. Revise Plan (`POST /api/plan/revise`)

Allows revising an existing plan session either by **direct step edit** (e.g. user toggles a join type or updates keys in the UI) or by **typed natural language instruction**. Only the affected step and its downstream dependents are updated.

### Request

- **Endpoint**: `POST /api/plan/revise`
- **Content-Type**: `application/json`

#### Option A: Direct Visual Step Edit
```json
{
  "plan_id": "8d3e9150-1f9e-4bca-8e2b-2a21051515bb",
  "edited_node": {
    "id": "F_PO_PROCESSING_TIME_APT",
    "operation": "join",
    "inputs": ["ZIPOHDRAPT", "V_PO_FINAL_DELIVERY_APT"],
    "columns": ["PURCHASEORDER", "COMPANYCODE", "SUPPLIER", "CREATIONDATE", "FINAL_DELIVERY_DATE"],
    "details": {
      "join_type": "left",
      "on": [["ZIPOHDRAPT.PURCHASEORDER", "V_PO_FINAL_DELIVERY_APT.PURCHASEORDER"]],
      "condition": "",
      "formula": "",
      "aggregation": ""
    },
    "reason": "Changed to LEFT join to retain all purchase order headers.",
    "is_existing": false,
    "layer": "L3"
  }
}
```

#### Option B: Natural Language Instruction
```json
{
  "plan_id": "8d3e9150-1f9e-4bca-8e2b-2a21051515bb",
  "instruction": "Change join between ZIPOHDRAPT and V_PO_FINAL_DELIVERY_APT from INNER to LEFT join."
}
```

### Response (`200 OK`)
```json
{
  "plan_id": "8d3e9150-1f9e-4bca-8e2b-2a21051515bb",
  "plan": { ... },
  "affected_nodes": ["F_PO_PROCESSING_TIME_APT", "AM_PO_APT"],
  "updated_at": "2026-10-15T22:35:00.000000+00:00"
}
```

---

## 3. Retrieve Plan (`GET /api/plan/{plan_id}`)

Retrieves an existing plan session by its unique `plan_id`.

### Request
- **Endpoint**: `GET /api/plan/{plan_id}`

### Response (`200 OK`)
```json
{
  "plan_id": "8d3e9150-1f9e-4bca-8e2b-2a21051515bb",
  "plan": { ... },
  "requirement": "...",
  "metadata_summary": "...",
  "profile_summary": "...",
  "created_at": "2026-10-15T22:30:00.000000+00:00",
  "updated_at": "2026-10-15T22:35:00.000000+00:00"
}
```

### Error Responses
- `400 Bad Request`: Validation failure (e.g. empty requirement, hallucinated column, invalid join condition).
- `404 Not Found`: Given `plan_id` does not exist in memory.
- `422 Unprocessable Entity`: Generated plan failed structural validation after retries.
