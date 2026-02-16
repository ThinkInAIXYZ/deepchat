# Phase 3: WindowSideBar Refactor

## Overview

改造 WindowSideBar 组件，实现：
1. 左侧 Agent 列表（48px 宽度）
2. 右侧 Session 列表（240px 宽度）
3. Session 分组逻辑（按项目/按时间）
4. 真实数据源绑定

## Style Reference

严格遵循 `src/renderer/src/components/WindowSideBar.vue` 现有样式：

### 布局结构
```css
/* 整体容器 */
.sidebar { @apply flex h-full overflow-hidden; }

/* 左列 Agent Icons */
.agent-panel {
  @apply flex flex-col items-center shrink-0;
  width: 48px; /* collapsed 时 macOS 70px */
}

/* 右列 Session List */
.session-panel {
  @apply flex-1 min-w-0 flex flex-col;
  width: 240px; /* 展开时 */
}
```

### Agent Icon 按钮
```css
.agent-btn {
  @apply w-9 h-9 rounded-xl flex items-center justify-center;
  @apply bg-transparent border-none shadow-none;
  @apply hover:bg-white/30 dark:hover:bg-white/10;
  @apply transition-all duration-150;
}

.agent-btn.active {
  @apply bg-card/50 border-white/80 dark:border-white/20;
  @apply ring-1 ring-black/10;
}

.agent-btn-icon {
  @apply w-4 h-4 text-foreground/80;
}
```

### Session Item
```css
.session-item {
  @apply px-2 py-1.5 rounded-md cursor-pointer;
  @apply text-foreground/80 hover:bg-accent/50;
  @apply transition-colors;
}

.session-item.active {
  @apply bg-accent text-accent-foreground;
}

.session-title {
  @apply text-sm truncate;
}
```

### Group 标题
```css
.group-header {
  @apply px-1.5 pt-3 pb-1;
  @apply text-xs font-medium text-muted-foreground;
}
```

## UI Design

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│                        Main Window                          │
├──────────┬─────────────────┬────────────────────────────────┤
│  Agent   │  Session List   │         Main Content           │
│  Icons   │                 │                                │
│  48px    │     240px       │         flexible               │
│          │                 │                                │
│ ┌──────┐ │ ┌─────────────┐ │ ┌────────────────────────────┐ │
│ │ 🔵   │ │ │ 🔍 Search   │ │ │                            │ │
│ ├──────┤ │ ├─────────────┤ │ │                            │ │
│ │ 🟢   │ │ │ ▼ Project A │ │ │      Chat / Welcome        │ │
│ ├──────┤ │ │   • Sess 1  │ │ │                            │ │
│ │ 🟡   │ │ │   • Sess 2  │ │ │                            │ │
│ │      │ │ │ ▶ Project B │ │ │                            │ │
│ │      │ │ │   • Sess 3  │ │ │                            │ │
│ │      │ │ ├─────────────┤ │ ├────────────────────────────┤ │
│ │      │ │ │ + New Chat  │ │ │  InputBox + Toolbar        │ │
│ └──────┘ │ └─────────────┘ │ └────────────────────────────┘ │
│ ┌──────┐ │                 │                                │
│ │  +   │ │                 │                                │
│ └──────┘ │                 │                                │
└──────────┴─────────────────┴────────────────────────────────┘
```

### Agent Panel (Left - 48px)

```
┌──────────┐
│          │
│  ┌────┐  │
│  │ 🤖 │  │  <- Template Agent (icon)
│  └────┘  │
│  ┌────┐  │
│  │ 🟢 │  │  <- ACP Agent (status indicator)
│  └────┘  │
│  ┌────┐  │
│  │ 📁 │  │  <- Template Agent
│  └────┘  │
│          │
│  ┌────┐  │
│  │ +  │  │  <- Create new Agent (opens settings)
│  └────┘  │
│          │
└──────────┘
```

### Session Panel (Right - 240px)

```
┌────────────────────────────────┐
│  🔍 Search sessions...         │
├────────────────────────────────┤
│  [📋 Project] [📅 Time]        │  <- Group toggle
├────────────────────────────────┤
│  📌 Pinned                     │
│    Session Title 1        🗑️   │
│    Session Title 2             │
├────────────────────────────────┤
│  ▼ ~/Projects/deepchat         │  <- Project group
│    Fix bug in sidebar     🗑️   │
│    Add new feature             │
├────────────────────────────────┤
│  ▶ ~/Projects/my-app           │  <- Collapsed project
├────────────────────────────────┤
│  ▼ Today                       │  <- Time group
│    Quick question              │
├────────────────────────────────┤
│  ▶ Yesterday                   │
├────────────────────────────────┤
│  + New Chat                    │
└────────────────────────────────┘
```

## Components

### Component Hierarchy

```
WindowSideBar.vue
├── AgentPanel.vue (left, 48px)
│   └── AgentIconItem.vue
├── SessionPanel.vue (right, 240px)
│   ├── SessionSearchBar.vue
│   ├── SessionGroupToggle.vue
│   ├── SessionList.vue
│   │   ├── SessionGroup.vue (by project/time)
│   │   │   └── SessionItem.vue
│   │   └── SessionItem.vue (flat)
│   └── NewChatButton.vue
└── ResizeHandle.vue (optional)
```

### AgentIconItem

```vue
<template>
  <button
    :class="['agent-icon', { active: isActive }]"
    @click="handleClick"
    :title="agent.name"
  >
    <Icon :name="agent.icon || 'lucide:bot'" />
    <span v-if="agent.type === 'acp'" class="status-indicator" :class="status" />
  </button>
