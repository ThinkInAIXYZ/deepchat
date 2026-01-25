# Workspace Integration - Implementation Plan

**Status**: Implementation Specification
**Date**: 2026-01-25
**Related**: `workspace-integration-analysis.md` (Analysis), `renderer-analysis-research.md` (Parent)

---

## Part I: Current Implementation Gap

### 1.1 What's Missing

**Shared Types** (`src/shared/types/presenters/agentic.presenter.d.ts`):

```typescript
// CURRENT (missing workspace)
export interface SessionConfig {
  modelId?: string
  modeId?: string
  [key: string]: any  // workspace can be passed here, but not typed
}

export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'
  // ... modes, models, capabilities
  // NO workspace field
}
```

**Required Changes**:

```typescript
// TARGET (with workspace)
export interface SessionConfig {
  modelId?: string
  modeId?: string
  workspace?: string  // NEW: Unified workspace/workdir field
}

export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

  // NEW: Workspace field
  workspace?: string

  availableModes?: Array<{ id: string; name: string; description: string }>
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModeId?: string
  currentModelId?: string

  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    supportsCommands?: boolean
  }
}
```

### 1.2 Agent Presenter Status

| Agent | Workspace Handling | Status |
|-------|-------------------|--------|
| **DeepChat** (AgentPresenter) | Uses `conversation.settings.agentWorkspacePath` | ⚠️ Not using SessionConfig.workspace |
| **ACP** (AcpPresenter) | Uses `workdir` parameter in `createSession` | ⚠️ Not using SessionConfig.workspace |

### 1.3 Current Workarounds

**DeepChat**:
- Workspace stored in SQLite: `conversations.settings.agentWorkspacePath`
- Renderer reads via `useAgentWorkspace` composable
- Not exposed through `SessionInfo`

**ACP**:
- Workdir passed directly to `AcpSessionManager.createSession(agentId, workdir, hooks)`
- Not exposed through unified `SessionConfig`
- Different parameter name (`workdir` vs `workspace`)

---

## Part II: Resolved Open Questions

### 2.1 Question: How to handle workspace persistence for ACP?

**Decision**: Keep ACP workdir in-memory (no SQLite persistence)

**Rationale**:
1. ACP protocol constraint: sessions are transient, process-scoped
2. ACP agents don't have a concept of "conversation" persistence
3. On app restart, user creates new ACP session (fresh start)
4. DeepChat keeps SQLite persistence for conversation history

**User Experience**:
```
ACP Session:
  - User selects workdir when creating session
  - Workdir is used for that session only
  - App restart → workdir forgotten (as designed)
  - User selects workdir again for new sessions

DeepChat Conversation:
  - User selects workspace (optional)
  - Workspace stored in SQLite per conversation
  - App restart → workspace restored from SQLite
  - User can change workspace anytime
```

### 2.2 Question: Should workspace be required for all agents?

**Decision**: No - Agent-type specific

**Specification**:

| Agent Type | Workspace Required | Default Behavior |
|------------|-------------------|------------------|
| **DeepChat** | No | `null` - tools prompt user or fail gracefully |
| **ACP** | Yes (de facto) | Fallback to temp dir if not specified |

### 2.3 Question: How to handle workspace change for DeepChat?

**Decision**: Allow in-place change (maintain existing UX)

**Specification**:
```typescript
// DeepChat AgentPresenter
async setWorkspace(sessionId: string, workspace: string | null): Promise<void> {
  // Update conversation.settings.agentWorkspacePath
  await conversationManager.updateSettings(sessionId, { agentWorkspacePath: workspace })

  // Re-register with WorkspacePresenter
  if (workspace) {
    await workspacePresenter.registerWorkspace(workspace)
  }

  // Emit SESSION_UPDATED event
  emitter.sessionUpdated({ workspace })
}

// ACP AgentPresenter
async setWorkspace(sessionId: string, workspace: string): Promise<void> {
  // NOT SUPPORTED - workdir is immutable
  throw new Error('ACP workdir is immutable. Create a new session with the desired workdir.')
}
```

