# Event Payload Specification - Agentic Unified Layer

## Document Purpose

This document specifies the unified `AgenticEventType` payload structure for all agent types (DeepChat and ACP), including ACP-specific data like commands, modes, and models.

**Status**: Complete Specification
**Date**: 2026-01-25
**Related**: Proposition 2 from `renderer-analysis-research.md`

---

## Part I: Current Event System Analysis

### 1.1 STREAM_EVENTS (DeepChat)

Located in `src/main/events.ts`:

```typescript
export const STREAM_EVENTS = {
  RESPONSE: 'stream:response', // Content delta, tool calls, reasoning, images
  END: 'stream:end',           // Message generation ended
  ERROR: 'stream:error'        // Error during generation
}
```

**RESPONSE Event Payload Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | `string` | Message ID (used as messageId in AgenticEventType) |
| `content` | `string` | Content delta text |
| `stream_kind` | `string` | Stream type ('final' when complete) |
| `tool_call` | `'start' \| 'running' \| 'end'` | Explicit tool state (new format) |
| `tool_call_id` | `string` | Tool call ID |
| `tool_call_name` | `string` | Tool name |
| `tool_call_params` | `string` (JSON) | Tool parameters |
| `tool_call_response` | `string` | Tool response text |
| `tool_call_response_raw` | `unknown` | Raw tool response data |
| `reasoning_time` | `number` | Reasoning duration in ms |
| `reasoning_content` | `string` | Reasoning content |
| `image_data` | `string` | Base64 image data |

**Key Patterns:**
- Single event type (`RESPONSE`) for multiple purposes (content, tools, reasoning, images)
- Discriminator fields (`tool_call`, `reasoning_time`, `image_data`) determine event meaning
- Backward compatibility maintained for older payload formats

**Normalization:**
`agentPresenter/normalizer.ts` maps `STREAM_EVENTS` to `AgenticEventType`:
- `tool_call: 'start'` → `AgenticEventType.TOOL_START`
- `tool_call: 'running'` → `AgenticEventType.TOOL_RUNNING`
- `tool_call: 'end'` → `AgenticEventType.TOOL_END`
- Content delta → `AgenticEventType.MESSAGE_DELTA`
- `stream:response` end → `AgenticEventType.MESSAGE_END`
- `stream:error` → `AgenticEventType.ERROR`

---

### 1.2 ACP_WORKSPACE_EVENTS (ACP-specific)

Located in `src/main/presenter/acpPresenter/events.ts`:

```typescript
export const ACP_WORKSPACE_EVENTS = {
  SESSION_MODES_READY: 'acp-workspace:session-modes-ready',
  SESSION_MODELS_READY: 'acp-workspace:session-models-ready',
  COMMANDS_UPDATE: 'acp-workspace:commands-update'
}
```

**SESSION_MODES_READY Payload:**

```typescript
{
  conversationId?: string  // Maps to sessionId
  agentId?: string
  workdir?: string
  current: string          // Current mode ID
  available: Array<{
    id: string
    name: string
    description: string
  }>
}
```

**SESSION_MODELS_READY Payload:**

```typescript
{
  conversationId?: string  // Maps to sessionId
  agentId?: string
  workdir?: string
  current: string          // Current model ID
  available: Array<{
    id: string
    name: string
    description?: string
  }>
}
```

**COMMANDS_UPDATE Payload:**

```typescript
{
  conversationId?: string  // Maps to sessionId
  agentId?: string
  commands: Array<{
    name: string
    description?: string
    input?: { hint: string } | null
  }>
}
```

**Current Usage in Renderer:**
- `useAcpEventsAdapter.ts` - Event subscription adapter
- `useAcpMode.ts` - Loads modes via IPC + listens to event
- `useAcpSessionModel.ts` - Loads models via IPC + listens to event
- `useAcpCommands.ts` - Only listens to event (no IPC query)

**Key Observation:**
Modes, models, and commands are **dynamic** - they can update during agent execution. The current architecture uses both:
1. IPC queries for initial load
2. Event subscriptions for updates

---

### 1.3 ACP_EVENTS (Core ACP)

Located in `src/main/presenter/acpPresenter/events.ts`:

