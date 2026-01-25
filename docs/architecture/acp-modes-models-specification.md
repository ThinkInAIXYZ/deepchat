# ACP Modes and Models Specification - Agentic Unified Layer

## Document Purpose

This document specifies the complete representation, lifecycle, and behavior of modes (permission policies) and models for both ACP and DeepChat agents in the unified agentic layer.

**Status**: Complete Specification
**Date**: 2026-01-25
**Related**: Research Item 3 from `renderer-analysis-research.md`, `event-payload-specification.md`

---

## Part I: Concepts and Terminology

### 1.1 What are Modes?

**Definition**: Modes (permission policies) control how an agent requests user approval for operations.

| Agent Type | Mode Concept | Scope | Update Pattern |
|------------|--------------|-------|----------------|
| **DeepChat** | Permission policy (strict/balanced/permissive) | Session | Static (hardcoded) |
| **ACP** | Agent-declared permission modes | Session | Dynamic (fetched from agent) |

**DeepChat Modes** (permission policies):
- **strict**: All operations require user confirmation
- **balanced**: Read operations auto-allow, write/delete require confirmation
- **permissive**: Most operations auto-allow, only dangerous operations require confirmation

**ACP Modes**:
- Agent-specific modes declared during runtime
- Example: "default", "high-security", "auto-approve"
- Fetched from agent process via IPC or events

### 1.2 What are Models?

**Definition**: Models are the AI models that an agent uses for generating responses.

| Agent Type | Model Concept | Scope | Update Pattern |
|------------|---------------|-------|----------------|
| **DeepChat** | Provider models (config-based) | Provider | Static (from config) |
| **ACP** | Agent-declared available models | Session | Dynamic (fetched from agent) |

**DeepChat Models**:
- Loaded from `configPresenter.getProviderModels(providerId)`
- Format: `{providerId}:{modelId}` (e.g., "anthropic:claude-3-5-sonnet")
- Static per provider

**ACP Models**:
- Agent-declared models available within the session
- Format: Agent-specific (e.g., "claude-3-5-sonnet", "claude-3-opus")
- Dynamic per session

---

## Part II: Current State Analysis

### 2.1 ACP Modes Implementation

**File**: `src/renderer/src/components/chat-input/composables/useAcpMode.ts`

**Current Behavior**:
1. **IPC Query**: `getAcpSessionModes(conversationId)` - Initial load
2. **Event Subscription**: `subscribeSessionModesReady()` - Update notifications
3. **Warmup Query**: `getAcpProcessModes(agentId, workdir)` - Before session creation
4. **Set Mode**: `setAcpSessionMode(conversationId, modeId)` - Change mode

**State Structure**:
```typescript
interface ModeInfo {
  id: string          // Mode ID (e.g., "default", "strict")
  name: string        // Display name
  description: string // Human-readable description
}

const currentMode = ref<string>('default')
const availableModes = ref<ModeInfo[]>([])
```

**Lifecycle**:
```
┌─────────────────────────────────────────────────────────────────────┐
│                       ACP Mode Lifecycle                            │
└─────────────────────────────────────────────────────────────────────┘

Before Session Created:
  1. User selects workdir (optional)
  2. Load warmup modes: getAcpProcessModes(agentId, workdir)
  3. Display mode selector with available modes

Session Created:
  4. Send first message → Session created
  5. Load session modes: getAcpSessionModes(conversationId)
  6. Listen for SESSION_MODES_READY event

During Session:
  7. Agent emits mode update → SESSION_MODES_READY event
  8. Update availableModes and currentMode
```

### 2.2 ACP Models Implementation

**File**: `src/renderer/src/components/chat-input/composables/useAcpSessionModel.ts`

**Current Behavior**:
1. **IPC Query**: `getAcpSessionModels(conversationId)` - Initial load
2. **Event Subscription**: `subscribeSessionModelsReady()` - Update notifications
3. **Warmup Query**: `getAcpProcessModels(agentId, workdir)` - Before session creation
4. **Set Model**: `setAcpSessionModel(conversationId, modelId)` - Change model

