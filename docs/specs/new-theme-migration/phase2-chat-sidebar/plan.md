# Phase 2: WindowSideBar 重构计划

## 1. 目标

将 WindowSideBar 从当前的 mock 实现改造为功能完整的生产版本，支持：
- 动态 Tab 生成（All Agents + 每个 ACP Agent + 每个 Local Model 各自一个 Tab）
- 会话历史列表显示（始终是会话列表，不是选择器）
- 正确的会话过滤和状态显示

## 2. 设计原则

1. **保留原有样式**：基于现有 WindowSideBar.vue 的 HTML/CSS 结构进行改造，不破坏视觉设计
2. **会话列表为核心**：任何 Tab 内显示的都是该来源的会话历史
3. **数据驱动 Tab**：Tab 数量根据实际可用的 Agents/Models 动态生成
4. **最小侵入性**：尽量复用现有的 stores 和 presenters，不引入新依赖

## 3. 实施步骤

### Step 1: 数据结构准备

**目标**：理解并准备所需的数据结构

**任务**：
- [ ] 确认 CONVERSATION 类型的 settings 字段结构
- [ ] 确认如何从 settings 中识别 ACP Agent vs Local Model
- [ ] 确认如何从 chatStore 获取按日期分组的历史会话
- [ ] 确认 agentModelStore 的模型数据结构

**关键检查点**：
```typescript
// 需要验证的数据访问方式
const threads = chatStore.threads  // { dt: string, dtThreads: CONVERSATION[] }[]
const workingStatus = chatStore.getThreadWorkingStatus(threadId)  // 'working' | 'error' | 'completed' | 'none'
const agentModels = agentModelStore.agentModels  // 按 providerId 分组的模型
```

### Step 2: 动态 Tab 生成

**目标**：根据可用 Agents/Models 动态生成 Tab 列表

**任务**：
- [ ] 修改左列图标列表，从 mock 数据改为真实数据
- [ ] All Agents Tab 始终存在（第一个）
- [ ] ACP Agent Tabs：遍历 agentModels['acp']，每个 model 一个 Tab
- [ ] Local Model Tabs：遍历其他 provider，每个 model 一个 Tab
- [ ] 为每个 Tab 生成图标和名称

**实现要点**：
```typescript
// Tab 数据结构
interface SidebarTab {
  id: string           // 'all' | 'acp-{modelId}' | '{providerId}-{modelId}'
  type: 'all' | 'acp' | 'local'
  name: string         // 显示名称
  icon: string         // Iconify 图标名称
  providerId?: string  // 用于过滤
  modelId?: string     // 用于过滤
}

// 生成 Tab 列表
const tabs = computed<SidebarTab[]>(() => {
  const result: SidebarTab[] = []
  
  // 1. All Agents Tab
  result.push({ id: 'all', type: 'all', name: 'All Agents', icon: 'lucide:layers' })
  
  // 2. ACP Agent Tabs
  const acpModels = agentModelStore.agentModels['acp'] || []
  for (const model of acpModels) {
    result.push({
      id: `acp-${model.id}`,
      type: 'acp',
      name: model.name,
      icon: getAgentIcon(model.id),  // 根据 model.id 返回对应图标
      providerId: 'acp',
      modelId: model.id
    })
  }
  
  // 3. Local Model Tabs
  for (const [providerId, models] of Object.entries(agentModelStore.agentModels)) {
    if (providerId === 'acp') continue
    for (const model of models) {
      result.push({
        id: `${providerId}-${model.id}`,
        type: 'local',
        name: model.name,
        icon: 'lucide:cpu',  // 本地模型使用通用图标
        providerId,
        modelId: model.id
      })
    }
  }
  
  return result
})
```

### Step 3: 会话过滤实现

**目标**：根据当前选中的 Tab 过滤显示对应的会话

**任务**：
- [ ] 修改 filteredSessions 计算属性
- [ ] All Agents Tab：显示所有会话（不过滤）
- [ ] ACP Agent Tab：过滤 providerId === 'acp' && modelId === tab.modelId
- [ ] Local Model Tab：过滤 providerId === tab.providerId && modelId === tab.modelId
- [ ] 保持按日期分组结构

**实现要点**：
```typescript
const filteredSessions = computed(() => {
  if (selectedTabId.value === 'all') {
    // All Agents - 显示所有
    return chatStore.threads
  }
  
  const selectedTab = tabs.value.find(t => t.id === selectedTabId.value)
  if (!selectedTab) return []
  
  // 过滤并重新分组
  const filtered = chatStore.threads
    .map(group => ({
      dt: group.dt,
      dtThreads: group.dtThreads.filter(thread => {
        if (selectedTab.type === 'acp') {
          return thread.settings.providerId === 'acp' && 
                 thread.settings.modelId === selectedTab.modelId
        } else {
          return thread.settings.providerId === selectedTab.providerId && 
                 thread.settings.modelId === selectedTab.modelId
        }
      })
    }))
    .filter(group => group.dtThreads.length > 0)
  
  return filtered
})
```

### Step 4: 会话状态显示

**目标**：在会话列表中显示工作状态

