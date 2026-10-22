# AI Tasks — DS ModelForge

## P0 — Do first
- [x] Create persistent AI context and handoff documentation.
- [x] Fix undefined `parsed` variable in `plan_view_chain_node`.
- [x] Add missing `aiosqlite` test dependency.
- [x] Fix Docker Compose `formatlib` mount path.
- [x] Synchronize LangGraph checkpoints into the `Run` database row.
- [x] Apply human gate decisions to the LangGraph checkpoint before resume.
- [ ] Install dependencies and run the complete backend test suite.
- [ ] Validate all three human approval gates end-to-end.
- [ ] Confirm run state, validation report, view specs and artifacts persist correctly after every stage.

## P1 — Reliability
- [ ] Replace `MemorySaver` with durable LangGraph checkpoint persistence.
- [ ] Add idempotency/duplicate-resume protection for approval endpoints.
- [ ] Add integration tests for rejected approvals and failed graph runs.
- [ ] Add structured error codes instead of only free-text error messages.
- [ ] Ensure background tasks survive API process restarts (production worker/queue).

## P1 — Product functionality
- [x] Preserve every requested fact-level formula as a distinct calculated output column; keep source projection/filter options inside one wrapper per source.
- [ ] Verify source confirmation UI writes selected tables back to the run.
- [ ] Verify plan confirmation UI updates the graph and persisted run state.
- [ ] Verify artifact approval triggers export and exposes generated artifacts.
- [ ] Verify Canvas edits enter the intended EDIT_LOOP and revalidation path.
- [ ] Verify lineage and impact views consume the same graph model.

## P2 — Quality
- [ ] Run frontend TypeScript/build checks.
- [ ] Add frontend tests for critical run/approval flows.
- [ ] Add API contract tests.
- [ ] Add logging/observability around LLM calls and graph transitions.
- [ ] Review environment/secrets handling before deployment.

## P2 — Production
- [ ] Add durable LangGraph/Postgres checkpointing.
- [ ] Add worker queue for long-running Datasphere/LLM tasks.
- [ ] Add database migrations as the authoritative production schema path.
- [ ] Add health/readiness checks for PostgreSQL and external Datasphere dependencies.