**State Structure**:
```typescript
interface ModelInfo {
  id: string
  name: string
  description?: string
}

const currentModelId = ref<string>('')
const availableModels = ref<ModelInfo[]>([])
```

**Lifecycle**: Similar to modes (warmup → session → updates)

### 2.3 DeepChat Modes Implementation

**File**: `src/main/presenter/agentPresenter/index.ts`

**Current Behavior**:
1. **Hardcoded Modes**: Three modes defined in `getSession()`
2. **Session State**: `sessionModes: Map<sessionId, modeId>` stores current mode
3. **Set Mode**: `setMode(sessionId, modeId)` updates Map

**Mode Definitions**:
```typescript
availableModes: [
  {
    id: 'strict',
    name: 'Strict',
    description: 'All operations require user confirmation'
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Read operations auto-allow, write/delete require confirmation'
  },
  {
    id: 'permissive',
    name: 'Permissive',
    description: 'Most operations auto-allow, only dangerous operations require confirmation'
  }
]
```

### 2.4 DeepChat Models Implementation

**Current Behavior**:
1. **Config-based**: `getProviderModels(providerId)` loads from config
2. **Session Storage**: `conversation.settings.modelId` stores current model
3. **Set Model**: `setModel(sessionId, modelId)` updates conversation settings

**Model Format**:
```typescript
// Available models returned from SessionInfo
availableModels: [
  {
    id: 'anthropic:claude-3-5-sonnet',  // providerId:modelId
    name: 'Claude 3.5 Sonnet',
    description: '...'
  }
]

// Current model stored separately
currentModelId: 'claude-3-5-sonnet'  // Without providerId prefix
```

---

## Part III: Unified Data Model

### 3.1 SessionInfo Extension

Already defined in `agentic.presenter.d.ts`:

```typescript
export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

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

  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    supportsCommands?: boolean
  }
}
```

### 3.2 Agent Type Differences

| Property | DeepChat | ACP |
|----------|----------|-----|
| `availableModes` | Static (3 hardcoded modes) | Dynamic (fetched from agent) |
| `currentModeId` | Stored in `sessionModes` Map | Fetched from agent state |
| `availableModels` | Static (from provider config) | Dynamic (fetched from agent) |
| `currentModelId` | From `conversation.settings` | From agent state |
| Model ID format | `providerId:modelId` or `modelId` | Agent-specific (plain `modelId`) |

### 3.3 Decision Points

**Decision D-016**: Unified SessionInfo structure
- Both agent types use the same `SessionInfo` structure
- Agent presenter abstracts the differences
- Renderer uses unified interface

**Decision D-017**: Model ID format for DeepChat
- Return models with `providerId:modelId` format for uniqueness
- Current model ID is stored without prefix (for backward compatibility)
- Presenter handles the transformation

---

## Part IV: Event Normalization

### 4.1 Mode Update Events

**ACP Event → Unified Event**:
```typescript
// ACP_WORKSPACE_EVENTS.SESSION_MODES_READY
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

// Normalized to AgenticEventType.SESSION_UPDATED
emitter.sessionUpdated({
  availableModes: data.available,
  currentModeId: data.current
})
```

**Implementation**: `src/main/presenter/acpPresenter/normalizer.ts`

```typescript
function normalizeSessionModesUpdate(
  data: Record<string, unknown>,
  emitter: AgenticEventEmitter
): void {
  const available = data.available as Array<{
    id: string
    name: string
    description: string
  }>
  const current = data.current as string

  emitter.sessionUpdated({
    availableModes: available,
    currentModeId: current
  })
}
```

**DeepChat**: No event emission (modes are static)

### 4.2 Model Update Events

**ACP Event → Unified Event**:
```typescript
// ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY
{
  conversationId?: string
  agentId?: string
  workdir?: string
  current: string
  available: Array<{
    id: string
    name: string
    description?: string
  }>
}

// Normalized to AgenticEventType.SESSION_UPDATED
emitter.sessionUpdated({
  availableModels: data.available,
  currentModelId: data.current
})
```

**Implementation**: `src/main/presenter/acpPresenter/normalizer.ts`

