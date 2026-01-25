# Unified Components Specification - Agentic Layer

## Document Purpose

This document specifies the complete design, implementation, and integration details for unified components in the agentic layer.

**Status**: Implementation Specification
**Date**: 2026-01-25
**Related**: Research Item 4 from `renderer-analysis-research.md`, Decision 3 (Component Strategy)

---

## Part I: Component Strategy Overview

### 1.1 Design Principles

All unified components follow these design principles:

1. **Agent-Agnostic Interface**: Components work with any agent type (DeepChat, ACP)
2. **SessionInfo-Driven**: All data comes from `SessionInfo` returned by `useAgenticSession`
3. **Presenter-Based**: State changes go through `AgenticPresenter` interface
4. **Unified Events**: Single event system (`AgenticEventType`) for all updates
5. **No Branching**: No `if (agentId.startsWith('acp.'))` logic in components

### 1.2 Component Hierarchy

```
ChatInput.vue
├── AgentHeader (NEW)
│   └── Displays: agent name, icon, status, capabilities
│
├── UnifiedModelSelector (NEW)
│   ├── DeepChat: Provider-based model selection
│   └── ACP: Session-scoped model selection
│
├── UnifiedModeSelector (NEW)
│   ├── DeepChat: Static permission policies
│   └── ACP: Dynamic agent-declared modes
│
├── WorkspaceSelector (NEW)
│   ├── DeepChat: Optional workspace (mutable)
│   └── ACP: Required workdir (immutable)
│
└── CommandsDisplay (from acp-commands-specification.md)
    └── Only shown when agent supports commands
```

### 1.3 Old Components to Deprecate

| Old Component | Replacement | Migration Path |
|---------------|-------------|----------------|
| `AcpModeSelector.vue` | `UnifiedModeSelector.vue` | Direct replacement |
| `AcpSessionModelSelector.vue` | `UnifiedModelSelector.vue` | Direct replacement |
| `ModelSelector.vue` | `UnifiedModelSelector.vue` | Direct replacement |
| `useAcpWorkdir.ts` | `WorkspaceSelector.vue` | Direct replacement |
| `useAgentWorkspace.ts` | `WorkspaceSelector.vue` | Direct replacement |

---

## Part II: AgentHeader Component

### 2.1 Component Specification

**File**: `src/renderer/src/components/chat-input/AgentHeader.vue`

**Purpose**: Display agent information (name, icon, status, capabilities) in a compact header format.

### 2.2 Props Interface

```typescript
interface Props {
  sessionId: string              // Current session ID
  compact?: boolean              // Compact mode (default: false)
  showStatus?: boolean           // Show status indicator (default: true)
  showCapabilities?: boolean     // Show capability badges (default: true)
  showWorkspace?: boolean        // Show workspace path (default: true)
}
```

### 2.3 Data Source

```typescript
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const { sessionInfo, hasWorkspace, hasCommands } = useAgenticSession(
  () => props.sessionId
)

// sessionInfo contains:
// - agentId: string
// - status: 'idle' | 'generating' | 'paused' | 'error'
// - capabilities: { supportsVision, supportsTools, supportsModes, supportsCommands }
// - workspace?: string
// - currentModelId?: string
// - availableCommands?: AgentCommand[]
```

### 2.4 Visual Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Agent Icon]  Claude Code (acp.claude-code)    🟢 Generating           │
│ Vision 📷  Tools 🛠️  Commands (3) 🔧            Workspace: ~/my-project │
└─────────────────────────────────────────────────────────────────────────┘

[Compact mode]:
┌─────────────────────────────────────────────────────────────────────────┐
│ [Icon] Claude Code           🟢               ~/my-project              │
└─────────────────────────────────────────────────────────────────────────┘

[Error state]:
┌─────────────────────────────────────────────────────────────────────────┐
│ [Agent Icon]  Claude Code (acp.claude-code)    🔴 Error                 │
│ Agent process crashed. Click to retry.                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.5 Status Indicators

| Status | Icon | Color | Animation |
|--------|------|-------|-----------|
| `idle` | Circle outline | Gray | None |
| `generating` | Circle filled | Green | Pulse |
| `paused` | Pause icon | Yellow | None |
| `error` | Warning triangle | Red | None |

### 2.6 Capability Badges

```typescript
const capabilityBadges = computed(() => {
  const badges: Array<{ icon: string; label: string; show: boolean }> = [
    { icon: 'lucide:eye', label: 'Vision', show: sessionInfo.value?.capabilities.supportsVision },
    { icon: 'lucide:wrench', label: 'Tools', show: sessionInfo.value?.capabilities.supportsTools },
    { icon: 'lucide:shield', label: 'Modes', show: sessionInfo.value?.capabilities.supportsModes },
    { icon: 'lucide:terminal', label: `Commands (${availableCommands.value.length})`, show: hasCommands.value }
  ]
  return badges.filter(b => b.show)
})
```

