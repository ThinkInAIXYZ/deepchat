# Discord-Style Icon Sidebar Specification

**Status**: Draft
**Created**: 2026-01-17
**Owner**: UI/UX Team

---

## 1. Overview

### 1.1 Design Goal

Create a **pure icon sidebar** similar to Discord's server list. Each open conversation tab displays only an icon representing the agent/model being used, with the title shown as a tooltip on hover.

### 1.2 Key Requirements

1. **Icon-Only Display**: No text titles, only icons
2. **Agent/Model Icons**: Icon is the actual agent or model icon (not generic mode icons)
3. **Open Tabs Only**: List shows only currently open conversation tabs
4. **Vertical Scrolling**: All items scroll together
5. **Inline Add Button**: Add button at the end of list, scrolls with items
6. **Selection Effect**: Clear visual feedback for active conversation

---

## 2. Visual Design

### 2.1 Layout Comparison

**BEFORE (Current Design)**:
```
┌───────────────────────────┐
│     Conversations         │
├───────────────────────────┤
│ 💬 Project Planning    ×  │
│ 💬 Code Review         ×  │
│ 💬 Bug Analysis        ×  │
│                           │
├───────────────────────────┤
│ ➕ New Conversation       │  ← Fixed at bottom
└───────────────────────────┘
```

**AFTER (Discord-Style Icon Sidebar)**:
```
┌──────┐
│      │
│▌[◉] │ ← Active tab (Claude icon + pill indicator)
│      │
│  ◎   │ ← Inactive tab (Kimi icon)
│      │
│  ◉   │ ← Inactive tab (GPT icon)
│      │
│  ➕  │ ← Add button (always at end)
│      │
│      │
│      │
└──────┘
```

### 2.2 Icon Sources

| Chat Mode | Icon Source | Example |
|-----------|-------------|---------|
| **Agent** | Model/Provider icon | Claude icon, GPT icon, Gemini icon |
| **ACP Agent** | ACP agent icon | Claude Code icon, Kimi CLI icon, Codex icon |

**Icon Resolution Logic**:
```typescript
function getConversationIcon(conversation: Conversation): string {
  const { chatMode, modelId, providerId } = conversation.settings

  if (chatMode === 'acp agent') {
    // Use ACP agent's icon (from builtin templates or custom)
    return getAcpAgentIcon(modelId)
  } else {
    // Use model/provider icon
    return getModelIcon(modelId, providerId)
  }
}
```

### 2.3 Item States

#### 2.3.1 Inactive State
```
┌────────┐
│        │
│   ◉    │  ← Agent/model icon, rounded square
│        │
└────────┘
```
- Background: `bg-muted/50`
- Size: 48x48px (icon 28x28px)
- Border-radius: 12px

#### 2.3.2 Hover State
```
┌────────┐
│ ╭────╮ │
│ │ ◉  │ │  ← Slightly larger, background highlight
│ ╰────╯ │
└────────┘
     ↑
  Tooltip: "Project Planning"
```
- Background: `bg-accent`
- Scale: 1.05
- Border-radius transitions to 16px
- Show tooltip with conversation title

#### 2.3.3 Active State
```
┌────────┐
│▌╭────╮│
│▌│ ◉  ││  ← Left pill indicator + highlight
│▌╰────╯│
└────────┘
```
- Left pill indicator (4px wide, full height)
- Background: `bg-accent`

#### 2.3.4 Mode Switching Animation
When user switches agent/model in a conversation:
```
Frame 1:  ◉  (old icon fade out, scale 0.8)
Frame 2:  ·  (transition)
Frame 3:  ◎  (new icon fade in, scale 1.0)
```
- Duration: 300ms
- Easing: ease-in-out

---

## 3. Data Model

### 3.1 What the List Shows

**Only currently open conversation tabs** — not all historical conversations.

```
Open Tabs:                    Sidebar Shows:
┌─────────────────────┐       ┌──────┐
│ Tab 1: Claude Chat  │  ───→ │▌[◉] │ (active)
│ Tab 2: Kimi Agent   │  ───→ │  ◎   │
│ Tab 3: GPT Chat     │  ───→ │  ◉   │
└─────────────────────┘       │  ➕  │ (add button)
                              └──────┘
```

