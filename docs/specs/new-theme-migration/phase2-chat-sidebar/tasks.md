# Phase 2: Chat 页面整合 WindowSideBar - 任务分解

## 任务清单

### 1. 创建 Sidebar Store

**任务**: 创建 Pinia Store 管理三模式状态

**详情**:
- [ ] 新建 `src/renderer/src/stores/sidebar.ts`
- [ ] 定义 State: `currentMode`, `selectedAcpAgentId`, `selectedLocalModelId`, `isHistoryPanelOpen`
- [ ] 定义 Actions: `setMode()`, `selectAcpAgent()`, `selectLocalModel()`, `toggleHistoryPanel()`
- [ ] 定义 Getters: `filteredConversations`（根据模式过滤）

**验收**:
- [ ] Store 可以正确创建和使用
- [ ] 状态变更触发响应式更新

---

### 2. 创建 LeftAgentColumn 组件

**任务**: 实现左侧 48px Agent 按钮列

**详情**:
- [ ] 新建 `src/renderer/src/components/LeftAgentColumn.vue`
- [ ] 实现三个主要按钮：
  - All Agents 按钮（网格/列表图标）
  - ACP Agents 按钮（或显示具体 ACP Agent 图标）
  - Local Models 按钮（电脑/芯片图标）
- [ ] 当前选中按钮高亮显示
- [ ] 点击按钮触发模式切换
- [ ] 底部添加 Settings 按钮

**Props**:
```typescript
interface Props {
  currentMode: 'all' | 'acp-agent' | 'local-model'
  selectedAcpAgentId?: string
  selectedLocalModelId?: string
}
```

**Emits**:
```typescript
interface Emits {
  'mode-change': (mode: 'all' | 'acp-agent' | 'local-model') => void
  'select-acp-agent': (agentId: string) => void
  'select-local-model': (modelId: string) => void
}
```

**验收**:
- [ ] 组件正确渲染三个按钮
- [ ] 点击按钮触发对应事件
- [ ] 当前模式按钮正确高亮

---

### 3. 创建 HistoryPanel 组件

**任务**: 实现右侧 240px 历史会话面板

**详情**:
- [ ] 新建 `src/renderer/src/components/HistoryPanel.vue`
- [ ] 实现历史会话列表显示
- [ ] 按时间分组显示（Today、Yesterday、Last Week、Older）
- [ ] 点击会话项打开对应聊天
- [ ] 支持传入过滤后的会话列表
- [ ] 空状态显示

**Props**:
```typescript
interface Props {
  conversations: Conversation[]
  currentMode: 'all' | 'acp-agent' | 'local-model'
}
```

**Emits**:
```typescript
interface Emits {
  'open-conversation': (conversationId: string) => void
}
```

**验收**:
- [ ] 正确显示历史会话列表
- [ ] 按时间正确分组
- [ ] 点击会话触发打开事件
- [ ] 空状态时显示友好提示

---

### 4. 创建 MiddleContent 组件

**任务**: 实现中间内容容器

**详情**:
- [ ] 新建 `src/renderer/src/components/MiddleContent.vue`
- [ ] 实现自适应宽度的内容区
- [ ] 根据模式显示不同内容：
  - All 模式: 嵌入 NewThread（完整版）
  - ACP Agent 模式: 显示选中 Agent 的配置
  - Local Model 模式: 显示选中模型的配置
- [ ] 预留插槽用于扩展

**Props**:
```typescript
interface Props {
  currentMode: 'all' | 'acp-agent' | 'local-model'
  selectedAcpAgentId?: string
  selectedLocalModelId?: string
}
```

**验收**:
- [ ] 内容区宽度自适应
- [ ] 根据模式显示不同占位内容

---

### 5. 重构 WindowSideBar 组件

**任务**: 将 WindowSideBar 重构为布局容器

**详情**:
- [ ] 修改 `src/renderer/src/components/WindowSideBar.vue`
- [ ] 整合 LeftAgentColumn、MiddleContent、HistoryPanel
- [ ] 集成 sidebarStore
- [ ] 实现三列布局（48px + flex-1 + 240px）
- [ ] 实现响应式：窗口变窄时隐藏右侧面板
- [ ] 添加切换右侧面板的按钮

**布局结构**:
```vue
<template>
  <div class="flex h-full w-full">
    <LeftAgentColumn 
      :current-mode="sidebarStore.currentMode"
      @mode-change="handleModeChange"
    />
    <MiddleContent 
      :current-mode="sidebarStore.currentMode"
      class="flex-1"
    />
    <HistoryPanel 
      v-if="sidebarStore.isHistoryPanelOpen"
      :conversations="filteredConversations"
      class="w-60"
    />
  </div>
</template>
```

**验收**:
- [ ] 三列布局正确显示
- [ ] 模式切换时内容更新
- [ ] 右侧面板可折叠
- [ ] 响应式布局正常工作

---

### 6. 修改 ChatView 整合 WindowSideBar

**任务**: 将 WindowSideBar 整合到 ChatView

