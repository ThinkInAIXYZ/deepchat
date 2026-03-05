# Input Box Disable + Stop Button - Implementation Tasks

## Implementation Sync (2026-03-04)

**Overall:** ✅ Functional Complete (with implementation deviation)

### Done in current codebase

1. Chat input submit is disabled while generating (`isInputSubmitDisabled` in `ChatPage`).
2. Stop action is wired (`ChatInputToolbar` emits `stop`, `ChatPage.onStop` calls `newAgentPresenter.cancelGeneration`).
3. Send/stop button switching during generation is live.

### Diff vs this task doc

1. No standalone `StopButton.vue` component; stop UX is implemented inside `ChatInputToolbar.vue`.
2. Prop names differ (`submit-disabled` / `is-generating`) from this older draft.

### Evidence (current files)

1. `src/renderer/src/pages/ChatPage.vue`
2. `src/renderer/src/components/chat/ChatInputBox.vue`
3. `src/renderer/src/components/chat/ChatInputToolbar.vue`

## Task List

### Task 1: Update ChatInputBox Component

**File:** `src/renderer/src/components/chat/ChatInputBox.vue`

**Current State:**
```vue
<template>
  <div class="chat-input-box">
    <textarea
      v-model="inputText"
      placeholder="Type a message..."
      @keydown.enter.exact="handleSend"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const inputText = ref('')

const emit = defineEmits<{
  send: [text: string]
}>()

const handleSend = () => {
  if (inputText.value.trim()) {
    emit('send', inputText.value.trim())
    inputText.value = ''
  }
}
</script>
```

**Required Change:**
```vue
<template>
  <div class="chat-input-box">
    <textarea
      v-model="inputText"
      :disabled="isDisabled"
      :aria-disabled="isDisabled"
      placeholder="Type a message..."
      @keydown.enter.exact="handleSend"
    />
    <span v-if="isDisabled" class="generating-indicator">
      Generating response...
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { isGenerating } from '@/stores/session'
import { sessionStore } from '@/stores/session'

const props = defineProps<{
  disabled?: boolean
}>()

const inputText = ref('')

const emit = defineEmits<{
  send: [text: string]
}>()

const isDisabled = computed(() => {
  const sessionId = sessionStore.activeSession?.id
  const generating = sessionId ? isGenerating(sessionId) : false
  return props.disabled || generating
})

const handleSend = () => {
  if (inputText.value.trim() && !isDisabled.value) {
    emit('send', inputText.value.trim())
    inputText.value = ''
  }
}
</script>

<style scoped>
.generating-indicator {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
}
</style>
```

**Expected Behavior:**
- Textarea is disabled when disabled prop is true OR session is generating
- Visual indicator shows when generating
- ARIA attributes for accessibility
- Cannot send message while disabled

**Test Case:**
```typescript
// src/renderer/src/components/chat/__tests__/ChatInputBox.test.ts
import { mount } from '@vue/test-utils'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import { addGeneratingSession, removeGeneratingSession } from '@/stores/session'

test('should disable when disabled prop is true', () => {
  const wrapper = mount(ChatInputBox, {
    props: { disabled: true }
  })
  
  const textarea = wrapper.find('textarea')
  expect(textarea.attributes('disabled')).toBeDefined()
})

test('should disable when session is generating', async () => {
  const wrapper = mount(ChatInputBox, {
    props: { disabled: false },
    global: { plugins: [createTestingPinia()] }
  })
  
  addGeneratingSession('test-session')
  await nextTick()
  
  const textarea = wrapper.find('textarea')
  expect(textarea.attributes('disabled')).toBeDefined()
  
  removeGeneratingSession('test-session')
  await nextTick()
  
  expect(textarea.attributes('disabled')).toBeUndefined()
})

test('should not send when disabled', async () => {
  const wrapper = mount(ChatInputBox, {
    props: { disabled: true },
    global: { plugins: [createTestingPinia()] }
  })
  
  const textarea = wrapper.find('textarea')
  await textarea.setValue('Hello')
  await textarea.trigger('keydown.enter.exact')
  
  expect(wrapper.emitted('send')).toBeUndefined()
})
```