```typescript
export const ACP_EVENTS = {
  // Session lifecycle
  SESSION_CREATED: 'acp:session-created',
  SESSION_LOADED: 'acp:session-loaded',
  SESSION_CLOSED: 'acp:session-closed',

  // Message flow
  PROMPT_STARTED: 'acp:prompt-started',
  SESSION_UPDATE: 'acp:session-update',    // Agent returned content
  PROMPT_COMPLETED: 'acp:prompt-completed',
  PROMPT_CANCELLED: 'acp:prompt-cancelled',

  // Mode/Model changes
  MODE_CHANGED: 'acp:mode-changed',
  MODEL_CHANGED: 'acp:model-changed',
  COMMANDS_UPDATE: 'acp:commands-update',

  // Process management
  PROCESS_STARTED: 'acp:process-started',
  PROCESS_READY: 'acp:process-ready',

  // Errors
  ERROR: 'acp:error'
}
```

**SESSION_UPDATE Payload:**

```typescript
{
  sessionId: string
  notification: SessionNotification  // From ACP SDK
}
```

`SessionNotification` has a nested structure:
- `notification.update` - Union type with different update kinds
- `notification.update.content` - Text content
- `notification.update.sessionUpdate` - Completion status ('complete')

**Normalization:**
`acpPresenter/normalizer.ts` maps `ACP_EVENTS.SESSION_UPDATE` to:
- Content delta → `AgenticEventType.MESSAGE_DELTA`
- Complete status → `isComplete: true` in delta

---

### 1.4 Current AgenticEventType

Located in `src/shared/types/presenters/agentic.presenter.d.ts`:

```typescript
export enum AgenticEventType {
  // Session lifecycle
  SESSION_CREATED = 'agentic.session.created',
  SESSION_READY = 'agentic.session.ready',
  SESSION_UPDATED = 'agentic.session.updated',
  SESSION_CLOSED = 'agentic.session.closed',

  // Message flow
  MESSAGE_DELTA = 'agentic.message.delta',
  MESSAGE_BLOCK = 'agentic.message.block',
  MESSAGE_END = 'agentic.message.end',

  // Tool calls
  TOOL_START = 'agentic.tool.start',
  TOOL_RUNNING = 'agentic.tool.running',
  TOOL_END = 'agentic.tool.end',
  TOOL_PERMISSION_REQUIRED = 'agentic.tool.permission-required',
  TOOL_PERMISSION_GRANTED = 'agentic.tool.permission-granted',
  TOOL_PERMISSION_DENIED = 'agentic.tool.permission-denied',

  // Status
  STATUS_CHANGED = 'agentic.status.changed',
  ERROR = 'agentic.error'
}
```

**Current SessionInfo:**

```typescript
export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

  // Modes and models (already defined)
  availableModes?: Array<{ id: string; name: string; description: string }>
  availableModels?: Array<{ id: string; name: string; description?: string }>

  currentModeId?: string
  currentModelId?: string

  // Capability declarations
  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
  }
}
```

---

## Part II: Research Questions Analysis

### Question 1: How to represent ACP commands in SessionInfo?

**Current State:**
- ACP agents expose commands (available tools/actions) that update during execution
- Commands have: `name`, `description`, optional `input.hint`
- Commands are agent-specific (not applicable to DeepChat)

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| **A: Include in SessionInfo** | Simple, consistent with modes/models | SessionInfo becomes large |
| **B: Separate entity** | Cleaner separation | More complex state management |
| **C: In capabilities** | Logical grouping | capabilities is for booleans, not lists |

**Decision: Option A** - Include `availableCommands` in `SessionInfo`

**Rationale:**
1. Consistent with existing `availableModes` and `availableModels` pattern
2. Commands are session-scoped (like modes and models for ACP)
3. Simple to update via `SESSION_UPDATED` event
4. DeepChat can return `undefined` (optional field)

---

### Question 2: Should modes/models/commands be separate events?

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| **A: Separate events** | Clear intent, can filter | Event listener fragmentation |
| **B: Use SESSION_UPDATED** | Single event for all session changes | Payload parsing required |

**Decision: Option B** - Use `SESSION_UPDATED` for all session metadata changes

