# Optimistic User Messages - Specification

## Overview

Implement optimistic UI for user messages by showing them immediately in the UI before backend confirmation, then merging with the real message once persisted. This provides instant feedback and a more responsive user experience.

## User Stories

- As a user, I want to see my message immediately after sending
- As a user, I don't want to wait for backend confirmation to see what I typed
- As a user, I need the optimistic message to be replaced seamlessly with the real message
- As a user, I want error handling if the message fails to send

## Acceptance Criteria

### Functional Requirements

- [ ] User message appears immediately after send
- [ ] Optimistic message has temporary ID
- [ ] Optimistic message marked as pending
- [ ] Real message replaces optimistic message when received
- [ ] Error shown if message fails to send
- [ ] Optimistic message removed on error (or marked as failed)
- [ ] Message order preserved during merge

### Technical Requirements

- [ ] Frontend creates optimistic message with temp ID
- [ ] Message store supports optimistic messages
- [ ] Merge logic matches optimistic to real message
- [ ] Backend returns message ID in response
- [ ] Error handling for failed sends
- [ ] Rollback mechanism on error

## Architecture

### Backend Changes

**Modified Files:**
1. `src/main/presenter/newAgentPresenter/index.ts` - Return message ID in sendMessage response

### Frontend Changes

**Modified Files:**
1. `src/renderer/src/stores/message.ts` - Add optimistic message support
2. `src/renderer/src/views/ChatPage.vue` - Create optimistic message on send

### State Management

```
User sends message
  ↓
Frontend: Create optimistic message with temp ID
  ↓
Frontend: Add to message list immediately
  ↓
Frontend: Send to backend
  ↓
Backend: Persist message to DB
  ↓
Backend: Return real message with ID
  ↓
Frontend: Replace optimistic with real message
  ↓
UI: Seamless update
```

## Event Flow

```
User types "Hello" and clicks Send
  ↓
ChatPage.sendMessage("Hello")
  ↓
messageStore.addOptimisticMessage({
  id: 'temp-' + Date.now(),
  content: "Hello",
  role: 'user',
  pending: true
})
  ↓
UI shows message immediately
  ↓
agentPresenter.sendMessage(sessionId, "Hello")
  ↓
Backend persists to DB
  ↓
Backend returns { id: 'real-123', content: "Hello", ... }
  ↓
messageStore.mergeOptimisticMessage('temp-xxx', 'real-123')
  ↓
UI updates seamlessly
```

## Edge Cases

### 1. Message Send Fails

**Scenario:** Backend rejects message or network error

**Handling:**
- Show error notification
- Mark optimistic message as failed
- Allow user to retry or delete
- Remove from list if retry not possible

### 2. Multiple Rapid Messages

**Scenario:** User sends multiple messages quickly

**Handling:**
- Each gets unique temp ID
- Order preserved in list
- Each merged independently
- No race conditions

### 3. Backend Returns Different Content

**Scenario:** Backend modifies message content (e.g., sanitization)

**Handling:**
- Real message content takes precedence
- UI updates to show real content
- Minimal visual disruption

### 4. Message Order During Merge

**Scenario:** Optimistic messages sent out of order

**Handling:**
- Use orderSeq or timestamp for ordering
- Merge based on temp ID, not position
- Maintain correct order after merge

### 5. Duplicate Detection

**Scenario:** Network retry causes duplicate message

**Handling:**
- Backend deduplicates based on content + timestamp
- Frontend handles gracefully
- Show single message

## Testing Checklist

### Unit Tests

- [ ] addOptimisticMessage creates message with temp ID
- [ ] mergeOptimisticMessage replaces with real message
- [ ] Error handling removes or marks optimistic message
- [ ] Message order preserved

### Integration Tests

- [ ] Send message → appears immediately
- [ ] Backend returns → message updated seamlessly
- [ ] Send fails → error shown
- [ ] Multiple rapid messages → all handled correctly

### Manual Tests

- [ ] Send message → see immediate appearance
- [ ] Watch for merge → should be seamless
- [ ] Trigger error → error handling works
- [ ] Send multiple rapidly → all work correctly
- [ ] Check message order → correct

## Dependencies

### Internal Dependencies

- **Feature 1:** Generating Session IDs Tracking (coordinates with generation start)

### External Dependencies

- None

## Related Features

- **Feature 1:** Generating Session IDs Tracking
- **Feature 3:** CancelGenerating Implementation (may cancel optimistic message)

---

**Status:** 📝 Spec Complete  
**Priority:** P0  
**Estimated Implementation:** 3-4 hours  
**Risk Level:** Low
