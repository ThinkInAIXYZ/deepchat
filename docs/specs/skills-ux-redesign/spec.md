# Skills UX Redesign - Technical Specification

> Version: 1.0
> Date: 2025-01-11
> Status: Draft

---

## Overview

This document specifies the technical implementation for the Skills UX redesign based on the 4 design decisions outlined in [analysis.md](./analysis.md).

---

## Decision 1: Trigger Symbol Separation

### Goal

Separate `@` (reference context) from `/` (invoke capabilities) to provide clearer mental models.

### Current State

- Single `@` trigger in [suggestion.ts](../../../src/renderer/src/components/editor/mention/suggestion.ts)
- Categories: `context`, `files`, `resources`, `tools`, `prompts`
- No skills integration
- TipTap Mention extension with `char: '@'`

### Target State

| Trigger | Semantic | Content |
|---------|----------|---------|
| `@` | Reference context | context, files, resources, workspace files |
| `/` | Invoke capability | **skills**, prompts, tools |

### Technical Approach

#### 1.1 Create Slash Suggestion Module

Create new file: `src/renderer/src/components/editor/mention/slashSuggestion.ts`

```typescript
// Similar structure to suggestion.ts but with char: '/'
export default {
  char: '/',
  allowedPrefixes: null,
  items: ({ query }) => {
    // Return skills + prompts + tools
  },
  render: () => { /* Same popup renderer */ }
}
```

#### 1.2 Create Slash Extension

Create new file: `src/renderer/src/components/editor/mention/slashMention.ts`

```typescript
import TipTMention from '@tiptap/extension-mention'

export const SlashMention = TipTMention.extend({
  name: 'slashMention',  // Different name to coexist with @mention
  // ... same attributes as mention.ts
})
```

#### 1.3 Update ChatInput.vue

Add SlashMention extension to editor:

```typescript
// In editor extensions array
SlashMention.configure({
  HTMLAttributes: {
    class: 'slash-mention px-1.5 py-0.5 text-xs rounded-md bg-primary/10 ...'
  },
  suggestion: slashSuggestion,
  deleteTriggerWithBackspace: true
})
```

#### 1.4 Update suggestion.ts

Remove `tools` and `prompts` from `@` categories:

```typescript
const categorizedData: CategorizedData[] = [
  { label: 'context', icon: 'lucide:quote', type: 'category' },
  { label: 'files', icon: 'lucide:files', type: 'category' },
  { label: 'resources', icon: 'lucide:swatch-book', type: 'category' }
  // tools and prompts moved to /
]
```

#### 1.5 Add Skills Data Source

Create composable: `src/renderer/src/components/chat-input/composables/useSkillsData.ts`

```typescript
export function useSkillsData(conversationId: Ref<string | null>) {
  const skillPresenter = usePresenter('skillPresenter')
  const skills = ref<SkillMetadata[]>([])
  const activeSkills = ref<string[]>([])

  // Fetch skills metadata
  const loadSkills = async () => {
    skills.value = await skillPresenter.getMetadataList()
  }

  // Fetch active skills for current conversation
  const loadActiveSkills = async () => {
    if (!conversationId.value) return
    activeSkills.value = await skillPresenter.getActiveSkills(conversationId.value)
  }

  return { skills, activeSkills, loadSkills, loadActiveSkills }
}
```

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/components/editor/mention/slashSuggestion.ts` | **New** - `/` trigger logic |
| `src/renderer/src/components/editor/mention/slashMention.ts` | **New** - TipTap extension |
| `src/renderer/src/components/editor/mention/suggestion.ts` | Remove tools/prompts categories |
| `src/renderer/src/components/chat-input/ChatInput.vue` | Add SlashMention extension |
| `src/renderer/src/components/chat-input/composables/useSkillsData.ts` | **New** - Skills data source |
| `src/renderer/src/components/chat-input/composables/useMentionData.ts` | Split @ and / data |

---

## Decision 2: Flatten Menus

### Goal

Remove secondary category selection, show flat filtered list directly.

### Current State

- [MentionList.vue](../../../src/renderer/src/components/editor/mention/MentionList.vue) uses `isCategoryView` state
- First shows categories, then items within selected category
- `displayItems` computed filters by `currentCategory`

### Target State

- Single flat list showing all matching items
- Icons distinguish item types
- No category navigation needed

### Technical Approach

#### 2.1 Simplify MentionList.vue

Remove category navigation logic:

```typescript
// Remove these:
const currentCategory = ref<string | null>(null)
const isCategoryView = computed(...)
const backHandler = () => {...}

