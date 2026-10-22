# DS ModelForge — AI Project Context

> This file is the persistent context for ChatGPT sessions working on this repository.
> The source code is the ultimate source of truth. This document describes the current
> architecture, contracts, workflow, conventions, and known implementation state as
> observed from the uploaded project on 2026-09-30.

## 1. Product

DS ModelForge is an AI-assisted SAP Datasphere data-modeling application.

The intended workflow is:

1. User provides a natural-language analytics/data-modeling requirement.
2. The system parses the requirement into measures, dimensions, time grain, filters and target.
3. It searches the catalog for relevant source tables.
4. A human confirms the selected sources.
5. Datasphere tables are profiled.
6. Join/association candidates are detected and validated with profiling evidence.
7. The system proposes a layered Datasphere model.
8. A human approves the plan.
9. ViewSpecs are generated for L0-L4.
10. Deterministic validation rules validate the generated ViewSpecs.
11. Valid ViewSpecs are rendered into Datasphere-native JSON artifacts.
12. A human approves the artifacts.
13. The artifacts are exported.
14. Users can inspect lineage/canvas/impact, edit ViewSpecs, and use chat to modify them.

The important design principle is that `ViewSpec` is intended to be the single source of truth; generated Datasphere artifacts are derived from ViewSpecs rather than being authored independently.

## 2. Repository layout

```text
DS Modelforge/
├── .env.example
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── agent/
│   │   │   ├── graph.py
│   │   │   ├── llm.py
│   │   │   ├── nodes.py
│   │   │   ├── sap_dictionary.py
│   │   │   └── states.py
│   │   ├── api/v1/
│   │   │   ├── auth_routes.py
│   │   │   ├── catalog.py
│   │   │   ├── chat.py
│   │   │   ├── connections.py
│   │   │   ├── export.py
│   │   │   ├── runs.py
│   │   │   ├── views.py
│   │   │   └── websocket.py
│   │   ├── core/
│   │   ├── ds/
│   │   ├── models/
│   │   ├── services/
│   │   ├── main.py
│   │   └── worker.py
│   ├── formatlib/
│   │   └── v1_scaffold/
│   ├── tests/
│   ├── Dockerfile
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/client.ts
    │   ├── components/
    │   ├── pages/
    │   ├── store/useStore.ts
    │   └── types/index.ts
    ├── package.json
    └── vite.config.ts
```

The uploaded ZIP also contained `backend/.venv/`. It is environment-generated content and should not be treated as project source or included in future context packages.

## 3. Technology stack

### Backend
- Python 3.12 target in Docker
- FastAPI 0.111
- Uvicorn
- SQLAlchemy 2 async
- PostgreSQL 16 + pgvector
- Alembic
- LangGraph 0.1.19
- LiteLLM 1.40
- OpenAI / Azure OpenAI / Anthropic support
- sentence-transformers with local `all-MiniLM-L6-v2` embeddings
- pandas/numpy
- JayDeBeApi + JPype1 for SAP HANA/Datasphere JDBC
- Pydantic v2
- JWT + Argon2 authentication
- WebSockets for run progress
- Docker Compose

### Frontend
- React 18
- TypeScript
- Vite 5
- React Router
- Zustand
- React Query
- React Flow
- Tailwind CSS
- lucide-react

## 4. Backend architecture

### `app/main.py`
Creates the FastAPI application, CORS middleware, startup/shutdown lifecycle, and mounts all API routers.

Endpoints include:
- `/health`
- `/`
- `/api/v1/auth/*`
- `/api/v1/connections/*`
- `/api/v1/catalog/*`
- `/api/v1/runs/*`
- `/api/v1/chat/*`
- `/api/v1/views/*`
- `/api/v1/export/*`
- `/ws/runs/{run_id}`

### Configuration
`app/core/config.py` loads environment variables using Pydantic Settings.

Important settings:
- `DATABASE_URL`
- `LLM_PROVIDER`
- `LLM_MODEL`
- `OPENAI_API_KEY`
- Azure/Anthropic credentials
- local embedding model
- SAP Datasphere OAuth/JDBC settings
- profiling thresholds
- confidence thresholds
- worker settings

Credentials must not be persisted in the database.

### Database
`app/core/database.py` creates the async SQLAlchemy engine and session factory.

Primary production DB is PostgreSQL. Models use PostgreSQL-specific UUID/JSONB types.

