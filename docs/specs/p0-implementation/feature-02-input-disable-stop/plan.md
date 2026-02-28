# Input Box Disable + Stop Button - Implementation Plan

## Current State

**What exists today:**

1. ChatInputBox component exists but may not have proper disabled prop
2. Stop button may exist but not properly integrated
3. No unified disabled state management
4. Input box can be clicked during generation (no prevention)
5. No clear visual feedback for generation state

**Current Code:**
```vue
<!-- ChatInputBox.vue - May lack proper disabled handling -->
<template>
  <textarea
    v-model="inputText"
    @keydown.enter.exact="handleSend"
  />
  <!-- Stop button may be missing or not functional -->
</template>
```

## Target State

**What we want after implementation:**

1. ChatInputBox has reactive disabled prop
2. StopButton component properly integrated
3. Input box disabled during generation
4. Stop button visible during generation
5. Clear visual feedback for users

**Target Code:**
```vue
<!-- ChatInputBox.vue -->
<template>
  <textarea
    :disabled="disabled || isGenerating"
    v-model="inputText"
    placeholder="Type your message..."
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  disabled?: boolean
}>()

const isGenerating = computed(() => {
  const sessionId = sessionStore.activeSession?.id
  return sessionId ? isGenerating(sessionId) : false
})
</script>

<!-- StopButton.vue -->
<template>
  <button
    v-if="showStopButton"
    @click="handleStop"
  >
    Stop Generating
  </button>
</template>
```

## Implementation Phases

### Phase 1: ChatInputBox Component Update

1. Add `disabled` prop to component interface
2. Bind disabled prop to textarea element
3. Add computed property for generating state
4. Combine disabled prop with generating state
5. Add ARIA attributes for accessibility

**Files:**
- `src/renderer/src/components/chat/ChatInputBox.vue`

### Phase 2: StopButton Component

1. Create or update StopButton component
2. Add `showStopButton` prop
3. Add `stop` event emission
4. Style button appropriately
5. Add loading state for click feedback

**Files:**
- `src/renderer/src/components/chat/StopButton.vue`

### Phase 3: ChatPage Integration

1. Import ChatInputBox and StopButton components
2. Pass disabled prop based on generating state
3. Pass showStopButton prop based on generating state
4. Handle stop event emission
5. Call cancelGenerating on stop (Feature 3)

**Files:**
- `src/renderer/src/views/ChatPage.vue`

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/renderer/src/components/chat/ChatInputBox.vue` | Modify | Add disabled prop and generating state binding |
| `src/renderer/src/components/chat/StopButton.vue` | Modify/Create | Create or update stop button component |
| `src/renderer/src/views/ChatPage.vue` | Modify | Wire up disabled and stop button props |
| `src/renderer/src/components/chat/index.ts` | Modify | Export StopButton component |

## Testing Strategy

### Unit Tests

**File:** `src/renderer/src/components/chat/__tests__/ChatInputBox.test.ts`

```typescript
import { mount } from '@vue/test-utils'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'

describe('ChatInputBox', () => {
  it('should disable textarea when disabled prop is true', () => {
    const wrapper = mount(ChatInputBox, {
      props: { disabled: true }
    })
    
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('disabled')).toBeDefined()
  })

  it('should enable textarea when disabled prop is false', () => {
    const wrapper = mount(ChatInputBox, {
      props: { disabled: false }
    })
    
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('disabled')).toBeUndefined()
  })

  it('should disable when session is generating', async () => {
    const wrapper = mount(ChatInputBox, {
      props: { disabled: false },
      global: { plugins: [createTestingPinia()] }
    })
    
    addGeneratingSession('test-session')
    await nextTick()
    
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('disabled')).toBeDefined()
  })
})
```

**File:** `src/renderer/src/components/chat/__tests__/StopButton.test.ts`

```typescript
import { mount } from '@vue/test-utils'
import StopButton from '@/components/chat/StopButton.vue'

