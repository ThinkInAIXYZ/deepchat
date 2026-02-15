# Phase 3: NewThread 三模式适配 - 实现计划

## 架构决策

### 决策 1: NewThread 组件结构设计

**背景**: 需要支持三模式，同时保持代码可维护。

**决策**: 采用组合式组件设计，将不同模式的内容拆分为子组件。

**组件结构**:
```
NewThread (主容器)
├── AllModeView (All 模式)
│   ├── ModeTabs (Agent/ACP Agent 切换)
│   ├── AgentTabContent
│   │   ├── ChatInput
│   │   └── BottomOptions (模型选择、MCP)
│   └── AcpAgentTabContent
│       ├── AgentSelector
│       ├── ChatInput
│       └── BottomOptions (reasoning effort)
├── AcpAgentModeView (ACP Agent 已选择模式)
│   ├── AgentHeader
│   ├── SessionStatus
│   ├── ChatInput
│   └── BottomOptions (reasoning effort + session 操作)
└── LocalModelModeView (Local Model 已选择模式)
    ├── ModelHeader
    ├── ChatInput
    └── BottomOptions (MCP 选择)
```

**理由**:
- 代码结构清晰
- 便于单独测试和维护
- 模式间逻辑隔离

### 决策 2: ChatInput 复用策略

**背景**: 当前 ChatInput.vue 功能完整，但设计需要调整。

**决策**: 提取 ChatInput 的核心逻辑为 composable，UI 部分根据设计重新实现。

**结构**:
```typescript
// Composable
useChatInput() {
  text: Ref<string>
  images: Ref<ImageFile[]>
  sendMessage: () => Promise<void>
  handlePaste: (event: ClipboardEvent) => void
  handleMention: (query: string) => void
  // ... 其他逻辑
}

// UI 组件
NewThreadChatInput.vue - 使用 useChatInput，按新设计实现 UI
```

**理由**:
- 复用核心逻辑，减少重复代码
- UI 可以根据新设计灵活调整

### 决策 3: Session 状态管理

**背景**: ACP Session 需要实时状态显示。

**决策**: 在 sidebarStore 中管理当前 session 状态，通过 EventBus 监听变化。

**Store 扩展**:
```typescript
interface SidebarState {
  // ... 已有字段
  
  // Session 状态
  currentSessionId: string | null
  sessionStatus: 'active' | 'destroyed' | 'none'
  
  // Session 操作
  createSession: () => Promise<void>
  destroySession: () => Promise<void>
}
```

**理由**:
- 状态集中管理
- 多个组件可以订阅同一状态

## 涉及的模块

### NewThread 组件
- **改动**: 重构为模式化容器
- **文件**: 新建 `src/renderer/src/components/NewThread.vue`

### ChatInput 相关
- **改动**: 提取 useChatInput composable
- **文件**: 
  - 新建 `src/renderer/src/composables/useChatInput.ts`
  - 修改 `src/renderer/src/components/NewThreadChatInput.vue`

### Session 管理
- **改动**: 在 sidebarStore 添加 session 管理
- **文件**: `src/renderer/src/stores/sidebar.ts`

### AcpSessionPresenter
- **改动**: 确保 IPC 接口对 renderer 可用
- **文件**: `src/main/presenter/agentPresenter/acp/acpSessionManager.ts`

## 事件流

### Session 创建流程
```
用户点击"创建新 session"
  ↓
sidebarStore.createSession()
  ↓
调用 presenter.acpSessionManager.createSession(agentId)
  ↓
Main process 创建 session
  ↓
通过 EventBus 发送 SESSION_CREATED 事件
  ↓
Renderer 更新 sessionStatus
```

### Session 销毁流程
```
用户点击"销毁当前 session"
  ↓
显示确认对话框
  ↓
用户确认
  ↓
sidebarStore.destroySession()
  ↓
调用 presenter.acpSessionManager.destroySession(sessionId)
  ↓
Main process 销毁 session
  ↓
通过 EventBus 发送 SESSION_DESTROYED 事件
  ↓
Renderer 更新 sessionStatus
```

## IPC 接口

### Renderer → Main
```typescript
// Session 管理
interface AcpSessionIPC {
  createSession(agentId: string): Promise<string>  // 返回 sessionId
  destroySession(sessionId: string): Promise<void>
  getCurrentSession(agentId: string): Promise<SessionInfo | null>
}

// 已在 AcpSessionManager 中实现，需要暴露给 renderer
```

