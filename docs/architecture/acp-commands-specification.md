# ACP Commands Specification - Agentic Unified Layer

## Document Purpose

This document specifies the complete representation, lifecycle, and UI implementation for ACP agent commands in the unified agentic layer.

**Status**: Complete Specification
**Date**: 2026-01-25
**Related**: Research Item 2 from `renderer-analysis-research.md`, `event-payload-specification.md`

---

## Part I: Command Concept Analysis

### 1.1 What are ACP Commands?

**Definition**: Commands are agent-declared capabilities/tools that the agent can invoke during a session. They are:

- **Dynamic**: Commands can appear/disappear during agent execution
- **Agent-specific**: Each ACP agent declares its own commands
- **Input hints**: Commands may include hints about expected input format
- **Not persistent**: Commands are session-scoped, not stored in SQLite

**Comparison with related concepts**:

| Concept | Scope | Updates | Persistence |
|---------|-------|---------|-------------|
| **Commands** | Session | Dynamic (during execution) | In-memory only |
| **MCP Tools** | Global | Static (on server start) | Config |
| **Modes** | Session | Static (after initial load) | In-memory only |
| **Models** | Session | Static (after initial load) | In-memory only |

### 1.2 Current State (Pre-Unification)

**Main Process**:
- `AcpSessionInfo.availableCommands` - Array stored in session record
- `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` - Event for command updates
- **Gap**: Command update event emission not yet implemented in session manager

**Renderer**:
- `useAcpCommands` composable - Subscribes to `COMMANDS_UPDATE` event
- No dedicated UI component for displaying commands
- Commands only logged to console, not displayed to users

**Current Command Structure**:
```typescript
// src/main/presenter/acpPresenter/types.ts
interface AcpSessionInfo {
  availableCommands?: Array<{
    name: string
    description?: string
  }>
}

// src/renderer/src/components/chat-input/composables/useAcpCommands.ts
export interface AcpCommand {
  name: string
  description?: string
  input?: { hint: string } | null
}
```

**Note**: There's a mismatch - main process doesn't include `input.hint`, but renderer expects it.

---

## Part II: Command Lifecycle

### 2.1 Lifecycle States

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Command Lifecycle                               │
└─────────────────────────────────────────────────────────────────────┘

Session Created:
  availableCommands: []  (initially empty)

     │
     ▼
Agent Declares Commands:
  availableCommands: [
    { name: "run_command", description: "...", inputHint: "..." },
    { name: "read_file", description: "..." }
  ]
  → Emit SESSION_UPDATED with availableCommands

     │
     ▼
Agent Updates Commands (adds/removes):
  availableCommands: [...]
  → Emit SESSION_UPDATED with availableCommands

     │
     ▼
Session Closed:
  availableCommands: []  (cleared from memory)
```

### 2.2 Update Triggers

Commands can update at these points:

| Trigger | Source | Event |
|---------|--------|-------|
| **Initial load** | Agent process starts | `SESSION_UPDATED` (with availableCommands) |
| **Dynamic declaration** | Agent during execution | `SESSION_UPDATED` (with availableCommands) |
| **Agent change** | User switches agents | Clear commands (set to empty array) |
| **Session close** | User closes session | Clear commands from memory |

### 2.3 Current Implementation Gaps

**Gap 1**: Command update event not emitted
- Location: `src/main/presenter/acpPresenter/managers/sessionManager.ts`
- Issue: Session manager doesn't track command updates from agent process
- Fix: Add command update handler in process manager

**Gap 2**: `inputHint` field missing in main process
- Location: `src/main/presenter/acpPresenter/types.ts`
- Issue: `AcpSessionInfo.availableCommands` doesn't include `inputHint`
- Fix: Extend command type to include `inputHint?`

**Gap 3**: No UI for displaying commands
- Location: Renderer components
- Issue: Commands only logged, not shown to users
- Fix: Create `CommandsDisplay` component

---

## Part III: Unified Data Model

### 3.1 Command Type Definition

```typescript
// src/shared/types/presenters/agentic.presenter.d.ts

