# Phase 6: Shell Removal

## Overview

移除 Shell 层，将 Tab 管理逻辑整合到主 Renderer 进程中：
1. 移除 `src/renderer/shell/` 目录
2. 将 Tab 状态管理合并到 workspace store
3. 更新 Electron 窗口加载配置
4. 清理不再需要的代码

## Core Principle: 复用现有能力

本 phase 复用以下现有组件：

- **Workspace Store**: 将 tab 状态合并到现有 `stores/workspace.ts`
- **路由**: 保持现有 `src/renderer/src/router/` 结构
- **窗口管理**: 复用 `windowPresenter` 的窗口加载模式
- **App 布局**: 在 `App.vue` 中整合侧边栏，保持现有结构

## Current Architecture

```
src/renderer/
├── shell/                    # [TO BE REMOVED]
│   ├── App.vue              # Shell 外壳
│   ├── main.ts              # Shell 入口
│   ├── index.html           # Shell HTML
│   ├── components/
│   │   ├── TabBar.vue       # Tab 栏
│   │   └── ...
│   └── stores/
│       └── tabs.ts          # Tab 状态
├── src/                      # 主应用
│   ├── App.vue
│   ├── main.ts
│   └── ...
└── index.html
```

## Target Architecture

```
src/renderer/
├── src/
│   ├── App.vue              # 合并后的主应用（包含侧边栏 + 内容区）
│   ├── main.ts
│   ├── components/
│   │   ├── WindowSideBar.vue    # 侧边栏
│   │   ├── ChatTabView.vue      # 聊天视图
│   │   └── ...
│   ├── stores/
│   │   ├── workspace.ts     # 包含 Tab 管理
│   │   └── ...
│   └── views/
│       └── ...
└── index.html
```

## Migration Details

### 1. Tab State Integration

将 `shell/stores/tabs.ts` 的功能合并到 `workspace.ts`：

```typescript
// src/renderer/src/stores/workspace.ts

export const useWorkspaceStore = defineStore('workspace', () => {
  // Tab management (from shell/stores/tabs.ts)
  const tabs = ref<Tab[]>([])
  const activeTabId = ref<string | null>(null)
  
  // ... existing workspace state
  
  const activeTab = computed(() => 
    tabs.value.find(t => t.id === activeTabId.value)
  )
  
  function createTab(options: CreateTabOptions): string {
    const id = generateId()
    tabs.value.push({
      id,
      type: options.type,
      title: options.title,
      threadId: options.threadId,
      createdAt: Date.now()
    })
    activeTabId.value = id
    return id
  }
  
  function closeTab(id: string): void {
    const index = tabs.value.findIndex(t => t.id === id)
    if (index === -1) return
    
    tabs.value.splice(index, 1)
    
    // 如果关闭的是当前 tab，切换到相邻的
    if (activeTabId.value === id) {
      const nextTab = tabs.value[Math.min(index, tabs.value.length - 1)]
      activeTabId.value = nextTab?.id || null
    }
  }
  
  function activateTab(id: string): void {
    activeTabId.value = id
  }
  
  function updateTab(id: string, updates: Partial<Tab>): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      Object.assign(tab, updates)
    }
  }
  
  return {
    // Tab state
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    activateTab,
    updateTab,
    // ... existing workspace functions
  }
})
```

### 2. App.vue Refactor

```vue
<!-- src/renderer/src/App.vue -->
<template>
  <div class="app-container">
    <!-- 侧边栏 -->
    <WindowSideBar v-if="showSidebar" />
    
    <!-- 主内容区 -->
    <main class="main-content">
      <!-- Tab 栏 (可选，如果需要) -->
      <TabBar v-if="showTabs" :tabs="tabs" @close="closeTab" @select="activateTab" />
      
      <!-- 内容视图 -->
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
const workspaceStore = useWorkspaceStore()

const showSidebar = computed(() => true) // 可根据配置调整
const showTabs = computed(() => workspaceStore.tabs.length > 1)

const { tabs, closeTab, activateTab } = storeToRefs(workspaceStore)
</script>
```

### 3. Router Update

```typescript
// src/renderer/src/router/index.ts
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/views/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'new-thread',
        component: () => import('@/views/NewThreadView.vue')
      },
      {
        path: 'chat/:threadId',
        name: 'chat',
        component: () => import('@/views/ChatTabView.vue')
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/SettingsView.vue')
      }
    ]
  }
]
```