### Security
`app/core/security.py` provides:
- Argon2 password hashing
- JWT creation/decoding
- OAuth2 bearer extraction
- roles: `admin`, `modeler`, `viewer`
- role-based FastAPI dependencies

## 5. Database/domain model

Important SQLAlchemy models:

### User
Authentication and role.

### Connection
Stores SAP Datasphere connection metadata. The design states that client secrets should not be stored in the DB; runtime secret input/environment configuration is used.

### CatalogTable / CatalogColumn / CatalogProfile
Catalog cache and profiling metadata.

Catalog columns include:
- name/type
- nullability
- key status
- semantic role
- business name
- classification confidence/source
- PII flag

### Run
Represents an end-to-end modeling session.

Important fields:
- connection
- creator
- requirement
- current state
- version
- parent run
- agent state
- parsed requirement
- candidate tables
- view chain plan
- validation report
- error

### ViewSpec
The intended single source of truth for generated/edited Datasphere objects.

Important fields:
- object ID
- layer
- kind
- business name
- description
- full `spec_json`
- approval state
- human edit history
- version

Kinds include:
- `graphical_view`
- `sql_view`
- `business_entity`
- `analytic_model`

### GraphNode / GraphEdge
Unified graph representation used by Canvas, Lineage and Impact views.

### Artifact
Rendered Datasphere-native JSON derived from a ViewSpec.

### AuditLog
Immutable audit trail for LLM calls, human edits, approvals, exports, connection tests and errors.

### Feedback
Structured before/after ViewSpec diffs intended to support future golden examples.

### Glossary
Database representation of deterministic SAP technical-name classifications.

## 6. Agent/orchestration architecture

The LangGraph flow in `app/agent/graph.py` is:

```text
INTAKE
  ↓
PARSE_REQUIREMENT
  ↓
SELECT_SOURCES
  ↓ [human gate]
PROFILE
  ↓
DETECT_ASSOCIATIONS
  ↓
PLAN_VIEW_CHAIN
  ↓ [human gate]
BUILD_VIEWS
  ↓
VALIDATE
  ↓
RENDER_ARTIFACTS
  ↓ [human gate]
EXPORT
```

There is also an intended edit loop where canvas/chat edits re-enter validation and rendering.

### RunState
Defined in `app/agent/states.py`.

It contains:
- run/connection/user identity
- requirement text
- current state/error
- parsed requirement
- candidate source tables
- source match reasons
- profiles
- association candidates
- confirmed associations
- view-chain plan
- ViewSpecs and IDs
- validation report/blocker state
- artifact IDs
- human gate flags
- golden examples
- pending edits/messages

### Agent nodes
`app/agent/nodes.py` implements:
- `intake_node`
- `parse_requirement_node`
- `select_sources_node`
- `profile_node`
- `detect_associations_node`
- `plan_view_chain_node`
- `build_views_node`
- `validate_node`
- `render_artifacts_node`
- `export_node`

### LLM layer
`app/agent/llm.py` centralizes LLM calls through LiteLLM.

Current call types include:
- `parse_requirement`
- `classify_column`
- `confirm_association`
- `build_view_spec`
- `chat_modify`

The implementation:
- uses deterministic temperature 0
- limits calls to 4096 output tokens
- uses JSON response format for OpenAI/Azure
- validates outputs against JSON schemas where configured
- retries failed calls
- records audit information
- returns a human-review sentinel on failure

Important principle: LLM output must not be trusted directly. Deterministic validation happens afterward.

### SAP dictionary
`app/agent/sap_dictionary.py` provides deterministic classification for known SAP fields.

Examples:
- `VBELN` → key / sales order
- `NETWR` → measure / currency amount
- `WAERS` → unit / currency key
- `KUNNR` → customer dimension
- `MATNR` → material dimension
- `BUDAT` → date
- `MENGE` → quantity measure

Unknown fields can fall back to LLM classification.

## 7. Datasphere discovery/profiling

### Reader
`app/ds/reader.py` connects through HANA JDBC using JayDeBeApi.

It attempts universal object discovery and falls back to TABLES + VIEWS if needed.

It enriches objects with:
- canonical object type
- remote status/source/object
- replication status
- associations/referential constraints
- columns
- primary-key columns
- schema hash

### Profiler
`app/ds/profiler.py` implements the profiling pack:
- P1: column statistics
- P2: key uniqueness
- P3: orphan/join ratio
- P4: currency/unit pairing validity
- P5: top-K values for non-PII columns
- P6: self-reference/hierarchy hint

