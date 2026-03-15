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

## Main Runtime Micro-Batches

### Main Batch 0

- Update docs to classify main residuals as active compatibility / import-only / retirement.
- Extend the static guard to `skillPresenter` and `mcpPresenter/toolManager`.
- Track current legacy helper imports and `input_chatMode` access as main baseline violations.

Rollback:

- Revert docs and guard updates only.

### Main Batch 1

- Add `new_sessions.active_skills`.
- Make `SkillPresenter` persist new-session skills in `new_sessions`.
- Keep old-session fallback unchanged in this slice.

Rollback:

- Keep the DB column and route new-session skill reads/writes back to in-memory state if needed.

### Main Batch 2

- Move session-dir / shell-env / background-exec helpers used by `skillExecutionService` into a
  neutral runtime module.
- Keep old helper paths as temporary shims if needed.

Rollback:

- Restore imports to legacy helper modules.

### Main Batch 3

- Remove `mcpPresenter/toolManager` dependence on global `input_chatMode`.
- Resolve ACP gating from session context first; keep legacy conversation fallback only on legacy
  paths.

Rollback:

- Restore the old `input_chatMode` gate and legacy conversation lookup.

### Main Batch 4

- Audit `Presenter` default wiring and `main/index` shutdown cleanup.
- Strip old `SessionPresenter` / `AgentPresenter` from the new primary path once import-only
  compatibility is proven stable.

Rollback:

- Restore legacy wiring in startup/shutdown if regressions are found.

## Legacy Agent Runtime Micro-Batches

### Batch A

- Introduce an internal session runtime port for legacy `agentPresenter` handlers.
- Remove direct `presenter.sessionManager` reads from `PermissionHandler`,
  `LLMEventHandler`, `StreamGenerationHandler`, `AgentLoopHandler`, and `AgentPresenter`.
- Keep `toolPresenter` / `mcpPresenter` / `windowPresenter` globals out of scope for this slice.

Rollback:

- Restore handler access to `presenter.sessionManager` and remove the runtime-port seam.

### Batch B

- Inject `IToolPresenter` into legacy `agentPresenter` runtime instead of reading
  `presenter.toolPresenter`.
- Cover `PermissionHandler`, `StreamGenerationHandler`, `messageBuilder`, `AgentLoopHandler`,
  `LLMProviderPresenter` wiring, and legacy `AgentPresenter` construction.
- Keep `mcpPresenter` / `windowPresenter` globals out of scope for this slice.

Rollback:

- Restore legacy runtime tool access to `presenter.toolPresenter`.