// Simplify displayItems:
const displayItems = computed<CategorizedData[]>(() => {
  if (props.query) {
    return props.items.filter(item =>
      item.label.toLowerCase().includes(props.query.toLowerCase())
    ).slice(0, 10)
  }
  return props.items.slice(0, 10)
})
```

#### 2.2 Add Type Icons

Update template to show type-specific icons:

```vue
<template>
  <div class="flex items-center gap-2">
    <!-- Type indicator icon -->
    <span v-if="item.category === 'skills'" class="text-amber-500">✨</span>
    <span v-else-if="item.category === 'prompts'" class="text-blue-500">💬</span>
    <span v-else-if="item.category === 'tools'" class="text-green-500">🔧</span>
    <Icon v-else-if="item.icon" :icon="item.icon" class="size-4" />

    <span class="flex-1 truncate">{{ item.label }}</span>
    <span v-if="item.description" class="text-xs text-muted-foreground truncate max-w-32">
      {{ item.description }}
    </span>
  </div>
</template>
```

#### 2.3 Update Data Structure

Ensure all items have proper `category` and `description`:

```typescript
interface CategorizedData {
  label: string
  icon?: string
  id?: string
  type: 'item'  // No more 'category' type
  category: 'context' | 'files' | 'resources' | 'skills' | 'prompts' | 'tools'
  description?: string
  // ... other fields
}
```

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/components/editor/mention/MentionList.vue` | Remove category navigation, flatten UI |
| `src/renderer/src/components/editor/mention/suggestion.ts` | Update CategorizedData type |

---

## Decision 3: Skills Indicator

### Goal

Add visible Skills indicator in chat input toolbar showing active skills count and quick management panel.

### Current State

- No Skills UI in chat input
- Toolbar has: Mode, Folder, Attach, Web, MCP
- Skills only manageable via settings page

### Target State

```
┌──────────────────────────────────────────────────────────────────┐
│ [Mode ▾] [📁] [📎] [🌐] [MCP ▾]  [✨ 2]        [Model ▾] [⚙️] [↑]│
│                                   ↑                              │
│                          Skills indicator                        │
└──────────────────────────────────────────────────────────────────┘
```

### Technical Approach

#### 3.1 Create SkillsIndicator Component

New file: `src/renderer/src/components/chat-input/SkillsIndicator.vue`

```vue
<template>
  <Popover v-model:open="panelOpen">
    <PopoverTrigger>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            :class="[
              'flex items-center gap-1.5 h-7 text-xs px-1.5 rounded-lg',
              activeCount > 0 ? 'text-primary border-primary/50' : ''
            ]"
          >
            <Icon icon="lucide:sparkles" class="w-4 h-4" />
            <span v-if="activeCount > 0">{{ activeCount }}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ activeCount > 0
            ? t('skills.indicator.active', { count: activeCount })
            : t('skills.indicator.none')
          }}
        </TooltipContent>
      </Tooltip>
    </PopoverTrigger>

    <PopoverContent class="w-72 p-0" align="start">
      <SkillsPanel
        :skills="skills"
        :active-skills="activeSkills"
        @toggle="handleToggle"
        @manage="openSettings"
      />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSkillsData } from './composables/useSkillsData'

const props = defineProps<{
  conversationId: string | null
}>()

const { skills, activeSkills, toggleSkill } = useSkillsData(
  computed(() => props.conversationId)
)

const activeCount = computed(() => activeSkills.value.length)
const panelOpen = ref(false)

const handleToggle = async (skillName: string) => {
  await toggleSkill(skillName)
}

const openSettings = () => {
  // Navigate to settings/skills
  window.api.openSettings('skills')
}
</script>
```

