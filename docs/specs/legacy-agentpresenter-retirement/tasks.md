# Legacy AgentPresenter Retirement Tasks

## Runtime Retirement

- [x] remove live `AgentPresenter` runtime ownership from `src/main/presenter/index.ts`
- [x] remove public `agentPresenter` / `sessionPresenter` presenter exposure
- [x] remove `ILlmProviderPresenter.startStreamCompletion()`
- [x] stop `SessionPresenter` from reading legacy runtime in-memory session state

## Migration

- [x] move ACP helpers to `src/main/presenter/llmProviderPresenter/acp/`
- [x] move agent tools to `src/main/presenter/toolPresenter/agentTools/`
- [x] move retained message formatter helper to `src/main/presenter/sessionPresenter/messageFormatter.ts`
- [x] update imports and tests to the new paths

## Archive

- [x] archive retired `src/main/presenter/agentPresenter/`
- [x] archive retired legacy presenter type definitions
- [x] archive retired legacy tests
- [x] add archive README for provenance and intent

## Docs

- [x] add retirement spec/plan/tasks
- [x] replace active architecture and flow docs with current runtime descriptions
- [x] link legacy architecture/flows as archive-only docs
- [x] update `agent-cleanup` checkpoint docs to final state

## Verification

- [x] `pnpm run format`
- [x] `pnpm run i18n`
- [x] `pnpm run lint`
- [x] `pnpm run typecheck`
- [x] targeted Vitest suites
- [x] `node scripts/agent-cleanup-guard.mjs`