### 3.2 Enhanced ConversationMeta

```typescript
export interface ConversationMeta {
  id: string
  title: string                    // For tooltip
  lastMessageAt: Date
  isLoading: boolean
  hasError: boolean

  // Icon resolution
  chatMode: 'agent' | 'acp agent'  // Determines icon source
  modelId: string                   // Model ID or ACP agent ID
  providerId: string                // Provider ID or 'acp'
  resolvedIcon?: string             // Cached resolved icon URL/identifier
}
```

### 3.3 Icon Resolution

```typescript
// For ACP agents - use agent's icon from builtin templates
const ACP_AGENT_ICONS: Record<string, string> = {
  'claude-code-acp': '/path/to/claude-code-icon.svg',
  'kimi-cli': '/path/to/kimi-icon.svg',
  'codex-acp': '/path/to/codex-icon.svg',
  'opencode': '/path/to/opencode-icon.svg',
  'gemini-cli': '/path/to/gemini-icon.svg',
  'qwen-code': '/path/to/qwen-icon.svg',
}

// For regular models - use provider icon from modelStore
function getModelIcon(modelId: string, providerId: string): string {
  const provider = modelStore.getProvider(providerId)
  return provider?.websites?.icon || getDefaultProviderIcon(providerId)
}
```

---

## 4. Detailed Mockups

### 4.1 Empty State (No Open Tabs)

```
┌──────┐
│      │
│  ➕  │  ← Only add button
│      │
│      │
│      │
│      │
└──────┘
```

### 4.2 Single Open Tab

```
┌──────┐
│      │
│▌[◉] │  ← Active tab (e.g., Claude icon)
│      │
│  ➕  │  ← Add button
│      │
│      │
└──────┘
```

### 4.3 Multiple Open Tabs

```
┌──────┐
│      │
│▌[◉] │  ← Active: Claude Code
│      │
│  ◎   │  ← Inactive: Kimi CLI
│      │
│  ◉   │  ← Inactive: GPT-4
│      │
│  ➕  │  ← Add button (always last)
│      │
└──────┘
```

### 4.4 Many Tabs (Scrolling)

```
┌──────┐
│  ◉   │  ↑
│      │  │
│  ◎   │  │ Scroll
│      │  │ Area
│  ◉   │  │
│      │  │
│  ➕  │  ↓
└──────┘
```

### 4.5 Hover with Tooltip

```
┌──────┐
│      │
│▌[◉] │──→ ┌─────────────────────┐
│      │    │ Project Planning    │  ← Tooltip shows title
│  ◎   │    └─────────────────────┘
│      │
│  ◉   │
│      │
│  ➕  │
└──────┘
```

---

## 5. Interaction Design

### 5.1 Click Behavior

| Action | Result |
|--------|--------|
| Click inactive tab | Switch to that conversation |
| Click active tab | No change (already selected) |
| Click add button | Create new conversation tab |

### 5.2 Hover Behavior

| Action | Result |
|--------|--------|
| Hover on tab | Show tooltip with title, highlight background, show small pill |
| Hover on add button | Show "New Conversation" tooltip |

### 5.3 Selection Indicator (Discord-Style Pill)

```
┌──────┐
│      │
│▌[◉] │  ← Active: tall left pill (40px)
│      │
│ ◎    │  ← Hover: short pill (20px)
│      │
│  ◉   │  ← Inactive: no pill
│      │
└──────┘
```

---

## 6. CSS Specifications

### 6.1 Sidebar Container

```css
.icon-sidebar {
  width: 64px;
  min-width: 64px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-background);
  border-right: 1px solid var(--border);
}

.scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
```

### 6.2 Icon Item

```css
.icon-item {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  cursor: pointer;
  position: relative;
  transition: all 200ms ease;
  background: var(--muted);
}

.icon-item:hover {
  background: var(--accent);
  transform: scale(1.05);
  border-radius: 16px;
}

.icon-item.active {
  background: var(--accent);
}

/* Agent/Model icon */
.icon-item .agent-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: contain;
}

/* Left pill indicator (Discord-style) */
.icon-item::before {
  content: '';
  position: absolute;
  left: -8px;
  width: 4px;
  height: 0;
  background: var(--foreground);
  border-radius: 0 4px 4px 0;
  transition: height 200ms ease;
}

.icon-item:hover::before {
  height: 20px;
}

.icon-item.active::before {
  height: 40px;
}
```

