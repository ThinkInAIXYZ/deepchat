# Phase 4: NewThread Adaptation

## Overview

改造 NewThread 页面，实现：
1. Agent 选择器（从选中的 Agent 获取模型配置）
2. Workdir 显示（继承自 Agent 默认配置）
3. 创建 Session 时绑定 Agent

## Style Reference

严格遵循 `src/renderer/src/components/NewThreadMock.vue` 现有样式：

### Welcome 布局
```css
/* 整体容器 */
.welcome-page {
  @apply h-full w-full flex flex-col;
}

/* 主内容区 */
.welcome-content {
  @apply flex-1 flex flex-col items-center justify-center px-6;
}

/* Logo */
.welcome-logo {
  @apply w-14 h-14 mb-4;
}

/* 标题 */
.welcome-title {
  @apply text-3xl font-semibold text-foreground mb-4;
}
```

### Project/Agent Selector
```css
/* 按钮样式 - 参考 NewThreadMock.vue */
.selector-btn {
  @apply h-7 px-2.5 gap-1.5 text-xs;
  @apply text-muted-foreground hover:text-foreground;
}

/* 下拉菜单 */
.dropdown-content {
  @apply min-w-[200px];
}

.dropdown-item {
  @apply gap-2 text-xs py-1.5 px-2;
}

.dropdown-icon {
  @apply w-3.5 h-3.5 text-muted-foreground;
}
```

### InputBox 容器
```css
/* 参考 MockInputBox.vue */
.input-box {
  @apply w-full max-w-2xl rounded-xl border;
  @apply bg-card/30 backdrop-blur-lg shadow-sm;
  @apply overflow-hidden;
}

.input-textarea {
  @apply min-h-[80px] resize-none;
  @apply border-0 shadow-none;
  @apply bg-transparent;
  @apply px-4 pt-4 pb-2 text-sm;
  @apply placeholder:text-muted-foreground;
}
```

### InputToolbar
```css
/* 参考 MockInputToolbar.vue */
.input-toolbar {
  @apply flex items-center justify-between px-3 py-2;
}

.toolbar-btn {
  @apply h-7 w-7 rounded-lg;
  @apply text-muted-foreground hover:text-foreground;
}

.send-btn {
  @apply h-7 w-7 rounded-full;
}
```

### StatusBar
```css
/* 参考 MockStatusBar.vue */
.status-bar {
  @apply w-full max-w-2xl;
  @apply flex items-center justify-between;
  @apply px-1 py-2;
}

.status-btn {
  @apply h-6 px-2 gap-1 text-xs;
  @apply text-muted-foreground hover:text-foreground;
  @apply backdrop-blur-lg;
}
```

## UI Design

### Welcome Page (NewThread)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         🤖                                  │
│                    DeepChat                                │
│                                                             │
│              Build and explore                             │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │                                                     │  │
│   │              What can I help you?                  │  │
│   │                                                     │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ 🤖 Local Agent     │ 📁 ~/DeepChat/workspace │ [⚙] │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   │
│   │  Suggestion 1 │ │  Suggestion 2 │ │  Suggestion 3 │   │
│   └───────────────┘ └───────────────┘ └───────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Agent Selector Dropdown

```
┌─────────────────────────────────────────────────────────────┐
│  🤖 Local Agent                                       [▼]  │
├─────────────────────────────────────────────────────────────┤
│  Template Agents                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🤖 Local Agent                              ✓      │   │
│  │     Ollama • llama3                                  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  📁 Project Helper                                   │   │
│  │     Anthropic • claude-3-sonnet                      │   │
│  └─────────────────────────────────────────────────────┘   │
│  ACP Agents                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🟢 Claude Code                                      │   │
│  │     claude                                           │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  [+ Manage Agents...]                                      │
└─────────────────────────────────────────────────────────────┘
```

### Workdir Display

```
┌─────────────────────────────────────────────────────────────┐
│  📁 ~/DeepChat/workspace                            [▼]   │
├─────────────────────────────────────────────────────────────┤
│  Recent Directories                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ~/DeepChat/workspace                          ✓    │   │
│  │  ~/Projects/my-app                                  │   │
│  │  ~/Projects/another-project                         │   │
│  └─────────────────────────────────────────────────────┘   │
│  ───────────────────────────────────────────────────────   │
│  [Browse Other Directory...]                               │
└─────────────────────────────────────────────────────────────┘
```

## Components

### NewThread Refactor

