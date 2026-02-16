# Phase 5: ChatInput Integration

## Overview

在 ChatInput 输入框工具栏中集成 Workdir 显示和选择功能：
1. 显示当前 session 的 workdir
2. 允许临时修改 workdir（仅对当前消息生效）
3. 显示当前使用的 Agent 信息

## Style Reference

严格遵循 mock 组件样式规范：

### 参考 MockInputBox.vue
```css
.input-box {
  @apply w-full max-w-2xl rounded-xl border;
  @apply bg-card/30 backdrop-blur-lg shadow-sm;
  @apply overflow-hidden;
}
```

### 参考 MockInputToolbar.vue
```css
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

### 参考 MockStatusBar.vue
```css
.status-btn {
  @apply h-6 px-2 gap-1 text-xs;
  @apply text-muted-foreground hover:text-foreground;
  @apply backdrop-blur-lg;
}

.dropdown-icon {
  @apply w-3 h-3;
}
```

## UI Design

### ChatInput with Toolbar

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   [Chat messages area...]                                   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                                                     │   │
│   │              Type your message...                  │   │
│   │                                                     │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ 🤖 Local Agent  │  📁 ~/deepchat  │  ⚙️  │  [Send] │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Workdir Toolbar Item

```
┌────────────────────────────────────┐
│ 📁 ~/deepchat               [▼]   │
└────────────────────────────────────┘
         │
         ▼ (click)
┌────────────────────────────────────┐
│ Recent Directories                 │
│ ┌────────────────────────────────┐ │
│ │ ✓ ~/deepchat                   │ │
│ │   ~/Projects/my-app            │ │
│ │   ~/Documents/notes            │ │
│ └────────────────────────────────┘ │
│ ─────────────────────────────────  │
│ [Browse Other Directory...]        │
└────────────────────────────────────┘
```

### Agent Display (Read-only in Chat)

```
┌────────────────────────────────────┐
│ 🤖 Local Agent              [ℹ️]  │
└────────────────────────────────────┘
         │
         ▼ (hover/click)
┌────────────────────────────────────┐
│ Agent: Local Agent                 │
│ Provider: Ollama                   │
│ Model: llama3                      │
│ ─────────────────────────────────  │
│ [View Agent Settings]              │
└────────────────────────────────────┘
```

## Components

### ChatInputToolbar Component

```vue
<!-- src/renderer/src/components/ChatInput/ChatInputToolbar.vue -->
<template>
  <div class="chat-input-toolbar">
    <!-- Agent Info (read-only) -->
    <AgentInfoBadge 
      :agent="currentAgent"
      @click="showAgentInfo"
    />
    
    <div class="toolbar-divider" />
    
    <!-- Workdir Selector -->
    <WorkdirToolbarItem
      v-model="currentWorkdir"
      :session-default="sessionWorkdir"
    />
    
    <div class="toolbar-divider" />
    
    <!-- Settings Button -->
    <button class="toolbar-btn settings-btn" @click="openSettings">
      <Icon name="lucide:settings" />
    </button>
    
    <div class="toolbar-spacer" />
    
    <!-- Send Button -->
    <SendButton 
      :disabled="!canSend"
      :loading="sending"
      @click="handleSend"
    />
  </div>
</template>
```

### AgentInfoBadge Component

```vue
<!-- src/renderer/src/components/ChatInput/AgentInfoBadge.vue -->
<template>
  <Popover>
    <PopoverTrigger as-child>
      <button class="agent-badge">
        <Icon :name="agent?.icon || 'lucide:bot'" :class="agentType" />
        <span class="agent-name">{{ agent?.name || 'Unknown' }}</span>
        <Icon name="lucide:info" class="info-icon" />
      </button>
    </PopoverTrigger>
    
    <PopoverContent class="agent-info-popover">
      <div class="info-row">
        <span class="label">Agent:</span>
        <span class="value">{{ agent?.name }}</span>
      </div>
      <template v-if="agent?.type === 'template'">
        <div class="info-row">
          <span class="label">Provider:</span>
          <span class="value">{{ agent.providerId }}</span>
        </div>
        <div class="info-row">
          <span class="label">Model:</span>
          <span class="value">{{ agent.modelId }}</span>
        </div>
      </template>
      <template v-else-if="agent?.type === 'acp'">
        <div class="info-row">
          <span class="label">Command:</span>
          <span class="value">{{ agent.command }}</span>
        </div>
      </template>
      
      <div class="popover-footer">
        <button @click="openAgentSettings">
          View Agent Settings
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
defineProps<{
  agent: Agent | null
}>()

const agentType = computed(() => props.agent?.type || 'template')
</script>
```

### WorkdirToolbarItem Component

```vue
<!-- src/renderer/src/components/ChatInput/WorkdirToolbarItem.vue -->
<template>
  <Popover v-model:open="showDropdown">
    <PopoverTrigger as-child>
      <button class="workdir-item" :class="{ modified: isModified }">
        <Icon name="lucide:folder" />
        <span class="workdir-path">{{ displayPath }}</span>
        <Icon name="lucide:chevron-down" class="chevron" />
      </button>
    </PopoverTrigger>
    
    <PopoverContent class="workdir-popover">
      <div class="popover-header">
        <span>Working Directory</span>
        <button 
          v-if="isModified" 
          class="reset-btn"
          @click="resetToDefault"
        >
          Reset to default
        </button>
      </div>
      
      <div class="recent-list">
        <button
          v-for="dir in recentWorkdirs"
          :key="dir"
          :class="['workdir-option', { selected: dir === modelValue }]"
          @click="selectWorkdir(dir)"
        >
          <Icon name="lucide:folder" />
          <span class="path">{{ formatPath(dir) }}</span>
          <Icon v-if="dir === modelValue" name="lucide:check" class="check" />
        </button>
      </div>
      
      <div class="popover-footer">
        <button class="browse-btn" @click="browseDirectory">
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
  sessionDefault: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const showDropdown = ref(false)
