# Legacy AgentPresenter Retirement Plan

## Execution Order

1. migrate retained ACP helpers to `src/main/presenter/llmProviderPresenter/acp/`
2. migrate retained agent tools to `src/main/presenter/toolPresenter/agentTools/`
3. migrate retained message-formatting helpers to `src/main/presenter/sessionPresenter/`
4. remove legacy presenter/public type exposure and runtime wiring
5. archive retired source/tests
6. refresh active docs and cleanup specs
7. run format, i18n, lint, typecheck, tests, and cleanup guard

## Design Rules

1. keep compatibility-only data paths separate from active runtime
2. do not leave migration shims in the old folder if a live module owns the code now
3. prefer neutral/internal helper names over `legacy*` names when the function remains active
4. archive before delete when historical traceability matters

## Verification

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- targeted Vitest suites for provider/tools/presenter changes
- `node scripts/agent-cleanup-guard.mjs`