```typescript
function normalizeSessionModelsUpdate(
  data: Record<string, unknown>,
  emitter: AgenticEventEmitter
): void {
  const available = data.available as Array<{
    id: string
    name: string
    description?: string
  }>
  const current = data.current as string

  emitter.sessionUpdated({
    availableModels: available,
    currentModelId: current
  })
}
```

**DeepChat**: No event emission (models are static)

---

## Part V: Presenter Implementation

### 5.1 ACP AgentPresenter

**File**: `src/main/presenter/acpPresenter/index.ts`

```typescript
class AcpAgentPresenter implements IAgenticAgentPresenter {
  getSession(sessionId: string): SessionInfo | null {
    const acpSessionInfo = this.acpPresenter.getSessionInfo(sessionId)
    if (!acpSessionInfo) return null

    return {
      sessionId: acpSessionInfo.sessionId,
      agentId: this.agentId,
      status: mapStatus(acpSessionInfo.status),
      availableModes: acpSessionInfo.availableModes,  // From process
      currentModeId: acpSessionInfo.currentModeId,    // From process
      availableModels: acpSessionInfo.availableModels, // From process
      currentModelId: acpSessionInfo.currentModelId,   // From process
      capabilities: {
        supportsVision: false,
        supportsTools: true,
        supportsModes: acpSessionInfo.availableModes?.length > 0
      }
    }
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.acpPresenter.setSessionMode(sessionId, modeId)
    // No SESSION_UPDATED emission (ACP agent handles this)
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.acpPresenter.setSessionModel(sessionId, modelId)
    // No SESSION_UPDATED emission (ACP agent handles this)
  }
}
```

### 5.2 DeepChat AgentPresenter

**File**: `src/main/presenter/agentPresenter/index.ts`

```typescript
class AgentPresenter implements IAgentPresenter {
  private sessionModes = new Map<string, string>()  // sessionId → modeId

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const conversation = await this.sqlitePresenter.getConversation(sessionId)
    if (!conversation) return null

    const { providerId, modelId } = conversation.settings
    const models = this.configPresenter.getProviderModels(providerId)

    return {
      sessionId: conversation.id,
      agentId: this.agentId,
      status: getSessionStatus(sessionId),
      availableModes: [
        { id: 'strict', name: 'Strict', description: 'All operations require user confirmation' },
        { id: 'balanced', name: 'Balanced', description: 'Read operations auto-allow, write/delete require confirmation' },
        { id: 'permissive', name: 'Permissive', description: 'Most operations auto-allow, only dangerous operations require confirmation' }
      ],
      currentModeId: this.sessionModes.get(sessionId),
      availableModels: models.map(m => ({
        id: `${providerId}:${m.id}`,
        name: m.name,
        description: m.description
      })),
      currentModelId: modelId,
      capabilities: {
        supportsVision: this.configPresenter.getModelConfig(modelId, providerId)?.vision ?? false,
        supportsTools: true,
        supportsModes: true
      }
    }
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    this.sessionModes.set(sessionId, modeId)
    // Emit SESSION_UPDATED to notify renderer
    const emitter = this.getEmitter(sessionId)
    emitter?.sessionUpdated({ currentModeId: modeId })
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    const parts = modelId.split(':')
    const providerId = parts.length === 2 ? parts[0] : undefined
    const actualModelId = parts.length === 2 ? parts[1] : modelId

    await this.sessionPresenter.updateConversationSettings(sessionId, {
      providerId,
      modelId: actualModelId
    })

    // Emit SESSION_UPDATED to notify renderer
    const emitter = this.getEmitter(sessionId)
    emitter?.sessionUpdated({ currentModelId: actualModelId })
  }
}
```

---

## Part VI: Renderer Composable

### 6.1 Unified Mode Selector

**File**: `src/renderer/src/composables/chat/useAgenticSession.ts`