PII protection is an explicit design requirement: raw top-K values are not collected for PII columns.

## 8. Core services

- `association_detector.py`: identifies likely joins/associations using catalog/profile evidence.
- `catalog_service.py`: catalog persistence/search/profile orchestration.
- `embedding_service.py`: local embeddings and vector/golden-example search.
- `replication_builder.py`: chooses federation vs replication and generates replication specs.
- `view_builder.py`: deterministic ViewSpec builders for common layers.
- `sql_generator.py`: Datasphere/HANA SQL generation.
- `validator.py`: deterministic validation rules V-01 through V-08 and auto-fixes.
- `renderer_service.py`: converts ViewSpec to Datasphere-native JSON and persists artifacts.
- `export_service.py`: builds export bundles.
- `audit.py`: audit logging.
- `services/renderer_service.py` is deliberately downstream of ViewSpec generation.

## 9. Validation philosophy

Validation is deterministic and runs after generation.

The validator covers rules including:
- join type mismatch
- orphan ratio
- key uniqueness
- currency binding
- non-additive measures
- duplicate/reserved columns
- object existence
- other ViewSpec consistency checks

A blocker must prevent rendering/export until resolved or corrected.

Do not remove deterministic validation just to make LLM output pass.

## 10. Frontend architecture

`frontend/src/App.tsx` routes to:
- `/chat`
- `/canvas`
- `/catalog`
- `/lineage`
- `/runs`
- `/export`
- `/connections`

Global UI state is in `useStore.ts`:
- active connection
- active run
- selected ViewSpec
- approval gate modal
- impact analysis modal

Major components:
- Datasphere canvas / custom React Flow nodes
- chat modification panel
- gate approval modal
- impact analysis modal
- catalog page
- connections page
- runs page
- lineage page
- export page

### Current plan-driven modeling contract

The plan visualizer prepares one L1 wrapper Relational Dataset per source. Projection and filter are editable wrapper settings, not separate view entities. New row-level formulas belong on the L3 fact node as individually named `calculated_fields`, each with its own formula and output column. The LLM contract is defined in `backend/app/agent/prompts/planner_system.md`, represented by the Pydantic plan models, and mapped to export entities in `frontend/src/features/plan/planExport.ts`.

Legacy plans may still use the single `details.formula` property. Consumers should preserve that form for compatibility while preferring `calculated_fields` for multiple calculations. CSN serialization and plan validation do not by themselves prove that an artifact imports, deploys, or returns rows in a Datasphere tenant; source binding and tenant-level verification remain necessary.

`api/client.ts` wraps backend REST APIs.

Vite proxies `/api` to port 8000 and `/ws` to the backend WebSocket endpoint.

## 11. API flow

Typical modeling run:

```text
POST /api/v1/runs
        ↓
background LangGraph execution
        ↓
GET /api/v1/runs/{id}
GET /api/v1/runs/{id}/graph
WS /ws/runs/{id}
        ↓
POST /api/v1/runs/{id}/approve/sources
        ↓
POST /api/v1/runs/{id}/approve/plan
        ↓
POST /api/v1/runs/{id}/approve/artifacts
        ↓
export endpoints
```

View editing uses:
- `PUT /api/v1/views/{spec_id}`
- `GET /api/v1/views/{spec_id}`
- artifact endpoint
- approval endpoint
- impact analysis endpoint

Chat modification uses:
- `POST /api/v1/chat/{run_id}/chat`

## 12. Deployment

Docker Compose intends to run:
- PostgreSQL + pgvector
- FastAPI API
- worker
- React/Vite frontend

Postgres is exposed on 5432, API on 8000, frontend on 3000.

The backend Docker image installs Java because SAP JDBC access is required.

The backend Docker build also downloads `all-MiniLM-L6-v2` at image build time.

## 13. Coding conventions for future ChatGPT work

1. Inspect existing code before changing it.
2. Preserve the current architecture unless there is a clear defect requiring redesign.
3. Prefer small, targeted changes.
4. Do not duplicate business logic between frontend/backend.
5. Keep ViewSpec as the source of truth.
6. Keep Datasphere rendering downstream from validation.
7. Prefer deterministic SAP dictionary/rules before LLM calls.
8. Never put secrets in source control or generated documentation.
9. Preserve audit logging for LLM and human actions.
10. When changing an API contract, update backend models, frontend types, API client, UI callers and tests together.
11. When changing state-machine behavior, inspect both LangGraph code and the run approval/resume API.
12. After every meaningful change, run syntax checks and the most relevant tests.
13. Update `AI_TASKS.md` and `AI_CHANGELOG.md` after completed work.
14. Do not claim a feature is complete merely because code was written; verify it with tests or an executable path where possible.