#### 3.2 Create SkillsPanel Component

New file: `src/renderer/src/components/chat-input/SkillsPanel.vue`

```vue
<template>
  <div class="divide-y">
    <!-- Header -->
    <div class="p-2 flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <Icon icon="lucide:sparkles" class="w-4 h-4 text-primary" />
        <span class="text-sm font-medium">{{ t('skills.panel.title') }}</span>
      </div>
      <Button variant="ghost" size="sm" @click="$emit('manage')">
        {{ t('skills.panel.manage') }}
      </Button>
    </div>

    <!-- Active Skills -->
    <div v-if="activeSkills.length > 0" class="p-2 space-y-1">
      <div class="text-xs text-muted-foreground mb-1">
        {{ t('skills.panel.active') }}
      </div>
      <div
        v-for="skill in activeSkillItems"
        :key="skill.name"
        class="flex items-center justify-between p-1.5 rounded hover:bg-muted"
      >
        <div class="flex items-center gap-2">
          <span class="text-amber-500">●</span>
          <span class="text-sm">{{ skill.name }}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          @click="$emit('toggle', skill.name)"
        >
          <Icon icon="lucide:x" class="w-3 h-3" />
        </Button>
      </div>
    </div>

    <!-- Available Skills -->
    <div v-if="availableSkills.length > 0" class="p-2 space-y-1">
      <div class="text-xs text-muted-foreground mb-1">
        {{ t('skills.panel.available') }}
      </div>
      <div
        v-for="skill in availableSkills"
        :key="skill.name"
        class="flex items-center justify-between p-1.5 rounded hover:bg-muted"
      >
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground">○</span>
          <span class="text-sm">{{ skill.name }}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          @click="$emit('toggle', skill.name)"
        >
          <Icon icon="lucide:plus" class="w-3 h-3" />
        </Button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="skills.length === 0" class="p-4 text-center text-sm text-muted-foreground">
      {{ t('skills.panel.empty') }}
    </div>
  </div>
</template>
```

#### 3.3 Update ChatInput.vue

Add SkillsIndicator to toolbar:

```vue
<!-- In template, after McpToolsList -->
<McpToolsList />
<SkillsIndicator :conversation-id="conversationId" />
```

#### 3.4 Create Skills Store

New file: `src/renderer/src/stores/skillsActiveStore.ts`

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SkillMetadata } from '@shared/types/skill'

export const useSkillsActiveStore = defineStore('skillsActive', () => {
  const skills = ref<SkillMetadata[]>([])
  const activeSkillsByConversation = ref<Map<string, string[]>>(new Map())

  const getActiveSkills = (conversationId: string) => {
    return activeSkillsByConversation.value.get(conversationId) || []
  }

  const setActiveSkills = (conversationId: string, skillNames: string[]) => {
    activeSkillsByConversation.value.set(conversationId, skillNames)
  }

  const toggleSkill = async (conversationId: string, skillName: string) => {
    const current = getActiveSkills(conversationId)
    const isActive = current.includes(skillName)
    const updated = isActive
      ? current.filter(s => s !== skillName)
      : [...current, skillName]
    setActiveSkills(conversationId, updated)

    // Sync to backend
    await window.api.skillPresenter.setActiveSkills(conversationId, updated)
  }

  return {
    skills,
    getActiveSkills,
    setActiveSkills,
    toggleSkill
  }
})
```

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/components/chat-input/SkillsIndicator.vue` | **New** |
| `src/renderer/src/components/chat-input/SkillsPanel.vue` | **New** |
| `src/renderer/src/components/chat-input/ChatInput.vue` | Add SkillsIndicator |
| `src/renderer/src/stores/skillsActiveStore.ts` | **New** |
| `src/renderer/src/components/chat-input/composables/useSkillsData.ts` | **New** |

### i18n Keys

