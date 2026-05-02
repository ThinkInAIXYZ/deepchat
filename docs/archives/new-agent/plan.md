# New Agent Architecture v0 — Implementation Plan

> Archive note: This document is a historical record. File paths and implementation names can reference code that has since moved or been removed.


## 1. Current Implementation Baseline

### 1.1 LLM Provider (reuse as-is)

- `src/main/presenter/llmProviderPresenter/baseProvider.ts` — `BaseLLMProvider` with `coreStream()` returning `AsyncGenerator<LLMCoreStreamEvent>`
- `src/shared/types/core/llm-events.ts` — `LLMCoreStreamEvent` discriminated union (text, reasoning, tool_call_start, error, usage, stop, etc.)
- Provider instances managed by `LLMProviderPresenter.getProviderInstance(providerId)`

### 1.2 Event System (extend, not replace)

- `src/main/eventbus.ts` — `EventBus` singleton with `sendToRenderer(event, target, payload)`
- `src/main/events.ts` — existing event constants (CONVERSATION_EVENTS, STREAM_EVENTS)
- `src/renderer/src/events.ts` — renderer-side event constant mirrors

### 1.3 Presenter Registration

- `src/main/presenter/index.ts` — singleton `Presenter` class, IPC handler at line ~358 does `presenter[name as keyof Presenter]`
- `src/shared/types/presenters/legacy.presenters.d.ts` — `IPresenter` interface
- `src/renderer/api/legacy/presenters.ts` — proxy-based IPC caller

### 1.4 SQLite

- `src/main/presenter/sqlitePresenter/index.ts` — shared SQLite instance
- `src/main/presenter/sqlitePresenter/tables/` — table definitions with migration support
- Migration pattern: each table file exports `createTable()` + `migrations` array

### 1.5 Config

- `src/main/presenter/configPresenter/index.ts` — `getSetting()`, `getEnabledProviders()`, model defaults
- Default provider/model resolved via `configPresenter.getSetting('DEFAULT_PROVIDER_ID')` and `configPresenter.getSetting('DEFAULT_MODEL_ID')`

## 2. Design Decisions

### 2.1 Naming: `agentSessionPresenter` not `agentPresenter`

The old `agentPresenter` still exists and must keep working. The new one is registered as `agentSessionPresenter` in IPresenter to avoid name collision. Renderer calls `useLegacyPresenter('agentSessionPresenter')`. When old UI is removed, rename to `agentPresenter`.

### 2.2 Database: new tables in same chat.db

No separate DB file. New tables coexist with old tables in `chat.db`:
- `new_sessions` — agentPresenter's thin session registry
- `new_projects` — project directory history
- `deepchat_sessions` — agentRuntimePresenter's session config
- `deepchat_messages` — agentRuntimePresenter's messages

Prefix `new_` on `sessions` and `projects` to avoid any conflict with potential future SQLite reserved words or collisions.

### 2.3 Stream handling: reuse LLMCoreStreamEvent, transform to LLMAgentEventData

agentRuntimePresenter consumes `LLMCoreStreamEvent` from `coreStream()` and:
1. Accumulates content into `AssistantMessageBlock[]` structure
2. Persists structured JSON content to `deepchat_messages` (batched DB writes every 600ms)
3. Transforms to `LLMAgentEventData` format with `conversationId` + `eventId` for routing
4. Emits via EventBus (batched renderer flush every 120ms) — agentPresenter relays to renderer

This means the renderer's stream handling code receives the same event format. Same `LLMAgentEventData` structure.

### 2.4 v0 message content: structured JSON from the start

Even in v0, messages use structured JSON content — not plain text. This avoids a migration when adding tool calls and thinking in later versions.

**User messages** are stored as serialized `UserMessageContent`:
```
{ text: "user input", files: [], links: [], search: false, think: false }
```

**Assistant messages** are stored as serialized `AssistantMessageBlock[]`:
```
[{ type: "content", content: "LLM response text", status: "success", timestamp: 1234567890 }]
```

v0 only produces `content` and `reasoning_content` block types. Later versions add `tool_call`, `search`, `error`, etc.

### 2.5 v0 message assembly: single user message, no context

v0 sends exactly one message to the LLM:

```
messages = [
  { role: 'user', content: input.message }
]
```