</template>
```

### SessionGroupToggle

```vue
<template>
  <div class="group-toggle">
    <button
      :class="{ active: groupBy === 'project' }"
      @click="setGroupBy('project')"
    >
      <Icon name="lucide:folder" />
      <span>Project</span>
    </button>
    <button
      :class="{ active: groupBy === 'time' }"
      @click="setGroupBy('time')"
    >
      <Icon name="lucide:clock" />
      <span>Time</span>
    </button>
  </div>
</template>
```

## Data Binding

### Agent Store

```typescript
// src/renderer/src/stores/agent.ts
export const useAgentStore = defineStore('agent', () => {
  const agents = ref<Agent[]>([])
  const selectedAgentId = ref<string | null>(null)
  const loading = ref(false)

  const selectedAgent = computed(() => 
    agents.value.find(a => a.id === selectedAgentId.value)
  )

  const templateAgents = computed(() => 
    agents.value.filter(a => a.type === 'template')
  )

  const acpAgents = computed(() => 
    agents.value.filter(a => a.type === 'acp')
  )

  async function loadAgents() {
    loading.value = true
    try {
      agents.value = await presenter.agentConfigPresenter.getAgents()
      // 如果没有选中的 agent，选中第一个
      if (!selectedAgentId.value && agents.value.length > 0) {
        selectedAgentId.value = agents.value[0].id
      }
    } finally {
      loading.value = false
    }
  }

  function selectAgent(id: string) {
    selectedAgentId.value = id
  }

  return {
    agents,
    selectedAgentId,
    selectedAgent,
    templateAgents,
    acpAgents,
    loading,
    loadAgents,
    selectAgent
  }
})
```

### Session List Store

```typescript
// src/renderer/src/composables/useSessionList.ts
export function useSessionList() {
  const agentStore = useAgentStore()
  const groupBy = ref<'project' | 'time'>('project')
  const searchQuery = ref('')
  
  const allSessions = ref<Session[]>([])
  
  // 根据选中的 agent 过滤
  const filteredSessions = computed(() => {
    let sessions = allSessions.value
    
    // 按 agent 过滤
    if (agentStore.selectedAgentId) {
      sessions = sessions.filter(s => 
        s.config.agentId === agentStore.selectedAgentId
      )
    }
    
    // 按搜索词过滤
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      sessions = sessions.filter(s => 
        s.config.title.toLowerCase().includes(query)
      )
    }
    
    return sessions
  })
  
  // 分组后的 sessions
  const groupedSessions = computed(() => {
    if (groupBy.value === 'project') {
      return groupByProject(filteredSessions.value)
    }
    return groupByTime(filteredSessions.value)
  })
  
  function groupByProject(sessions: Session[]) {
    const groups = new Map<string, Session[]>()
    
    for (const session of sessions) {
      const workdir = session.config.agentWorkspacePath || 'No Project'
      if (!groups.has(workdir)) {
        groups.set(workdir, [])
      }
      groups.get(workdir)!.push(session)
    }
    
    return Array.from(groups.entries()).map(([path, sessions]) => ({
      type: 'project' as const,
      id: path,
      name: path.split('/').pop() || path,
      fullPath: path,
      sessions,
      expanded: true
    }))
  }
  
  function groupByTime(sessions: Session[]) {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    
    const groups = {
      pinned: [] as Session[],
      today: [] as Session[],
      yesterday: [] as Session[],
      thisWeek: [] as Session[],
      older: [] as Session[]
    }
    
    for (const session of sessions) {
      if (session.config.isPinned) {
        groups.pinned.push(session)
        continue
      }
      
      const age = now - session.updatedAt
      if (age < day) {
        groups.today.push(session)
      } else if (age < 2 * day) {
        groups.yesterday.push(session)
      } else if (age < 7 * day) {
        groups.thisWeek.push(session)
      } else {
        groups.older.push(session)
      }
    }
    
    const result = []
    if (groups.pinned.length) {
      result.push({ type: 'time' as const, id: 'pinned', name: 'Pinned', sessions: groups.pinned })
    }
    if (groups.today.length) {
      result.push({ type: 'time' as const, id: 'today', name: 'Today', sessions: groups.today })
    }
    if (groups.yesterday.length) {
      result.push({ type: 'time' as const, id: 'yesterday', name: 'Yesterday', sessions: groups.yesterday })
    }
    if (groups.thisWeek.length) {
      result.push({ type: 'time' as const, id: 'week', name: 'This Week', sessions: groups.thisWeek })
    }
    if (groups.older.length) {
      result.push({ type: 'time' as const, id: 'older', name: 'Older', sessions: groups.older })
    }
    
    return result
  }
  
  return {
    allSessions,
    filteredSessions,
    groupedSessions,
    groupBy,
    searchQuery,
    loadSessions,
    refreshSessions
  }
}
```

## Event Handling

### Agent Selection

```typescript
// 选择 agent 时
function handleAgentClick(agentId: string) {
  agentStore.selectAgent(agentId)
  // 加载该 agent 的 sessions
  sessionList.loadSessions(agentId)
}
```

### Session Actions

```typescript
// 点击 session
function handleSessionClick(sessionId: string) {
  workspaceStore.activateSession(sessionId)
}

