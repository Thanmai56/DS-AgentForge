# AI Change Log — DS ModelForge

## 2026-10-21 — Multi-formula fact planning and wrapper configuration

### Added / changed
- Updated the planner prompt to require each distinct row-level formula as a separate `calculated_fields` entry on the L3 fact node, with each formula name included in the fact output columns.
- Added typed calculated-field entries to the backend plan model and made the plan checker include those names in the node's output columns.
- Updated frontend plan display and export mapping to preserve and emit every named calculation, while retaining compatibility with legacy single `details.formula` plans.
- Added a regression test covering two independent formula columns in one fact entity.
- Kept the requested source modeling shape: one wrapper per source with projection and filter configured in place rather than extra transform nodes.

### Verification
- Python syntax diagnostics passed for changed backend files. Runtime checks confirmed the fixture plan passes the deterministic plan checker, retains two distinct fact calculations, and synthesizes one lineage calculation node per formula.
- Focused pytest execution was blocked because `pytest` is not installed in the selected Python interpreter. Frontend editor diagnostics reported no errors; frontend unit/build execution remains unverified.

## 2026-09-30 — Foundation audit + run lifecycle fixes

### Added / fixed
- Added persistent AI project context files: `AI_CONTEXT.md`, `AI_TASKS.md`, `AI_INSTRUCTIONS.md`, `AI_CHANGELOG.md`.
- Fixed `plan_view_chain_node()` using an undefined `parsed` variable; it now reads `state["parsed_requirement"]` safely.
- Added `aiosqlite` to backend requirements so the existing SQLite test configuration can initialize.
- Fixed Docker Compose `formatlib` volume paths to `./backend/formatlib:/app/formatlib`.
- Added LangGraph checkpoint-to-`Run` synchronization so API/UI state is updated from the actual graph checkpoint after each step.
- Added approval-gate checkpoint updates so source selections and human approval flags are applied before graph resume.
- Added failure handling that marks the persisted run as `FAILED` and records the exception message.

### Verification
- Python application files compile successfully with `python -m compileall`.
- Full pytest execution is blocked in the current analysis environment because project dependencies are not installed there; after installing requirements, rerun the test suite.

### Next
- Install backend dependencies and run the full test suite.
- Verify LangGraph `aupdate_state`/checkpoint behavior against the pinned LangGraph version.
- Test the complete source → plan → build → validate → render → export approval flow end-to-end.
- Replace in-memory `MemorySaver` with durable checkpoint storage for production.