No system prompt, no conversation history, no tool definitions. Just raw user message → LLM → streamed response. Multi-turn context assembly is v1.

### 2.6 v0 model resolution

Use the global default provider/model from configPresenter unless CreateSessionInput specifies overrides:

1. `input.providerId ?? configPresenter.getSetting('DEFAULT_PROVIDER_ID')`
2. `input.modelId ?? configPresenter.getSetting('DEFAULT_MODEL_ID')`

Per-session model config (temperature, system prompt, etc.) is not planned. Sessions use provider/model defaults from configPresenter.

### 2.7 Message status lifecycle

Messages use a three-state lifecycle: `pending` → `sent` | `error`

- `pending` — message is being generated (stream in progress)
- `sent` — generation completed successfully
- `error` — generation failed or app crashed during generation

**Crash recovery**: On app startup, any `deepchat_messages` rows with `status = 'pending'` are updated to `status = 'error'`. This handles the case where the app was killed during streaming.

### 2.8 Stream batching

Two independent batching intervals to balance responsiveness and write pressure:

- **Renderer flush**: every 120ms — accumulate stream deltas and flush to renderer via EventBus
- **DB flush**: every 600ms — batch-write accumulated content to `deepchat_messages` table

On stream end, both flush immediately with final content.

## 3. Architecture: Module Breakdown

### 3.1 Shared Types (`src/shared/types/`)

**`agent-interface.d.ts`** — the protocol every agent implements:

- `IAgentImplementation` interface with: `initSession`, `destroySession`, `getSessionState`, `processMessage`, `cancelGeneration`, `getMessages`, `getMessageIds`, `getMessage`
- v0 subset only — permissions, retry, edit added in later versions

**`chat-types.d.ts`** — data model types:

- `Agent`, `Session`, `SessionStatus`, `CreateSessionInput`, `ChatMessage`, `UserMessageContent`, `AssistantMessageBlock`, `MessageMetadata`, `Project`

**`presenters/agent-session.presenter.d.ts`** — IPC-facing interface:

- `IAgentSessionPresenter` — what the renderer can call: `createSession`, `sendMessage`, `getSessionList`, `getSession`, `getMessages`, `getMessageIds`, `getMessage`, `activateSession`, `deactivateSession`, `getActiveSession`, `getAgents`, `deleteSession`

**`presenters/project.presenter.d.ts`** — IPC-facing interface:

- `IProjectPresenter` — `getProjects`, `getRecentProjects`, `selectDirectory`

### 3.2 New DB Tables (`src/main/presenter/sqlitePresenter/tables/`)

**`newSessions.ts`** — thin session registry

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| agent_id | TEXT NOT NULL | `'deepchat'` for v0 |
| title | TEXT NOT NULL | |
| project_dir | TEXT | nullable |
| is_pinned | INTEGER DEFAULT 0 | |
| created_at | INTEGER NOT NULL | epoch ms |
| updated_at | INTEGER NOT NULL | epoch ms |

**`newProjects.ts`** — project directory history

| Column | Type | Notes |
|--------|------|-------|
| path | TEXT PRIMARY KEY | filesystem path |
| name | TEXT NOT NULL | directory basename |
| icon | TEXT DEFAULT NULL | base64 icon data |
| last_accessed_at | INTEGER NOT NULL | epoch ms |

**`deepchatSessions.ts`** — deepchat agent session config

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | same ID as new_sessions |
| provider_id | TEXT NOT NULL | |
| model_id | TEXT NOT NULL | |

**`deepchatMessages.ts`** — deepchat agent messages

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| session_id | TEXT NOT NULL | FK to new_sessions |
| order_seq | INTEGER NOT NULL | monotonic ordering within session |
| role | TEXT NOT NULL | `'user'` or `'assistant'` |
| content | TEXT NOT NULL | JSON string: `UserMessageContent` or `AssistantMessageBlock[]` |
| status | TEXT DEFAULT 'pending' | `'pending'`, `'sent'`, `'error'` |
| is_context_edge | INTEGER DEFAULT 0 | marks context window boundary (unused in v0) |
| metadata | TEXT DEFAULT '{}' | JSON string: token usage, timing, model info |
| created_at | INTEGER NOT NULL | epoch ms |
| updated_at | INTEGER NOT NULL | epoch ms |

