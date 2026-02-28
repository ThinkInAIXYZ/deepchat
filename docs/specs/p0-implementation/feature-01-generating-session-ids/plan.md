# Generating Session IDs Tracking - Implementation Plan

## Current State

**What exists today:**

1. No centralized tracking of generating sessions in frontend
2. Input box disable logic is ad-hoc and inconsistent
3. Stop button visibility not properly tied to generation state
4. Backend emits `STREAM_EVENTS.END` and `STREAM_EVENTS.ERROR` ✅
5. Session store exists but lacks generation tracking state

**Current Code Flow:**
```typescript
// Current: No tracking
async function sendMessage() {
  await agentPresenter.sendMessage(sessionId, content)
  // No state management
}
```

## Target State

**What we want after implementation:**

1. Frontend maintains reactive Set of generating session IDs
2. Immediate UI feedback when generation starts
3. Consistent input box disable behavior
4. Stop button visibility tied to generation state
5. Multi-session generation tracking support

**Target Code Flow:**
```typescript
// Target: With tracking
async function sendMessage() {
  sessionStore.addGeneratingSession(sessionId)
  try {
    await agentPresenter.sendMessage(sessionId, content)
  } catch (error) {
    sessionStore.removeGeneratingSession(sessionId)
    throw error
  }
}

// Cleanup on stream end
window.api.on(STREAM_EVENTS.END, (data) => {
  sessionStore.removeGeneratingSession(data.sessionId)
})
```

## Implementation Phases

### Phase 1: Session Store Updates

1. Add `generatingSessionIds` state to session store
2. Add helper functions (add, remove, isGenerating)
3. Ensure reactivity with Vue 3 `ref<Set<string>>`
4. Export state and functions for use in components

**Files:**
- `src/renderer/src/stores/session.ts`

### Phase 2: ChatPage Integration

1. Import `addGeneratingSession` and `removeGeneratingSession`
2. Modify `sendMessage()` to add session ID before sending
3. Add error handling to remove on failure
4. Set up event listeners for END and ERROR events
5. Clean up listeners on component unmount

**Files:**
- `src/renderer/src/views/ChatPage.vue`

### Phase 3: UI Component Binding

1. Update `ChatInputBox.vue` to check `isGenerating(sessionId)`
2. Update `StopButton.vue` to show when generating
3. Test reactive updates across components
4. Verify multi-session tracking works correctly

**Files:**
- `src/renderer/src/components/chat/ChatInputBox.vue`
- `src/renderer/src/components/chat/StopButton.vue`

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/renderer/src/stores/session.ts` | Modify | Add `generatingSessionIds` state and helper functions |
| `src/renderer/src/views/ChatPage.vue` | Modify | Add session to Set on send, remove on END/ERROR |
| `src/renderer/src/components/chat/ChatInputBox.vue` | Modify | Check `isGenerating()` for disabled prop |
| `src/renderer/src/components/chat/StopButton.vue` | Modify | Show/hide based on generating state |

## Testing Strategy

### Unit Tests

**File:** `src/renderer/src/stores/__tests__/session.test.ts`

```typescript
describe('generatingSessionIds', () => {
  it('should add session ID to Set', () => {
    addGeneratingSession('session-1')
    expect(isGenerating('session-1')).toBe(true)
  })

  it('should remove session ID from Set', () => {
    addGeneratingSession('session-1')
    removeGeneratingSession('session-1')
    expect(isGenerating('session-1')).toBe(false)
  })

  it('should track multiple sessions independently', () => {
    addGeneratingSession('session-1')
    addGeneratingSession('session-2')
    expect(isGenerating('session-1')).toBe(true)
    expect(isGenerating('session-2')).toBe(true)
    removeGeneratingSession('session-1')
    expect(isGenerating('session-1')).toBe(false)
    expect(isGenerating('session-2')).toBe(true)
  })

  it('should be reactive', async () => {
    const wrapper = mount({ template: '<div>{{ isGenerating("s1") }}</div>' })
    expect(wrapper.text()).toBe('false')
    addGeneratingSession('s1')
    await nextTick()
    expect(wrapper.text()).toBe('true')
  })
})
```

### Integration Tests

**File:** `tests/integration/generation-tracking.test.ts`

```typescript
describe('Generation Tracking Integration', () => {
  it('should track session during message send', async () => {
    const sessionId = 'test-session'
    
    // Send message
    await chatPage.sendMessage(sessionId, 'Hello')
    
    // Verify tracking
    expect(sessionStore.isGenerating(sessionId)).toBe(true)
  })

  it('should stop tracking on END event', async () => {
    const sessionId = 'test-session'
    
    // Send message
    await chatPage.sendMessage(sessionId, 'Hello')
    
    // Simulate END event
    eventBus.sendToRenderer(STREAM_EVENTS.END, { sessionId })
    await nextTick()
    
    // Verify tracking removed
    expect(sessionStore.isGenerating(sessionId)).toBe(false)
  })

  it('should stop tracking on ERROR event', async () => {
    const sessionId = 'test-session'
    
    // Send message
    await chatPage.sendMessage(sessionId, 'Hello')
    
    // Simulate ERROR event
    eventBus.sendToRenderer(STREAM_EVENTS.ERROR, { sessionId, error: 'Test error' })
    await nextTick()
    
    // Verify tracking removed
    expect(sessionStore.isGenerating(sessionId)).toBe(false)
  })
})
```

### Manual Testing

1. Open app and navigate to a session
2. Send a message
3. Verify input box is disabled immediately
4. Verify stop button appears
5. Wait for generation to complete
6. Verify input box is re-enabled
7. Verify stop button disappears
8. Repeat with multiple sessions open in different tabs

## Rollback Plan

**If issues are found:**

1. **Revert session store changes:**
   ```bash
   git checkout HEAD -- src/renderer/src/stores/session.ts
   ```

2. **Revert ChatPage changes:**
   ```bash
   git checkout HEAD -- src/renderer/src/views/ChatPage.vue
   ```

3. **Revert component changes:**
   ```bash
   git checkout HEAD -- src/renderer/src/components/chat/ChatInputBox.vue
   git checkout HEAD -- src/renderer/src/components/chat/StopButton.vue
   ```

**Fallback Behavior:**
- Input box disable logic reverts to previous ad-hoc implementation
- Stop button visibility uses old logic
- No breaking changes to existing functionality

## Success Criteria

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Manual testing completed successfully
- [ ] No console errors or warnings
- [ ] Reactive updates work correctly
- [ ] Multi-session tracking works
- [ ] Edge cases handled properly
- [ ] Type check passing
- [ ] Lint passing
- [ ] Format passing

## Estimated Timeline

- **Phase 1 (Store):** 30 minutes
- **Phase 2 (ChatPage):** 1 hour
- **Phase 3 (Components):** 30 minutes
- **Testing:** 1 hour
- **Total:** ~3 hours

---

**Status:** 📝 Plan Complete  
**Priority:** P0  
**Complexity:** Low  
**Risk:** Low
