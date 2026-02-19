# New Agent Architecture v0 — Minimal Single-Turn Chat

## Overview

Replace the old sessionPresenter + agentPresenter architecture with an agent-centric model. v0 delivers the minimum working system: a user can create a session, send one message, and see a streamed LLM response — all through the new architecture with new DB tables and new presenters.

v0 is the foundation. It proves the architecture end-to-end. Subsequent versions (v1–v5) add multi-turn, tool calling, permissions, config, and ACP support incrementally.

## Background

See [Full-Stack Mismatch Analysis](../../architecture/new-ui-store-presenter-mismatch.md) for the complete problem analysis and architectural decisions, including:
- Why agents are the organizing principle (not sessions)
- Why new presenters coexist with old ones (not wrap/translate)
- The ownership model: agents own their data, agentPresenter owns the registry
- The "build new, grow forward" strategy

## Goals

1. **Agent interface protocol** — define the unified contract all agents implement
2. **agentPresenter** — router, thin session registry, event relay
3. **deepchatAgentPresenter** — single-turn chat: message → LLM → streamed response → persist
4. **projectPresenter** — thin project directory CRUD
5. **New DB tables** — `new_sessions`, `new_projects`, `deepchat_sessions`, `deepchat_messages`
6. **New renderer stores** — sessionStore, messageStore, agentStore, projectStore, draftStore
7. **NewThreadPage integration** — create session and see streamed response through new architecture

## Non-Goals (deferred to later versions)

- Multi-turn conversation context assembly (v1)
- Tool calling / MCP integration (v2)
- Permission and question flows (v3)
- ACP agent support (v5)
- Migration / backfill from old tables (separate task)
- Modifying or removing any old presenter or old UI code
- i18n for new components (follow-up)

## Scope Boundary

### New files to create

**Main process:**
- `src/shared/types/agent-interface.d.ts` — agent interface protocol
- `src/shared/types/chat-types.d.ts` — Agent, Session, Project, CreateSessionInput, ChatMessage, MessageBlock types
- `src/main/presenter/newAgentPresenter/index.ts` — agentPresenter (router)
- `src/main/presenter/newAgentPresenter/sessionManager.ts` — thin session registry
- `src/main/presenter/newAgentPresenter/messageManager.ts` — message proxy
- `src/main/presenter/newAgentPresenter/agentRegistry.ts` — agent discovery + routing
- `src/main/presenter/deepchatAgentPresenter/index.ts` — deepchat agent implementation
- `src/main/presenter/deepchatAgentPresenter/sessionStore.ts` — agent-owned session persistence
- `src/main/presenter/deepchatAgentPresenter/messageStore.ts` — agent-owned message persistence
- `src/main/presenter/deepchatAgentPresenter/streamHandler.ts` — LLM stream → message persistence + event emission
- `src/main/presenter/projectPresenter/index.ts` — project CRUD
- `src/main/presenter/sqlitePresenter/tables/` — new table definitions
- `src/main/events.ts` — add SESSION_EVENTS

**Renderer:**
- `src/renderer/src/stores/ui/session.ts` — rewrite
- `src/renderer/src/stores/ui/message.ts` — new
- `src/renderer/src/stores/ui/agent.ts` — rewrite
- `src/renderer/src/stores/ui/project.ts` — rewrite
- `src/renderer/src/stores/ui/draft.ts` — new

### Existing files to modify

- `src/shared/types/presenters/legacy.presenters.d.ts` — add to IPresenter interface
- `src/main/presenter/index.ts` — register new presenters (3 touchpoints)
- `src/renderer/src/pages/NewThreadPage.vue` — wire to new stores
- `src/renderer/src/events.ts` — add SESSION_EVENTS mirror

### Explicitly NOT modified

- All old presenters (sessionPresenter, old agentPresenter, threadPresenter)
- Old DB tables (conversations, messages)
- Legacy chatStore (`stores/chat.ts`)
- Old UI components that use legacy stores (ChatPage stays on old stores for now)
- LLM provider implementations (reused as-is)
- mcpPresenter (reused as-is, wired in v2)

## Acceptance Criteria

### Functional Requirements

- [ ] Agent interface protocol defined as TypeScript types in `src/shared/types/`
- [ ] agentPresenter registered in Presenter class, accessible via `usePresenter('newAgentPresenter')`
- [ ] agentPresenter.sessionManager creates session records in new `new_sessions` table
- [ ] agentPresenter.agentRegistry returns `[{ id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true }]`
- [ ] agentPresenter routes `sendMessage()` to deepchatAgentPresenter based on session's agentId
- [ ] deepchatAgentPresenter calls LLM provider's `coreStream()` and receives `LLMCoreStreamEvent` stream
- [ ] deepchatAgentPresenter persists user message and assistant message in `deepchat_messages` table with structured JSON content
- [ ] deepchatAgentPresenter emits stream events (response/end/error) via EventBus with `conversationId` for routing
- [ ] agentPresenter relays all stream events to renderer
- [ ] Stream events batched: 120ms flush to renderer, 600ms flush to DB
- [ ] On app restart, any messages with `status = 'pending'` are marked as `'error'` (crash recovery)
- [ ] projectPresenter reads/writes `new_projects` table
- [ ] NewThreadPage creates a session and displays streamed response through new architecture
- [ ] sessionStore displays session list in sidebar from new `new_sessions` table
- [ ] messageStore displays messages from new `deepchat_messages` table
- [ ] Old UI continues to work via old presenters — zero regression