**任务**：
- [ ] 修改会话列表项模板，添加状态图标
- [ ] 使用 chatStore.getThreadWorkingStatus(threadId) 获取状态
- [ ] 根据状态显示不同图标：
  - working: `<Icon icon="lucide:loader-2" class="animate-spin" />`
  - completed: `<Icon icon="lucide:check" class="text-green-500" />`
  - error: `<Icon icon="lucide:alert-circle" class="text-destructive" />`
  - none: 不显示图标

### Step 5: 会话切换功能

**目标**：点击会话标题可以切换到该会话

**任务**：
- [ ] 修改会话点击处理函数
- [ ] 调用 chatStore.setActiveConversation(threadId, tabId)
- [ ] 更新选中状态样式
- [ ] 如果是新标签页打开，调用 chatStore.openConversationInNewTab

**实现要点**：
```typescript
const handleSessionClick = async (threadId: string) => {
  selectedSessionId.value = threadId
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    await chatStore.setActiveConversation(threadId, windowId)
  }
}
```

### Step 6: 新建会话功能

**目标**：[+ New Chat] 按钮根据当前 Tab 创建对应类型的会话

**任务**：
- [ ] 修改 handleNewChat 函数
- [ ] All Agents Tab：使用默认设置创建
- [ ] ACP Agent Tab：使用对应 Agent 的设置创建
- [ ] Local Model Tab：使用对应 Model 的设置创建
- [ ] 创建后自动切换到新会话

**实现要点**：
```typescript
const handleNewChat = async () => {
  const selectedTab = tabs.value.find(t => t.id === selectedTabId.value)
  
  let settings: Partial<CONVERSATION_SETTINGS> = {}
  
  if (selectedTab?.type === 'acp') {
    settings = {
      providerId: 'acp',
      modelId: selectedTab.modelId,
      chatMode: 'acp agent'
    }
  } else if (selectedTab?.type === 'local') {
    settings = {
      providerId: selectedTab.providerId,
      modelId: selectedTab.modelId,
      chatMode: 'agent'
    }
  }
  
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    const newThreadId = await chatStore.createConversation(
      'New Chat',
      settings,
      windowId
    )
    selectedSessionId.value = newThreadId
  }
}
```

### Step 7: 空状态处理

**目标**：处理无会话和加载状态

**任务**：
- [ ] 添加加载状态指示器
- [ ] All Agents 无会话：显示 "No conversations yet" + 新建按钮
- [ ] 特定 Agent/Model 无会话：显示 "No conversations with {name}" + 新建按钮
- [ ] 网络错误状态处理

### Step 8: 实时更新监听

**目标**：监听会话列表变化并刷新显示

**任务**：
- [ ] 在 onMounted 中设置事件监听
- [ ] 监听 CONVERSATION_EVENTS.LIST_UPDATED
- [ ] 监听 CONVERSATION_EVENTS.TITLE_UPDATED
- [ ] 监听 CONVERSATION_EVENTS.DELETED
- [ ] 在 onUnmounted 中清理监听

### Step 9: 性能优化

**目标**：确保大量会话时的性能

**任务**：
- [ ] 使用 computed 缓存过滤结果
- [ ] 虚拟滚动（如果会话数量 > 100）
- [ ] 防抖搜索输入

### Step 10: 测试和验证

**目标**：确保功能完整和稳定

**任务**：
- [ ] 单元测试：会话过滤逻辑
- [ ] 单元测试：Tab 生成逻辑
- [ ] 集成测试：完整用户流程
- [ ] 性能测试：大量会话场景
- [ ] 暗色/亮色主题测试

## 4. 依赖关系

### 前置依赖
- Phase 1 完成（Shell 移除架构已稳定）
- chatStore 已实现（已有 threads、getThreadWorkingStatus 等）
- agentModelStore 已实现（已有 agentModels、refreshAgentModels 等）

### 并行工作
- Phase 3（NewThread 适配）可以并行进行，不依赖 WindowSideBar 完成

### 后置依赖
- Phase 4（浏览器地址栏）依赖此阶段完成

## 5. 风险和对策

| 风险 | 影响 | 对策 |
|------|------|------|
| chatStore 数据结构变化 | 高 | 在 Step 1 充分验证数据结构 |
| 大量会话时性能问题 | 中 | Step 9 实现虚拟滚动 |
| ACP Agent 识别逻辑变化 | 中 | 使用多种条件判断（providerId + chatMode） |
| 用户会话过滤不符合预期 | 中 | 与产品经理确认过滤逻辑 |

## 6. 验收标准

### 功能标准
1. 侧边栏正确显示所有可用的 Agents 和 Models 作为独立 Tab
2. 每个 Tab 内显示对应来源的历史会话列表
3. 会话状态（working/completed/error）正确显示
4. 点击会话可以切换到该会话
5. [+ New Chat] 根据当前 Tab 创建对应类型的会话

### 性能标准
1. 初始加载 < 500ms（100 条会话）
2. Tab 切换 < 100ms
3. 滚动流畅（60fps）

### 代码标准
1. 通过 TypeScript 类型检查
2. 通过 ESLint 检查
3. 单元测试覆盖率 > 80%