```vue
<!-- src/renderer/src/views/ChatTabView.vue 或 NewThread.vue -->
<template>
  <div class="new-thread-page">
    <!-- Logo Section -->
    <div class="logo-section">
      <LogoIcon class="logo" />
      <h1>DeepChat</h1>
      <p class="tagline">Build and explore</p>
    </div>

    <!-- Input Section -->
    <div class="input-section">
      <NewThreadInputBox
        v-model="userInput"
        :disabled="loading"
        @submit="handleSubmit"
      />
      
      <!-- Toolbar -->
      <div class="input-toolbar">
        <AgentSelector 
          v-model="selectedAgent"
          :agents="availableAgents"
        />
        <WorkdirSelector 
          v-model="workdir"
          :default-workdir="selectedAgent?.workdir"
        />
        <SettingsButton @click="openAgentSettings" />
      </div>
    </div>

    <!-- Suggestions -->
    <div class="suggestions">
      <SuggestionCard
        v-for="suggestion in suggestions"
        :key="suggestion.id"
        :suggestion="suggestion"
        @select="handleSuggestionSelect"
      />
    </div>
  </div>
</template>
```

### AgentSelector Component

```vue
<!-- src/renderer/src/components/NewThread/AgentSelector.vue -->
<template>
  <Popover v-model:open="showDropdown">
    <PopoverTrigger as-child>
      <button class="agent-selector-trigger">
        <Icon :name="selectedAgent?.icon || 'lucide:bot'" />
        <span class="agent-name">{{ selectedAgent?.name || 'Select Agent' }}</span>
        <Icon name="lucide:chevron-down" class="chevron" />
      </button>
    </PopoverTrigger>
    
    <PopoverContent class="agent-selector-dropdown">
      <div class="agent-section">
        <div class="section-title">Template Agents</div>
        <button
          v-for="agent in templateAgents"
          :key="agent.id"
          :class="['agent-item', { selected: agent.id === selectedAgentId }]"
          @click="selectAgent(agent)"
        >
          <Icon :name="agent.icon || 'lucide:bot'" />
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
            <div class="agent-meta">{{ agent.providerId }} • {{ agent.modelId }}</div>
          </div>
          <Icon v-if="agent.id === selectedAgentId" name="lucide:check" />
        </button>
      </div>
      
      <div class="agent-section">
        <div class="section-title">ACP Agents</div>
        <button
          v-for="agent in acpAgents"
          :key="agent.id"
          :class="['agent-item', { selected: agent.id === selectedAgentId }]"
          @click="selectAgent(agent)"
        >
          <Icon :name="agent.icon || 'lucide:terminal'" />
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
            <div class="agent-meta">{{ agent.command }}</div>
          </div>
          <span class="status-dot" :class="agent.enabled ? 'active' : 'inactive'" />
        </button>
      </div>
      
      <div class="dropdown-footer">
        <button @click="openAgentSettings">
          <Icon name="lucide:plus" />
          <span>Manage Agents...</span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
```

### WorkdirSelector Component

```vue
<!-- src/renderer/src/components/NewThread/WorkdirSelector.vue -->
<template>
  <Popover v-model:open="showDropdown">
    <PopoverTrigger as-child>
      <button class="workdir-selector-trigger">
        <Icon name="lucide:folder" />
        <span class="workdir-path">{{ displayPath }}</span>
        <Icon name="lucide:chevron-down" class="chevron" />
      </button>
    </PopoverTrigger>
    
    <PopoverContent class="workdir-selector-dropdown">
      <div class="section-title">Recent Directories</div>
      <button
        v-for="dir in recentWorkdirs"
        :key="dir"
        :class="['workdir-item', { selected: dir === workdir }]"
        @click="selectWorkdir(dir)"
      >
        <Icon name="lucide:folder" />
        <span>{{ formatPath(dir) }}</span>
        <Icon v-if="dir === workdir" name="lucide:check" />
      </button>
      
      <div class="dropdown-footer">
        <button @click="browseDirectory">
          <Icon name="lucide:folder-plus" />
          <span>Browse Other Directory...</span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  defaultWorkdir?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const workdir = computed({
  get: () => props.modelValue || props.defaultWorkdir || '',
  set: (val) => emit('update:modelValue', val)
})

const displayPath = computed(() => {
  const path = workdir.value
  if (!path) return 'Select directory'
  // 截断显示
  const parts = path.split('/')
  if (parts.length > 3) {
    return '.../' + parts.slice(-2).join('/')
  }
  return path
})

const recentWorkdirs = ref<string[]>([])

async function loadRecentWorkdirs() {
  recentWorkdirs.value = await presenter.configPresenter.getRecentWorkdirs()
}

async function browseDirectory() {
  const result = await presenter.filePresenter.showDirectoryPicker()
  if (result) {
    selectWorkdir(result)
  }
}

function selectWorkdir(path: string) {
  workdir.value = path
  showDropdown.value = false
}
</script>
```

## Session Creation Flow