**Rationale:**
1. `SESSION_UPDATED` already exists with `Partial<SessionInfo>` payload
2. Modes, models, and commands are **session metadata**, not separate concerns
3. Single event listener for all session changes
4. Payload is strongly typed (`SessionInfo` interface)

**Implementation Pattern:**
```typescript
// Modes updated
emitter.sessionUpdated({ availableModes: [...], currentModeId: '...' })

// Models updated
emitter.sessionUpdated({ availableModels: [...], currentModelId: '...' })

// Commands updated
emitter.sessionUpdated({ availableCommands: [...] })
```

---

### Question 3: How does renderer distinguish update types?

**Answer:** Examine the `SessionUpdatedEvent.payload` keys

```typescript
// Renderer event handler
const handleSessionUpdated = (event: SessionUpdatedEvent) => {
  const { sessionId, sessionInfo } = event

  if (sessionInfo.availableModes) {
    // Modes updated
  }
  if (sessionInfo.availableModels) {
    // Models updated
  }
  if (sessionInfo.availableCommands) {
    // Commands updated
  }
}
```

**Optimization:** Use TypeScript type guards if needed

---

## Part III: Unified Event Payload Specification

### 3.1 Extended SessionInfo

```typescript
export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

  // Workspace (from workspace integration analysis)
  workspace?: string

  // Modes (permission policies)
  availableModes?: Array<{
    id: string
    name: string
    description: string
  }>
  currentModeId?: string

  // Models
  availableModels?: Array<{
    id: string
    name: string
    description?: string
  }>
  currentModelId?: string

  // Commands (ACP-specific, optional for DeepChat)
  availableCommands?: Array<{
    name: string
    description?: string
    inputHint?: string  // Flattened from input.hint
  }>

  // Capability declarations
  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    supportsCommands?: boolean  // New: true for ACP agents
  }
}
```

**Changes:**
1. Added `workspace?: string`
2. Added `availableCommands?: Command[]`
3. Added `capabilities.supportsCommands?: boolean`
4. Flattened command `input.hint` to `inputHint`

---

### 3.2 SessionUpdatedEvent

**No changes needed** - already uses `Partial<SessionInfo>`:

```typescript
export interface SessionUpdatedEvent {
  sessionId: string
  sessionInfo: Partial<SessionInfo>  // Can include any SessionInfo field
}
```

**Usage Examples:**

```typescript
// Modes updated
eventBus.send('agentic.session.updated', {
  sessionId: 'abc123',
  sessionInfo: {
    availableModes: [
      { id: 'strict', name: 'Strict', description: 'Requires approval' },
      { id: 'balanced', name: 'Balanced', description: 'Auto-approve safe commands' }
    ],
    currentModeId: 'balanced'
  }
})

// Models updated
eventBus.send('agentic.session.updated', {
  sessionId: 'abc123',
  sessionInfo: {
    availableModels: [
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-opus', name: 'Claude 3 Opus' }
    ],
    currentModelId: 'claude-3-5-sonnet'
  }
})

// Commands updated (ACP-specific)
eventBus.send('agentic.session.updated', {
  sessionId: 'abc123',
  sessionInfo: {
    availableCommands: [
      { name: 'run_command', description: 'Execute shell command', inputHint: 'command to run' },
      { name: 'read_file', description: 'Read file contents' }
    ],
    capabilities: {
      supportsVision: false,
      supportsTools: true,
      supportsModes: true,
      supportsCommands: true
    }
  }
})
```

---

### 3.3 Event Mapping Summary

| Current Event | Target AgenticEventType | Payload Transformation |
|---------------|-------------------------|------------------------|
| `STREAM_EVENTS.RESPONSE` | `MESSAGE_DELTA`, `TOOL_START`, `TOOL_RUNNING`, `TOOL_END`, `MESSAGE_BLOCK` | Extract discriminator fields |
| `STREAM_EVENTS.END` | `MESSAGE_END` | Direct mapping |
| `STREAM_EVENTS.ERROR` | `ERROR` | Direct mapping |
| `ACP_EVENTS.SESSION_UPDATE` | `MESSAGE_DELTA` | Extract content from notification.update |
| `ACP_EVENTS.PROMPT_COMPLETED` | `MESSAGE_END` | Direct mapping |
| `ACP_EVENTS.ERROR` | `ERROR` | Direct mapping |
| `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` | `SESSION_UPDATED` | Map to `sessionInfo.availableModes` |
| `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` | `SESSION_UPDATED` | Map to `sessionInfo.availableModels` |
| `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` | `SESSION_UPDATED` | Map to `sessionInfo.availableCommands` |