export interface AgentCommand {
  name: string            // Command identifier (e.g., "run_command")
  description?: string    // Human-readable description
  inputHint?: string      // Flattened from input.hint (e.g., "command to run")
}
```

**Design Decisions**:
1. **Flattened `inputHint`**: Simpler property structure (Decision D-012)
2. **Optional fields**: `description` and `inputHint` are optional
3. **Minimal schema**: No complex input schema (may be added later for advanced UI)

### 3.2 SessionInfo Extension

```typescript
export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

  // ... modes, models, workspace fields ...

  // Commands (ACP-specific, optional for DeepChat)
  availableCommands?: AgentCommand[]

  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    supportsCommands?: boolean  // New: true for ACP agents
  }
}
```

**Type Guards**:
```typescript
// Check if agent supports commands
function supportsCommands(session: SessionInfo): boolean {
  return session.capabilities.supportsCommands === true
}

// Check if commands are available
function hasCommands(session: SessionInfo): boolean {
  return supportsCommands(session) &&
         (session.availableCommands?.length ?? 0) > 0
}
```

---

## Part IV: Event Normalization

### 4.1 Current Event → Unified Event

```typescript
// src/main/presenter/acpPresenter/normalizer.ts

/**
 * Normalize ACP COMMANDS_UPDATE event to SESSION_UPDATED
 * Called when agent emits command update notification
 */
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

### 4.2 Event Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    Command Update Event Flow                      │
└──────────────────────────────────────────────────────────────────┘

ACP Agent Process:
  → Emits command update notification

        ↓

AcpProcessManager:
  → Receives notification
  → Extracts commands array

        ↓

AcpSessionManager:
  → Updates session.availableCommands
  → Calls normalizeCommandsUpdate()

        ↓

AgenticEventEmitter:
  → Emits AgenticEventType.SESSION_UPDATED
  → Payload: { availableCommands: [...] }

        ↓

Renderer (useAgenticSession):
  → Receives SESSION_UPDATED event
  → Updates availableCommands state

        ↓

UI Component (CommandsDisplay):
  → Re-renders with new commands
```

### 4.3 Handler Registration

**Location**: `src/main/presenter/acpPresenter/managers/processManager.ts`

```typescript
// Add to process manager event listeners
private attachCommandUpdateHandler(
  agentId: string,
  workdir: string
): () => void {
  const connection = this.getConnection(agentId, workdir)

  // Listen for command update notifications from agent
  const unsubscribe = connection.onNotification((notification) => {
    if (notification.type === 'commands_update') {
      const commands = notification.commands as AgentCommand[]

      // Emit to renderer via ACP_WORKSPACE_EVENTS
      eventBus.sendToRenderer(
        ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE,
        SendTarget.ALL_WINDOWS,
        { agentId, workdir, commands }
      )
    }
  })

  return unsubscribe
}
```

---

## Part V: Renderer Composable

### 5.1 Unified Session Composable

**File**: `src/renderer/src/composables/chat/useAgenticSession.ts`

```typescript
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { SessionInfo, AgentCommand } from '@shared/types/presenters/agentic.presenter.d'

