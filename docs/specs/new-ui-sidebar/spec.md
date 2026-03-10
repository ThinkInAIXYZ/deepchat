# Sidebar Component Spec

## Overview

The sidebar displays agent filter icons, session list with grouping, and quick action buttons. All data comes from stores — no mock data.

## File Location

`src/renderer/src/components/WindowSideBar.vue`

## Visual Design (must match mock exactly)

```
┌─────────────────────────────────────────────────────┐
│ Agent Icons (48px)  │  Session List (240px)         │
│ ┌─────────────────┐ │ ┌───────────────────────────┐ │
│ │ [All Agents]    │ │ │ Header: Agent Name        │ │
│ │ ────────────    │ │ │        [Group] [+ New]    │ │
│ │ [DeepChat]      │ │ ├───────────────────────────┤ │
│ │ [Claude Code]   │ │ │ Today                     │ │
│ │ [Codex]         │ │ │   - Fix login bug  [v]    │ │
│ │ [Kimi]          │ │ │   - Refactor auth  [~]    │ │
│ │ [My Bot]        │ │ ├───────────────────────────┤ │
│ │                 │ │ │ Yesterday                 │ │
│ │                 │ │ │   - Add dark mode         │ │
│ │ ────────────    │ │ │   - API integration [!]   │ │
│ │ [Collapse]      │ │ └───────────────────────────┘ │
│ │ [Browser]       │ │                               │
│ │ [Settings]      │ │                               │
│ └─────────────────┘ │                               │
└─────────────────────────────────────────────────────┘
```

### Widths

- Expanded: `w-[288px]` (48px agent column + 240px session column)
- Collapsed: `w-12` (agent column only)

## Data Sources (all from stores)

| UI Element | Store Source |
|------------|-------------|
| Agent icon list | `agentStore.enabledAgents` |
| Selected agent | `agentStore.selectedAgentId` |
| Agent name in header | `agentStore.selectedAgentName` |
| Session groups | `sessionStore.getFilteredGroups(agentStore.selectedAgentId)` |
| Active session | `sessionStore.activeSessionId` |
| Group mode toggle | `sessionStore.groupMode` |

## Local State

Only UI-specific state is local to the component:

```typescript
const collapsed = ref(false)
```

Everything else comes from stores.

## Component Implementation

### Agent Icons Column

```vue
<div class="flex flex-col items-center shrink-0 pt-2 pb-2 gap-1 w-12">
  <!-- All agents button -->
  <Button @click="agentStore.selectAgent(null)"
    :class="agentStore.selectedAgentId === null ? 'selected-style' : 'default-style'">
    <Icon icon="lucide:layers" />
  </Button>

  <div class="w-5 h-px bg-border my-1"></div>

  <!-- Agent icons from store -->
  <Button v-for="agent in agentStore.enabledAgents" :key="agent.id"
    @click="agentStore.selectAgent(agent.id)"
    :class="agentStore.selectedAgentId === agent.id ? 'selected-style' : 'default-style'">
    <ModelIcon :model-id="agent.id" />
  </Button>

  <div class="flex-1"></div>
  <div class="w-5 h-px bg-border my-1"></div>

  <!-- Bottom actions: collapse, browser, settings -->
  <Button @click="collapsed = !collapsed">
    <Icon :icon="collapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'" />
  </Button>
  <Button @click="onBrowserClick">
    <Icon icon="lucide:compass" />
  </Button>
  <Button @click="openSettings">
    <Icon icon="lucide:ellipsis" />
  </Button>
</div>
```

### Session List Column

```vue
<div v-show="!collapsed" class="flex flex-col w-0 flex-1 min-w-0">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 h-10 shrink-0">
    <span class="text-sm font-medium truncate">{{ agentStore.selectedAgentName }}</span>
    <div class="flex items-center gap-0.5">
      <button @click="sessionStore.toggleGroupMode()"
        :class="sessionStore.groupMode === 'project' ? 'active' : ''">
        <Icon icon="lucide:folder-kanban" />
      </button>
      <button @click="handleNewChat">
        <Icon icon="lucide:plus" />
      </button>
    </div>
  </div>

  <!-- Session list -->
  <div class="flex-1 overflow-y-auto px-1.5">
    <!-- Empty state -->
    <div v-if="filteredGroups.length === 0" class="...">
      <Icon icon="lucide:message-square-plus" />
      <p>No conversations yet</p>
      <p>Start a new chat to begin</p>
    </div>

    <!-- Groups -->
    <template v-for="group in filteredGroups" :key="group.label">
      <div class="px-1.5 pt-3 pb-1">
        <span class="text-xs font-medium text-muted-foreground">{{ group.label }}</span>
      </div>
      <button v-for="session in group.sessions" :key="session.id"
        :class="sessionStore.activeSessionId === session.id ? 'bg-accent' : 'hover:bg-accent/50'"
        @click="handleSessionClick(session)">
        <span class="flex-1 text-sm truncate">{{ session.title }}</span>
        <!-- Status indicators -->
        <Icon v-if="session.status === 'working'" icon="lucide:loader-2" class="animate-spin" />
        <Icon v-else-if="session.status === 'completed'" icon="lucide:check" />
        <Icon v-else-if="session.status === 'error'" icon="lucide:alert-circle" />
      </button>
    </template>
  </div>
</div>
```

## Computed Properties

```typescript
const filteredGroups = computed(() =>
  sessionStore.getFilteredGroups(agentStore.selectedAgentId)
)
```

## Event Handlers

```typescript
const handleNewChat = () => {
  sessionStore.closeSession()
  // closeSession internally calls pageRouter.goToNewThread()
}

const handleSessionClick = (session: UISession) => {
  sessionStore.selectSession(session.id)
  // selectSession internally calls pageRouter.goToChat(id)
}

const openSettings = () => {
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    windowPresenter.openOrFocusSettingsTab(windowId)
  }
}

const onBrowserClick = async () => {
  try {
    await yoBrowserPresenter.show(true)
  } catch (e) {
    console.warn('Failed to open browser window.', e)
  }
}
```

## Styling Reference

All CSS classes must match the existing `WindowSideBar.vue` mock implementation exactly. Key classes:

- Agent button selected: `bg-card/50 border-white/70 dark:border-white/20 ring-1 ring-black/10`
- Agent button default: `bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10`
- Session item active: `bg-accent text-accent-foreground`
- Session item hover: `text-foreground/80 hover:bg-accent/50`
- Status working: `text-primary animate-spin` (loader-2 icon)
- Status completed: `text-green-500` (check icon)
- Status error: `text-destructive` (alert-circle icon)
- Window drag region: `-webkit-app-region: drag` on container, `no-drag` on buttons

## Test Points

1. Agent icons render from `agentStore.enabledAgents`
2. Clicking agent icon calls `agentStore.selectAgent(id)`
3. Session list renders from `sessionStore.getFilteredGroups()`
4. Clicking session calls `sessionStore.selectSession(id)`
5. New Chat button calls `sessionStore.closeSession()`
6. Group toggle calls `sessionStore.toggleGroupMode()`
7. Collapse toggle hides session column
8. Empty state shows when no sessions match filter
9. Status indicators display correctly per session status