const recentWorkdirs = ref<string[]>([])

const isModified = computed(() => 
  props.modelValue !== props.sessionDefault
)

const displayPath = computed(() => {
  const path = props.modelValue
  if (!path) return 'No directory'
  
  // 智能截断
  const home = process.env.HOME || ''
  if (path.startsWith(home)) {
    return '~' + path.slice(home.length)
  }
  
  const parts = path.split('/')
  if (parts.length > 4) {
    return '.../' + parts.slice(-2).join('/')
  }
  return path
})

async function loadRecentWorkdirs() {
  recentWorkdirs.value = await presenter.configPresenter.getRecentWorkdirs()
}

async function browseDirectory() {
  const result = await presenter.filePresenter.showDirectoryPicker()
  if (result) {
    emit('update:modelValue', result)
    showDropdown.value = false
  }
}

function selectWorkdir(path: string) {
  emit('update:modelValue', path)
  showDropdown.value = false
}

function resetToDefault() {
  emit('update:modelValue', props.sessionDefault)
}

onMounted(loadRecentWorkdirs)
</script>
```

## State Management

### Per-Message Workdir Override

```typescript
// stores/chat.ts
interface ChatState {
  // ... existing state
  
  // 每个会话的临时 workdir 覆盖
  workdirOverrides: Map<string, string>
}

// 获取当前使用的 workdir
function getCurrentWorkdir(threadId: string): string {
  const session = this.sessions.find(s => s.id === threadId)
  const override = this.workdirOverrides.get(threadId)
  
  return override || session?.config.agentWorkspacePath || ''
}

// 设置临时 workdir
function setWorkdirOverride(threadId: string, workdir: string | null) {
  if (workdir === null) {
    this.workdirOverrides.delete(threadId)
  } else {
    this.workdirOverrides.set(threadId, workdir)
  }
}
```

### Sending Message with Workdir

```typescript
// components/ChatInput/ChatInput.vue
async function handleSend() {
  const content = parseUserInput(userInput.value)
  const workdir = chatStore.getCurrentWorkdir(props.threadId)
  
  // 发送消息时带上 workdir
  await chatStore.sendMessage(props.threadId, content, {
    workdir
  })
  
  // 清空输入
  userInput.value = ''
  
  // 可选：发送后重置 workdir 到默认
  // chatStore.setWorkdirOverride(props.threadId, null)
}
```

## IPC Communication

### Getting Recent Workdirs

```typescript
// main/presenter/configPresenter/workdirHelper.ts
export async function getRecentWorkdirs(): Promise<string[]> {
  const settings = await this.store.get('recentWorkdirs')
  return settings || []
}

export async function addRecentWorkdir(path: string): Promise<void> {
  const recent = await this.getRecentWorkdirs()
  const updated = [path, ...recent.filter(p => p !== path)].slice(0, 10)
  await this.store.set('recentWorkdirs', updated)
}
```

## i18n Keys

```json
{
  "chatInput.toolbar.agentInfo": "Agent Info",
  "chatInput.toolbar.workdir": "Working Directory",
  "chatInput.toolbar.workdir.reset": "Reset to default",
  "chatInput.toolbar.workdir.browse": "Browse Other Directory...",
  "chatInput.toolbar.workdir.noDirectory": "No directory",
  "chatInput.toolbar.settings": "Chat Settings",
  "chatInput.send": "Send",
  "chatInput.sending": "Sending..."
}
```

## Files to Create/Modify

### New Files
- `src/renderer/src/components/ChatInput/ChatInputToolbar.vue`
- `src/renderer/src/components/ChatInput/AgentInfoBadge.vue`
- `src/renderer/src/components/ChatInput/WorkdirToolbarItem.vue`
- `src/renderer/src/components/ChatInput/SendButton.vue`

### Modified Files
- `src/renderer/src/components/ChatInput.vue` - 添加工具栏
- `src/renderer/src/stores/chat.ts` - 添加 workdir override 逻辑
- `src/main/presenter/configPresenter/index.ts` - 添加 recentWorkdirs 管理
- `src/shared/types/presenters/config.presenter.d.ts` - 添加类型定义

## Dependencies

- Phase 1 (AgentConfigPresenter)
- Phase 4 (NewThread - WorkdirSelector 逻辑可复用)

## Testing

- [ ] Agent info badge displays correctly
- [ ] Agent info popover shows details
- [ ] Workdir shows session default
- [ ] Workdir selector shows recent directories
- [ ] Workdir browse opens native picker
- [ ] Workdir override is applied to message
- [ ] Reset button clears override
- [ ] Recent workdirs persist across sessions
