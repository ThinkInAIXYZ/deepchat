# Phase 2: Chat 页面整合 WindowSideBar - 实现计划

## 架构决策

### 决策 1: WindowSideBar 布局整合方案

**背景**: WindowSideBar 目前是一个独立组件，需要整合到 Chat 页面。

**决策**: 将 WindowSideBar 作为 Chat 页面的布局容器，内部包含三列布局。

**布局结构**:
```
WindowSideBar (flex row)
├── LeftColumn (48px, 固定宽度)
│   └── Agent 类型按钮
├── MiddleColumn (flex-1, 自适应)
│   └── NewThread 或 Chat 内容
└── RightColumn (240px, 可折叠)
    └── HistoryList
```

**理由**:
- 清晰的布局结构
- 符合新设计稿要求
- 便于后续功能扩展

### 决策 2: 三模式状态管理

**背景**: 需要管理 All / ACP Agent / Local Model 三种模式状态。

**决策**: 使用 Pinia Store 集中管理模式状态。

**Store 设计**:
```typescript
interface SidebarState {
  currentMode: 'all' | 'acp-agent' | 'local-model'
  selectedAcpAgent: string | null  // 选中的 ACP Agent ID
  selectedLocalModel: string | null // 选中的本地模型 ID
}
```

**理由**:
- 状态集中管理，便于跨组件通信
- 支持持久化（如有需要）
- 符合现有架构模式

### 决策 3: 历史会话过滤策略

**背景**: 不同模式下需要显示不同类型的历史会话。

**决策**: 在右侧历史列表组件中根据当前模式过滤。

**过滤逻辑**:
- All 模式: 显示所有历史会话
- ACP Agent 模式: 显示 provider_id 为 'acp' 且 model_id 匹配的会话
- Local Model 模式: 显示 provider_id 不为 'acp' 的会话

**理由**:
- 利用现有会话数据模型
- 无需改动数据层

## 涉及的模块

### ChatView.vue
- **改动**: 整合 WindowSideBar 作为布局容器
- **文件**: `src/renderer/src/views/ChatView.vue`

### WindowSideBar.vue
- **改动**: 重构为布局容器，包含三列布局
- **文件**: `src/renderer/src/components/WindowSideBar.vue`

### NewThread 相关组件
- **改动**: 适配新的布局容器
- **文件**: `src/renderer/src/components/NewThreadMock.vue` 或新建组件

### 历史会话组件（新建或复用）
- **改动**: 实现历史会话列表，支持过滤
- **文件**: 新建 `src/renderer/src/components/HistoryList.vue`

### Store（新建）
- **改动**: 创建 sidebarStore 管理模式状态
- **文件**: 新建 `src/renderer/src/stores/sidebar.ts`

## 事件流

### 模式切换流程
```
用户点击左侧按钮
  ↓
触发模式切换事件
  ↓
sidebarStore 更新 currentMode
  ↓
WindowSideBar 监听状态变化
  ↓
重新渲染中间列和右侧列内容
```

### 历史会话加载流程
```
组件挂载
  ↓
调用 sessionPresenter 获取历史会话
  ↓
根据 currentMode 过滤会话
  ↓
渲染历史列表
```

## 数据模型

### SidebarState (Pinia Store)
```typescript
interface SidebarState {
  // 当前模式
  currentMode: 'all' | 'acp-agent' | 'local-model'
  
  // ACP Agent 模式下的选择
  selectedAcpAgentId: string | null
  
  // Local Model 模式下的选择
  selectedLocalModelId: string | null
  
  // UI 状态
  isHistoryPanelOpen: boolean  // 右侧面板是否展开
}
```

### 历史会话数据
使用现有的 `Conversation` 类型，根据字段过滤：
```typescript
interface Conversation {
  id: string
  provider_id: string  // 'acp' 表示 ACP Agent
  model_id: string
  title: string
  created_at: number
  updated_at: number
  // ... 其他字段
}
```

## IPC 接口

### 从 Presenter 获取数据
```typescript
// 获取 ACP Agents 列表
const agents = await presenter.llmProviderPresenter.getAcpAgents()

// 获取本地模型列表
const models = await presenter.llmProviderPresenter.getAllProviders()

// 获取历史会话
const conversations = await presenter.sessionPresenter.getRecentConversations()
```

## 组件设计

### WindowSideBar (重构后)
```vue
<template>
  <div class="flex h-full w-full">
    <!-- 左侧 Agent 按钮列 -->
    <LeftAgentColumn 
      :current-mode="currentMode"
      @mode-change="handleModeChange"
    />
    
    <!-- 中间内容区 -->
    <MiddleContent :current-mode="currentMode">
      <NewThread v-if="showNewThread" :mode="currentMode" />
      <ChatContent v-else />
    </MiddleContent>
    
    <!-- 右侧历史会话 -->
    <HistoryPanel 
      v-if="isHistoryPanelOpen"
      :conversations="filteredConversations"
    />
  </div>
</template>
```

### LeftAgentColumn
- 显示三个主要按钮：All、ACP Agents、Local Models
- 当前选中的按钮高亮显示
- 底部可能有 Settings 按钮

### MiddleContent
- 根据模式显示不同内容
- All 模式: 显示完整的 NewThread（带模式切换）
- ACP Agent 模式: 显示选中的 Agent 配置界面
- Local Model 模式: 显示选中的模型配置界面

### HistoryPanel
- 显示历史会话列表
- 按时间分组（Today、Yesterday、Last Week 等）
- 点击会话打开对应聊天

## 测试策略

### 单元测试

#### sidebarStore 测试
- 测试模式切换逻辑
- 测试选择状态管理

#### WindowSideBar 组件测试
- 测试渲染正确性
- 测试模式切换事件

#### HistoryPanel 组件测试
- 测试过滤逻辑
- 测试会话列表渲染

### 集成测试
- 测试模式切换后内容正确更新
- 测试历史会话加载和显示

### 手动测试
- [ ] 三模式切换流畅
- [ ] 历史列表显示正确
- [ ] 点击历史会话打开聊天

## UI/UX 考虑

### 动画效果
- 模式切换时内容淡入淡出
- 右侧面板展开/收起动画

### 响应式设计
- 窗口宽度小于某阈值时，右侧面板自动收起
- 提供按钮手动展开/收起右侧面板

### 主题支持
- 深色/浅色主题正确显示
- 使用 Tailwind 主题变量

## 文件变更清单

### 修改的文件
1. `src/renderer/src/views/ChatView.vue`
2. `src/renderer/src/components/WindowSideBar.vue`

### 新建的文件
1. `src/renderer/src/stores/sidebar.ts` - Sidebar 状态管理
2. `src/renderer/src/components/LeftAgentColumn.vue` - 左侧 Agent 按钮列
3. `src/renderer/src/components/HistoryPanel.vue` - 右侧历史会话面板
4. `src/renderer/src/components/MiddleContent.vue` - 中间内容容器

### 可能需要复用/修改的文件
1. `src/renderer/src/components/NewThreadMock.vue` - 根据设计调整

## 依赖关系

- 依赖 Phase 1 完成（Shell 移除）
- 依赖 ChatInput.vue 的设计作为参考

## 进入 Phase 3 的前置条件

- [ ] WindowSideBar 正确整合到 Chat 页面
- [ ] 三模式切换功能正常
- [ ] 历史会话列表正确显示
- [ ] 代码质量检查通过