### Non-Functional Requirements

- [ ] New tables created alongside old tables in same chat.db (no separate DB file)
- [ ] All new types in `src/shared/types/` — no type definitions in presenter files
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run lint` passes
- [ ] `pnpm run format` passes
- [ ] Unit tests for agentPresenter routing, deepchatAgentPresenter stream handling, sessionManager CRUD

## Constraints

- LLM provider HTTP clients are reused directly — deepchatAgentPresenter calls `BaseLLMProvider.coreStream()` and consumes the `AsyncGenerator<LLMCoreStreamEvent>`
- New tables live in the same SQLite database (`chat.db`) alongside old tables — no separate DB file
- IPC routing is dynamic (`presenter[name]`) — no route registration needed beyond the 3 touchpoints
- v0 sends a single user message and gets a single assistant response — no multi-turn context, no tool use
- Sessions use default model config from `configPresenter` — no per-session config overrides (by design, not deferred)

## Data Model (v0 subset)

### Agent

- `id: string` — `'deepchat'` (only agent in v0)
- `name: string` — `'DeepChat'`
- `type: 'deepchat' | 'acp'` — `'deepchat'`
- `enabled: boolean` — `true`

### Session (UI-facing)

- `id: string`
- `title: string`
- `status: 'idle' | 'generating' | 'error'` — (`'waiting'` deferred to v3)
- `agentId: string`
- `projectDir: string | null`
- `providerId: string`
- `modelId: string`
- `isPinned: boolean`
- `createdAt: number`
- `updatedAt: number`

### CreateSessionInput

- `agentId: string`
- `message: string`
- `projectDir?: string`
- `providerId?: string`
- `modelId?: string`

### Message (UI-facing, v0 subset)

- `id: string`
- `sessionId: string`
- `orderSeq: number` — monotonic ordering within a session
- `role: 'user' | 'assistant'`
- `content: string` — JSON string in DB. For user: serialized `UserMessageContent`. For assistant: serialized `AssistantMessageBlock[]`
- `status: 'pending' | 'sent' | 'error'` — `pending` = generation in progress, `sent` = complete, `error` = failed or crash recovery
- `metadata: string` — JSON string for token usage, timing, model info
- `createdAt: number`
- `updatedAt: number`

### UserMessageContent (stored as JSON)

- `text: string` — the user's input text
- `files: MessageFile[]` — attached files (empty in v0)
- `links: string[]` — attached links (empty in v0)
- `search: boolean` — whether web search was requested
- `think: boolean` — whether thinking/reasoning was requested

### AssistantMessageBlock (stored as JSON array)

Each block has a `type` discriminator. v0 uses these block types:

- `content` — text content from LLM response. Fields: `type`, `content`, `status`, `timestamp`
- `reasoning_content` — thinking/reasoning output. Fields: `type`, `content`, `status`, `timestamp`, `reasoning_time`
- `error` — error information. Fields: `type`, `content`, `status`, `timestamp`

Additional block types added in later versions: `tool_call` (v2), `search` (v2), `action` (v2), `image` (v2)

### MESSAGE_METADATA (stored in metadata JSON field)

- `totalTokens: number`
- `inputTokens: number`
- `outputTokens: number`
- `generationTime: number`
- `firstTokenTime: number`
- `tokensPerSecond: number`
- `model?: string`
- `provider?: string`

### Project

- `path: string`
- `name: string`
- `icon: string | null` — base64 icon data
- `lastAccessedAt: number`

## Event System (v0 subset)

### SESSION_EVENTS (emitted by agentPresenter)

- `session:list-updated` — session list changed
- `session:activated` — `{ webContentsId, sessionId }`
- `session:deactivated` — `{ webContentsId }`
- `session:status-changed` — `{ sessionId, status }`

### STREAM_EVENTS (relayed from agents, unchanged format)

- `stream:response` — streaming chunk, carries `LLMAgentEventData` with `conversationId` and `eventId` for routing
- `stream:end` — streaming complete, carries `{ conversationId }`
- `stream:error` — streaming failed, carries `{ conversationId, error }`

## Open Questions

None. All architectural decisions resolved in the mismatch analysis document.