### 4. Electron Window Config Update

```typescript
// src/main/presenter/windowPresenter/index.ts

// 更新窗口加载路径
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // ... window options
  })
  
  // 直接加载 renderer 入口，不再通过 shell
  if (is.dev) {
    win.loadURL('http://localhost:5173')  // Vite dev server
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  
  return win
}
```

### 5. Files to Remove

```
src/renderer/shell/
├── App.vue
├── main.ts
├── index.html
├── components/
│   └── TabBar.vue (如果不再需要)
├── stores/
│   └── tabs.ts
└── ...
```

## Tab Types

```typescript
// src/shared/types/workspace.ts

export type TabType = 'chat' | 'settings' | 'browser'

export interface Tab {
  id: string
  type: TabType
  title: string
  threadId?: string  // for chat tabs
  icon?: string
  createdAt: number
  updatedAt: number
}

export interface CreateTabOptions {
  type: TabType
  title: string
  threadId?: string
  icon?: string
}
```

## Session to Tab Mapping

```typescript
// 当创建新 session 时自动创建 tab
async function createSessionWithTab(options: CreateSessionOptions): Promise<string> {
  // 1. 创建 session
  const threadId = await sessionPresenter.createSession(options)
  
  // 2. 创建对应的 tab
  const tabId = workspaceStore.createTab({
    type: 'chat',
    title: options.title || 'New Chat',
    threadId
  })
  
  // 3. 激活 tab
  workspaceStore.activateTab(tabId)
  
  return threadId
}

// 当删除 session 时关闭 tab
async function deleteSessionAndCloseTab(threadId: string): Promise<void> {
  // 1. 找到对应的 tab
  const tab = workspaceStore.tabs.find(t => t.threadId === threadId)
  
  // 2. 关闭 tab
  if (tab) {
    workspaceStore.closeTab(tab.id)
  }
  
  // 3. 删除 session
  await sessionPresenter.deleteSession(threadId)
}
```

## Migration Steps

### Step 1: 准备工作
1. 将 `shell/stores/tabs.ts` 逻辑复制到 `workspace.ts`
2. 更新 `workspace.ts` 的类型定义
3. 确保所有 tab 相关功能正常工作

### Step 2: 更新组件
1. 更新 `App.vue` 包含侧边栏
2. 移除对 shell 组件的引用
3. 更新路由配置

### Step 3: 更新入口
1. 更新 electron 窗口加载配置
2. 更新 vite 配置（如果需要）
3. 移除 shell 目录

### Step 4: 测试
1. 验证所有页面正常加载
2. 验证 tab 创建/切换/关闭功能
3. 验证 session 与 tab 的同步

## IPC Events Update

```typescript
// 移除 shell 相关的 IPC 事件
// src/main/events.ts

// 移除:
// - SHELL_CREATE_TAB
// - SHELL_CLOSE_TAB
// - SHELL_ACTIVATE_TAB
// ...

// 保留/更新:
// - TAB_CREATED
// - TAB_CLOSED
// - TAB_ACTIVATED
```

## Files to Create/Modify

### Modified Files
- `src/renderer/src/App.vue` - 整合 shell 逻辑
- `src/renderer/src/stores/workspace.ts` - 添加 tab 管理
- `src/renderer/src/router/index.ts` - 更新路由
- `src/main/presenter/windowPresenter/index.ts` - 更新窗口加载
- `electron.vite.config.ts` - 更新构建配置（如需要）

### Removed Files
- `src/renderer/shell/` - 整个目录
- 相关的 shell 入口配置

## Dependencies

- Phase 1-5 全部完成
- 所有组件已迁移到 renderer/src

## Testing

- [ ] App loads without shell
- [ ] Sidebar displays correctly
- [ ] Tab creation works
- [ ] Tab switching works
- [ ] Tab closing works
- [ ] Session-tab synchronization
- [ ] Navigation between views
- [ ] Settings opens correctly
- [ ] New thread page works
- [ ] Chat page works
- [ ] Build produces correct output

## Rollback Plan

如果出现问题，可以通过以下步骤回滚：
1. 恢复 `shell/` 目录
2. 恢复 electron 窗口加载配置
3. 恢复 `workspace.ts` 中的 tab 相关代码