### 2.7 User Interactions

| Interaction | Behavior |
|-------------|----------|
| Click on header | Open agent config dialog |
| Click on status badge | Show status tooltip with details |
| Click on workspace | Open workspace selector |
| Click on error state | Retry session connection |

### 2.8 Component Implementation

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const props = withDefaults(
  defineProps<{
    sessionId: string
    compact?: boolean
    showStatus?: boolean
    showCapabilities?: boolean
    showWorkspace?: boolean
  }>(),
  {
    compact: false,
    showStatus: true,
    showCapabilities: true,
    showWorkspace: true
  }
)

const { t } = useI18n()
const { sessionInfo, hasWorkspace, hasCommands, availableCommands } = useAgenticSession(
  () => props.sessionId
)

// Status configuration
const statusConfig = computed(() => {
  const status = sessionInfo.value?.status
  const configs = {
    idle: { icon: 'lucide:circle', color: 'text-gray-400', animation: '', label: 'Idle' },
    generating: { icon: 'lucide:circle-dot', color: 'text-green-500', animation: 'animate-pulse', label: 'Generating' },
    paused: { icon: 'lucide:pause-circle', color: 'text-yellow-500', animation: '', label: 'Paused' },
    error: { icon: 'lucide:alert-triangle', color: 'text-red-500', animation: '', label: 'Error' }
  }
  return configs[status] || configs.idle
})

