# New Agent Architecture — Tasks

## T0 Shared Types & Events

- [x] Create `src/shared/types/agent-interface.d.ts` — `IAgentImplementation`, `Agent`, `Session`, `SessionStatus`, `CreateSessionInput`, `ChatMessageRecord`, `UserMessageContent`, `AssistantMessageBlock`, `MessageMetadata`, `Project` (merged chat-types into this file)
- [x] Create `src/shared/types/presenters/new-agent.presenter.d.ts` — `INewAgentPresenter` interface
- [x] Create `src/shared/types/presenters/project.presenter.d.ts` — `IProjectPresenter` interface
- [x] Export new types from `src/shared/types/presenters/index.d.ts`
- [x] Add `SESSION_EVENTS` to `src/main/events.ts` (list-updated, activated, deactivated, status-changed)
- [x] Add `SESSION_EVENTS` mirror to `src/renderer/src/events.ts`

## T1 New DB Tables

- [x] Create `src/main/presenter/sqlitePresenter/tables/newSessions.ts` — `new_sessions` table (no provider_id/model_id — agent owns those)
- [x] Create `src/main/presenter/sqlitePresenter/tables/newProjects.ts` — `new_projects` table with `icon` column
- [x] Create `src/main/presenter/sqlitePresenter/tables/deepchatSessions.ts` — `deepchat_sessions` table (id, provider_id, model_id only — no per-session config columns)
- [x] Create `src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts` — `deepchat_messages` table with order_seq, JSON content, status (pending/sent/error), is_context_edge, metadata; index on (session_id, order_seq)
- [x] Register new tables in `sqlitePresenter/index.ts` (initTables + migrate array)

## T2 deepchatAgentPresenter

- [x] Create `src/main/presenter/deepchatAgentPresenter/messageStore.ts` — CRUD over `deepchat_messages`: createUserMessage (JSON UserMessageContent), createAssistantMessage (empty AssistantMessageBlock[]), updateAssistantContent (batched JSON), finalizeAssistantMessage (status→sent), setMessageError (status→error), recoverPendingMessages (pending→error on startup), getNextOrderSeq
- [x] Create `src/main/presenter/deepchatAgentPresenter/sessionStore.ts` — CRUD over `deepchat_sessions`
- [x] Create `src/main/presenter/deepchatAgentPresenter/streamHandler.ts` — consume `AsyncGenerator<LLMCoreStreamEvent>`, accumulate into AssistantMessageBlock[], batch DB writes (600ms), batch renderer flush (120ms), emit stream events with conversationId, flush both on stream end/error
- [x] Create `src/main/presenter/deepchatAgentPresenter/index.ts` — implements `IAgentImplementation`, wires sessionStore + messageStore + streamHandler + llmProviderPresenter, runs crash recovery on init
- [x] Unit tests: streamHandler given mock async generator → verify block accumulation, batched DB writes at 600ms, renderer flush at 120ms, final flush on stop/error (`test/main/presenter/deepchatAgentPresenter/streamHandler.test.ts`)
- [x] Unit tests: processMessage → creates user message (JSON), calls streamHandler, creates assistant message (JSON blocks), correct order_seq (`test/main/presenter/deepchatAgentPresenter/deepchatAgentPresenter.test.ts`)
- [x] Unit tests: recoverPendingMessages → pending rows updated to error (`test/main/presenter/deepchatAgentPresenter/deepchatAgentPresenter.test.ts`)

## T3 agentPresenter (newAgentPresenter)

- [x] Create `src/main/presenter/newAgentPresenter/agentRegistry.ts` — register/resolve/getAll
- [x] Create `src/main/presenter/newAgentPresenter/sessionManager.ts` — CRUD over `new_sessions`, in-memory window bindings (webContentsId → sessionId)
- [x] Create `src/main/presenter/newAgentPresenter/messageManager.ts` — proxy resolves agentId then delegates to agent
- [x] Create `src/main/presenter/newAgentPresenter/index.ts` — implements `INewAgentPresenter`, wires sessionManager + messageManager + agentRegistry + event relay (all stream events carry conversationId)
- [x] Unit tests: sessionManager CRUD + window bindings (`test/main/presenter/newAgentPresenter/sessionManager.test.ts`)
- [x] Unit tests: agentRegistry register/resolve/getAll/has (`test/main/presenter/newAgentPresenter/agentRegistry.test.ts`)
- [x] Unit tests: messageManager delegation (`test/main/presenter/newAgentPresenter/messageManager.test.ts`)
- [x] Unit tests: createSession → verify sessionManager.create + agent.initSession + agent.processMessage called (`test/main/presenter/newAgentPresenter/newAgentPresenter.test.ts`)
- [x] Unit tests: sendMessage → verify agent routing (`test/main/presenter/newAgentPresenter/newAgentPresenter.test.ts`)