export function useAgenticSession(sessionId: () => string) {
  const sessionInfo = ref<SessionInfo | null>(null)

  // Commands
  const availableCommands = computed<AgentCommand[]>(
    () => sessionInfo.value?.availableCommands ?? []
  )
  const hasCommands = computed(() => availableCommands.value.length > 0)
  const supportsCommands = computed(
    () => sessionInfo.value?.capabilities.supportsCommands === true
  )

  // Event handler
  const handleSessionUpdated = (event: SessionUpdatedEvent) => {
    if (event.sessionId !== sessionId.value) return

    // Update session info (including commands)
    if (event.sessionInfo.availableCommands) {
      console.info(
        `[useAgenticSession] Commands updated: [${event.sessionInfo.availableCommands.map(c => c.name).join(', ')}]`
      )
    }

    sessionInfo.value = {
      ...sessionInfo.value,
      ...event.sessionInfo
    }
  }

  onMounted(() => {
    window.electron.ipcRenderer.on(
      'agentic.session.updated',
      handleSessionUpdated
    )
  })

  onUnmounted(() => {
    window.electron.ipcRenderer.off(
      'agentic.session.updated',
      handleSessionUpdated
    )
  })

  return {
    sessionInfo,
    availableCommands,
    hasCommands,
    supportsCommands
  }
}
```

### 5.2 Migration from Old Composable

**Before** (`useAcpCommands.ts`):
```typescript
// Separate composable, only for ACP
const { availableCommands, hasCommands } = useAcpCommands({
  activeModel,
  conversationId
})
```

**After** (`useAgenticSession.ts`):
```typescript
// Unified composable, all agent types
const { availableCommands, hasCommands } = useAgenticSession(
  () => activeSessionId.value
)
```

---

## Part VI: UI Component Specification

### 6.1 CommandsDisplay Component

**File**: `src/renderer/src/components/chat-input/CommandsDisplay.vue`

**Purpose**: Display available commands for agents that support them

**Props**:
```typescript
interface Props {
  commands: AgentCommand[]  // Array of commands to display
  maxVisible?: number       // Max commands before collapsing (default: 5)
}
```

**Visual Design**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Available Commands (3)                          [Collapse ▼]    │
├─────────────────────────────────────────────────────────────────┤
│ 🔧 run_command                                               Run │
│    Execute shell command in workspace                          │
│    Hint: command to run                                        │
├─────────────────────────────────────────────────────────────────┤
│ 📄 read_file                                                  Run │
│    Read file contents from workspace                           │
├─────────────────────────────────────────────────────────────────┤
│ ✏️ write_file                                                 Run │
│    Write content to file in workspace                          │
└─────────────────────────────────────────────────────────────────┘

[Collapsed state]:

┌─────────────────────────────────────────────────────────────────┐
│ Available Commands (3)                              [Expand ▶]   │
└─────────────────────────────────────────────────────────────────┘
```

**Component Implementation**:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AgentCommand } from '@shared/types/presenters/agentic.presenter.d'

const props = withDefaults(
  defineProps<{
    commands: AgentCommand[]
    maxVisible?: number
  }>(),
  { maxVisible: 5 }
)

const isExpanded = ref(true)
const visibleCommands = computed(() => {
  if (isExpanded.value || props.commands.length <= props.maxVisible) {
    return props.commands
  }
  return props.commands.slice(0, props.maxVisible)
})

const collapsedCount = computed(() =>
  Math.max(0, props.commands.length - props.maxVisible)
)

const getCommandIcon = (name: string): string => {
  // Map command names to icons
  if (name.includes('run') || name.includes('exec')) return '⚡'
  if (name.includes('read') || name.includes('file')) return '📄'
  if (name.includes('write') || name.includes('save')) return '✏️'
  return '🔧'
}

const emit = defineEmits<{
  (e: 'command-click', command: AgentCommand): void
}>()
</script>

<template>
  <div v-if="commands.length > 0" class="commands-display">
    <div class="commands-header">
      <span class="commands-title">
        Available Commands ({{ commands.length }})
      </span>
      <button
        v-if="commands.length > maxVisible"
        class="toggle-button"
        @click="isExpanded = !isExpanded"
      >
        {{ isExpanded ? 'Collapse ▼' : 'Expand ▶' }}
      </button>
    </div>

    <div v-if="isExpanded" class="commands-list">
      <div
        v-for="cmd in visibleCommands"
        :key="cmd.name"
        class="command-item"
        @click="emit('command-click', cmd)"
      >
        <div class="command-main">
          <span class="command-icon">{{ getCommandIcon(cmd.name) }}</span>
          <span class="command-name">{{ cmd.name }}</span>
          <button class="command-run">Run</button>
        </div>
        <div v-if="cmd.description" class="command-description">
          {{ cmd.description }}
        </div>
        <div v-if="cmd.inputHint" class="command-hint">
          Hint: {{ cmd.inputHint }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.commands-display {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-bg-secondary);
}