**详情**:
- [ ] 修改 `src/renderer/src/views/ChatView.vue`
- [ ] 用 WindowSideBar 替换现有布局
- [ ] 确保 Chat 内容正确嵌入到 WindowSideBar 中
- [ ] 保留现有的 ArtifactDialog 等功能

**验收**:
- [ ] ChatView 显示 WindowSideBar
- [ ] 原有功能（Artifact 等）正常工作

---

### 7. 实现历史会话数据获取

**任务**: 从历史会话 Presenter 获取数据

**详情**:
- [ ] 在 WindowSideBar 或 sidebarStore 中实现数据获取
- [ ] 调用 `sessionPresenter.getRecentConversations()`
- [ ] 实现根据模式过滤的逻辑

**过滤逻辑**:
```typescript
const filteredConversations = computed(() => {
  switch (sidebarStore.currentMode) {
    case 'all':
      return allConversations.value
    case 'acp-agent':
      return allConversations.value.filter(
        c => c.provider_id === 'acp' && c.model_id === sidebarStore.selectedAcpAgentId
      )
    case 'local-model':
      return allConversations.value.filter(c => c.provider_id !== 'acp')
    default:
      return allConversations.value
  }
})
```

**验收**:
- [ ] 正确获取历史会话数据
- [ ] 根据模式正确过滤

---

### 8. 实现 ACP Agent 数据获取

**任务**: 获取可用的 ACP Agents 列表

**详情**:
- [ ] 调用 `llmProviderPresenter.getAcpAgents()` 获取列表
- [ ] 在 LeftAgentColumn 中显示 ACP Agents
- [ ] 处理选中逻辑

**验收**:
- [ ] 正确获取 ACP Agents 列表
- [ ] 在左侧显示

---

### 9. 实现 Local Model 数据获取

**任务**: 获取可用的本地模型列表

**详情**:
- [ ] 调用 `llmProviderPresenter.getAllProviders()` 获取列表
- [ ] 过滤出本地模型（非 ACP）
- [ ] 在 LeftAgentColumn 中显示

**验收**:
- [ ] 正确获取本地模型列表
- [ ] 在左侧显示

---

### 10. 添加动画效果

**任务**: 添加过渡动画

**详情**:
- [ ] 模式切换时内容淡入淡出动画
- [ ] 右侧面板展开/收起动画
- [ ] 使用 Vue Transition 或 Tailwind transitions

**验收**:
- [ ] 动画流畅
- [ ] 不影响性能

---

### 11. 添加 i18n 支持

**任务**: 所有用户可见文本使用 i18n

**详情**:
- [ ] 在 `src/renderer/src/i18n/` 添加新键值
- [ ] 更新 LeftAgentColumn 使用 i18n
- [ ] 更新 HistoryPanel 使用 i18n
- [ ] 支持中英文（至少）

**验收**:
- [ ] 所有文本通过 i18n 获取
- [ ] 中英文显示正确

---

### 12. 运行代码质量检查

**任务**: 确保代码质量

**详情**:
```bash
pnpm run format
pnpm run lint
pnpm run typecheck
```

**验收**:
- [ ] 格式化无问题
- [ ] Lint 无错误
- [ ] 类型检查通过

---

### 13. 执行测试套件

**任务**: 运行自动化测试

**详情**:
```bash
pnpm test:renderer
```

**验收**:
- [ ] 所有现有测试通过
- [ ] 新增测试通过（如添加了组件测试）

---

### 14. 手动验收测试

**任务**: 手动验证功能

**详情**:
- [ ] 启动应用，WindowSideBar 显示正确
- [ ] 点击左侧按钮切换模式，中间内容正确变化
- [ ] All 模式下可切换 Agent/ACP Agent
- [ ] ACP Agent 模式下显示 Agent 列表和配置
- [ ] Local Model 模式下显示模型列表和 MCP 选项
- [ ] 右侧显示对应的历史会话
- [ ] 点击历史会话打开聊天
- [ ] 右侧面板可展开/收起
- [ ] 窗口缩小时布局自适应

**验收**:
- [ ] 所有手动测试项通过

---

## Phase 2 验收标准

Phase 2 完成的标准：

1. **组件层面**
   - [ ] LeftAgentColumn 组件工作正常
   - [ ] HistoryPanel 组件工作正常
   - [ ] MiddleContent 组件工作正常
   - [ ] WindowSideBar 整合完成

2. **功能层面**
   - [ ] 三模式切换功能正常
   - [ ] 历史会话列表正确显示
   - [ ] 响应式布局正常工作

3. **质量层面**
   - [ ] `pnpm run format` 通过
   - [ ] `pnpm run lint` 通过
   - [ ] `pnpm run typecheck` 通过
   - [ ] `pnpm test:renderer` 通过

4. **UI 层面**
   - [ ] 动画效果流畅
   - [ ] i18n 支持完整
   - [ ] 深色/浅色主题正常

---

## 进入 Phase 3 的前置条件

- [ ] Phase 2 所有任务完成
- [ ] Phase 2 所有验收标准满足
- [ ] 代码审查通过