---

## Part IV: Normalizer Extensions

### 4.1 ACP Normalizer Extensions

**File:** `src/main/presenter/acpPresenter/normalizer.ts`

**Current Implementation:**
```typescript
export function normalizeAndEmit(
  acpEvent: keyof typeof ACP_EVENTS,
  payload: unknown,
  sessionId: string,
  emitter: AgenticEventEmitter
): void {
  switch (acpEvent) {
    case ACP_EVENTS.SESSION_UPDATE:
      normalizeSessionUpdateEventAndEmit(data, emitter)
      break
    case ACP_EVENTS.PROMPT_COMPLETED:
      emitter.messageEnd(sessionId)
      break
    case ACP_EVENTS.ERROR:
      emitter.statusChanged('error', new Error(data.error as string))
      break
    default:
      break  // Other events not yet normalized
  }
}
```

**Required Extension:** Handle `ACP_WORKSPACE_EVENTS` for modes, models, commands

```typescript
// Add to normalizeAndEmit switch statement
case 'acp-workspace:session-modes-ready':
  normalizeSessionModesUpdate(data, emitter)
  break

case 'acp-workspace:session-models-ready':
  normalizeSessionModelsUpdate(data, emitter)
  break

case 'acp-workspace:commands-update':
  normalizeCommandsUpdate(data, emitter)
  break

// Helper functions
function normalizeSessionModesUpdate(
  data: Record<string, unknown>,
  emitter: AgenticEventEmitter
): void {
  const available = data.available as Array<{ id: string; name: string; description: string }>
  const current = data.current as string

  emitter.sessionUpdated({
    availableModes: available,
    currentModeId: current
  })
}

function normalizeSessionModelsUpdate(
  data: Record<string, unknown>,
  emitter: AgenticEventEmitter
): void {
  const available = data.available as Array<{ id: string; name: string; description?: string }>
  const current = data.current as string

  emitter.sessionUpdated({
    availableModels: available,
    currentModelId: current
  })
}

function normalizeCommandsUpdate(
  data: Record<string, unknown>,
  emitter: AgenticEventEmitter
): void {
  const commands = data.commands as Array<{
    name: string
    description?: string
    input?: { hint: string } | null
  }>

  emitter.sessionUpdated({
    availableCommands: commands.map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      inputHint: cmd.input?.hint
    }))
  })
}
```

---

### 4.2 DeepChat Normalizer

**File:** `src/main/presenter/agentPresenter/normalizer.ts`

**No changes needed** - already handles all `STREAM_EVENTS` correctly.

DeepChat agents don't have dynamic modes/models/commands, so no additional normalization required.

---

## Part V: Renderer Integration Impact

### 5.1 Current Renderer Composables

| Composable | Current Event Source | Target Migration |
|------------|---------------------|------------------|
| `useAcpMode.ts` | `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` | `AgenticEventType.SESSION_UPDATED` |
| `useAcpSessionModel.ts` | `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` | `AgenticEventType.SESSION_UPDATED` |
| `useAcpCommands.ts` | `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` | `AgenticEventType.SESSION_UPDATED` |
| `useAcpEventsAdapter.ts` | All ACP events | Can be removed after migration |

### 5.2 Migration Pattern

**Before (Current):**
```typescript
// useAcpMode.ts
const handleModesReady = (payload: {
  conversationId?: string
  agentId?: string
  workdir?: string
  current: string
  available: ModeInfo[]
}) => {
  currentMode.value = payload.current
  availableModes.value = payload.available
}

onMounted(() => {
  unsubscribe = acpEventsAdapter.subscribeSessionModesReady(handleModesReady)
})
```

**After (Unified):**
```typescript
// useAgenticSession.ts (new composable)
const handleSessionUpdated = (event: SessionUpdatedEvent) => {
  if (event.sessionId !== activeSessionId.value) return

  const { availableModes, currentModeId } = event.sessionInfo

  if (availableModes) {
    availableModes.value = availableModes
  }
  if (currentModeId) {
    currentMode.value = currentModeId
  }
}

onMounted(() => {
  unsubscribe = window.electron.ipcRenderer.on(
    'agentic.session.updated',
    handleSessionUpdated
  )
})
```