```typescript
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { SessionInfo, ModeInfo } from '@shared/types/presenters/agentic.presenter.d'

export function useAgenticSession(sessionId: () => string) {
  const sessionInfo = ref<SessionInfo | null>(null)

  // Modes
  const availableModes = computed<ModeInfo[]>(
    () => sessionInfo.value?.availableModes ?? []
  )
  const currentModeId = computed(() => sessionInfo.value?.currentModeId)
  const currentModeInfo = computed(() =>
    availableModes.value.find(m => m.id === currentModeId.value)
  )
  const hasModes = computed(() => availableModes.value.length > 0)

  // Models
  const availableModels = computed(
    () => sessionInfo.value?.availableModels ?? []
  )
  const currentModelId = computed(() => sessionInfo.value?.currentModelId)
  const currentModelInfo = computed(() =>
    availableModels.value.find(m => m.id === currentModelId.value)
  )
  const hasModels = computed(() => availableModels.value.length > 0)

  // Event handler for SESSION_UPDATED
  const handleSessionUpdated = (event: SessionUpdatedEvent) => {
    if (event.sessionId !== sessionId.value) return

    // Update session info (including modes/models)
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
    // Modes
    availableModes,
    currentModeId,
    currentModeInfo,
    hasModes,
    // Models
    availableModels,
    currentModelId,
    currentModelInfo,
    hasModels
  }
}
```

### 6.2 Mode Selection Composable

**File**: `src/renderer/src/composables/chat/useModeSelection.ts`

```typescript
import { computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { Ref } from 'vue'

export function useModeSelection(sessionId: Ref<string>) {
  const agenticPresenter = usePresenter('agenticPresenter')

  const setMode = async (modeId: string) => {
    try {
      await agenticPresenter.setMode(sessionId.value, modeId)
    } catch (error) {
      console.error('Failed to set mode:', error)
      throw error
    }
  }

  const cycleMode = async (availableModes: Array<{ id: string }>, currentModeId?: string) => {
    if (availableModes.length === 0) return

    const currentIndex = currentModeId
      ? availableModes.findIndex(m => m.id === currentModeId)
      : -1
    const nextIndex = (currentIndex + 1) % availableModes.length
    const nextMode = availableModes[nextIndex]

    await setMode(nextMode.id)
  }

  return {
    setMode,
    cycleMode
  }
}
```

---

## Part VII: UI Components

### 7.1 UnifiedModeSelector Component

**File**: `src/renderer/src/components/chat-input/UnifiedModeSelector.vue`

**Purpose**: Display and select mode/permission policy for any agent type

**Props**:
```typescript
interface Props {
  availableModes: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  disabled?: boolean
}
```

**Visual Design**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Mode: Balanced ▼                                                │
└─────────────────────────────────────────────────────────────────┘
[Dropdown]
┌─────────────────────────────────────────────────────────────────┐
│ 🔒 Strict                  All operations require confirmation  │
│ ✓ ⚖️ Balanced               Read auto-allow, write requires...  │
│ 🔓 Permissive               Most operations auto-allow...       │
└─────────────────────────────────────────────────────────────────┘

Or Cycle Button (for ACP with few modes):

┌─────────────────────────────────────────────────────────────────┐
│ [⚖️] Balanced (3 modes)                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Component Implementation**:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { ModeInfo } from '@shared/types/presenters/agentic.presenter.d'

const props = defineProps<{
  availableModes: ModeInfo[]
  currentModeId?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', modeId: string): void
}>()

const currentMode = computed(() =>
  props.availableModes.find(m => m.id === props.currentModeId)
)

const modeIcon = computed(() => {
  if (!props.currentModeId) return '⚙️'
  const iconMap: Record<string, string> = {
    strict: '🔒',
    balanced: '⚖️',
    permissive: '🔓',
    default: '⚙️'
  }
  return iconMap[props.currentModeId] || '⚙️'
})
</script>

<template>
  <div v-if="availableModes.length > 0" class="mode-selector">
    <span class="mode-icon">{{ modeIcon }}</span>
    <span class="mode-label">{{ currentMode?.name || currentModeId }}</span>
    <span v-if="availableModes.length > 1" class="mode-count">
      ({{ availableModes.length }} modes)
    </span>
  </div>
</template>

<style scoped>
.mode-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.mode-selector:hover {
  background: var(--color-bg-hover);
}