### 2.4 Question: Where to store workspace preference?

**Decision**: Agent-type specific storage

**Specification**:

| Agent Type | Storage | Location |
|------------|---------|----------|
| **DeepChat** | SQLite | `conversations.settings.agentWorkspacePath` |
| **ACP** | In-memory | `AcpProcessManager.sessionWorkdirs` (Map) |
| **Unified** | SessionInfo | `SessionInfo.workspace` (read-only, derived) |

### 2.5 Question: How to display workspace in UI?

**Decision**: Display in both SessionInfo header and chat config panel

**Specification**:

```
┌─────────────────────────────────────────────────────────┐
│ Agent: Claude Code │ Model: Sonnet │ Mode: Balanced     │  ← SessionInfo header
│ Workspace: /Users/user/projects/my-project              │
└─────────────────────────────────────────────────────────┘

Chat Config Panel:
┌─────────────────────────────────────────────────────────┐
│ Workspace: /Users/user/projects/my-project  [Change...] │
│                                                         │
│ ✓ Workspace is required for this agent                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Part III: Implementation Phases

### Phase 1: Type Definitions

**File**: `src/shared/types/presenters/agentic.presenter.d.ts`

```diff
export interface SessionConfig {
  modelId?: string
  modeId?: string
+ workspace?: string
  [key: string]: any
}

export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

+ workspace?: string

  availableModes?: Array<{ id: string; name: string; description: string }>
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModeId?: string
  currentModelId?: string

  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
+   supportsCommands?: boolean
  }
}
```

**Tasks**:
- [ ] Add `workspace?: string` to `SessionConfig`
- [ ] Add `workspace?: string` to `SessionInfo`
- [ ] Add `supportsCommands?: boolean` to `capabilities`

### Phase 2: DeepChat Agent Implementation

**File**: `src/main/presenter/agentPresenter/index.ts`

```typescript
async createSession(config: SessionConfig): Promise<string> {
  const conversationId = nanoid()

  // Get workspace from config or conversation settings
  const workspace = config.workspace ??
    await this.getConversationWorkspace(conversationId)

  // Create conversation with workspace
  await this.conversationManager.createConversation({
    id: conversationId,
    settings: {
      agentWorkspacePath: workspace  // Store in SQLite
    }
  })

  // Register workspace for security
  if (workspace) {
    await this.workspacePresenter.registerWorkspace(workspace)
  }

  // Store session context
  this.sessionContexts.set(conversationId, {
    conversationId,
    workspace
  })

  return conversationId
}

async getSession(sessionId: string): SessionInfo | null {
  const context = this.sessionContexts.get(sessionId)
  if (!context) return null

  return {
    sessionId,
    agentId: this.agentId,
    status: this.getStatus(sessionId),
    workspace: context.workspace,  // ← NEW
    // ... other fields
  }
}

async setWorkspace(sessionId: string, workspace: string | null): Promise<void> {
  // Update conversation settings
  await this.conversationManager.updateSettings(sessionId, {
    agentWorkspacePath: workspace
  })

  // Update session context
  const context = this.sessionContexts.get(sessionId)
  if (context) {
    context.workspace = workspace ?? undefined
  }

  // Re-register workspace
  if (workspace) {
    await this.workspacePresenter.registerWorkspace(workspace)
  }

  // Emit update
  const emitter = this.getEmitter(sessionId)
  emitter?.sessionUpdated({ workspace: workspace ?? undefined })
}
```

**Tasks**:
- [ ] Add workspace to `createSession()` logic
- [ ] Add workspace to `getSession()` return value
- [ ] Add `setWorkspace()` method (DeepChat-specific)
- [ ] Update session context to include workspace

### Phase 3: ACP Agent Implementation

**File**: `src/main/presenter/acpPresenter/index.ts`

```typescript
async createSession(config: SessionConfig): Promise<string> {
  const workdir = config.workspace || this.getFallbackWorkdir()

  // Register workdir for security
  await this.workspacePresenter.registerWorkdir(workdir)

  // Create session with workdir
  const sessionId = await this.sessionManager.createSession(
    this.agent.id,
    workdir,  // ← Use workspace from config
    this.getSessionHooks()
  )

  return sessionId
}