### 6.3 Add Button

```css
.add-button {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  cursor: pointer;
  background: var(--muted);
  color: var(--muted-foreground);
  transition: all 200ms ease;
}

.add-button:hover {
  background: var(--primary);
  color: var(--primary-foreground);
  border-radius: 16px;
}
```

### 6.4 Icon Switch Animation

```css
.icon-item .agent-icon {
  transition: opacity 150ms ease, transform 150ms ease;
}

.icon-item.switching .agent-icon {
  animation: icon-switch 300ms ease-in-out;
}

@keyframes icon-switch {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1); }
}
```

---

## 7. Component Structure

### 7.1 IconSidebar.vue

```vue
<template>
  <div class="icon-sidebar">
    <div class="scroll-container">
      <!-- Open conversation tabs -->
      <IconItem
        v-for="tab in openTabs"
        :key="tab.id"
        :conversation="tab"
        :is-active="tab.id === activeTabId"
        @click="selectTab(tab.id)"
      />

      <!-- Add button (always at end) -->
      <AddButton @click="createNewTab" />
    </div>
  </div>
</template>
```

### 7.2 IconItem.vue

```vue
<template>
  <div
    class="icon-item"
    :class="{ active: isActive }"
    v-tooltip="conversation.title"
  >
    <img
      :src="resolvedIcon"
      :alt="conversation.title"
      class="agent-icon"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  conversation: ConversationMeta
  isActive: boolean
}>()

const resolvedIcon = computed(() => {
  return resolveConversationIcon(props.conversation)
})
</script>
```

---

## 8. Implementation Steps

### Phase 1: Basic Structure
1. Create `IconSidebar.vue` replacing current sidebar
2. Create `IconItem.vue` for tab icons
3. Set fixed width (64px) layout
4. Implement scroll container

### Phase 2: Icon Resolution
1. Add icon resolution logic for ACP agents
2. Add icon resolution logic for regular models
3. Cache resolved icons in store
4. Handle missing/fallback icons

### Phase 3: Visual Polish
1. Add pill indicator for active/hover states
2. Implement hover effects and transitions
3. Add tooltips for conversation titles
4. Style add button

### Phase 4: Integration
1. Connect to sidebar/tab store
2. Handle tab selection events
3. Handle new tab creation
4. Sync with existing tab management

---

## 9. Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/src/components/sidebar/VerticalSidebar.vue` | Replace with icon-only layout |
| `src/renderer/src/components/sidebar/ConversationTab.vue` | Convert to `IconItem.vue` |
| `src/renderer/src/stores/sidebarStore.ts` | Add icon resolution, ensure open tabs only |
| New: `src/renderer/src/components/sidebar/IconItem.vue` | Icon item component |
| New: `src/renderer/src/components/sidebar/IconSidebar.vue` | Main sidebar component |
| `src/renderer/src/utils/iconResolver.ts` | Icon resolution utilities |

---

## 10. Summary

**Key Design Decisions**:

| Aspect | Decision |
|--------|----------|
| Display | Icon only (no text) |
| Icons | Actual agent/model icons (not generic) |
| Content | Open tabs only (not all history) |
| Add Button | Always at end, scrolls with list |
| Width | 64px fixed |
| Selection | Discord-style left pill indicator |
| Titles | Tooltip on hover |

**Visual Summary**:
```
BEFORE:                       AFTER:
┌─────────────────────┐       ┌──────┐
│ 💬 Project Planning │       │      │
│ 💬 Code Review      │  →    │▌[◉] │ Claude icon (active)
│ 💬 Bug Analysis     │       │  ◎   │ Kimi icon
├─────────────────────┤       │  ◉   │ GPT icon
│ ➕ New              │       │  ➕  │ Add button
└─────────────────────┘       └──────┘
                                 ↑
                              Tooltip: "Project Planning"
```

---

**End of Specification**
