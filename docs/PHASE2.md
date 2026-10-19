# Phase 2 Architecture Outline (Future Scope)

> **Notice**: This document outlines the planned scope and architecture for Phase 2. No Phase 2 code is implemented in Phase 1.

---

## 1. Plan Acceptance & Dummy Lineage
* **User Acceptance**: User clicks "Accept and build lineage" on the Phase 1 visual plan page.
* **Lineage Synthesizer**: Converts the accepted `Plan` (nodes, operations, inputs, joins, calculations) into an interactive Lineage Graph.
* **Lineage Editing**: Modeler can visually reorder nodes, modify join types, or adjust projections directly on the lineage canvas before artifact compilation.

---

## 2. Template-Based CSN Builders
* **Reference Specifications**: Built from real observed exports in `fixtures/reference/AM_PO_APT.json`, `fixtures/reference/F_PO_PROCESSING_TIME_APT (1).json`, and `fixtures/reference/ds.md`.
* **Deterministic Operators**:
  1. **Projection / Staging**: Generates `SELECT` with column aliasing and type casting.
  2. **Filter**: Generates native CSN `where` token tree (`GOODSMOVEMENTTYPE = '101'`).
  3. **Join**: Generates inner, left, and right join blocks with explicit `@EndUserText.label` bindings.
  4. **Association**: Generates `@ObjectModel.association` elements with target cardinality (`1..1`, `1..n`, `n..1`).
  5. **Calculated Column**: Emits CSN `xpr` / `func` structures for date math (`DAYS_BETWEEN`, `TO_DATE`, `SUBSTRING`) and string concatenation.
  6. **Measure**: Emits `@AnalyticsDetails.measureType` (`BASE` vs `CALCULATION`) and `@Aggregation.default` formulas.
  7. **Analytic Model (Cube)**: Emits `@Analytics.dataCategory: {"#": "CUBE"}` referencing the underlying analytical fact view.

---

## 3. Step-by-Step Live Generation & Highlight
* **WebSocket / SSE Progress**: Backend streams progress events as each node in the DAG is compiled into CSN JSON.
* **Visual Active State**: The frontend highlights the specific node currently being rendered, giving modelers real-time visual feedback.

---

## 4. Deterministic Validator & Mock-Data Simulation
* **Validator**: Runs deterministic V-01 through V-08 rules to ensure CSN compliance, correct data type bindings, and absence of reserved word collisions.
* **Mock-Data Simulator**: Runs DuckDB SQL queries against uploaded mock CSVs to simulate the exact output rows produced by the generated CSN view stack, verifying calculations before tenant deployment.