async getSession(sessionId: string): SessionInfo | null {
  const sessionRecord = this.sessionManager.getSession(sessionId)
  if (!sessionRecord) return null

  // Get workdir from process manager
  const workdir = this.processManager.getSessionWorkdir(sessionId)

  return {
    sessionId,
    agentId: this.agent.id,
    status: this.getSessionStatus(sessionId),
    workspace: workdir,  // ← NEW
    // ... other fields
  }
}

// ACP: setWorkspace is NOT supported (workdir is immutable)
async setWorkspace(sessionId: string, workspace: string): Promise<void> {
  throw new Error(
    'ACP workdir is immutable for the session lifetime. ' +
    'To use a different workdir, create a new session.'
  )
}
```

**File**: `src/main/presenter/acpPresenter/managers/processManager.ts`

```typescript
// Add method to retrieve workdir for a session
getSessionWorkdir(sessionId: string): string | undefined {
  return this.sessionWorkdirs.get(sessionId)
}
```

**Tasks**:
- [ ] Update `createSession()` to use `config.workspace`
- [ ] Add workspace to `getSession()` return value
- [ ] Add `getSessionWorkdir()` method to `AcpProcessManager`
- [ ] Document that `setWorkspace()` is not supported for ACP

### Phase 4: Unified Event Emission

**File**: `src/main/presenter/agenticPresenter/index.ts`

No changes needed - `SESSION_CREATED` event already includes `sessionInfo`:
```typescript
eventBus.sendToRenderer(
  'agentic.session.created',
  { sessionId, agentId, sessionInfo: await presenter.getSession(sessionId) }
)
```

**Verification**:
- [ ] DeepChat: `sessionInfo.workspace` reflects `agentWorkspacePath`
- [ ] ACP: `sessionInfo.workspace` reflects workdir

### Phase 5: Renderer Migration

#### 5.1 New Composable: `useAgenticWorkspace`

**File**: `src/renderer/src/composables/chat/useAgenticWorkspace.ts`

```typescript
import { computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { SessionInfo } from '@shared/types/presenters/agentic.presenter.d'

export function useAgenticWorkspace(sessionId: () => string) {
  const agenticPresenter = usePresenter('agenticPresenter')

  const sessionInfo = ref<SessionInfo | null>(null)

  // Load session info
  const loadSessionInfo = async () => {
    sessionInfo.value = await agenticPresenter.getSession(sessionId.value)
  }

  // Computed workspace
  const workspace = computed(() => sessionInfo.value?.workspace)
  const hasWorkspace = computed(() => !!workspace.value)

  // Change workspace (DeepChat only)
  const changeWorkspace = async (newWorkspace: string | null) => {
    try {
      const session = await agenticPresenter.getSession(sessionId.value)
      const isAcp = session?.agentId.startsWith('acp.')

      if (isAcp && newWorkspace !== null) {
        throw new Error('ACP workdir cannot be changed. Create a new session.')
      }

      // For DeepChat, update via conversation settings
      // This will be handled by a separate method or IPC call
      await window.electron.ipcRenderer.invoke(
        'agent:set-workspace',
        sessionId.value,
        newWorkspace
      )

      await loadSessionInfo()
    } catch (error) {
      console.error('Failed to change workspace:', error)
      throw error
    }
  }

  return {
    workspace,
    hasWorkspace,
    changeWorkspace,
    loadSessionInfo,
    sessionInfo
  }
}
```

#### 5.2 Workspace Selector Component

**File**: `src/renderer/src/components/chat-input/WorkspaceSelector.vue`

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAgenticWorkspace } from './composables/useAgenticWorkspace'

const props = defineProps<{
  sessionId: string
}>()

const { workspace, hasWorkspace, changeWorkspace } = useAgenticWorkspace(
  () => props.sessionId
)

const showDialog = ref(false)
const pendingPath = ref('')

const selectWorkspace = async () => {
  const result = await window.electron.ipcRenderer.invoke(
    'dialog:select-directory'
  )
  if (result) {
    pendingPath.value = result
    showDialog.value = true
  }
}

const confirmChange = async () => {
  await changeWorkspace(pendingPath.value)
  showDialog.value = false
}
</script>

<template>
  <div class="workspace-selector">
    <div v-if="hasWorkspace" class="workspace-info">
      <Folder class="icon" />
      <span class="path">{{ workspace }}</span>
      <Button @click="selectWorkspace" size="sm" variant="ghost">
        Change
      </Button>
    </div>
    <div v-else class="workspace-empty">
      <Button @click="selectWorkspace" size="sm">
        <Folder class="icon" />
        Select Workspace
      </Button>
    </div>

    <Dialog v-model:open="showDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Workspace</DialogTitle>
          <DialogDescription>
            This will change the workspace for future file operations.
          </DialogDescription>
        </DialogHeader>
        <div class="dialog-content">
          <p>New workspace: <code>{{ pendingPath }}</code></p>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDialog = false">
            Cancel
          </Button>
          <Button @click="confirmChange">
            Change Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
```

**Tasks**:
- [ ] Create `useAgenticWorkspace` composable
- [ ] Create `WorkspaceSelector` component
- [ ] Integrate into ChatInput.vue
- [ ] Remove old `useAgentWorkspace` for DeepChat
- [ ] Remove old `useAcpWorkdir` for ACP

---

## Part IV: Decision Log

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-007 | 2026-01-25 | Use session-scoped workspace (unified model) | Aligns with ACP, presenter abstracts difference | ✅ Confirmed |
| D-008 | 2026-01-25 | Workspace is part of SessionConfig | Specified at session creation, returned in SessionInfo | ✅ Confirmed |
| D-009 | 2026-01-25 | Agent-type specific workspace handling | DeepChat: optional (SQLite fallback), ACP: required (temp fallback) | ✅ Confirmed |

---

## Part V: Testing Checklist

### Unit Tests
- [ ] `AgentPresenter.createSession()` with workspace config
- [ ] `AgentPresenter.createSession()` without workspace config
- [ ] `AgentPresenter.setWorkspace()` updates SQLite
- [ ] `AcpPresenter.createSession()` with workspace config
- [ ] `AcpPresenter.createSession()` without workspace (uses fallback)
- [ ] `AcpPresenter.setWorkspace()` throws error

### Integration Tests
- [ ] DeepChat session with workspace → `SessionInfo` includes workspace
- [ ] DeepChat session without workspace → `SessionInfo.workspace` is undefined
- [ ] ACP session with workdir → `SessionInfo.workspace` equals workdir
- [ ] ACP session without workdir → `SessionInfo.workspace` equals fallback temp dir
- [ ] `SESSION_CREATED` event includes workspace
- [ ] `SESSION_UPDATED` event when workspace changes

### E2E Tests
- [ ] User creates DeepChat session, selects workspace
- [ ] User creates DeepChat session without workspace
- [ ] User changes workspace during DeepChat session
- [ ] User creates ACP session with workdir
- [ ] User creates ACP session without workdir (uses temp)
- [ ] Workspace shown correctly in UI
- [ ] Workspace selector works for both agent types

---

## Part VI: Related Documents

- `workspace-integration-analysis.md` - Deep analysis of workspace/workdir concepts
- `event-payload-specification.md` - Event payload specifications
- `renderer-analysis-research.md` - Parent research document
- `agentic-unified-presenter.md` - Presenter layer architecture