.commands-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.command-item {
  padding: 8px;
  margin-bottom: 4px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.command-item:hover {
  background: var(--color-bg-hover);
}

.command-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.command-icon {
  font-size: 16px;
}

.command-name {
  flex: 1;
  font-family: monospace;
  font-weight: 600;
}

.command-run {
  padding: 4px 12px;
  font-size: 11px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.command-description {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
  padding-left: 24px;
}

.command-hint {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-muted);
  font-style: italic;
  padding-left: 24px;
}
</style>
```

### 6.2 Integration Points

**In ChatConfig Panel**:
```vue
<script setup lang="ts">
import { useAgenticSession } from '@/composables/chat/useAgenticSession'
import CommandsDisplay from './CommandsDisplay.vue'

const sessionId = computed(() => activeSessionId.value)
const { availableCommands, hasCommands } = useAgenticSession(sessionId)

const handleCommandClick = (command: AgentCommand) => {
  // Insert command invocation into chat input
  chatInput.value += `/${command.name} `
}
</script>

<template>
  <div class="chat-config">
    <!-- ... other config options ... -->

    <CommandsDisplay
      v-if="hasCommands"
      :commands="availableCommands"
      @command-click="handleCommandClick"
    />
  </div>
</template>
```

**In SessionInfo Header** (compact view):
```vue
<template>
  <div class="session-info-header">
    <span>{{ sessionInfo.agentId }}</span>
    <span v-if="hasCommands" class="commands-badge">
      {{ availableCommands.length }} commands
    </span>
  </div>
</template>
```

---

## Part VII: Implementation Checklist

### Phase 1: Type Definitions
- [ ] Add `AgentCommand` interface to `agentic.presenter.d.ts`
- [ ] Extend `SessionInfo` with `availableCommands?: AgentCommand[]`
- [ ] Add `capabilities.supportsCommands?: boolean`
- [ ] Update `AcpSessionInfo` in `acpPresenter/types.ts` to include `inputHint`

### Phase 2: Main Process Updates
- [ ] Implement command update handler in `AcpProcessManager`
- [ ] Add `normalizeCommandsUpdate` to `acpPresenter/normalizer.ts`
- [ ] Wire up command updates to emit `SESSION_UPDATED`
- [ ] Update `AcpAgentPresenter.getSession()` to include commands

### Phase 3: Renderer Migration
- [ ] Create `useAgenticSession` composable
- [ ] Create `CommandsDisplay.vue` component
- [ ] Integrate into `ChatConfig.vue`
- [ ] Add command count badge to session header
- [ ] Deprecate `useAcpCommands.ts`

### Phase 4: Testing
- [ ] Test command updates during ACP session
- [ ] Test command display in UI
- [ ] Test command click handler
- [ ] Test DeepChat sessions (should show no commands)
- [ ] Test session close (commands cleared)

---

## Part VIII: Architectural Decisions

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-010 | 2026-01-25 | Include `availableCommands` in SessionInfo | Consistent with modes/models pattern | ✅ Confirmed |
| D-011 | 2026-01-25 | Use `SESSION_UPDATED` for command updates | Single event for all session changes | ✅ Confirmed |
| D-012 | 2026-01-25 | Flatten command `input.hint` to `inputHint` | Simpler property structure | ✅ Confirmed |
| D-013 | 2026-01-25 | Add `capabilities.supportsCommands` | Type-safe command capability check | ✅ Confirmed |
| D-014 | 2026-01-25 | Create dedicated `CommandsDisplay` component | Better UX than inline rendering | ✅ Confirmed |
| D-015 | 2026-01-25 | Commands are session-scoped, not persistent | Matches ACP protocol design | ✅ Confirmed |

---

## Part IX: Related Documents

- `event-payload-specification.md` - Unified event payload specification
- `workspace-integration-analysis.md` - Workspace integration analysis
- `workspace-implementation-plan.md` - Workspace implementation phases
- `renderer-analysis-research.md` - Main research document

### Code References

- `src/main/presenter/acpPresenter/types.ts` - ACP type definitions
- `src/main/presenter/acpPresenter/managers/sessionManager.ts` - Session management
- `src/main/presenter/acpPresenter/managers/processManager.ts` - Process management
- `src/main/presenter/acpPresenter/normalizer.ts` - Event normalization
- `src/renderer/src/components/chat-input/composables/useAcpCommands.ts` - Current commands composable