```typescript
// 创建 Session 时的逻辑
async function handleSubmit(content: UserMessageContent) {
  if (!selectedAgent.value) {
    showError('Please select an agent')
    return
  }
  
  loading.value = true
  
  try {
    // 1. 创建 session，绑定 agent
    const threadId = await chatStore.createThread(content.text, {
      agentId: selectedAgent.value.id,
      agentWorkspacePath: workdir.value,
      // 从 Agent 继承配置
      ...(selectedAgent.value.type === 'template' ? {
        providerId: selectedAgent.value.providerId,
        modelId: selectedAgent.value.modelId,
        systemPrompt: selectedAgent.value.systemPrompt,
        temperature: selectedAgent.value.temperature,
        contextLength: selectedAgent.value.contextLength,
        maxTokens: selectedAgent.value.maxTokens,
        thinkingBudget: selectedAgent.value.thinkingBudget,
        reasoningEffort: selectedAgent.value.reasoningEffort
      } : {})
    })
    
    // 2. 导航到 chat 页面
    router.push({ name: 'chat', params: { threadId } })
    
    // 3. 发送消息
    await chatStore.sendMessage(threadId, content)
    
  } catch (error) {
    showError(error.message)
  } finally {
    loading.value = false
  }
}
```

## State Management

```typescript
// composables/useNewThread.ts
export function useNewThread() {
  const agentStore = useAgentStore()
  const router = useRouter()
  
  const selectedAgentId = ref<string | null>(null)
  const workdir = ref<string>('')
  const userInput = ref('')
  const loading = ref(false)
  
  const selectedAgent = computed(() => 
    agentStore.agents.find(a => a.id === selectedAgentId.value)
  )
  
  // 当 agent 变化时，更新默认 workdir
  watch(selectedAgent, (agent) => {
    if (agent?.type === 'template') {
      // 从 agent 配置获取默认 workdir
      workdir.value = agent.workdir || ''
    }
  })
  
  // 从 URL query 参数初始化（从 sidebar 点击过来）
  onMounted(() => {
    const queryAgentId = router.currentRoute.value.query.agentId
    if (queryAgentId) {
      selectedAgentId.value = queryAgentId as string
    }
    
    // 默认选中第一个 agent
    if (!selectedAgentId.value && agentStore.agents.length > 0) {
      selectedAgentId.value = agentStore.agents[0].id
    }
  })
  
  return {
    selectedAgentId,
    selectedAgent,
    workdir,
    userInput,
    loading,
    handleSubmit
  }
}
```

## Integration with chatStore

```typescript
// stores/chat.ts 需要修改 createThread 方法
async function createThread(
  title: string,
  options: {
    agentId: string
    agentWorkspacePath: string
    // Agent 继承的配置
    providerId?: string
    modelId?: string
    systemPrompt?: string
    temperature?: number
    // ...
  }
): Promise<string> {
  const threadId = await presenter.sessionPresenter.createSession({
    title,
    config: {
      agentId: options.agentId,
      agentWorkspacePath: options.agentWorkspacePath,
      // 存储配置
      ...options
    }
  })
  
  // 刷新 session 列表
  await this.loadThreads()
  
  return threadId
}
```

## i18n Keys

```json
{
  "newThread.title": "DeepChat",
  "newThread.tagline": "Build and explore",
  "newThread.inputPlaceholder": "What can I help you?",
  "newThread.agentSelector.title": "Select Agent",
  "newThread.agentSelector.templateSection": "Template Agents",
  "newThread.agentSelector.acpSection": "ACP Agents",
  "newThread.agentSelector.manageAgents": "Manage Agents...",
  "newThread.workdirSelector.title": "Select Directory",
  "newThread.workdirSelector.recent": "Recent Directories",
  "newThread.workdirSelector.browse": "Browse Other Directory...",
  "newThread.workdirSelector.empty": "Select directory",
  "newThread.error.noAgent": "Please select an agent"
}
```

## Files to Create/Modify

### New Files
- `src/renderer/src/components/NewThread/AgentSelector.vue`
- `src/renderer/src/components/NewThread/WorkdirSelector.vue`
- `src/renderer/src/composables/useNewThread.ts`

### Modified Files
- `src/renderer/src/views/ChatTabView.vue` - 添加 Agent/Workdir 选择器
- `src/renderer/src/components/NewThread.vue` - 或重构此组件
- `src/renderer/src/stores/chat.ts` - 修改 createThread 方法
- `src/main/presenter/sessionPresenter/index.ts` - 添加 agentId 参数支持

## Dependencies

- Phase 1 (AgentConfigPresenter)
- Phase 2 (Agent Settings)
- Phase 3 (WindowSideBar - for agent selection from sidebar)

## Testing

- [ ] Agent selector displays all agents
- [ ] Agent selection updates workdir default
- [ ] Workdir selector shows recent directories
- [ ] Workdir browse opens native picker
- [ ] Session creation binds agent correctly
- [ ] Session inherits agent configuration
- [ ] Navigation from sidebar with agentId query
