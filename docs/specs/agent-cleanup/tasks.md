# Agent Cleanup Tasks

## Current Inventory

Baseline updated on March 15, 2026. This section is read-only inventory and does not imply that all
items should be addressed in one batch.

### Event Contract Baseline

- [x] Document `session:list-updated`, `session:activated`, `session:deactivated`
- [x] Document `session:status-changed` and `session:compaction-updated`
- [x] Document `stream:response`, `stream:end`, and `stream:error`
- [x] Capture the current renderer assumptions:
  - `useMessageStore` clears stream state and reloads DB records on `stream:end/error`
  - `stream:end` is also used as a message refresh signal today
  - `ChatPage` still adapts `ChatMessageRecord` into legacy `@shared/chat` render inputs
- [ ] Keep event payloads and emit ordering unchanged in batches `0B`, `1A`, `1B`, and `1C`

### Primary Flow Reverse Imports

- [x] `src/main/presenter/deepchatAgentPresenter/index.ts` moved off legacy prompt helper
- [x] `src/main/presenter/deepchatAgentPresenter/dispatch.ts` moved off legacy question-tool helper
- [x] `src/main/presenter/deepchatAgentPresenter/toolOutputGuard.ts` moved off legacy
  `sessionPaths`

### Primary Flow Type-Source Coupling

- [x] `deepchatAgentPresenter` moved to direct `core/mcp`
- [x] new-flow search result usage moved to `core/search`
- [ ] `src/main/presenter/newAgentPresenter/index.ts` still imports `Message` from `@shared/chat`
  for export-only conversion

### New UI Legacy Message Protocol Imports

- [x] Active chat pages, stores, message list, and live block path no longer import
  `@shared/chat`
- [x] Archived dead renderer code -> `src/renderer/src/components/message/MessageMinimap.vue` moved to `archives/code/dead-renderer-batch-1/`

### Secondary Renderer Residuals

- [x] `SearchResult` moved to `core/search`
- [ ] `src/renderer/settings/components/prompt/PromptEditorSheet.vue` still imports `MessageFile`
  from `@shared/chat` outside the active chat path

### Compatibility Layer Runtime Fallbacks

- [ ] `src/main/presenter/skillPresenter/index.ts` -> old-session fallback through
  `presenter.sessionPresenter.getConversation/updateConversationSettings`
- [x] `src/main/presenter/skillPresenter/index.ts` -> new-session skills persisted in
  `new_sessions.active_skills`
- [x] `src/main/presenter/skillPresenter/skillExecutionService.ts` moved off legacy helper
  ownership
- [x] `src/main/presenter/mcpPresenter/toolManager.ts` no longer depends on global
  `input_chatMode`
- [x] `src/main/presenter/index.ts` and `src/main/index.ts` no longer force legacy runtime on the
  new primary path
- [x] `src/main/presenter/agentPresenter/**` no longer reads `presenter.sessionManager` directly

### Import-Only Compatibility To Keep

- [x] `LegacyChatImportService`
- [x] legacy import hook / status tracking
- [x] old `conversations/messages` tables kept as import sources

### Recommended Next PR Order

- [x] `0A` Inventory only, docs only
- [x] `0B` Add static guardrails only
- [x] `1A` Extract `questionTool` helper only
- [x] `1B` Extract system env prompt helper only
- [x] `1C` Extract session path helper and narrow `MCPToolDefinition` / `SearchResult` imports
- [x] `2` Clear active renderer chat path and archive dead renderer code
- [ ] `M0` Add main compatibility baseline and guardrails
- [ ] `M1` Persist new-session `activeSkills`
- [ ] `M2` Extract skill runtime neutral helpers
- [ ] `M3` Decouple MCP ACP gating from global chat mode / legacy session fallback
- [ ] `M4` Reduce startup wiring to import-only boundaries
- [x] `A` Remove `presenter.sessionManager` from legacy `agentPresenter` internals

## Batch 0

- [x] Add spec artifacts under `docs/specs/agent-cleanup/`
- [x] Add static dependency guard script
- [x] Wire guard script into `pnpm run lint`

## Batch 1

- [x] Extract neutral runtime prompt builder
- [x] Extract neutral question-tool helper
- [x] Extract neutral session path helper
- [x] Update new-flow imports to neutral helpers
- [x] Add standalone `SearchResult` core type
- [x] Update new-flow imports to `core/mcp` and `core/search`

## Batch 2

- [x] Extend `agent-interface` message protocol for currently rendered blocks
- [x] Introduce renderer-local display message types
- [x] Remove new UI direct imports from `@shared/chat` on the active path
- [x] Archive dead renderer residuals outside the active path

## Main Batch 0

- [x] Update docs to classify main residuals as active compatibility / import-only / retirement
- [x] Extend static guard to main compatibility modules

## Main Batch 1

- [x] Add `active_skills` persistence to `new_sessions`
- [x] Make `SkillPresenter` persist new-session active skills
- [x] Keep old-session fallback unchanged

## Main Batch 2

- [x] Move skill runtime helpers out of legacy presenter folders

## Main Batch 3

- [x] Remove new-session ACP runtime gating dependence on `input_chatMode`

## Legacy Agent Runtime Batch

- [x] Add internal `AgentSessionRuntimePort`
- [x] Inject session runtime into legacy handlers
- [x] Remove direct `presenter.sessionManager` access from `agentPresenter/**`
- [x] Extend cleanup guard to block new `presenter.sessionManager` access in legacy runtime

## Batch 4

- [ ] Audit remaining legacy runtime references
- [ ] Retire safe legacy-only runtime wiring