## 14.1 Current status after foundation fixes

The initial audit blockers below have been addressed in the current working copy:
- `plan_view_chain_node()` now defines `parsed` from `state["parsed_requirement"]`.
- `aiosqlite` is declared for the existing SQLite test environment.
- Docker Compose mounts `./backend/formatlib` consistently.
- The run API now mirrors LangGraph checkpoints into the `runs` table after graph steps.
- Approval endpoints now apply human gate decisions to the LangGraph checkpoint before resuming.

Still pending: install dependencies, execute the full test suite, verify the pinned LangGraph API, and replace in-memory checkpointing for production.

## 14. Known issues discovered during initial inspection

These are findings from the uploaded repository, not assumptions.

### P0/P1: Agent plan node has an undefined variable
In `backend/app/agent/nodes.py`, `plan_view_chain_node()` builds a context containing `parsed`, but the function does not define `parsed` before using it. It should use the parsed requirement from `state` (or define the local variable explicitly).

This can stop a modeling run during plan generation.

### P1: Test environment dependency is missing
`backend/tests/conftest.py` configures:

```text
DATABASE_URL=sqlite+aiosqlite:///:memory:
```

but `aiosqlite` is not present in `backend/requirements.txt`.

The test suite therefore fails during import in a clean environment before tests run.

Additionally, production models use PostgreSQL-specific UUID/JSONB types, so SQLite compatibility should be evaluated rather than blindly adding the dependency and assuming all integration tests will work.

### P1: Docker Compose formatlib mount path is inconsistent
The repository has:

```text
backend/formatlib/
```

but `docker-compose.yml` mounts:

```text
./formatlib:/app/formatlib
```

from the repository root.

There is no root-level `formatlib` directory in the uploaded project. The compose mount likely needs to be reconciled with the actual directory/build context.

### P1: LangGraph checkpoint persistence is currently in-memory
`app/agent/graph.py` uses `MemorySaver()`.

The `Run` database stores an `agent_state` JSON field, but the compiled LangGraph checkpointer is not PostgreSQL-backed. A process restart can therefore lose in-progress LangGraph checkpoints even though the Run record remains.

For production-grade resumability, use a persistent LangGraph checkpointer or implement an explicit durable state/resume strategy.

### P1: Approval API and graph state must be verified together
The REST approval endpoint writes `run.state`/`agent_state` and then resumes the graph using `graph.astream(None, config=...)`.

Because the actual LangGraph checkpoint is separate from the SQL `Run.agent_state`, the approval flow needs an end-to-end test to verify that the correct checkpoint is resumed and the updated candidate table selection is actually visible to the resumed graph.

### P2: Frontend API base URL is currently hardcoded
`frontend/src/api/client.ts` uses `/api/v1`, while Docker Compose sets `VITE_API_URL=http://localhost:8000`.

Vite development proxying makes `/api` work in local dev, but `VITE_API_URL` is currently not consumed by the client. This should be intentionally documented or changed so development and production deployment semantics are clear.

### P2: Alembic exists but development startup also auto-creates tables
`app/main.py` calls `Base.metadata.create_all()` during startup.

That can be convenient in development, but migrations should be the source of truth for production. Future work should make the behavior environment-specific and ensure all schema changes have Alembic migrations.

### P2: Test coverage is currently narrow
Tests cover basic graph initialization, dictionary lookup, health/root endpoints, schema hashing, rendering and a small validator surface.

There is not yet strong end-to-end coverage for:
- authentication
- connection lifecycle
- catalog scanning
- real run creation
- human gates
- graph resume
- view generation
- validation blockers
- rendering/export
- WebSocket progress
- frontend behavior

## 15. First implementation priority

Before adding major product features, stabilize the execution path:

1. Fix the undefined `parsed` variable.
2. Fix the test environment and make backend tests runnable.
3. Decide on PostgreSQL-only integration tests vs a deliberate SQLite test strategy.
4. Fix/verify Docker Compose `formatlib` path.
5. Verify the full run state machine with mocked LLM/Datasphere dependencies.
6. Make LangGraph checkpoint persistence durable.
7. Verify source/plan/artifact approval and resume behavior end-to-end.
8. Then continue feature implementation.
