# Agent Cleanup Tasks

## Current Inventory

Baseline recorded on March 14, 2026. This section is read-only inventory and does not imply that
all items should be addressed in one batch.

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

- [ ] `src/main/presenter/deepchatAgentPresenter/index.ts` -> `../agentPresenter/message/systemEnvPromptBuilder`
- [ ] `src/main/presenter/deepchatAgentPresenter/dispatch.ts` -> `../agentPresenter/tools/questionTool`
- [ ] `src/main/presenter/deepchatAgentPresenter/toolOutputGuard.ts` -> `../sessionPresenter/sessionPaths`

### Primary Flow Type-Source Coupling

- [ ] `src/main/presenter/deepchatAgentPresenter/types.ts` -> `MCPToolDefinition` from `@shared/presenter`
- [ ] `src/main/presenter/deepchatAgentPresenter/toolOutputGuard.ts` -> `MCPToolDefinition` from `@shared/presenter`
- [ ] `src/main/presenter/deepchatAgentPresenter/dispatch.ts` -> `MCPToolDefinition` and `SearchResult` from `@shared/presenter`
- [ ] `src/main/presenter/deepchatAgentPresenter/messageStore.ts` -> `SearchResult` from `@shared/presenter`
- [ ] `src/main/presenter/newAgentPresenter/index.ts` -> `Message` from `@shared/chat`, `SearchResult` from `@shared/presenter`
- [ ] `src/main/presenter/newAgentPresenter/legacyImportService.ts` -> `SearchResult` from `@shared/presenter`

### New UI Legacy Message Protocol Imports

- [ ] Pages -> `src/renderer/src/pages/ChatPage.vue`, `src/renderer/src/pages/NewThreadPage.vue`
- [ ] Stores -> `src/renderer/src/stores/ui/message.ts`, `src/renderer/src/stores/ui/session.ts`
- [ ] Chat components -> `src/renderer/src/components/chat/ChatAttachmentItem.vue`, `src/renderer/src/components/chat/ChatInputBox.vue`, `src/renderer/src/components/chat/MessageList.vue`, `src/renderer/src/components/chat/messageListItems.ts`, `src/renderer/src/components/chat/composables/useChatInputFiles.ts`
- [ ] Message components -> `src/renderer/src/components/message/MessageBlockAction.vue`, `src/renderer/src/components/message/MessageBlockAudio.vue`, `src/renderer/src/components/message/MessageBlockContent.vue`, `src/renderer/src/components/message/MessageBlockError.vue`, `src/renderer/src/components/message/MessageBlockImage.vue`, `src/renderer/src/components/message/MessageBlockMcpUi.vue`, `src/renderer/src/components/message/MessageBlockPlan.vue`, `src/renderer/src/components/message/MessageBlockQuestionRequest.vue`, `src/renderer/src/components/message/MessageBlockThink.vue`, `src/renderer/src/components/message/MessageBlockToolCall.vue`, `src/renderer/src/components/message/MessageContent.vue`, `src/renderer/src/components/message/MessageItemAssistant.vue`, `src/renderer/src/components/message/MessageItemUser.vue`
- [x] Archived dead renderer code -> `src/renderer/src/components/message/MessageMinimap.vue` moved to `archives/code/dead-renderer-batch-1/`

### Secondary Renderer Type Coupling

- [ ] `src/renderer/src/components/message/MessageBlockContent.vue` -> `SearchResult` from `@shared/presenter`
- [ ] `src/renderer/src/components/message/ReferencePreview.vue` -> `SearchResult` from `@shared/presenter`
- [ ] `src/renderer/src/stores/reference.ts` -> `SearchResult` from `@shared/presenter`

### Compatibility Layer Runtime Fallbacks

- [ ] `src/main/presenter/skillPresenter/index.ts` -> `presenter.sessionPresenter.getConversation/updateConversationSettings`
- [ ] `src/main/presenter/skillPresenter/skillExecutionService.ts` -> `../sessionPresenter/sessionPaths`, `../agentPresenter/acp/backgroundExecSessionManager`, `../agentPresenter/acp/shellEnvHelper`
- [ ] `src/main/presenter/mcpPresenter/toolManager.ts` -> global `input_chatMode` and `presenter.sessionPresenter.getConversation`

### Recommended Next PR Order

- [ ] `0A` Inventory only, docs only
- [x] `0B` Add static guardrails only
- [ ] `1A` Extract `questionTool` helper only
- [ ] `1B` Extract system env prompt helper only
- [ ] `1C` Extract session path helper and narrow `MCPToolDefinition` / `SearchResult` imports
- [ ] `4` Remove remaining legacy runtime logic after import-only compatibility is proven stable

## Batch 0

- [x] Add spec artifacts under `docs/specs/agent-cleanup/`
- [x] Add static dependency guard script
- [x] Wire guard script into `pnpm run lint`

## Batch 1

- [ ] Extract neutral runtime prompt builder
- [ ] Extract neutral question-tool helper
- [ ] Extract neutral session path helper
- [ ] Update new-flow imports to neutral helpers
- [ ] Add standalone `SearchResult` core type
- [ ] Update new-flow imports to `core/mcp` and `core/search`

## Batch 2

- [ ] Extend `agent-interface` message protocol for currently rendered blocks
- [ ] Introduce renderer-local display message types
- [ ] Remove new UI direct imports from `@shared/chat`

## Batch 3

- [ ] Add `active_skills` persistence to `new_sessions`
- [ ] Make `SkillPresenter` persist new-session active skills
- [ ] Remove new-session fallback to legacy conversation settings
- [ ] Remove new-session ACP runtime gating dependence on `input_chatMode`
- [ ] Move skill runtime helpers out of legacy presenter folders

## Batch 4

- [ ] Audit remaining legacy runtime references
- [ ] Retire safe legacy-only runtime wiring
