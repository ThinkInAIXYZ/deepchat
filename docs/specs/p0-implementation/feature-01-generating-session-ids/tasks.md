# Generating Session IDs Tracking - Implementation Tasks

## Task List

### Task 1: Add generatingSessionIds State to Session Store

**File:** `src/renderer/src/stores/session.ts`

**Current State:**
```typescript
export const sessionStore = defineStore('session', {
  state: () => ({
    sessions: [] as Session[],
    activeSessionId: null as string | null,
    // ... other state
  })
})
```

**Required Change:**
```typescript
import { ref } from 'vue'

// Add to store state
export const generatingSessionIds = ref<Set<string>>(new Set())

// Add helper functions
export function addGeneratingSession(sessionId: string) {
  generatingSessionIds.value.add(sessionId)
}

export function removeGeneratingSession(sessionId: string) {
  generatingSessionIds.value.delete(sessionId)
}

export function isGenerating(sessionId: string): boolean {
  return generatingSessionIds.value.has(sessionId)
}

// Export for use in components
export { generatingSessionIds, addGeneratingSession, removeGeneratingSession, isGenerating }
```

**Expected Behavior:**
- Set is reactive (Vue 3 ref)
- Functions properly add/remove/check session IDs
- Multiple sessions can be tracked simultaneously

**Test Case:**
```typescript
// src/renderer/src/stores/__tests__/session.test.ts
import { addGeneratingSession, removeGeneratingSession, isGenerating } from '../session'

test('should track generating sessions', () => {
  expect(isGenerating('session-1')).toBe(false)
  
  addGeneratingSession('session-1')
  expect(isGenerating('session-1')).toBe(true)
  
  removeGeneratingSession('session-1')
  expect(isGenerating('session-1')).toBe(false)
})

test('should track multiple sessions', () => {
  addGeneratingSession('session-1')
  addGeneratingSession('session-2')
  
  expect(isGenerating('session-1')).toBe(true)
  expect(isGenerating('session-2')).toBe(true)
  
  removeGeneratingSession('session-1')
  expect(isGenerating('session-1')).toBe(false)
  expect(isGenerating('session-2')).toBe(true)
})
```

---

### Task 2: Update ChatPage to Track Generation

**File:** `src/renderer/src/views/ChatPage.vue`

**Current State:**
```typescript
async function sendMessage(content: string) {
  const sessionId = sessionStore.activeSession?.id
  if (!sessionId) return
  
  await agentPresenter.sendMessage(sessionId, content)
  // No tracking
}
```

**Required Change:**
```typescript
import { addGeneratingSession, removeGeneratingSession } from '@/stores/session'
import { STREAM_EVENTS } from '@shared/events'

async function sendMessage(content: string) {
  const sessionId = sessionStore.activeSession?.id
  if (!sessionId) return
  
  // Add to generating set immediately
  addGeneratingSession(sessionId)
  
  try {
    await agentPresenter.sendMessage(sessionId, content)
    // Don't remove here - wait for END/ERROR event
  } catch (error) {
    // On error, remove from set
    removeGeneratingSession(sessionId)
    throw error
  }
}

// Set up event listeners
onMounted(() => {
  // Listen for stream end
  window.api.on(STREAM_EVENTS.END, (data) => {
    removeGeneratingSession(data.sessionId)
  })
  
  // Listen for stream error
  window.api.on(STREAM_EVENTS.ERROR, (data) => {
    removeGeneratingSession(data.sessionId)
  })
})

onUnmounted(() => {
  // Clean up listeners
  window.api.removeAllListeners(STREAM_EVENTS.END)
  window.api.removeAllListeners(STREAM_EVENTS.ERROR)
})
```

**Expected Behavior:**
- Session ID added to Set immediately when send is clicked
- Session ID removed when END event received
- Session ID removed when ERROR event received
- Error handling removes from Set if sendMessage fails

**Test Case:**
```typescript
// tests/integration/chatpage-generation.test.ts
import { generatingSessionIds } from '@/stores/session'

test('should add session to generating set on send', async () => {
  const sessionId = 'test-session'
  await sessionStore.setActiveSession(sessionId)
  
  await chatPage.sendMessage('Hello')
  
  expect(generatingSessionIds.value.has(sessionId)).toBe(true)
})

test('should remove session from generating set on END', async () => {
  const sessionId = 'test-session'
  await sessionStore.setActiveSession(sessionId)
  
  await chatPage.sendMessage('Hello')
  expect(generatingSessionIds.value.has(sessionId)).toBe(true)
  
  // Simulate END event
  window.api.emit(STREAM_EVENTS.END, { sessionId })
  await nextTick()
  
  expect(generatingSessionIds.value.has(sessionId)).toBe(false)
})

test('should remove session from generating set on ERROR', async () => {
  const sessionId = 'test-session'
  await sessionStore.setActiveSession(sessionId)
  
  await chatPage.sendMessage('Hello')
  
  // Simulate ERROR event
  window.api.emit(STREAM_EVENTS.ERROR, { sessionId, error: 'Test error' })
  await nextTick()
  
  expect(generatingSessionIds.value.has(sessionId)).toBe(false)
})
```

---

### Task 3: Update ChatInputBox to Check Generating State

**File:** `src/renderer/src/components/chat/ChatInputBox.vue`

