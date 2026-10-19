# DS ModelForge

**AI-Powered SAP Datasphere Semantic Modeling & Canvas Synthesizer**

DS ModelForge is an intelligent data modeling workbench and compiler for **SAP Datasphere**. It translates plain English business requirements and human-provided schemas (JSON, SQL DDL, or table lists) into production-ready Datasphere graphical views, associations, hierarchies, and analytic models.

---

## Key Features

1. **Human-in-the-Loop Requirement AI Modeler**
   - Natural language business requirement specification.
   - Accepts uploaded JSON/CSN schemas or pasted table metadata and column definitions.
   - **Local schema modeling**: Build a lineage graph and export CSN JSON without an active SAP Datasphere connection.
   - For PO Average Processing Time, the generated KPI uses the PO creation and final-delivery dates and averages processing duration in days; vendor grouping requires matching vendor-master metadata.

2. **Datasphere Data Builder Canvas**
   - Interactive canvas for exploring and editing model specifications, with nodes for:
     - **Projection Operators**: Column mapping, data typing, and calculated formulas.
     - **Filter Operators**: Datasphere filter condition expressions.
     - **Join Operators**: Inner/outer joins, cardinalities (`1:N`), and join conditions.
     - **Association Operators**: Target dimension entities and foreign key mappings.
     - **Hierarchy Operators**: Parent-child and level-based hierarchies.
     - **Analytic Models**: Multi-dimensional models with aggregated measures for SAP Analytics Cloud (SAC) and Power BI.
   - **Interactive Inspector Drawer**: Click any operator or view to inspect and copy condition codes, formulas, and schemas.

3. **Intelligent JSON & Token Compressor**
   - Extracts a compact set of fields and metadata from supported JSON/CSN schema inputs.
   - Used to prepare uploaded schema metadata for lineage and model generation.

4. **Space Deployment & Native CSN 2.0 Export**
   - Downloads generated CSN JSON files individually or as an ordered ZIP bundle with an import guide.
   - The canvas includes deployment UI, but live Datasphere deployment is not currently available through the database-free backend.
   - V-01..V-08 validation rules are available in the model validation workflow; they do not guarantee that every generated artifact will compile in every Datasphere tenant. Validate imports in Datasphere and ensure referenced source objects exist.

---

## Project Structure

```
DS Modelforge/
├── backend/
│   ├── app/
│   │   ├── agent/           # LangGraph nodes, LLM caller, canvas synthesizer, JSON compressor
│   │   ├── api/v1/          # API route modules; stateful routes are currently not mounted
│   │   ├── core/            # Configuration and legacy database/security modules
│   │   ├── models/          # Legacy SQLAlchemy ORM models (not used by current app startup)
│   │   └── services/        # Validator, SQL generator, association detector
│   ├── requirements.txt     # Python dependencies
│   └── tests/               # Backend test suite
├── frontend/
│   ├── src/
│   │   ├── api/             # API client & WebSocket handler
│   │   ├── components/      # ReactFlow custom nodes, canvas, layout, chat panel
│   │   ├── pages/           # Requirement AI, Canvas, Catalog, Lineage, Runs, Export
│   │   ├── store/           # Zustand state management
│   │   └── types/           # TypeScript definitions
│   ├── package.json         # Frontend dependencies (React, Vite, ReactFlow, TailwindCSS)
│   └── vite.config.ts
├── .gitignore
└── README.md
```

---

## Quickstart Guide

### 1. Backend Setup

Use Python 3.12 for the backend. The pinned CPU builds of PyTorch 2.3.0 and
torchvision 0.18.0 do not provide wheels for Python 3.14; the Docker image also
uses Python 3.12. If the Python launcher does not detect your Python 3.12 runtime
(for example, a runtime installed by uv), create the environment with uv instead.

```cmd
cd backend
py -3.12 -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Alternative when using uv-managed Python:

```cmd
cd backend
uv venv --python 3.12 venv
call venv\Scripts\activate.bat
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs will be available at: `http://localhost:8000/docs`
The backend provides:
- `/health`: Health status
- `/api/plan`: Phase 1 modeling plan generation and visual revision
- `/ws`: Real-time WebSocket transport

Run the Phase 1 test suite (offline, no database needed):
```cmd
pytest tests/test_plan_step1.py tests/test_profiler_step2.py tests/test_planner_step3.py tests/test_api_step4.py -v
```

### 2. Frontend Setup

```cmd
cd frontend
npm install
npm run dev
```

Application will be running at: `http://localhost:3000`
- Navigate to `http://localhost:3000/plan` to interact with the Visual Modeling Plan.

---

## License

MIT
