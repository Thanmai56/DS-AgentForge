# Instructions for ChatGPT Working on DS ModelForge

Use this file together with `AI_CONTEXT.md`, `AI_TASKS.md`, and `AI_CHANGELOG.md`.

## Before coding

1. Read all four AI files.
2. Inspect the actual source files relevant to the task.
3. Determine the existing contract and data flow.
4. Check whether the task is already partially implemented.
5. Do not replace working architecture unnecessarily.

## While coding

- Make the smallest coherent change that fully solves the task.
- Keep backend/frontend contracts synchronized.
- Preserve ViewSpec as the single source of truth.
- Keep LLM-generated data behind deterministic validation.
- Preserve security and PII constraints.
- Never hard-code API keys, passwords, client secrets or tokens.
- Prefer typed models and explicit error handling.
- Avoid speculative refactors unrelated to the task.

## After coding

1. Run compile/type/build checks relevant to the change.
2. Run targeted tests.
3. Fix regressions caused by the change.
4. Update `AI_TASKS.md`.
5. Update `AI_CHANGELOG.md`.
6. Update `AI_CONTEXT.md` if architecture, contracts, commands or important decisions changed.
7. Report exactly what was changed and what could not be verified.

## When starting a new ChatGPT conversation

Upload:
- `AI_CONTEXT.md`
- `AI_TASKS.md`
- `AI_CHANGELOG.md`
- `AI_INSTRUCTIONS.md`

Then provide the specific task. Add only the relevant source files when possible.

## Important

Do not rely on previous chat history as the project's permanent memory. The repository and these AI files are the durable project context.