Index: `CREATE INDEX idx_deepchat_messages_session ON deepchat_messages(session_id, order_seq)`

### 3.3 agentPresenter (`src/main/presenter/agentSessionPresenter/`)

**`index.ts`** — main presenter class implementing `IAgentSessionPresenter`

Owns:
- `sessionManager` — thin CRUD over `new_sessions` table
- `messageManager` — proxy that resolves agentId then delegates to agent
- `agentRegistry` — `Map<string, IAgentImplementation>`, populated in constructor with agentRuntimePresenter

Methods (IPC-facing):
- `createSession(input, webContentsId)` → sessionManager.create() + agent.initSession() + agent.processMessage() + emit ACTIVATED
- `sendMessage(sessionId, content)` → resolve agent → agent.processMessage()
- `getSessionList(params)` → sessionManager.list() + enrich with agent.getSessionState()
- `getSession(sessionId)` → sessionManager.get() + agent.getSessionState()
- `getMessages(sessionId)` → resolve agent → agent.getMessages()
- `getMessageIds(sessionId)` → resolve agent → agent.getMessageIds()
- `getMessage(messageId)` → resolve agent → agent.getMessage() (needs sessionId lookup)
- `activateSession(webContentsId, sessionId)` → update window binding + emit ACTIVATED
- `deactivateSession(webContentsId)` → clear window binding + emit DEACTIVATED
- `getActiveSession(webContentsId)` → return bound session
- `getAgents()` → agentRegistry.getAll()
- `deleteSession(sessionId)` → agent.destroySession() + sessionManager.delete()

Event relay:
- Listen to agent events (callback or EventEmitter pattern)
- Re-emit as SESSION_EVENTS / STREAM_EVENTS via EventBus to renderer
- All STREAM_EVENTS carry `conversationId` for renderer routing

**`sessionManager.ts`** — thin session registry

- `create(id, agentId, title, projectDir)` → INSERT into `new_sessions`
- `get(id)` → SELECT from `new_sessions`, returns thin record
- `list(filters)` → SELECT with optional WHERE agent_id / project_dir, ORDER BY updated_at DESC
- `update(id, fields)` → UPDATE `new_sessions`
- `delete(id)` → DELETE from `new_sessions`
- Window bindings: in-memory `Map<number, string | null>` for webContentsId → sessionId

**`messageManager.ts`** — proxy

- `getMessages(sessionId)` → resolve agentId from sessionManager → agentRegistry.get(agentId).getMessages(sessionId)
- Same pattern for `getMessageIds`, `getMessage`

**`agentRegistry.ts`** — agent discovery

- `register(agentId, implementation)` — called in constructor
- `resolve(agentId)` → returns `IAgentImplementation` or throws
- `getAll()` → returns `Agent[]` list (for v0: just deepchat)

### 3.4 agentRuntimePresenter (`src/main/presenter/agentRuntimePresenter/`)

**`index.ts`** — implements `IAgentImplementation`

Constructor receives: `llmProviderPresenter`, `configPresenter`, `sqlitePresenter`

Initialization:
- Run crash recovery: `UPDATE deepchat_messages SET status = 'error' WHERE status = 'pending'`

State: in-memory `Map<string, DeepChatSessionState>` for runtime status

Methods:
- `initSession(sessionId, config)` → INSERT into `deepchat_sessions`, set runtime status to `'idle'`
- `destroySession(sessionId)` → DELETE from `deepchat_sessions` + `deepchat_messages`, remove from in-memory map
- `getSessionState(sessionId)` → return `{ status, providerId, modelId }` from in-memory + DB
- `processMessage(sessionId, content)` → persist user message (status `'sent'`) → create assistant message (status `'pending'`) → call LLM → stream with batching → finalize assistant message (status `'sent'`) → emit events
- `cancelGeneration(sessionId)` → abort stream (v0: basic abort signal support)
- `getMessages(sessionId)` → SELECT from `deepchat_messages` WHERE session_id ORDER BY order_seq
- `getMessageIds(sessionId)` → SELECT id from `deepchat_messages` WHERE session_id ORDER BY order_seq
- `getMessage(messageId)` → SELECT from `deepchat_messages` WHERE id

**`streamHandler.ts`** — LLM stream consumer