**Current State:**
```vue
<template>
  <textarea
    :disabled="disabled"
    v-model="inputText"
    @keydown.enter.exact="handleSend"
  />
</template>

<script setup lang="ts">
defineProps<{
  disabled?: boolean
}>()
</script>
```

**Required Change:**
```vue
<template>
  <textarea
    :disabled="disabled || isSessionGenerating"
    v-model="inputText"
    @keydown.enter.exact="handleSend"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isGenerating } from '@/stores/session'
import { sessionStore } from '@/stores/session'

const props = defineProps<{
  disabled?: boolean
}>()

const isSessionGenerating = computed(() => {
  const sessionId = sessionStore.activeSession?.id
  return sessionId ? isGenerating(sessionId) : false
})
</script>
```

**Expected Behavior:**
- Input box disabled when session is generating
- Input box disabled when parent component sets disabled prop
- Both conditions are OR'd together

**Test Case:**
```typescript
// tests/unit/chat-input-box.test.ts
import { mount } from '@vue/test-utils'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import { addGeneratingSession, removeGeneratingSession } from '@/stores/session'

test('should disable when session is generating', async () => {
  const wrapper = mount(ChatInputBox, {
    props: { disabled: false },
    global: {
      plugins: [createTestingPinia()]
    }
  })
  
  const sessionId = 'test-session'
  addGeneratingSession(sessionId)
  await nextTick()
  
  const textarea = wrapper.find('textarea')
  expect(textarea.attributes('disabled')).toBeDefined()
  
  removeGeneratingSession(sessionId)
  await nextTick()
  
  expect(textarea.attributes('disabled')).toBeUndefined()
})

test('should disable when disabled prop is true', () => {
  const wrapper = mount(ChatInputBox, {
    props: { disabled: true }
  })
  
  const textarea = wrapper.find('textarea')
  expect(textarea.attributes('disabled')).toBeDefined()
})
```

---

### Task 4: Update StopButton to Show When Generating

**File:** `src/renderer/src/components/chat/StopButton.vue`

**Current State:**
```vue
<template>
  <button
    v-if="show"
    @click="handleStop"
  >
    Stop
  </button>
</template>

<script setup lang="ts">
defineProps<{
  show?: boolean
}>()
</script>
```

**Required Change:**
```vue
<template>
  <button
    v-if="show || isSessionGenerating"
    @click="handleStop"
  >
    Stop
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isGenerating } from '@/stores/session'
import { sessionStore } from '@/stores/session'

const props = defineProps<{
  show?: boolean
}>()

const isSessionGenerating = computed(() => {
  const sessionId = sessionStore.activeSession?.id
  return sessionId ? isGenerating(sessionId) : false
})

const handleStop = () => {
  // Emit stop event to parent
  emit('stop')
  // Will be handled by Feature 3: cancelGenerating
}
</script>
```

**Expected Behavior:**
- Stop button visible when session is generating
- Stop button visible when parent component sets show prop
- Both conditions are OR'd together
- Click emits stop event

**Test Case:**
```typescript
// tests/unit/stop-button.test.ts
import { mount } from '@vue/test-utils'
import StopButton from '@/components/chat/StopButton.vue'
import { addGeneratingSession, removeGeneratingSession } from '@/stores/session'

test('should show when session is generating', async () => {
  const wrapper = mount(StopButton, {
    props: { show: false },
    global: {
      plugins: [createTestingPinia()]
    }
  })
  
  const sessionId = 'test-session'
  addGeneratingSession(sessionId)
  await nextTick()
  
  const button = wrapper.find('button')
  expect(button.exists()).toBe(true)
  
  removeGeneratingSession(sessionId)
  await nextTick()
  
  expect(button.exists()).toBe(false)
})

test('should show when show prop is true', () => {
  const wrapper = mount(StopButton, {
    props: { show: true }
  })
  
  const button = wrapper.find('button')
  expect(button.exists()).toBe(true)
})

test('should emit stop event on click', async () => {
  const wrapper = mount(StopButton, {
    props: { show: true }
  })
  
  await wrapper.find('button').trigger('click')
  
  expect(wrapper.emitted('stop')).toHaveLength(1)
})
```

---

## Implementation Order

1. **Task 1: Session Store State** - Priority: High
   - Foundation for all other tasks
   - No dependencies
   - Estimated: 30 minutes

2. **Task 2: ChatPage Integration** - Priority: High
   - Depends on Task 1
   - Core integration point
   - Estimated: 1 hour

3. **Task 3: ChatInputBox Update** - Priority: High
   - Depends on Task 1
   - User-facing UI update
   - Estimated: 30 minutes

4. **Task 4: StopButton Update** - Priority: Medium
   - Depends on Task 1
   - User-facing UI update
   - Estimated: 30 minutes

## Definition of Done

- [ ] All tasks completed
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Type check passing (`pnpm run typecheck`)
- [ ] Lint passing (`pnpm run lint`)
- [ ] Format passing (`pnpm run format`)
- [ ] Manual testing completed
- [ ] No console errors or warnings
- [ ] Reactive updates work correctly
- [ ] Multi-session tracking validated

## Notes

- This feature is frontend-only (no backend changes required)
- Backend already emits required events (END, ERROR)
- Vue 3 Set reactivity works automatically
- Multiple sessions can be tracked simultaneously
- Clean up event listeners on component unmount

---

**Status:** 📝 Tasks Defined  
**Total Estimated Time:** 2.5-3 hours  
**Risk Level:** Low
