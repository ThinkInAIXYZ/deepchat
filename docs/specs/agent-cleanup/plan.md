# Agent Cleanup Plan

## Immediate Micro-Batches

As of March 14, 2026, cleanup execution is split into smaller reviewable slices.

### Batch 0A

- Inventory only.
- Record current legacy coupling in the new primary flow and compatibility layer.
- Record the current main-to-renderer event contract and freeze its payload/ordering assumptions.
- No runtime, renderer, DB, IPC, or CI wiring changes.

Rollback:

- Revert docs only.

Event safety gate:

- No cleanup batch may change `STREAM_EVENTS` or `SESSION_EVENTS` names, payload fields, or sender
  ordering until the renderer listeners are migrated in a dedicated event batch.
- In particular, `stream:end` must keep its current dual meaning ("stream finished" and "refresh
  persisted message from DB") until a separate refresh event exists and the renderer stops relying
  on `loadMessages()` for that path.

### Batch 0B

- Add the static dependency guard script.
- Wire the guard into `pnpm run lint`.
- Do not combine with helper extraction or renderer protocol work.

Rollback:

- Remove the guard script from `package.json`.

## Batch 0

- Add `docs/specs/agent-cleanup/{spec,plan,tasks}.md`.
- Batch 0 is now split into 0A and 0B above.

Rollback:

- Remove the guard script from `package.json`.

## Batch 1

Batch 1 is split into independent helper/type moves. Each slice should ship alone.

### Batch 1A

- Extract only the question-tool schema/parser to a neutral module.
- Update `deepchatAgentPresenter/dispatch.ts` to use the neutral helper.
- No renderer, DB, or `MCPToolDefinition`/`SearchResult` changes.

Rollback:

- Point `deepchatAgentPresenter/dispatch.ts` back to `agentPresenter/tools/questionTool`.

### Batch 1B

- Extract only the runtime/system env prompt builder to a neutral module.
- Update `deepchatAgentPresenter/index.ts` to use the neutral helper.
- No session path, renderer, DB, or compatibility-layer changes.

Rollback:

- Point `deepchatAgentPresenter/index.ts` back to
  `agentPresenter/message/systemEnvPromptBuilder`.

### Batch 1C

- Extract only session offload/session path helper ownership.
- Introduce standalone `core/search` and direct `core/mcp` imports where needed.
- Keep legacy files as thin re-export shims if required.

Rollback:

- Restore imports to `sessionPresenter/sessionPaths` and shared presenter barrels.

- Extract shared helpers to neutral modules:
  - runtime/system env prompt builder
  - question tool schema/parser
  - session offload/session path helper
- Keep legacy files as thin re-export shims so old code keeps working.
- Move new primary-flow code to direct `core` type imports for MCP/search instead of legacy
  presenter barrels.

Rollback:

- Point new-flow imports back to legacy helper modules.

## Batch 2

- Expand `agent-interface` message block/user content types to cover the block variants already
  rendered by the new UI.
- Replace new UI `@shared/chat` imports with `agent-interface` + renderer-local display types.
- Remove `ChatPage` runtime adaptation to legacy message protocol.

Rollback:

- Restore new UI imports to `@shared/chat`.

## Batch 3

- Persist `activeSkills` in `new_sessions`.
- Make `SkillPresenter` read/write new-session skills from the new session domain.
- Remove new-session skill fallback to legacy `sessionPresenter`.
- Remove new-session ACP gating dependence on global `input_chatMode`.
- Move shared runtime helpers used by `skillExecutionService` out of legacy folders.

Rollback:

- Keep DB column and route reads/writes back through legacy fallback.

## Batch 4

- Re-audit remaining runtime references to legacy presenter/session modules.
- Retire legacy runtime wiring only after batches 0-3 are stable.
- Keep only legacy data import compatibility; do not preserve old runtime ownership beyond that.

Rollback:

- Restore legacy presenter construction or shared type exposure if runtime regressions are found.