describe('StopButton', () => {
  it('should show button when showStopButton is true', () => {
    const wrapper = mount(StopButton, {
      props: { showStopButton: true }
    })
    
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('should hide button when showStopButton is false', () => {
    const wrapper = mount(StopButton, {
      props: { showStopButton: false }
    })
    
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('should emit stop event on click', async () => {
    const wrapper = mount(StopButton, {
      props: { showStopButton: true }
    })
    
    await wrapper.find('button').trigger('click')
    
    expect(wrapper.emitted('stop')).toHaveLength(1)
  })
})
```

### Integration Tests

**File:** `tests/integration/input-disable-stop.test.ts`

```typescript
import { mount } from '@vue/test-utils'
import ChatPage from '@/views/ChatPage.vue'

describe('Input Disable and Stop Button Integration', () => {
  it('should disable input and show stop button on send', async () => {
    const wrapper = mount(ChatPage, {
      global: { plugins: [createTestingPinia()] }
    })
    
    // Send a message
    await wrapper.vm.sendMessage('Hello')
    await nextTick()
    
    // Check input is disabled
    const inputBox = wrapper.findComponent(ChatInputBox)
    expect(inputBox.props('disabled')).toBe(true)
    
    // Check stop button is visible
    const stopButton = wrapper.findComponent(StopButton)
    expect(stopButton.props('showStopButton')).toBe(true)
  })

  it('should enable input and hide stop button on END', async () => {
    const wrapper = mount(ChatPage, {
      global: { plugins: [createTestingPinia()] }
    })
    
    // Send a message
    await wrapper.vm.sendMessage('Hello')
    
    // Simulate END event
    window.api.emit(STREAM_EVENTS.END, { sessionId: 'test-session' })
    await nextTick()
    
    // Check input is enabled
    const inputBox = wrapper.findComponent(ChatInputBox)
    expect(inputBox.props('disabled')).toBe(false)
    
    // Check stop button is hidden
    const stopButton = wrapper.findComponent(StopButton)
    expect(stopButton.props('showStopButton')).toBe(false)
  })

  it('should call cancelGenerating when stop button clicked', async () => {
    const wrapper = mount(ChatPage, {
      global: { plugins: [createTestingPinia()] }
    })
    
    // Send a message
    await wrapper.vm.sendMessage('Hello')
    
    // Click stop button
    const stopButton = wrapper.findComponent(StopButton)
    await stopButton.find('button').trigger('click')
    
    // Verify cancelGenerating was called
    expect(sessionStore.cancelGenerating).toHaveBeenCalledWith('test-session')
  })
})
```

### Manual Testing

1. **Basic Flow:**
   - Open app
   - Send a message
   - Verify input box is disabled immediately
   - Verify stop button appears
   - Wait for generation to complete
   - Verify input box is re-enabled
   - Verify stop button disappears

2. **Stop Flow:**
   - Send a message
   - Click stop button immediately
   - Verify generation is cancelled
   - Verify input box is re-enabled
   - Verify stop button disappears

3. **Error Flow:**
   - Send a message that will error
   - Verify error is shown
   - Verify input box is re-enabled
   - Verify stop button disappears

4. **Multi-Session Flow:**
   - Open two sessions in different tabs
   - Send message in Tab 1
   - Verify Tab 1 input is disabled
   - Switch to Tab 2
   - Verify Tab 2 input is enabled
   - Send message in Tab 2
   - Verify both tabs track independently

## Rollback Plan

**If issues are found:**

1. **Revert ChatInputBox changes:**
   ```bash
   git checkout HEAD -- src/renderer/src/components/chat/ChatInputBox.vue
   ```

2. **Revert StopButton changes:**
   ```bash
   git checkout HEAD -- src/renderer/src/components/chat/StopButton.vue
   ```

3. **Revert ChatPage changes:**
   ```bash
   git checkout HEAD -- src/renderer/src/views/ChatPage.vue
   ```

**Fallback Behavior:**
- Input box may not disable during generation (previous behavior)
- Stop button may not appear or be non-functional
- No breaking changes to existing functionality

## Success Criteria

- [ ] ChatInputBox disabled prop works correctly
- [ ] StopButton shows/hides correctly
- [ ] Stop button click triggers cancel flow
- [ ] Input box disabled during generation
- [ ] Input box enabled after generation ends
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Manual testing completed
- [ ] Accessibility requirements met
- [ ] Type check passing
- [ ] Lint passing
- [ ] Format passing

## Estimated Timeline

- **Phase 1 (ChatInputBox):** 1 hour
- **Phase 2 (StopButton):** 1 hour
- **Phase 3 (Integration):** 30 minutes
- **Testing:** 1 hour
- **Total:** ~3.5 hours

---

**Status:** 📝 Plan Complete  
**Priority:** P0  
**Complexity:** Low  
**Risk:** Low