// 右键菜单
function handleSessionContextMenu(session: Session, event: MouseEvent) {
  showContextMenu({
    items: [
      { label: 'Rename', action: () => startRename(session) },
      { label: 'Pin', action: () => togglePin(session) },
      { type: 'separator' },
      { label: 'Delete', action: () => deleteSession(session), danger: true }
    ]
  })
}

// 新建 chat
function handleNewChat() {
  const agent = agentStore.selectedAgent
  router.push({ 
    name: 'new-thread',
    query: { agentId: agent?.id }
  })
}
```

## Resize Behavior

```typescript
// 可选：允许用户调整 session panel 宽度
const sessionPanelWidth = ref(240)
const isResizing = ref(false)

function startResize(e: MouseEvent) {
  isResizing.value = true
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
}

function handleResize(e: MouseEvent) {
  const newWidth = e.clientX - 48 // 减去 agent panel 宽度
  sessionPanelWidth.value = Math.min(Math.max(newWidth, 200), 400)
}

function stopResize() {
  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
}
```

## i18n Keys

```json
{
  "sidebar.agents.tooltip.new": "Create new agent",
  "sidebar.sessions.search": "Search sessions...",
  "sidebar.sessions.groupBy.project": "Project",
  "sidebar.sessions.groupBy.time": "Time",
  "sidebar.sessions.newChat": "New Chat",
  "sidebar.sessions.contextMenu.rename": "Rename",
  "sidebar.sessions.contextMenu.pin": "Pin",
  "sidebar.sessions.contextMenu.unpin": "Unpin",
  "sidebar.sessions.contextMenu.delete": "Delete",
  "sidebar.sessions.groups.pinned": "Pinned",
  "sidebar.sessions.groups.today": "Today",
  "sidebar.sessions.groups.yesterday": "Yesterday",
  "sidebar.sessions.groups.thisWeek": "This Week",
  "sidebar.sessions.groups.older": "Older"
}
```

## Files to Create/Modify

### New Files
- `src/renderer/src/stores/agent.ts`
- `src/renderer/src/composables/useSessionList.ts`
- `src/renderer/src/components/sidebar/AgentPanel.vue`
- `src/renderer/src/components/sidebar/AgentIconItem.vue`
- `src/renderer/src/components/sidebar/SessionPanel.vue`
- `src/renderer/src/components/sidebar/SessionSearchBar.vue`
- `src/renderer/src/components/sidebar/SessionGroupToggle.vue`
- `src/renderer/src/components/sidebar/SessionList.vue`
- `src/renderer/src/components/sidebar/SessionGroup.vue`
- `src/renderer/src/components/sidebar/SessionItem.vue`

### Modified Files
- `src/renderer/src/components/WindowSideBar.vue` - 重构为新布局
- `src/main/presenter/sessionPresenter/index.ts` - 添加按 agent 过滤方法

## Dependencies

- Phase 1 (AgentConfigPresenter)
- Phase 2 (Settings - for agent creation link)
- sessionPresenter (for session data)

## Testing

- [ ] Agent selection updates session list
- [ ] Session grouping by project
- [ ] Session grouping by time
- [ ] Session search functionality
- [ ] Session pin/unpin
- [ ] Session delete
- [ ] New chat creation
- [ ] Agent creation link opens settings