### Main → Renderer (EventBus)
```typescript
// Session 事件
ACP_SESSION_EVENTS = {
  SESSION_CREATED: 'acp:session-created',
  SESSION_DESTROYED: 'acp:session-destroyed',
  SESSION_ERROR: 'acp:session-error'
}
```

## 数据模型

### SessionInfo
```typescript
interface SessionInfo {
  id: string
  agentId: string
  status: 'active' | 'destroyed'
  createdAt: number
  lastUsedAt: number
}
```

### ReasoningEffort
```typescript
type ReasoningEffort = 'low' | 'medium' | 'high'
```

## 组件详细设计

### NewThread (主容器)
```vue
<script setup lang="ts">
import { useSidebarStore } from '@/stores/sidebar'
import AllModeView from './newthread/AllModeView.vue'
import AcpAgentModeView from './newthread/AcpAgentModeView.vue'
import LocalModelModeView from './newthread/LocalModelModeView.vue'

const sidebarStore = useSidebarStore()
</script>

<template>
  <div class="h-full flex flex-col">
    <AllModeView 
      v-if="sidebarStore.currentMode === 'all'"
      :current-tab="sidebarStore.allModeTab"
    />
    <AcpAgentModeView 
      v-else-if="sidebarStore.currentMode === 'acp-agent'"
      :agent-id="sidebarStore.selectedAcpAgentId"
    />
    <LocalModelModeView 
      v-else-if="sidebarStore.currentMode === 'local-model'"
      :model-id="sidebarStore.selectedLocalModelId"
    />
  </div>
</template>
```

### AcpAgentModeView
```vue
<script setup lang="ts">
import { useSidebarStore } from '@/stores/sidebar'
import AgentHeader from './AgentHeader.vue'
import SessionStatus from './SessionStatus.vue'
import ChatInput from './ChatInput.vue'
import AcpOptionsBar from './AcpOptionsBar.vue'

const props = defineProps<{
  agentId: string
}>()

const sidebarStore = useSidebarStore()
</script>

<template>
  <div class="flex flex-col h-full">
    <AgentHeader :agent-id="agentId" />
    <SessionStatus :status="sidebarStore.sessionStatus" />
    
    <div class="flex-1 flex flex-col justify-end p-4">
      <ChatInput 
        :placeholder="$t('newThread.placeholder')"
        @send="handleSend"
      />
      
      <AcpOptionsBar 
        v-model:reasoning-effort="sidebarStore.reasoningEffort"
        :session-status="sidebarStore.sessionStatus"
        @create-session="sidebarStore.createSession"
        @destroy-session="sidebarStore.destroySession"
      />
    </div>
  </div>
</template>
```

## 测试策略

### 单元测试

#### useChatInput 测试
- 测试文本输入处理
- 测试图片粘贴
- 测试发送逻辑

#### sidebarStore 测试
- 测试 session 状态管理
- 测试 session 操作

#### 组件测试
- 测试模式切换
- 测试选项显示
- 测试 session 操作按钮

### 集成测试
- 测试完整的新对话流程
- 测试 session 创建/销毁

### 手动测试
- [ ] 所有模式的输入功能
- [ ] Session 管理功能
- [ ] 选项切换功能

## 文件变更清单

### 新建文件
1. `src/renderer/src/components/NewThread.vue` - 主容器
2. `src/renderer/src/components/newthread/AllModeView.vue`
3. `src/renderer/src/components/newthread/AcpAgentModeView.vue`
4. `src/renderer/src/components/newthread/LocalModelModeView.vue`
5. `src/renderer/src/components/newthread/ChatInput.vue`
6. `src/renderer/src/components/newthread/AcpOptionsBar.vue`
7. `src/renderer/src/components/newthread/AgentSelector.vue`
8. `src/renderer/src/components/newthread/SessionStatus.vue`
9. `src/renderer/src/composables/useChatInput.ts`

### 修改文件
1. `src/renderer/src/stores/sidebar.ts` - 添加 session 管理
2. `src/main/presenter/agentPresenter/acp/acpSessionManager.ts` - 确保 IPC 暴露
3. `src/preload/index.ts` - 如有必要，添加 session 相关 IPC

### 可能删除的文件
1. `src/renderer/src/components/NewThreadMock.vue` - 被新组件替代

## 依赖关系

- 依赖 Phase 2 完成（WindowSideBar 整合）
- 依赖 ChatInput.vue 的设计参考

## 进入 Phase 4 的前置条件

- [ ] NewThread 三模式功能完整
- [ ] Session 管理功能工作正常
- [ ] 输入功能完整
- [ ] 代码质量检查通过