Responsibility: consume `AsyncGenerator<LLMCoreStreamEvent>`, build structured `AssistantMessageBlock[]` content, persist with batching, emit events.

Flow:
1. Get provider instance via `llmProviderPresenter.getProviderInstance(providerId)`
2. Build messages array (v0: just the user message as plain text)
3. Call `provider.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools=[])`
4. Iterate the async generator, accumulating into `AssistantMessageBlock[]`:
   - On `text` event → append to current `content` block, queue renderer flush
   - On `reasoning` event → append to current `reasoning_content` block, queue renderer flush
   - On `usage` event → store in metadata
   - On `stop` event → finalize all blocks, flush DB, set message status to `'sent'`, emit `stream:end`
   - On `error` event → add `error` block, set message status to `'error'`, emit `stream:error`
5. Renderer batching: flush accumulated deltas every 120ms as `stream:response` with `LLMAgentEventData` (includes `conversationId`, `eventId`)
6. DB batching: write accumulated content JSON to `deepchat_messages` every 600ms
7. On stream end or error, flush both immediately

**`sessionStore.ts`** — deepchat session persistence

- CRUD over `deepchat_sessions` table (columns: id, provider_id, model_id)

**`messageStore.ts`** — deepchat message persistence

- CRUD over `deepchat_messages` table
- `createUserMessage(sessionId, orderSeq, content)` → INSERT with role='user', status='sent', content=JSON string of `UserMessageContent`
- `createAssistantMessage(sessionId, orderSeq)` → INSERT with role='assistant', status='pending', content='[]'
- `updateAssistantContent(messageId, contentJson)` → UPDATE content (batched)
- `finalizeAssistantMessage(messageId, contentJson, metadataJson)` → UPDATE content, status='sent', metadata
- `setMessageError(messageId, errorJson)` → UPDATE status='error', content with error block appended
- `recoverPendingMessages()` → UPDATE status='error' WHERE status='pending' (called on startup)
- `getNextOrderSeq(sessionId)` → SELECT MAX(order_seq) + 1

### 3.5 projectPresenter (`src/main/presenter/projectPresenter/`)

**`index.ts`** — implements `IProjectPresenter`

Constructor receives: `sqlitePresenter`, `devicePresenter`

Methods:
- `getProjects()` → SELECT * FROM new_projects ORDER BY last_accessed_at DESC
- `getRecentProjects(limit)` → SELECT * FROM new_projects ORDER BY last_accessed_at DESC LIMIT ?
- `selectDirectory()` → `devicePresenter.selectDirectory()`, if selected upsert into new_projects, return path

### 3.6 Presenter Registration (`src/main/presenter/index.ts`)

3 touchpoints:

1. Import and add to IPresenter: `agentSessionPresenter: IAgentSessionPresenter`, `projectPresenter: IProjectPresenter`
2. Add class properties
3. Instantiate in constructor:
   - `this.agentRuntimePresenter = new AgentRuntimePresenter(this.llmProviderPresenter, this.configPresenter, this.sqlitePresenter)`
   - `this.agentSessionPresenter = new AgentSessionPresenter(this.agentRuntimePresenter, this.configPresenter, this.sqlitePresenter, this.eventBus)`
   - `this.projectPresenter = new ProjectPresenter(this.sqlitePresenter, this.devicePresenter)`

Note: `agentRuntimePresenter` is NOT exposed on IPresenter — it's internal. Only `agentSessionPresenter` and `projectPresenter` are IPC-accessible.

### 3.7 Events (`src/main/events.ts`)

Add:

```
SESSION_EVENTS = {
  LIST_UPDATED: 'session:list-updated',
  ACTIVATED: 'session:activated',
  DEACTIVATED: 'session:deactivated',
  STATUS_CHANGED: 'session:status-changed',
}
```

STREAM_EVENTS reused as-is — same event names, same payload format. All stream events include `conversationId` for renderer-side routing.

### 3.8 Renderer Stores (`src/renderer/src/stores/ui/`)

**`session.ts`** — rewrite