.mode-icon {
  font-size: 14px;
}

.mode-label {
  font-size: 13px;
  font-weight: 500;
}

.mode-count {
  font-size: 11px;
  color: var(--color-text-secondary);
}
</style>
```

### 7.2 UnifiedModelSelector Component

**File**: `src/renderer/src/components/chat-input/UnifiedModelSelector.vue`

**Purpose**: Display and select model for any agent type

**Props**:
```typescript
interface Props {
  availableModels: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string
  disabled?: boolean
}
```

**Visual Design**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Model: Claude 3.5 Sonnet ▼                       (3 available)  │
└─────────────────────────────────────────────────────────────────┘
[Dropdown]
┌─────────────────────────────────────────────────────────────────┐
│ ✓ Claude 3.5 Sonnet         Most capable model for complex...   │
│   Claude 3 Opus             Most powerful model...             │
│   Claude 3 Haiku            Fastest model for simple...        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part VIII: Implementation Checklist

### Phase 1: Type Definitions
- [x] Add modes/models to `SessionInfo` in `agentic.presenter.d.ts`
- [ ] Add `ModeInfo` and `ModelInfo` type exports
- [ ] Update `AcpSessionInfo` to ensure consistency

### Phase 2: Main Process Updates
- [ ] Add mode/model normalization to `acpPresenter/normalizer.ts`
- [ ] Implement `normalizeSessionModesUpdate()`
- [ ] Implement `normalizeSessionModelsUpdate()`
- [ ] Add SESSION_UPDATED emission in DeepChat `setMode()`
- [ ] Add SESSION_UPDATED emission in DeepChat `setModel()`

### Phase 3: Renderer Migration
- [ ] Create `useAgenticSession` composable
- [ ] Create `useModeSelection` composable
- [ ] Create `useModelSelection` composable
- [ ] Create `UnifiedModeSelector.vue` component
- [ ] Create `UnifiedModelSelector.vue` component
- [ ] Deprecate `useAcpMode.ts`
- [ ] Deprecate `useAcpSessionModel.ts`

### Phase 4: Integration
- [ ] Replace ACP mode selector with unified component
- [ ] Replace ACP model selector with unified component
- [ ] Ensure DeepChat uses same components

### Phase 5: Testing
- [ ] Test ACP mode/model loading
- [ ] Test ACP mode/model updates during session
- [ ] Test DeepChat mode/model selection
- [ ] Test warmup mode/model loading for ACP
- [ ] Test SESSION_UPDATED events

---

## Part IX: Architectural Decisions

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-011 | 2026-01-25 | Use `SESSION_UPDATED` for modes/models | Single event for all session metadata | ✅ Confirmed |
| D-016 | 2026-01-25 | Unified SessionInfo structure | Same structure for all agent types | ✅ Confirmed |
| D-017 | 2026-01-25 | DeepChat model ID format with providerId prefix | Ensures uniqueness across providers | ✅ Confirmed |
| D-018 | 2026-01-25 | DeepChat emits SESSION_UPDATED on mode/model change | Notify renderer of changes | ✅ Confirmed |
| D-019 | 2026-01-25 | ACP modes/models are session-scoped | Matches ACP protocol design | ✅ Confirmed |
| D-020 | 2026-01-25 | DeepChat modes are static (hardcoded) | Permission policies don't change | ✅ Confirmed |

---

## Part X: Related Documents

- `event-payload-specification.md` - Unified event payload specification
- `acp-commands-specification.md` - Commands lifecycle and component spec
- `workspace-integration-analysis.md` - Workspace integration analysis
- `renderer-analysis-research.md` - Main research document

### Code References

- `src/renderer/src/components/chat-input/composables/useAcpMode.ts` - Current ACP mode composable
- `src/renderer/src/components/chat-input/composables/useAcpSessionModel.ts` - Current ACP model composable
- `src/main/presenter/agentPresenter/index.ts` - DeepChat presenter implementation
- `src/main/presenter/acpPresenter/index.ts` - ACP presenter implementation
- `src/main/presenter/acpPresenter/managers/processManager.ts` - Process manager for warmup queries
