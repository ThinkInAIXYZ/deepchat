# 路由配置问题分析

## 概述

在 ChatWindow 重构为 Single WebContents Architecture 后，路由配置存在多个问题，导致用户交互路径不清晰，部分路由没有被正确处理。

## 当前路由配置

文件：`src/renderer/src/router/index.ts`

```typescript
routes: [
  {
    path: '/',
    redirect: '/chat'
  },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('@/views/ChatTabView.vue')
  },
  {
    path: '/new',
    name: 'new-conversation',
    component: () => import('@/views/ChatTabView.vue')
  },
  {
    path: '/conversation/:id',
    name: 'conversation',
    component: () => import('@/views/ChatTabView.vue')
  },
  {
    path: '/welcome',
    name: 'welcome',
    component: () => import('@/views/WelcomeView.vue')
  }
]
```

**关键特点：**
- 三个聊天相关路由都使用同一个组件 `ChatTabView.vue`
- 根路径重定向到 `/chat`
- 使用 `createWebHashHistory` 模式

## 问题 1：`/chat` 路由处理不完整

### 问题描述

在 `ChatTabView.vue` 中，路由监听只处理了两种情况：

**文件：** `src/renderer/src/views/ChatTabView.vue:42-54`

```typescript
watch(
  () => route.params.id,
  async (newId) => {
    if (route.name === 'conversation' && newId) {
      // 加载指定会话
      await chatStore.setActiveThread(newId as string)
    } else if (route.name === 'new-conversation') {
      // 清空活动线程
      chatStore.setActiveThreadId(null)
    }
    // ❌ 没有处理 route.name === 'chat' 的情况
  },
  { immediate: true }
)
```

### 影响

- 根路径 `/` 重定向到 `/chat`
- 但访问 `/chat` 时不会触发任何会话加载逻辑
- 用户可能看到空白页面或不确定的状态
- 与 `/new` 路由的区别不清楚

### 相关代码位置

- `src/renderer/src/router/index.ts:11-18` - `/chat` 路由定义
- `src/renderer/src/views/ChatTabView.vue:42-54` - 路由监听逻辑

## 问题 2：Artifact Margin 计算逻辑错误

### 问题描述

在 `ChatTabView.vue` 中，`chatViewMargin` 的计算逻辑可能有误：

**文件：** `src/renderer/src/views/ChatTabView.vue:57-66`

```typescript
const chatViewMargin = computed(() => {
  if (route.name !== 'chat') return ''  // ❌ 逻辑反了

  const artifactOpen = artifactStore.isOpen
  if (artifactOpen) {
    return 'mr-[calc(60%-104px)]'
  }
  return ''
})
```

### 影响

- 这个逻辑表示只有在 `route.name === 'chat'` 时才会计算 margin
- 但实际上用户主要使用的是 `/conversation/:id` 路由（name: 'conversation'）
- 这意味着在查看具体会话时，artifact 的 margin 不会生效
- 用户在查看 artifact 时可能遇到布局问题

### 相关代码位置

- `src/renderer/src/views/ChatTabView.vue:57-66` - margin 计算逻辑

## 问题 3：`activeTab` 循环监听和遗留代码

### 问题描述

在 `App.vue` 中，存在两个相互监听的 watch，可能导致循环触发和路由参数丢失：

**文件：** `src/renderer/src/App.vue:314-337`

```typescript
// Watch 1: activeTab 变化 → 路由导航
watch(
  () => activeTab.value,
  (newVal) => {
    router.push({ name: newVal })
  }
)

// Watch 2: 路由变化 → 更新 activeTab
watch(
  () => route.fullPath,
  (newVal) => {
    const pathWithoutQuery = newVal.split('?')[0]
    const newTab =
      pathWithoutQuery === '/'
        ? (route.name as string)
        : pathWithoutQuery.split('/').filter(Boolean)[0] || ''
    if (newTab !== activeTab.value) {
      activeTab.value = newTab
    }
    // ...
  }
)
```

### 影响

1. **路由参数丢失**：当路由是 `/conversation/123` 时
   - Watch 2 提取第一段路径 → `activeTab = 'conversation'`
   - Watch 1 触发 → `router.push({ name: 'conversation' })`
   - 但 `conversation` 路由需要 `id` 参数，会导致路由错误

2. **遗留代码**：`activeTab` 除了这两个 watch 外没有其他用途，看起来是从旧架构迁移过来的残留

### 相关代码位置

- `src/renderer/src/App.vue:146` - `activeTab` 定义
- `src/renderer/src/App.vue:314-337` - 循环监听逻辑

## 问题 4：状态恢复被调用两次

### 问题描述

在 `App.vue` 中，`sidebarStore.restoreState()` 被调用了两次：

**文件：** `src/renderer/src/App.vue:239 & 248`

```typescript
onMounted(() => {
  // ...

  // 第一次调用：在 onMounted 中直接调用
  void sidebarStore.restoreState()  // Line 239

  // 第二次调用：在 IPC 事件中再次调用
  window.electron.ipcRenderer.on(
    'chat-window:init-state',
    (_event, initState) => {
      if (initState.conversationId) {
        sidebarStore.openConversation(initState.conversationId)
      } else if (initState.restoreState !== false) {
        void sidebarStore.restoreState()  // Line 248
      }
    }
  )
})
```

### 影响

- 状态恢复逻辑会执行两次
- 重复的数据库查询（`sessionPresenter.getConversation`）
- 可能导致路由导航冲突
- 性能浪费

### 相关代码位置

- `src/renderer/src/App.vue:239` - 第一次调用
- `src/renderer/src/App.vue:248` - 第二次调用
- `src/renderer/src/stores/sidebarStore.ts:258` - `restoreState` 实现

## 问题 5：路由配置的设计意图不明确

### 问题描述

当前存在三个聊天相关路由，但它们的用途和区别不清晰：

1. **`/chat`** - 用途不明确
   - 没有参数，不知道要显示哪个会话
   - 与 `/new` 的区别不清楚
   - 在 `ChatTabView.vue` 中没有被处理

2. **`/new`** - 明确表示"创建新会话"
   - 清空活动线程，显示空白聊天界面

3. **`/conversation/:id`** - 明确表示"查看特定会话"
   - 加载并显示指定的会话内容

### 可能的设计意图分析

**方案 A：`/chat` 作为"空状态"路由**
```
/ → /chat (空状态，等待状态恢复)
    ↓
sidebarStore.restoreState()
    ↓
/conversation/xxx (恢复到上次的会话)
```
问题：`/chat` 和 `/new` 功能重复，状态恢复期间用户看到什么？

**方案 B：`/chat` 是重构遗留**
- 可能是从旧架构迁移过来的
- 应该考虑移除，简化路由结构

**方案 C：`/chat` 应该有独立用途**
- 比如显示会话列表视图
- 或者显示欢迎界面
- 但目前没有实现