// Agent display info
const agentDisplayInfo = computed(() => {
  const agentId = sessionInfo.value?.agentId || ''
  // Parse agentId: "acp.claude-code" -> name: "Claude Code", type: "acp"
  if (agentId.startsWith('acp.')) {
    const name = agentId.replace('acp.', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    return { name, type: 'ACP' }
  }
  return { name: 'DeepChat', type: 'DeepChat' }
})

// Workspace display (compact path)
const workspaceDisplay = computed(() => {
  const workspace = sessionInfo.value?.workspace
  if (!workspace) return null
  // Truncate long paths: /Users/user/projects/my-project -> ~/projects/my-project
  return workspace.replace(/^\/Users\/[^/]+/, '~')
})

// Emit events
const emit = defineEmits<{
  'config-click': []
  'workspace-click': []
  'retry-click': []
}>()
</script>

<template>
  <div class="agent-header" :class="{ compact }">
    <!-- Agent Icon & Name -->
    <div class="agent-info">
      <div class="agent-icon">
        <Icon :icon="statusConfig.icon" :class="[statusConfig.color, statusConfig.animation]" />
      </div>
      <div v-if="!compact" class="agent-details">
        <span class="agent-name">{{ agentDisplayInfo.name }}</span>
        <span class="agent-id">({{ sessionInfo?.agentId }})</span>
      </div>
    </div>

    <!-- Status -->
    <div v-if="showStatus && !compact" class="agent-status">
      <Badge :variant="statusConfig.label === 'Error' ? 'destructive' : 'secondary'">
        {{ statusConfig.label }}
      </Badge>
    </div>

    <!-- Capabilities -->
    <div v-if="showCapabilities && !compact" class="agent-capabilities">
      <Tooltip v-for="badge in capabilityBadges" :key="badge.label">
        <TooltipTrigger as-child>
          <Badge variant="outline" class="gap-1">
            <Icon :icon="badge.icon" class="w-3 h-3" />
            {{ badge.label }}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{{ badge.label }}</TooltipContent>
      </Tooltip>
    </div>

    <!-- Workspace -->
    <div v-if="showWorkspace && hasWorkspace" class="agent-workspace" @click="emit('workspace-click')">
      <Icon icon="lucide:folder" class="w-4 h-4" />
      <span class="workspace-path">{{ workspaceDisplay }}</span>
      <Icon icon="lucide:chevron-down" class="w-3 h-3" />
    </div>

    <!-- Error Action -->
    <div v-if="statusConfig.label === 'Error'" class="agent-error-action">
      <Button size="sm" variant="outline" @click="emit('retry-click')">
        {{ t('agent.retry') }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.agent-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
}

.agent-header.compact {
  padding: 4px 8px;
  gap: 8px;
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-icon {
  font-size: 16px;
}

.agent-name {
  font-weight: 600;
  font-size: 14px;
}

.agent-id {
  font-size: 12px;
  color: var(--color-text-muted);
}

.agent-status,
.agent-capabilities {
  display: flex;
  gap: 6px;
}

.agent-workspace {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
  font-family: monospace;
  font-size: 12px;
}

.agent-workspace:hover {
  background: var(--color-bg-hover);
}

.workspace-path {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

### 2.9 Integration Example

```vue
<!-- In ChatInput.vue -->
<script setup lang="ts">
import AgentHeader from './AgentHeader.vue'
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const activeSessionId = computed(() => chatStore.activeSessionId)

const handleConfigClick = () => {
  // Open agent configuration dialog
}

const handleWorkspaceClick = () => {
  // Trigger workspace selector
}

const handleRetryClick = () => {
  // Retry connection to agent
}
</script>

<template>
  <div class="chat-input">
    <AgentHeader
      :session-id="activeSessionId"
      :compact="false"
      @config-click="handleConfigClick"
      @workspace-click="handleWorkspaceClick"
      @retry-click="handleRetryClick"
    />

    <!-- Rest of chat input -->
  </div>
</template>
```

---

## Part III: UnifiedModelSelector Component

### 3.1 Component Specification

**File**: `src/renderer/src/components/chat-input/UnifiedModelSelector.vue`

**Purpose**: Select model for any agent type (DeepChat or ACP).

### 3.2 Props Interface

```typescript
interface Props {
  sessionId: string              // Current session ID
  disabled?: boolean             // Disable selection (default: false)
  showProvider?: boolean         // Show provider name for DeepChat (default: true)
  compact?: boolean              // Compact mode (default: false)
}

interface ModelInfo {
  id: string                     // Model ID (format varies by agent type)
  name: string                   // Display name
  description?: string           // Optional description
  providerId?: string            // Provider ID (DeepChat only)
}

interface ModelState {
  availableModels: ModelInfo[]   // Available models for this session
  currentModelId?: string        // Currently selected model ID
  loading: boolean               // Models are being loaded
  error?: string                 // Error message if loading failed
}
```

### 3.3 Agent Type Differences

| Aspect | DeepChat | ACP |
|--------|----------|-----|
| **Model ID Format** | `providerId:modelId` (e.g., `anthropic:claude-sonnet-4`) | Plain `modelId` (e.g., `claude-sonnet-4`) |
| **Source** | Provider config (static) | Agent declaration (dynamic, session-scoped) |
| **Loading** | Immediate (from config) | Warmup query + session query |
| **Updates** | Config changes only | Can change during session |

### 3.4 Visual Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [CPU Icon]  Claude Sonnet 4          [Anthropic]           [▼]         │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ Click

┌─────────────────────────────────────────────────────────────────────────┐
│ Select Model                                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  [CPU]  Claude Sonnet 4                    [Anthropic]               ✓  │
│  [CPU]  Claude Opus 4                      [Anthropic]                  │
│  [CPU]  GPT-4.1                            [OpenAI]                     │
│  ────────────────────────────────────────────────────────────────────  │
│  [Agent]  ACP Session Models (3)                                        │
│    └─ (opens submenu with session models)                               │
└─────────────────────────────────────────────────────────────────────────┘

[ACP Agent - Session Models]:
┌─────────────────────────────────────────────────────────────────────────┐
│ [CPU Icon]  claude-sonnet-4-20250514                    [▼]            │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ Click

┌─────────────────────────────────────────────────────────────────────────┐
│ Session Models (5)                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  [CPU]  claude-sonnet-4-20250514                                        │
│       Claude Sonnet 4 (May 2025)                                        │
│  [CPU]  claude-opus-4-20250514                                          │
│       Claude Opus 4 (May 2025)                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Data Source

```typescript
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const { sessionInfo, availableModels, currentModelId } = useAgenticSession(
  () => props.sessionId
)

// Agent type detection
const isAcp = computed(() => sessionInfo.value?.agentId?.startsWith('acp.') ?? false)

// Current model display
const currentModel = computed(() => {
  return availableModels.value.find(m => m.id === currentModelId.value)
})
```

### 3.6 Model Selection Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Model Selection Flow                             │
└─────────────────────────────────────────────────────────────────────────┘

1. Component Mounts:
   → Loads SessionInfo via useAgenticSession
   → Displays current model or loading state

2. User Opens Selector:
   → Shows list of available models from SessionInfo

3. User Selects Model:
   → Emits 'model-select' event with modelId
   → Parent calls agenticPresenter.setModel(sessionId, modelId)
   → Presenter updates session state
   → Emits SESSION_UPDATED event with currentModelId
   → Component re-renders with new model

4. Error Handling:
   → If selection fails, show error message
   → Allow retry or cancel
```

### 3.7 Component Implementation

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Badge } from '@shadcn/components/ui/badge'
import { useAgenticSession } from '@/composables/chat/useAgenticSession'
import ModelIcon from './icons/ModelIcon.vue'

const props = withDefaults(
  defineProps<{
    sessionId: string
    disabled?: boolean
    showProvider?: boolean
    compact?: boolean
  }>(),
  {
    disabled: false,
    showProvider: true,
    compact: false
  }
)

const emit = defineEmits<{
  'model-select': [modelId: string]
}>()

const { t } = useI18n()
const open = ref(false)

const { sessionInfo, availableModels, currentModelId } = useAgenticSession(
  () => props.sessionId
)

// Agent type detection
const isAcp = computed(() => sessionInfo.value?.agentId?.startsWith('acp.') ?? false)

// Current model display
const currentModel = computed(() => {
  return availableModels.value.find(m => m.id === currentModelId.value)
})

const modelDisplayName = computed(() => {
  if (!currentModel.value) return t('model.select')
  return currentModel.value.name || currentModel.value.id
})

const providerDisplay = computed(() => {
  if (isAcp.value) return null
  return currentModel.value?.providerId || ''
})

const hasModels = computed(() => availableModels.value.length > 0)
const loading = computed(() => sessionInfo.value === null)

// Model selection handler
const handleModelSelect = async (modelId: string) => {
  if (props.disabled) return

  emit('model-select', modelId)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        :disabled="disabled || loading || !hasModels"
        class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold"
        size="sm"
      >
        <ModelIcon
          v-if="currentModel"
          :model-id="isAcp ? currentModel.id : currentModel?.providerId"
          custom-class="w-4 h-4"
        />
        <span class="truncate max-w-[140px]">
          {{ loading ? t('common.loading') : modelDisplayName }}
        </span>
        <Badge v-if="!isAcp && showProvider && providerDisplay" variant="outline" class="text-[10px]">
          {{ providerDisplay }}
        </Badge>
        <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="end" class="w-80 border-none bg-transparent p-0 shadow-none">
      <div class="rounded-lg border bg-card p-1 shadow-md max-h-72 overflow-y-auto">
        <!-- Empty state -->
        <div v-if="!hasModels && !loading" class="px-2 py-4 text-xs text-muted-foreground text-center">
          {{ t('model.noModelsAvailable') }}
        </div>

        <!-- Loading state -->
        <div v-if="loading" class="px-2 py-4 text-xs text-muted-foreground text-center">
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin inline-block mr-2" />
          {{ t('model.loadingModels') }}
        </div>

        <!-- Model list -->
        <template v-if="hasModels">
          <!-- Section header -->
          <div class="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {{ isAcp ? t('model.sessionModels') : t('model.providerModels') }}
          </div>

          <!-- Model items -->
          <div
            v-for="model in availableModels"
            :key="model.id"
            :class="[
              'flex items-center gap-2 rounded-md px-2 py-2 cursor-pointer transition-colors',
              currentModelId === model.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              disabled ? 'opacity-50 cursor-not-allowed' : ''
            ]"
            @click="handleModelSelect(model.id)"
          >
            <Icon icon="lucide:cpu" class="w-4 h-4" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">{{ model.name || model.id }}</div>
              <div v-if="model.description" class="text-xs opacity-70 truncate">
                {{ model.description }}
              </div>
            </div>
            <Badge v-if="!isAcp && showProvider && model.providerId" variant="outline" class="text-[10px]">
              {{ model.providerId }}
            </Badge>
            <Icon v-if="currentModelId === model.id" icon="lucide:check" class="w-4 h-4" />
          </div>
        </template>
      </div>
    </PopoverContent>
  </Popover>
</template>
```

### 3.8 Integration Example

```vue
<!-- In ChatConfig.vue -->
<script setup lang="ts">
import UnifiedModelSelector from './UnifiedModelSelector.vue'
import { useAgenticPresenter } from '@/composables/usePresenter'

const agenticPresenter = useAgenticPresenter('agenticPresenter')
const activeSessionId = computed(() => chatStore.activeSessionId)

const handleModelSelect = async (modelId: string) => {
  try {
    await agenticPresenter.setModel(activeSessionId.value, modelId)
  } catch (error) {
    console.error('Failed to set model:', error)
    // Show error notification
  }
}
</script>

<template>
  <div class="chat-config">
    <UnifiedModelSelector
      :session-id="activeSessionId"
      @model-select="handleModelSelect"
    />
  </div>
</template>
```

---

## Part IV: UnifiedModeSelector Component

### 4.1 Component Specification

**File**: `src/renderer/src/components/chat-input/UnifiedModeSelector.vue`

**Purpose**: Select mode/permission policy for agents that support it.

### 4.2 Props Interface

```typescript
interface Props {
  sessionId: string              // Current session ID
  disabled?: boolean             // Disable selection (default: false)
  showDescription?: boolean      // Show mode description in tooltip (default: true)
  compact?: boolean              // Compact mode (default: false)
}

interface ModeInfo {
  id: string                     // Mode ID
  name: string                   // Display name
  description: string            // Mode description
}

interface ModeState {
  availableModes: ModeInfo[]     // Available modes for this session
  currentModeId?: string         // Currently selected mode ID
  loading: boolean               // Modes are being loaded
  error?: string                 // Error message if loading failed
}
```

### 4.3 Agent Type Differences

| Aspect | DeepChat | ACP |
|--------|----------|-----|
| **Mode Type** | Permission policies (tool usage rules) | Agent-declared modes (behavior policies) |
| **Source** | Hardcoded (3 modes) | Agent declaration (dynamic) |
| **Updates** | Never (static) | Can change during session |
| **Default Modes** | strict, balanced, permissive | Varies by agent |

### 4.4 Visual Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Shield Icon]  Balanced                  [▼]                            │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓ Click

┌─────────────────────────────────────────────────────────────────────────┐
│ [🛡️] Strict                                                              │
│    All operations require user confirmation                              │
│                                                                          │
│ [🛡️] Balanced ✓                                                          │
│    Read operations auto-allow, write/delete require confirmation         │
│                                                                          │
│ [🛡️] Permissive                                                          │
│    Most operations auto-allow, only dangerous operations require conf.  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Data Source

```typescript
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const { sessionInfo, availableModes, currentModeId, supportsModes } = useAgenticSession(
  () => props.sessionId
)

// Component is only visible when agent supports modes
const showSelector = computed(() => supportsModes.value && availableModes.value.length > 0)
```

### 4.6 Mode Selection Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Mode Selection Flow                              │
└─────────────────────────────────────────────────────────────────────────┘

1. Component Mounts:
   → Checks if agent supports modes (capabilities.supportsModes)
   → Loads available modes from SessionInfo
   → Displays current mode or loading state

2. User Opens Selector:
   → Shows list of available modes with descriptions
   → Highlights current mode

3. User Selects Mode:
   → Emits 'mode-select' event with modeId
   → Parent calls agenticPresenter.setMode(sessionId, modeId)
   → Presenter updates session state
   → Emits SESSION_UPDATED event with currentModeId
   → Component re-renders with new mode

4. ACP-Specific:
   → Agent may emit mode update during session
   → Component responds to SESSION_UPDATED event
   → Updates displayed mode automatically
```

### 4.7 Component Implementation

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const props = withDefaults(
  defineProps<{
    sessionId: string
    disabled?: boolean
    showDescription?: boolean
    compact?: boolean
  }>(),
  {
    disabled: false,
    showDescription: true,
    compact: false
  }
)

const emit = defineEmits<{
  'mode-select': [modeId: string]
}>()

const { t } = useI18n()
const open = ref(false)

const { sessionInfo, availableModes, currentModeId, supportsModes } = useAgenticSession(
  () => props.sessionId
)

// Component visibility
const showSelector = computed(() => supportsModes.value && availableModes.value.length > 0)

// Current mode display
const currentMode = computed(() => {
  return availableModes.value.find(m => m.id === currentModeId.value)
})

const modeDisplayName = computed(() => {
  if (!currentMode.value) return t('mode.select')
  return currentMode.value.name
})

const hasModes = computed(() => availableModes.value.length > 0)
const loading = computed(() => sessionInfo.value === null)

// Mode selection handler
const handleModeSelect = async (modeId: string) => {
  if (props.disabled) return

  emit('mode-select', modeId)
  open.value = false
}
</script>

<template>
  <div v-if="showSelector" class="mode-selector">
    <Tooltip v-if="showDescription && currentMode">
      <TooltipTrigger as-child>
        <span class="inline-flex">
          <Popover v-model:open="open">
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                :disabled="disabled || loading"
                class="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold"
                size="sm"
              >
                <Icon icon="lucide:shield" class="w-4 h-4" />
                <span class="truncate max-w-[120px]">
                  {{ loading ? t('common.loading') : modeDisplayName }}
                </span>
                <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-72 border-none bg-transparent p-0 shadow-none">
              <div class="rounded-lg border bg-card p-1 shadow-md max-h-64 overflow-y-auto">
                <!-- Empty state -->
                <div v-if="!hasModes && !loading" class="px-2 py-4 text-xs text-muted-foreground text-center">
                  {{ t('mode.noModesAvailable') }}
                </div>

                <!-- Mode list -->
                <template v-if="hasModes">
                  <div
                    v-for="mode in availableModes"
                    :key="mode.id"
                    :class="[
                      'flex flex-col rounded-md px-3 py-2 cursor-pointer transition-colors',
                      currentModeId === mode.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                      disabled ? 'opacity-50 cursor-not-allowed' : ''
                    ]"
                    @click="handleModeSelect(mode.id)"
                  >
                    <div class="flex items-center gap-2">
                      <Icon icon="lucide:shield" class="w-4 h-4" />
                      <span class="flex-1 text-sm font-medium">{{ mode.name }}</span>
                      <Icon v-if="currentModeId === mode.id" icon="lucide:check" class="w-4 h-4" />
                    </div>
                    <div class="text-xs mt-1 opacity-80 pl-6">
                      {{ mode.description }}
                    </div>
                  </div>
                </template>
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </TooltipTrigger>
      <TooltipContent class="max-w-xs">
        <p class="text-xs font-semibold">{{ t('mode.currentMode') }}</p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ currentMode?.description }}
        </p>
      </TooltipContent>
    </Tooltip>

    <!-- Without tooltip (if showDescription is false) -->
    <Popover v-else v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          variant="ghost"
          :disabled="disabled || loading"
          class="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold"
          size="sm"
        >
          <Icon icon="lucide:shield" class="w-4 h-4" />
          <span class="truncate max-w-[120px]">
            {{ loading ? t('common.loading') : modeDisplayName }}
          </span>
          <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <!-- Same PopoverContent as above -->
    </Popover>
  </div>
</template>

<style scoped>
.mode-selector {
  display: inline-block;
}
</style>
```

### 4.8 Integration Example

```vue
<!-- In ChatConfig.vue -->
<script setup lang="ts">
import UnifiedModeSelector from './UnifiedModeSelector.vue'
import { useAgenticPresenter } from '@/composables/usePresenter'

const agenticPresenter = useAgenticPresenter('agenticPresenter')
const activeSessionId = computed(() => chatStore.activeSessionId)

const handleModeSelect = async (modeId: string) => {
  try {
    await agenticPresenter.setMode(activeSessionId.value, modeId)
  } catch (error) {
    console.error('Failed to set mode:', error)
    // Show error notification
  }
}
</script>

<template>
  <div class="chat-config">
    <UnifiedModeSelector
      :session-id="activeSessionId"
      @mode-select="handleModeSelect"
    />
  </div>
</template>
```

---

## Part V: WorkspaceSelector Component

### 5.1 Component Specification

**File**: `src/renderer/src/components/chat-input/WorkspaceSelector.vue`

**Purpose**: Select workspace/workdir for agent session.

### 5.2 Props Interface

```typescript
interface Props {
  sessionId: string              // Current session ID
  disabled?: boolean             // Disable selection (default: false)
  editable?: boolean             // Allow editing path (default: false)
  compact?: boolean              // Compact mode (default: false)
  showChangeButton?: boolean     // Show change button (default: true)
}
```

### 5.3 Agent Type Differences

| Aspect | DeepChat | ACP |
|--------|----------|-----|
| **Workspace** | Optional (for file tools) | Required (session-scoped) |
| **Mutability** | Mutable (can change anytime) | Immutable (fixed at session creation) |
| **Storage** | SQLite (`conversations.settings`) | In-memory only |
| **Validation** | Optional directory | Must be valid directory |

### 5.4 Visual Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Workspace Selector                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  [Folder Icon]  ~/projects/my-project                         [Change]  │
└─────────────────────────────────────────────────────────────────────────┘

[No workspace selected - DeepChat]:
┌─────────────────────────────────────────────────────────────────────────┐
│  [Folder Icon]  No workspace selected                       [Select]   │
└─────────────────────────────────────────────────────────────────────────┘

[ACP - Workdir required]:
┌─────────────────────────────────────────────────────────────────────────┐
│  [Folder Icon]  ~/projects/my-project (ACP workdir)                    │
└─────────────────────────────────────────────────────────────────────────┘

[Compact mode]:
┌─────────────────────────────────────────────────────────────────────────┐
│  ~/projects/my-project                                    [Change]     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.5 Selection UX Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Workspace Selection Flow                           │
└─────────────────────────────────────────────────────────────────────────┘

1. User clicks "Change" or "Select":
   → Opens directory picker dialog
   → User selects directory

2. For DeepChat:
   → Validates directory (optional)
   → Updates conversation.settings.agentWorkspacePath
   → Re-registers workspace with WorkspacePresenter
   → Emits SESSION_UPDATED event

3. For ACP:
   → Shows error: "ACP workdir cannot be changed"
   → Prompts to create new session with desired workdir

4. Validation:
   → Check if directory exists
   → Check read/write permissions
   → For ACP: register workdir with security manager
```

### 5.6 Data Source

```typescript
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const { sessionInfo, hasWorkspace } = useAgenticSession(
  () => props.sessionId
)

// Agent type detection
const isAcp = computed(() => sessionInfo.value?.agentId?.startsWith('acp.') ?? false)

// Workspace display
const workspaceDisplay = computed(() => {
  const workspace = sessionInfo.value?.workspace
  if (!workspace) return null
  // Truncate: /Users/user/projects/my-project -> ~/projects/my-project
  return workspace.replace(/^\/Users\/[^/]+/, '~')
})
```

### 5.7 Component Implementation

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { useAgenticSession } from '@/composables/chat/useAgenticSession'

const props = withDefaults(
  defineProps<{
    sessionId: string
    disabled?: boolean
    editable?: boolean
    compact?: boolean
    showChangeButton?: boolean
  }>(),
  {
    disabled: false,
    editable: false,
    compact: false,
    showChangeButton: true
  }
)

const emit = defineEmits<{
  'workspace-change': [workspace: string | null]
}>()

const { t } = useI18n()
const showDialog = ref(false)
const pendingWorkspace = ref<string | null>(null)

const { sessionInfo, hasWorkspace } = useAgenticSession(
  () => props.sessionId
)

// Agent type detection
const isAcp = computed(() => sessionInfo.value?.agentId?.startsWith('acp.') ?? false)

// Workspace display
const workspaceDisplay = computed(() => {
  const workspace = sessionInfo.value?.workspace
  if (!workspace) return t('workspace.noWorkspace')
  // Truncate long paths
  return workspace.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
})

const showRequiredBadge = computed(() => isAcp.value)

// Handle workspace selection
const handleSelectWorkspace = async () => {
  if (props.disabled) return

  // For ACP, show error dialog
  if (isAcp.value) {
    showDialog.value = true
    return
  }

  // For DeepChat, open directory picker
  const result = await window.electron.ipcRenderer.invoke('dialog:select-directory')
  if (result) {
    pendingWorkspace.value = result
    showDialog.value = true
  }
}

// Confirm workspace change
const confirmWorkspaceChange = async () => {
  if (isAcp.value) {
    // ACP: Cannot change, show error
    showDialog.value = false
    return
  }

  // DeepChat: Update workspace
  emit('workspace-change', pendingWorkspace.value)
  showDialog.value = false
}

// Clear workspace (DeepChat only)
const handleClearWorkspace = () => {
  if (!isAcp.value) {
    pendingWorkspace.value = null
    showDialog.value = true
  }
}
</script>

<template>
  <div class="workspace-selector" :class="{ compact }">
    <!-- Workspace display -->
    <div class="workspace-display">
      <Icon v-if="!compact" icon="lucide:folder" class="w-4 h-4 text-muted-foreground" />
      <span class="workspace-path" :title="sessionInfo?.workspace || t('workspace.noWorkspace')">
        {{ workspaceDisplay }}
      </span>
      <Badge v-if="showRequiredBadge" variant="secondary" class="text-[10px]">
        {{ t('workspace.required') }}
      </Badge>
    </div>

    <!-- Change/Select button -->
    <Button
      v-if="showChangeButton && !disabled"
      variant="ghost"
      size="sm"
      @click="handleSelectWorkspace"
    >
      {{ hasWorkspace ? t('workspace.change') : t('workspace.select') }}
    </Button>

    <!-- Confirmation dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle v-if="isAcp">
            {{ t('workspace.acpImmutableTitle') }}
          </DialogTitle>
          <DialogTitle v-else>
            {{ t('workspace.changeTitle') }}
          </DialogTitle>
          <DialogDescription v-if="isAcp">
            {{ t('workspace.acpImmutableDescription') }}
          </DialogDescription>
          <DialogDescription v-else>
            {{ pendingWorkspace
              ? t('workspace.changeDescription', { path: pendingWorkspace })
              : t('workspace.clearDescription')
            }}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter v-if="!isAcp">
          <Button variant="outline" @click="showDialog = false">
            {{ t('common.cancel') }}
          </Button>
          <Button @click="confirmWorkspaceChange">
            {{ pendingWorkspace ? t('workspace.change') : t('workspace.clear') }}
          </Button>
        </DialogFooter>

        <DialogFooter v-else>
          <Button @click="showDialog = false">
            {{ t('common.close') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.workspace-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-bg-secondary);
}

.workspace-selector.compact {
  padding: 4px 8px;
  background: transparent;
}

.workspace-display {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.workspace-path {
  font-family: monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

### 5.8 Integration Example

```vue
<!-- In ChatConfig.vue -->
<script setup lang="ts">
import WorkspaceSelector from './WorkspaceSelector.vue'
import { useAgenticPresenter } from '@/composables/usePresenter'

const agenticPresenter = useAgenticPresenter('agenticPresenter')
const activeSessionId = computed(() => chatStore.activeSessionId)

const handleWorkspaceChange = async (workspace: string | null) => {
  try {
    await agenticPresenter.setWorkspace(activeSessionId.value, workspace)
  } catch (error) {
    console.error('Failed to change workspace:', error)
    // Show error notification
  }
}
</script>

<template>
  <div class="chat-config">
    <WorkspaceSelector
      :session-id="activeSessionId"
      @workspace-change="handleWorkspaceChange"
    />
  </div>
</template>
```

---

## Part VI: Implementation Checklist

### Phase 1: Shared Composables

- [ ] Create `useAgenticSession` composable
  - [ ] SessionInfo loading
  - [ ] Event subscription (SESSION_UPDATED)
  - [ ] Computed properties for modes, models, commands, workspace
  - [ ] Type guards for capabilities

### Phase 2: Component Implementation

- [ ] **AgentHeader.vue**
  - [ ] Props interface
  - [ ] Status indicator
  - [ ] Capability badges
  - [ ] Workspace display
  - [ ] Error state handling

- [ ] **UnifiedModelSelector.vue**
  - [ ] Props interface
  - [ ] DeepChat model list
  - [ ] ACP model list
  - [ ] Model selection handler
  - [ ] Loading/error states

- [ ] **UnifiedModeSelector.vue**
  - [ ] Props interface
  - [ ] Mode list with descriptions
  - [ ] Mode selection handler
  - [ ] Tooltip for current mode
  - [ ] Visibility check (only when supported)

- [ ] **WorkspaceSelector.vue**
  - [ ] Props interface
  - [ ] Directory picker dialog
  - [ ] ACP immutable handling
  - [ ] DeepChat mutable handling
  - [ ] Path display with truncation

### Phase 3: Integration

- [ ] Update `ChatInput.vue`
  - [ ] Replace `AcpModeSelector` with `UnifiedModeSelector`
  - [ ] Replace `AcpSessionModelSelector` + `ModelSelector` with `UnifiedModelSelector`
  - [ ] Add `AgentHeader` component
  - [ ] Add `WorkspaceSelector` component

- [ ] Update `ChatConfig.vue`
  - [ ] Integrate `UnifiedModelSelector`
  - [ ] Integrate `UnifiedModeSelector`
  - [ ] Integrate `WorkspaceSelector`

- [ ] Remove old components
  - [ ] Deprecate `AcpModeSelector.vue`
  - [ ] Deprecate `AcpSessionModelSelector.vue`
  - [ ] Deprecate `ModelSelector.vue`
  - [ ] Deprecate `useAcpWorkdir.ts`
  - [ ] Deprecate `useAgentWorkspace.ts`

### Phase 4: Testing

- [ ] Unit tests for all components
- [ ] Integration tests for event flow
- [ ] E2E tests for user scenarios
- [ ] Accessibility testing

---

## Part VII: Architectural Decisions

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-021 | 2026-01-25 | Create `AgentHeader` component | Centralized agent info display, consistent with unified design | ✅ Confirmed |
| D-022 | 2026-01-25 | Single `UnifiedModelSelector` for all agent types | Eliminates branching logic, consistent UX | ✅ Confirmed |
| D-023 | 2026-01-25 | Single `UnifiedModeSelector` for all agent types | Eliminates branching logic, consistent UX | ✅ Confirmed |
| D-024 | 2026-01-25 | Single `WorkspaceSelector` with agent-specific behavior | Presenter abstracts agent differences | ✅ Confirmed |
| D-025 | 2026-01-25 | All components use `useAgenticSession` composable | Single data source, consistent updates | ✅ Confirmed |
| D-026 | 2026-01-25 | Components emit events, parent calls presenter | Separation of concerns, testability | ✅ Confirmed |
| D-027 | 2026-01-25 | Status indicator in AgentHeader uses pulse animation | Clear visual feedback for generating state | ✅ Confirmed |
| D-028 | 2026-01-25 | ACP workdir immutable, show error on change attempt | User education about ACP constraints | ✅ Confirmed |
| D-029 | 2026-01-25 | Workspace path truncation with ~ substitution | Better UX for long paths | ✅ Confirmed |
| D-030 | 2026-01-25 | Tooltip for mode descriptions | Better UX without cluttering UI | ✅ Confirmed |

---

## Part VIII: Related Documents

- `acp-commands-specification.md` - CommandsDisplay component specification
- `acp-modes-models-specification.md` - Modes/models data model
- `workspace-implementation-plan.md` - Workspace selector detailed spec
- `event-payload-specification.md` - Event system specifications
- `renderer-analysis-research.md` - Main research document (Research Item 4)

### Code References

- `src/renderer/src/components/chat-input/AcpModeSelector.vue` - Current ACP mode selector
- `src/renderer/src/components/chat-input/AcpSessionModelSelector.vue` - Current ACP model selector
- `src/renderer/src/components/chat-input/ModelSelector.vue` - Current DeepChat model selector
- `src/renderer/src/composables/chat/useAcpWorkdir.ts` - Current ACP workdir composable
- `src/renderer/src/composables/chat/useAgentWorkspace.ts` - Current DeepChat workspace composable