- Uses `useLegacyPresenter('agentSessionPresenter')`
- State: `sessions: Session[]`, `activeSessionId`, `groupMode`
- Actions: `fetchSessions()`, `createSession(input)`, `selectSession(id)`, `closeSession()`
- Listens to: `SESSION_EVENTS.LIST_UPDATED`, `SESSION_EVENTS.ACTIVATED`, `SESSION_EVENTS.DEACTIVATED`, `SESSION_EVENTS.STATUS_CHANGED`

**`message.ts`** — new

- Uses `useLegacyPresenter('agentSessionPresenter')`
- State: `messageIds: string[]`, `messageCache: Map<string, ChatMessage>`, `isStreaming: boolean`, `streamingBlocks: AssistantMessageBlock[]`
- Actions: `loadMessages(sessionId)`, `getMessage(id)`
- Listens to: `STREAM_EVENTS.RESPONSE` (update streaming blocks from `LLMAgentEventData`), `STREAM_EVENTS.END` (finalize), `STREAM_EVENTS.ERROR`
- Filters events by `conversationId` matching active session

**`agent.ts`** — rewrite

- Uses `useLegacyPresenter('agentSessionPresenter')`
- State: `agents: Agent[]`, `selectedAgentId`
- Actions: `fetchAgents()`, `selectAgent(id)`

**`project.ts`** — rewrite

- Uses `useLegacyPresenter('projectPresenter')`
- State: `projects: Project[]`, `selectedProjectPath`
- Actions: `fetchProjects()`, `selectProject(path)`, `openFolderPicker()`

**`draft.ts`** — new

- State: `providerId`, `modelId`, `projectDir`, `agentId`, `reasoningEffort`
- Actions: `toCreateInput(message)` → `CreateSessionInput`, `reset()`

### 3.9 NewThreadPage Integration

- Imports `useSessionStore`, `useDraftStore`, `useMessageStore`
- On submit: `draftStore.toCreateInput(text)` → `sessionStore.createSession(input)`
- Session ACTIVATED event triggers message loading
- messageStore receives STREAM_EVENTS, filters by `conversationId`, and displays streaming blocks

## 4. Test Strategy

### 4.1 Unit Tests

**agentPresenter:**
- `sessionManager.create/get/list/update/delete` — CRUD against in-memory SQLite
- `agentRegistry.register/resolve/getAll` — correct routing
- `createSession` → calls sessionManager.create + agent.initSession + agent.processMessage

**agentRuntimePresenter:**
- `processMessage` → creates user message (JSON content), calls LLM, creates assistant message (JSON blocks)
- `streamHandler` — given mock `AsyncGenerator<LLMCoreStreamEvent>`, verify: block accumulation, batched DB writes at 600ms, renderer flush at 120ms, final flush on stop
- `messageStore` — CRUD operations against in-memory SQLite, verify JSON content round-trip
- `messageStore.recoverPendingMessages()` — pending rows updated to error
- `messageStore.getNextOrderSeq()` — correct sequence calculation

**projectPresenter:**
- `getRecentProjects` — returns correct order and limit
- `selectDirectory` — upserts on new selection

### 4.2 Integration Tests

- End-to-end: `agentSessionPresenter.createSession()` → verify new_sessions row + deepchat_sessions row + deepchat_messages rows (with valid JSON content) + events emitted with conversationId
- Coexistence: old `sessionPresenter.createSession()` still works — old tables unaffected
- Crash recovery: insert pending message, reinitialize presenter, verify status changed to error

## 5. Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM provider internal API changes | Cannot call `coreStream()` directly | Check `BaseLLMProvider` is stable; if not, use `llmProviderPresenter` public method |
| Stream event format mismatch | Renderer can't display response | Reuse exact `LLMAgentEventData` format — same as old agentPresenter emits |
| DB migration conflicts with old tables | Data corruption | New tables use distinct names (`new_sessions`, `deepchat_*`) — zero overlap |
| Performance of batched message writes | Streaming feels laggy | DB flush every 600ms, renderer flush every 120ms — matches old `StreamUpdateScheduler` intervals |
| JSON content parsing errors | Messages unreadable | Validate JSON on write, wrap parse in try/catch on read, store raw text as fallback error block |

## 6. Quality Gate

- [ ] `pnpm run format`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] Unit tests pass for all new modules
- [ ] Integration test: create session + stream response end-to-end
- [ ] Old UI regression: `sessionPresenter.getSessionList()` returns same results as before

