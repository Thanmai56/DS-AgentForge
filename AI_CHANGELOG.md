# AI Change Log — DS ModelForge

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
