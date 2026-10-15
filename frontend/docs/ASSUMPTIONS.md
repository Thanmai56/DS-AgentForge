# KPI Lineage Builder – ASSUMPTIONS

> Recorded automatically by the build agent. Update this file when assumptions change.

## A1 – Project Root
All source lives in `/frontend/src`. The outer `backend/` and Docker files are left untouched.

## A2 – Pure Client-Side
No API calls, no authentication, no CLI references anywhere in code, UI, or README.
`MockPlanProvider` supplies all data; swapping to a real provider requires only implementing `PlanProvider`.

## A3 – Fixture Scenario (PO Processing Time)
Sources modelled: **ZIPOHDRAPT** (PO Header), **ZIPOHISTEXT** (PO History), **LFA1** (Supplier),
and **V_PO_FINAL_DELIVERY_APT** (intermediate delivery date view derived from ZIPOHISTEXT).
The fixture matches the real exports in `/fixtures/reference/`.
- Supplier dimension view: `DIM_SUPPLIER_APT`  
- Intermediate delivery view: `V_PO_FINAL_DELIVERY_APT`  
- Fact view: `F_PO_PROCESSING_TIME_APT`  
- Analytic model: `AM_PO_APT`

## A4 – Formula Language
The formula editor accepts SQL-style expressions as used in Datasphere calculated columns.
Supported functions are the allow-list in `src/core/validate/functions.config.ts`.
`||` (string concat) is treated as a binary operator token (not a function).

## A5 – CSN Templates
- **Verified** templates are those whose structure is directly observed in `ds.md` or the real JSON exports.
- **Experimental** templates (analytic model body, fact annotations, calculated-column `xpr`) are sourced
  from the real JSON exports (`AM_PO_APT.json`, `F_PO_PROCESSING_TIME_APT.json`) which the user provided.
  These are treated as verified since they are real exports, but are still flagged "Unverified template"
  on Page 2 per the spec so the user can confirm before importing.

## A6 – Navigation Stack
The navigation stack holds breadcrumb frames `{type:'main'} | {type:'view', id:string}`.
Clicking a crumb pops to that frame (not "back one step"). Implemented in Zustand.

## A7 – Multiple KPIs
`Proceed` to Page 2 is only available when ALL KPI formula states are `valid`.
For the PO Processing Time fixture there is exactly ONE KPI: APT = Processing_Days / Total_Delivered_Order.

## A8 – Monaco Editor
Monaco Editor is loaded lazily. In the test environment (happy-dom) it is mocked as a plain `<textarea>`.

## A9 – Playwright E2E
E2E tests run against `npm run dev` (port 3000). The `playwright.config.ts` starts the dev server automatically.

## A10 – Dagre Layout
Dagre is used for automatic left-to-right graph layout. Direction: LR. Node separation: 80/200.

## A11 – Zip Download
Uses `jszip` to bundle all CSN files. Filenames match technical names + `.json`.

## A12 – Existing Frontend Scaffold
The existing `frontend/` scaffold (ChatRequirementPage, Sidebar, Navbar, etc.) is completely replaced
by the KPI Lineage Builder UI. Old files are removed to keep the codebase clean.