### 5.3 State Management Consolidation

**Current (Fragmented):**
- `useAcpMode` - Modes state
- `useAcpSessionModel` - Models state
- `useAcpCommands` - Commands state
- `useChatStoreService` - Conversation state

**Target (Unified):**
- `useAgenticSession` - All session state including modes, models, commands

---

## Part VI: Architectural Decisions

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-010 | 2026-01-25 | Include `availableCommands` in SessionInfo | Consistent with modes/models pattern | ✅ Confirmed |
| D-011 | 2026-01-25 | Use `SESSION_UPDATED` for all session metadata | Single event for all session changes | ✅ Confirmed |
| D-012 | 2026-01-25 | Flatten command `input.hint` to `inputHint` | Simpler property structure | ✅ Confirmed |
| D-013 | 2026-01-25 | Add `capabilities.supportsCommands` | Type-safe command capability check | ✅ Confirmed |

---

## Part VII: Open Questions for Discussion

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q-004 | How to handle ACP agents that don't support commands? | ✅ Resolved | Return empty array, `supportsCommands: false` |
| Q-005 | Should commands include schema (beyond description/hint)? | 🟡 Open | May be needed for advanced UI |
| Q-006 | How to handle partial updates (e.g., only modes changed)? | ✅ Resolved | `SESSION_UPDATED` already uses `Partial<SessionInfo>` |

---

## Part VIII: Implementation Checklist

### Phase 1: Type Definitions
- [ ] Extend `SessionInfo` in `agentic.presenter.d.ts`
- [ ] Add `Command` type definition
- [ ] Update `capabilities.supportsCommands`

### Phase 2: Normalizer Updates
- [ ] Extend `acpPresenter/normalizer.ts` for modes/models/commands
- [ ] Add helper functions for ACP workspace event normalization
- [ ] Test normalization with ACP agents

### Phase 3: Event Emission
- [ ] Ensure ACP presenters emit `SESSION_UPDATED` for modes changes
- [ ] Ensure ACP presenters emit `SESSION_UPDATED` for models changes
- [ ] Ensure ACP presenters emit `SESSION_UPDATED` for commands changes
- [ ] Remove `ACP_WORKSPACE_EVENTS` (deprecated)

### Phase 4: Renderer Migration
- [ ] Create `useAgenticSession` composable
- [ ] Migrate `useAcpMode` to use `SESSION_UPDATED`
- [ ] Migrate `useAcpSessionModel` to use `SESSION_UPDATED`
- [ ] Migrate `useAcpCommands` to use `SESSION_UPDATED`
- [ ] Remove `useAcpEventsAdapter.ts` (deprecated)

### Phase 5: Testing
- [ ] Test modes update during ACP session
- [ ] Test models update during ACP session
- [ ] Test commands update during ACP session
- [ ] Test DeepChat sessions (should have no commands)
- [ ] Test event filtering by sessionId

---

## Part IX: References

### Related Documents
- `renderer-analysis-research.md` - Main research document
- `workspace-integration-analysis.md` - Workspace integration specification
- `agentic-unified-presenter.md` - Presenter layer achievements

### Code References
- `src/shared/types/presenters/agentic.presenter.d.ts` - Type definitions
- `src/main/presenter/acpPresenter/normalizer.ts` - ACP normalizer
- `src/main/presenter/agentPresenter/normalizer.ts` - DeepChat normalizer
- `src/renderer/src/composables/acp/useAcpEventsAdapter.ts` - Current event adapter
- `src/renderer/src/components/chat-input/composables/useAcpMode.ts` - Modes composable
- `src/renderer/src/components/chat-input/composables/useAcpSessionModel.ts` - Models composable
- `src/renderer/src/components/chat-input/composables/useAcpCommands.ts` - Commands composable

### Event Sources
- `src/main/events.ts` - Main process events
- `src/main/presenter/acpPresenter/events.ts` - ACP events
- `src/renderer/src/events.ts` - Renderer events