---

### Task 2: Create/Update StopButton Component

**File:** `src/renderer/src/components/chat/StopButton.vue`

**Current State:**
```vue
<!-- May not exist or may be incomplete -->
```

**Required Change:**
```vue
<template>
  <button
    v-if="showStopButton"
    type="button"
    class="stop-button"
    :class="{ 'is-stopping': isStopping }"
    @click="handleClick"
    :aria-label="isStopping ? 'Stopping generation...' : 'Stop generating'"
    :disabled="isStopping"
  >
    <span v-if="isStopping" class="spinner"></span>
    <span>{{ isStopping ? 'Stopping...' : 'Stop' }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  showStopButton: boolean
}>()

const emit = defineEmits<{
  stop: []
}>()

const isStopping = ref(false)

const handleClick = async () => {
  if (isStopping.value) return
  
  isStopping.value = true
  emit('stop')
  
  // Reset after a delay to show feedback
  setTimeout(() => {
    isStopping.value = false
  }, 1000)
}
</script>

<style scoped>
.stop-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background-color: var(--color-danger);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.stop-button:hover:not(:disabled) {
  background-color: var(--color-danger-dark);
}

.stop-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid white;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
```

**Expected Behavior:**
- Button only shows when showStopButton is true
- Emits 'stop' event when clicked
- Shows loading state while stopping
- Disabled while stopping to prevent double-clicks
- Accessible with ARIA labels

**Test Case:**
```typescript
// src/renderer/src/components/chat/__tests__/StopButton.test.ts
import { mount } from '@vue/test-utils'
import StopButton from '@/components/chat/StopButton.vue'

test('should show when showStopButton is true', () => {
  const wrapper = mount(StopButton, {
    props: { showStopButton: true }
  })
  
  expect(wrapper.find('button').exists()).toBe(true)
})

test('should hide when showStopButton is false', () => {
  const wrapper = mount(StopButton, {
    props: { showStopButton: false }
  })
  
  expect(wrapper.find('button').exists()).toBe(false)
})

test('should emit stop event on click', async () => {
  const wrapper = mount(StopButton, {
    props: { showStopButton: true }
  })
  
  await wrapper.find('button').trigger('click')
  
  expect(wrapper.emitted('stop')).toHaveLength(1)
})

test('should show stopping state on click', async () => {
  const wrapper = mount(StopButton, {
    props: { showStopButton: true }
  })
  
  await wrapper.find('button').trigger('click')
  
  expect(wrapper.vm.isStopping).toBe(true)
  expect(wrapper.find('button').attributes('disabled')).toBeDefined()
})

test('should prevent double-click during stopping', async () => {
  const wrapper = mount(StopButton, {
    props: { showStopButton: true }
  })
  
  await wrapper.find('button').trigger('click')
  await wrapper.find('button').trigger('click')
  
  expect(wrapper.emitted('stop')).toHaveLength(1)
})
```

---

### Task 3: Integrate Components in ChatPage

**File:** `src/renderer/src/views/ChatPage.vue`

**Current State:**
```vue
<template>
  <div class="chat-page">
    <MessageList />
    <ChatInputBox @send="sendMessage" />
  </div>
</template>

<script setup lang="ts">
import ChatInputBox from '@/components/chat/ChatInputBox.vue'

async function sendMessage(text: string) {
  const sessionId = sessionStore.activeSession?.id
  if (!sessionId) return
  
  await agentPresenter.sendMessage(sessionId, text)
}
</script>
```

