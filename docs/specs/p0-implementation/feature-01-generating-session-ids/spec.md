# Generating Session IDs Tracking - Specification

## Overview

Track which sessions are currently generating responses using a frontend-managed Set (`generatingSessionIds`). This provides immediate UI feedback for generation state, enabling proper input box disabling and stop button visibility.

## User Stories

- As a user, I want to know when a session is actively generating a response
- As a user, I need visual feedback that my message is being processed
- As a user, I want to see which conversations are busy in a multi-session environment

## Acceptance Criteria

### Functional Requirements

- [ ] Frontend maintains a reactive Set of generating session IDs
- [ ] Session ID is added to the Set immediately when user sends a message
- [ ] Session ID is removed from the Set when END or ERROR event is received
- [ ] UI components can reactively query if a session is generating
- [ ] Multiple sessions can be tracked simultaneously (multi-tab support)

### Technical Requirements

- [ ] Frontend adds session ID to Set on message send
- [ ] Frontend listens to `STREAM_EVENTS.END` event
- [ ] Frontend listens to `STREAM_EVENTS.ERROR` event
- [ ] Session ID removed on both END and ERROR events
- [ ] Set is reactive (Vue 3 `ref<Set<string>>`)
- [ ] No backend changes required (frontend-only state)

## Architecture

### Backend Changes

**None** - This is a frontend-only tracking mechanism.

Backend already emits the required events:
- `STREAM_EVENTS.END` - when generation completes
- `STREAM_EVENTS.ERROR` - when generation fails

### Frontend Changes

**New State:**
```typescript
// src/renderer/src/stores/session.ts
export const generatingSessionIds = ref<Set<string>>(new Set())
```

**Modified Components:**
1. `src/renderer/src/stores/session.ts` - Add generatingSessionIds state
2. `src/renderer/src/views/ChatPage.vue` - Add session ID on send
3. `src/renderer/src/components/chat/ChatInputBox.vue` - Check generating state
4. `src/renderer/src/components/chat/StopButton.vue` - Show when generating

### State Management

```typescript
// Session Store (src/renderer/src/stores/session.ts)
import { ref } from 'vue'

export const generatingSessionIds = ref<Set<string>>(new Set())

export function addGeneratingSession(sessionId: string) {
  generatingSessionIds.value.add(sessionId)
}

export function removeGeneratingSession(sessionId: string) {
  generatingSessionIds.value.delete(sessionId)
}

export function isGenerating(sessionId: string): boolean {
  return generatingSessionIds.value.has(sessionId)
}
```

## Event Flow

### Message Send Flow

```
User clicks Send
  ↓
ChatPage.sendMessage()
  ↓
sessionStore.addGeneratingSession(sessionId)  ← Add to Set
  ↓
messageStore.addOptimisticMessage()  ← Show optimistic UI
  ↓
agentPresenter.sendMessage()
  ↓
[Backend processes message]
  ↓
[Backend emits STREAM_EVENTS.RESPONSE (streaming content)]
  ↓
[Backend emits STREAM_EVENTS.END or STREAM_EVENTS.ERROR]
  ↓
Frontend receives END/ERROR event
  ↓
sessionStore.removeGeneratingSession(sessionId)  ← Remove from Set
  ↓
UI updates (input re-enabled, stop button hidden)
```

### Implementation Example

```typescript
// src/renderer/src/views/ChatPage.vue
async function sendMessage(content: string) {
  const sessionId = sessionStore.activeSession?.id
  
  if (!sessionId) return
  
  // Add to generating set IMMEDIATELY
  sessionStore.addGeneratingSession(sessionId)
  
  try {
    await agentPresenter.sendMessage(sessionId, content)
    // Note: Don't remove here - wait for END/ERROR event
  } catch (error) {
    // On error, remove from set
    sessionStore.removeGeneratingSession(sessionId)
    throw error
  }
}

// Listen to stream events
onMounted(() => {
  window.api.on(STREAM_EVENTS.END, (data) => {
    sessionStore.removeGeneratingSession(data.sessionId)
  })
  
  window.api.on(STREAM_EVENTS.ERROR, (data) => {
    sessionStore.removeGeneratingSession(data.sessionId)
  })
})
```

## Edge Cases

### 1. Backend Fails to Start Generation

**Scenario:** Frontend adds to Set, but backend fails before emitting END/ERROR

**Handling:**
- Frontend catches sendMessage() error
- Remove from Set in catch block
- Show error notification to user

### 2. Multiple Messages in Same Session

**Scenario:** User sends multiple messages rapidly (should be prevented by UI)

**Handling:**
- Input box is disabled while generating
- Set already contains sessionId (no duplicate issue with Set data structure)

### 3. Session Switch During Generation

**Scenario:** User switches to different session while one is generating

**Handling:**
- Set tracks all sessions independently
- Each session's generating state is preserved
- UI shows correct state when switching back

### 4. App Refresh During Generation

**Scenario:** User refreshes app while generation is in progress

**Handling:**
- Set is cleared on refresh (in-memory only)
- On reconnection, backend state is source of truth
- Can optionally sync with backend on reconnect

### 5. Network Disconnection

**Scenario:** Network disconnects, END/ERROR never received

**Handling:**
- Timeout mechanism (optional enhancement)
- User can manually cancel (see Feature 3)
- Set cleared on session deactivation

## Testing Checklist

### Unit Tests

- [ ] `addGeneratingSession()` adds ID to Set
- [ ] `removeGeneratingSession()` removes ID from Set
- [ ] `isGenerating()` returns correct boolean
- [ ] Set remains reactive after add/remove operations
- [ ] Multiple session IDs can be tracked simultaneously

### Integration Tests

- [ ] Send message → Set contains session ID
- [ ] Receive END event → Set doesn't contain session ID
- [ ] Receive ERROR event → Set doesn't contain session ID
- [ ] Input box disabled when session is generating
- [ ] Stop button visible when session is generating

### Manual Tests

- [ ] Send message in Session A → Session A shows generating state
- [ ] Send message in Session B → Both sessions tracked independently
- [ ] Wait for generation complete → Input re-enabled
- [ ] Trigger error → Input re-enabled, error shown
- [ ] Switch sessions during generation → State preserved

### Edge Case Tests

- [ ] Rapid message sending (should be blocked by disabled input)
- [ ] Network disconnection during generation
- [ ] App refresh during generation
- [ ] Backend crash during generation

## Dependencies

### Internal Dependencies

- None - This feature is foundational and independent

### External Dependencies

- Backend emits `STREAM_EVENTS.END` ✅ (already implemented)
- Backend emits `STREAM_EVENTS.ERROR` ✅ (already implemented)
- Vue 3 reactivity system ✅ (already available)

## Related Features

- **Feature 2:** Input Box Disable + Stop Button (uses this feature)
- **Feature 3:** CancelGenerating Implementation (uses this feature)
- **Feature 6:** Optimistic User Messages (coordinates with this feature)

---

**Status:** 📝 Spec Complete  
**Priority:** P0  
**Estimated Implementation:** 2-3 hours  
**Risk Level:** Low (frontend-only, no backend changes)