```yaml
skills:
  indicator:
    active: "{count} skills active"
    none: "No skills active"
  panel:
    title: "Skills"
    manage: "Manage"
    active: "Active"
    available: "Available"
    empty: "No skills installed"
```

---

## Decision 4: Sync Flow Optimization

### Goal

Improve skills sync discoverability with proactive detection and clear status display.

### Current State

- Sync hidden in dropdown: `[同步 ▾] → 导入 / 导出`
- No detection of external AI tools
- No sync status visibility
- Located in [SkillsHeader.vue](../../../src/renderer/settings/components/skills/SkillsHeader.vue)

### Target State

1. Proactive detection of external AI tools on first launch
2. Dedicated sync status section in settings
3. Clear last-sync timestamps and skill counts per tool

### Technical Approach

#### 4.1 Create SyncStatusSection Component

New file: `src/renderer/settings/components/skills/SyncStatusSection.vue`

```vue
<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium">{{ t('skills.sync.title') }}</h3>
      <Button variant="outline" size="sm" @click="refreshAll">
        <Icon icon="lucide:refresh-cw" class="w-4 h-4 mr-1" />
        {{ t('skills.sync.refreshAll') }}
      </Button>
    </div>

    <div class="space-y-2">
      <SyncStatusCard
        v-for="tool in detectedTools"
        :key="tool.id"
        :tool="tool"
        @sync="handleSync"
      />
    </div>

    <div v-if="detectedTools.length === 0" class="text-sm text-muted-foreground p-4 text-center">
      {{ t('skills.sync.noToolsDetected') }}
    </div>
  </div>
</template>
```

#### 4.2 Create SyncStatusCard Component

New file: `src/renderer/settings/components/skills/SyncStatusCard.vue`

```vue
<template>
  <div class="flex items-center justify-between p-3 border rounded-lg">
    <div class="flex items-center gap-3">
      <!-- Status indicator -->
      <div :class="statusColorClass" class="w-2 h-2 rounded-full" />

      <!-- Tool info -->
      <div>
        <div class="text-sm font-medium">{{ tool.name }}</div>
        <div class="text-xs text-muted-foreground">
          <template v-if="tool.connected">
            {{ tool.skillCount }} skills · {{ formatLastSync(tool.lastSync) }}
          </template>
          <template v-else>
            {{ t('skills.sync.notConnected') }}
          </template>
        </div>
      </div>
    </div>

    <!-- Action button -->
    <Button
      v-if="tool.connected"
      variant="outline"
      size="sm"
      :disabled="syncing"
      @click="$emit('sync', tool.id)"
    >
      <Icon v-if="syncing" icon="lucide:loader" class="w-4 h-4 animate-spin" />
      <span v-else>{{ t('skills.sync.sync') }}</span>
    </Button>
    <Button v-else variant="outline" size="sm" @click="openSetup(tool.id)">
      {{ t('skills.sync.setup') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  tool: {
    id: string
    name: string
    connected: boolean
    skillCount?: number
    lastSync?: Date
  }
}>()

const statusColorClass = computed(() => {
  if (!props.tool.connected) return 'bg-gray-400'
  if (props.tool.skillCount === 0) return 'bg-yellow-500'
  return 'bg-green-500'
})

const formatLastSync = (date?: Date) => {
  if (!date) return ''
  // Use relative time formatting
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const diff = Date.now() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.floor(hours / 24), 'day')
}
</script>
```

#### 4.3 Add External Tool Detection

Create: `src/main/presenter/skillSyncPresenter/toolDetection.ts`