**Required Change:**
```vue
<template>
  <div class="chat-page">
    <MessageList />
    
    <div class="chat-input-container">
      <StopButton
        :show-stop-button="shouldShowStopButton"
        @stop="handleStop"
      />
      <ChatInputBox
        :disabled="isInputDisabled"
        @send="sendMessage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import StopButton from '@/components/chat/StopButton.vue'
import { isGenerating } from '@/stores/session'
import { sessionStore } from '@/stores/session'

const shouldShowStopButton = computed(() => {
  const sessionId = sessionStore.activeSession?.id
  return sessionId ? isGenerating(sessionId) : false
})

const isInputDisabled = computed(() => {
  const sessionId = sessionStore.activeSession?.id
  return sessionId ? isGenerating(sessionId) : false
})

async function sendMessage(text: string) {
  const sessionId = sessionStore.activeSession?.id
  if (!sessionId) return
  
  // Add to generating set (Feature 1)
  sessionStore.addGeneratingSession(sessionId)
  
  try {
    await agentPresenter.sendMessage(sessionId, text)
  } catch (error) {
    sessionStore.removeGeneratingSession(sessionId)
    throw error
  }
}

function handleStop() {
  const sessionId = sessionStore.activeSession?.id
  if (!sessionId) return
  
  // Call cancelGenerating (Feature 3)
  sessionStore.cancelGenerating(sessionId)
}
</script>

<style scoped>
.chat-input-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--color-border);
}
</style>
```

**Expected Behavior:**
- Stop button appears above input box when generating
- Input box disabled when generating
- Stop button click triggers cancelGenerating
- Components properly wired up

**Test Case:**
```typescript
// tests/integration/chatpage-input-stop.test.ts
import { mount } from '@vue/test-utils'
import ChatPage from '@/views/ChatPage.vue'

test('should show stop button and disable input when generating', async () => {
  const wrapper = mount(ChatPage, {
    global: { plugins: [createTestingPinia()] }
  })
  
  // Start generation
  await wrapper.vm.sendMessage('Hello')
  await nextTick()
  
  const stopButton = wrapper.findComponent(StopButton)
  const inputBox = wrapper.findComponent(ChatInputBox)
  
  expect(stopButton.props('showStopButton')).toBe(true)
  expect(inputBox.props('disabled')).toBe(true)
})

test('should call cancelGenerating when stop button clicked', async () => {
  const wrapper = mount(ChatPage, {
    global: { plugins: [createTestingPinia()] }
  })
  
  // Start generation
  await wrapper.vm.sendMessage('Hello')
  
  // Click stop
  const stopButton = wrapper.findComponent(StopButton)
  await stopButton.find('button').trigger('click')
  
  expect(sessionStore.cancelGenerating).toHaveBeenCalledWith(
    sessionStore.activeSession.id
  )
})

test('should hide stop button and enable input after END', async () => {
  const wrapper = mount(ChatPage, {
    global: { plugins: [createTestingPinia()] }
  })
  
  // Start generation
  await wrapper.vm.sendMessage('Hello')
  
  // Simulate END
  window.api.emit(STREAM_EVENTS.END, { sessionId: 'test-session' })
  await nextTick()
  
  const stopButton = wrapper.findComponent(StopButton)
  const inputBox = wrapper.findComponent(ChatInputBox)
  
  expect(stopButton.props('showStopButton')).toBe(false)
  expect(inputBox.props('disabled')).toBe(false)
})
```

---

## Implementation Order

1. **Task 1: ChatInputBox Update** - Priority: High
   - Foundation component
   - No dependencies
   - Estimated: 1 hour

2. **Task 2: StopButton Component** - Priority: High
   - New/updated component
   - No dependencies
   - Estimated: 1 hour

3. **Task 3: ChatPage Integration** - Priority: High
   - Depends on Task 1 and Task 2
   - Integration point
   - Estimated: 30 minutes

## Definition of Done

- [ ] All tasks completed
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Type check passing
- [ ] Lint passing
- [ ] Format passing
- [ ] Manual testing completed
- [ ] Accessibility validated
- [ ] Visual design approved
- [ ] No console errors

## Notes

- This feature depends on Feature 1 (generatingSessionIds)
- Stop button action (cancelGenerating) is implemented in Feature 3
- Visual styling should match existing design system
- Accessibility is critical for this feature
- Consider mobile/responsive design

---

**Status:** 📝 Tasks Defined  
**Total Estimated Time:** 2.5-3 hours  
**Risk Level:** Low