## T4 projectPresenter

- [x] Create `src/main/presenter/projectPresenter/index.ts` — implements `IProjectPresenter`, CRUD over `new_projects`, selectDirectory via devicePresenter
- [x] Unit tests: getProjects, getRecentProjects (order + limit), selectDirectory (`test/main/presenter/projectPresenter/projectPresenter.test.ts`)

## T5 Presenter Registration

- [x] Add `INewAgentPresenter` and `IProjectPresenter` to `IPresenter` interface in `src/shared/types/presenters/legacy.presenters.d.ts`
- [x] Add properties and constructor instantiation in `src/main/presenter/index.ts`
- [ ] Verify: `usePresenter('newAgentPresenter')` and `usePresenter('projectPresenter')` callable from renderer

## T6 Renderer Stores

- [x] Rewrite `src/renderer/src/stores/ui/session.ts` — uses `newAgentPresenter`, listens to `SESSION_EVENTS`, uses `webContentsId` for activation
- [x] Create `src/renderer/src/stores/ui/message.ts` — uses `newAgentPresenter`, listens to `STREAM_EVENTS`, filters by conversationId, maintains streamingBlocks as AssistantMessageBlock[]
- [x] Rewrite `src/renderer/src/stores/ui/agent.ts` — uses `newAgentPresenter.getAgents()`
- [x] Rewrite `src/renderer/src/stores/ui/project.ts` — uses `projectPresenter`
- [x] Create `src/renderer/src/stores/ui/draft.ts` — pre-session config, toCreateInput()

## T7 NewThreadPage Integration

- [x] Update `src/renderer/src/pages/NewThreadPage.vue` — wire to new stores (removed `title` from CreateSessionInput, title derived from message in presenter)
- [x] Update `src/renderer/src/views/ChatTabView.vue` — `deriveFromSessions` → `fetchProjects`
- [ ] Verify: type message → submit → session created → streaming response displayed with structured blocks
- [ ] Verify: session appears in sidebar via sessionStore

## T8 Quality Gate & Verification

- [x] `pnpm run typecheck` — passes
- [x] `pnpm run lint` — passes (0 warnings, 0 errors)
- [x] `pnpm run format` — passes
- [x] Unit tests: all new modules (94 tests across 9 test files, all passing)
- [x] Integration test: createSession end-to-end — new_sessions row + deepchat_sessions row + deepchat_messages rows (valid JSON content) + events with conversationId (`test/main/presenter/newAgentPresenter/integration.test.ts`)
- [x] Integration test: crash recovery — insert pending message, reinit, verify status = error (`test/main/presenter/newAgentPresenter/integration.test.ts`)
- [ ] Verify old UI regression: old `sessionPresenter` / `chatStore` still functional — zero impact
- [ ] Manual verify: run `pnpm run dev`, create session via NewThreadPage, see streamed response

---

## v1: Multi-Turn Context Assembly

- [x] Create `src/main/presenter/deepchatAgentPresenter/contextBuilder.ts` — context assembly + truncation
- [x] Modify `processMessage` in `deepchatAgentPresenter/index.ts` — wire context builder
- [x] Unit tests for context builder (`test/main/presenter/deepchatAgentPresenter/contextBuilder.test.ts`)
- [x] Update `deepchatAgentPresenter.test.ts` — mock `getDefaultSystemPrompt`, verify multi-turn messages
- [x] Update `integration.test.ts` — verify multi-turn flow end-to-end
- [x] Quality gate: typecheck, lint, format, tests