```typescript
import fs from 'fs'
import path from 'path'
import os from 'os'

interface DetectedTool {
  id: string
  name: string
  configPath: string
  exists: boolean
}

const TOOL_PATHS = {
  'claude-code': {
    win32: path.join(os.homedir(), '.claude', 'settings.json'),
    darwin: path.join(os.homedir(), '.claude', 'settings.json'),
    linux: path.join(os.homedir(), '.claude', 'settings.json')
  },
  'cursor': {
    win32: path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage'),
    darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage'),
    linux: path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage')
  },
  // ... other tools
}

export function detectExternalTools(): DetectedTool[] {
  const platform = process.platform as 'win32' | 'darwin' | 'linux'
  const detected: DetectedTool[] = []

  for (const [id, paths] of Object.entries(TOOL_PATHS)) {
    const configPath = paths[platform]
    if (configPath) {
      detected.push({
        id,
        name: formatToolName(id),
        configPath,
        exists: fs.existsSync(configPath)
      })
    }
  }

  return detected.filter(t => t.exists)
}

function formatToolName(id: string): string {
  const names: Record<string, string> = {
    'claude-code': 'Claude Code',
    'cursor': 'Cursor',
    'windsurf': 'Windsurf',
    'github-copilot': 'GitHub Copilot',
    // ...
  }
  return names[id] || id
}
```

#### 4.4 Add First-Launch Detection Prompt

In settings initialization or first app launch, check for external tools:

```typescript
// In renderer settings initialization
const checkFirstLaunch = async () => {
  const hasShownSyncPrompt = await configPresenter.getSetting('skills.syncPromptShown')
  if (hasShownSyncPrompt) return

  const detectedTools = await skillSyncPresenter.detectExternalTools()
  if (detectedTools.length > 0) {
    // Show prompt dialog
    showSyncPromptDialog(detectedTools)
  }

  await configPresenter.setSetting('skills.syncPromptShown', true)
}
```

#### 4.5 Update SkillsSettings.vue

Add sync status section:

```vue
<template>
  <div class="space-y-6">
    <!-- Existing header -->
    <SkillsHeader ... />

    <!-- NEW: Sync Status Section -->
    <SyncStatusSection />

    <!-- Existing skills list -->
    <SkillsList ... />
  </div>
</template>
```

### Files Changed

| File | Change |
|------|--------|
| `src/renderer/settings/components/skills/SyncStatusSection.vue` | **New** |
| `src/renderer/settings/components/skills/SyncStatusCard.vue` | **New** |
| `src/renderer/settings/components/skills/SkillsSettings.vue` | Add SyncStatusSection |
| `src/main/presenter/skillSyncPresenter/toolDetection.ts` | **New** |
| `src/main/presenter/skillSyncPresenter/index.ts` | Add detection methods |

### i18n Keys

```yaml
skills:
  sync:
    title: "Sync Status"
    refreshAll: "Refresh All"
    sync: "Sync"
    setup: "Setup"
    notConnected: "Not connected"
    noToolsDetected: "No external AI tools detected"
    lastSync: "Last synced {time}"
    skillCount: "{count} skills"
```

---

## Implementation Order

| Phase | Components | Priority |
|-------|------------|----------|
| 1 | Flatten menus (Decision 2) | P0 |
| 2 | Skills Indicator (Decision 3) | P0 |
| 3 | Slash trigger (Decision 1) | P0 |
| 4 | Sync optimization (Decision 4) | P1 |

### Rationale

1. **Flatten menus first** - Simplest change, improves existing UX immediately
2. **Skills indicator second** - Core visibility improvement, relatively self-contained
3. **Slash trigger third** - Depends on having skills data accessible, more complex
4. **Sync optimization last** - Enhancement layer, not blocking core functionality

---

## Testing Considerations

### Unit Tests

- `useSkillsData` composable: skill loading, activation toggling
- `slashSuggestion`: filtering, ordering
- Flatten logic in `MentionList.vue`

### Integration Tests

- `/` trigger shows skills + prompts + tools
- `@` trigger shows context + files + resources only
- Skills indicator updates on activation/deactivation
- Sync status reflects actual tool states

### E2E Tests

- User types `/` → sees skills list → selects skill → skill activated
- User clicks skills indicator → panel opens → can toggle skills
- User opens settings → sees sync status → can sync tools

---

## Migration Notes

### Breaking Changes

None. All changes are additive or modify internal behavior.

### Backward Compatibility

- Existing `@` mentions continue to work (subset of categories)
- Existing skill activation via AI tools unchanged
- Settings page structure preserved

### Data Migration

None required. Skills state already stored per-conversation in database.
