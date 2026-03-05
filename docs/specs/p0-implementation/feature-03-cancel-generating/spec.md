# CancelGenerating Implementation - Specification

## Implementation Status Sync (2026-03-04)

**Status:** 🟡 Partial  
**Note:** Cancel/abort flow is live, but the message model does not yet expose an explicit `cancelled` status in this new-agent path.

## Overview

Implement the cancelGenerating functionality to allow users to stop ongoing generation. When cancelled, the assistant message should be marked as 'cancelled' but keep partial content, and the user should be able to resend a new message.

## User Stories

- As a user, I want to stop a long-running generation that's taking too long
- As a user, I need to see what was generated before I cancelled
- As a user, I want to send a new message after cancelling generation
- As a user, I should not lose partial content when cancelling

## Acceptance Criteria

### Functional Requirements

- [ ] User can click stop button to cancel generation
- [ ] Backend stops LLM stream immediately
- [ ] Partial content generated before cancel is preserved
- [ ] Message is marked with cancelled state
- [ ] Input box is re-enabled after cancel
- [ ] Stop button is hidden after cancel
- [ ] User can send a new message after cancel
- [ ] Cancelled message can be resent (user action, not automatic)

### Technical Requirements

- [ ] Frontend calls cancelGenerating(sessionId) IPC method
- [ ] Backend stops LLM stream
- [ ] Backend marks message as cancelled
- [ ] Backend emits STATUS_CHANGED('idle') event
- [ ] Backend removes session from generatingSessionIds
- [ ] Message retains partial content
- [ ] No automatic retry (user must manually resend)

## Architecture

### Backend Changes

**New/Modified Files:**
1. `src/main/presenter/newAgentPresenter/index.ts` - Add cancelGeneration method
2. `src/main/presenter/deepchatAgentPresenter/streamManager.ts` - Add stop stream logic
3. `src/main/presenter/deepchatAgentPresenter/messageStore.ts` - Add cancelled status

### Frontend Changes

**New/Modified Files:**
1. `src/renderer/src/stores/session.ts` - Add cancelGenerating action
2. `src/renderer/src/views/ChatPage.vue` - Call cancelGenerating on stop

### State Management

```
User clicks Stop
  ↓
sessionStore.cancelGenerating(sessionId)
  ↓
IPC: newAgentPresenter.cancelGeneration(sessionId)
  ↓
Backend: Stop LLM stream
  ↓
Backend: Mark message as cancelled
  ↓
Backend: emit STATUS_CHANGED('idle')
  ↓
Backend: emit STREAM_EVENTS.END
  ↓
Frontend: remove from generatingSessionIds
  ↓
UI: Input re-enabled, stop button hidden
```

## Event Flow

```
User clicks Stop button
  ↓
ChatPage.handleStop()
  ↓
sessionStore.cancelGenerating(sessionId)
  ↓
IPC: newAgentPresenter.cancelGeneration(sessionId)
  ↓
Backend: Set session.cancelling = true
  ↓
Backend: Abort LLM stream controller
  ↓
Backend: Keep partial content in message
  ↓
Backend: message.status = 'cancelled'
  ↓
Backend: emit STATUS_CHANGED('idle', sessionId)
  ↓
Backend: emit STREAM_EVENTS.END({ sessionId, cancelled: true })
  ↓
Frontend: removeGeneratingSession(sessionId)
  ↓
UI updates
```

## Edge Cases

### 1. Cancel During Permission Request

**Scenario:** User cancels while waiting for permission approval

**Handling:**
- Cancel permission request
- Mark message as cancelled
- Clear permission state

### 2. Cancel After Stream Already Ended

**Scenario:** User clicks stop after generation completed (race condition)

**Handling:**
- Backend checks if stream is still active
- If already ended, no-op
- Frontend still removes from generating set

### 3. Multiple Cancel Clicks

**Scenario:** User clicks stop button multiple times

**Handling:**
- Stop button disabled after first click (Feature 2)
- Backend ignores duplicate cancel requests
- Idempotent operation

### 4. Network Disconnection During Cancel

**Scenario:** Network disconnects before cancel reaches backend

**Handling:**
- Frontend removes from generating set anyway
- Backend will eventually timeout
- User can send new message

### 5. Cancel During Tool Execution

**Scenario:** User cancels while tool is executing

**Handling:**
- Abort tool execution if possible
- Mark message as cancelled
- Clean up tool state

## Testing Checklist

### Unit Tests

- [ ] cancelGenerating removes session from generating set
- [ ] cancelGeneration IPC method exists
- [ ] Stream abort controller is called
- [ ] Message status set to 'cancelled'
- [ ] Partial content preserved

### Integration Tests

- [ ] Click stop → generation cancels
- [ ] After cancel → input re-enabled
- [ ] After cancel → stop button hidden
- [ ] After cancel → can send new message
- [ ] Cancelled message retains content

### Manual Tests

- [ ] Start generation, click stop immediately
- [ ] Start generation, click stop after partial content
- [ ] Verify partial content is shown
- [ ] Send new message after cancel
- [ ] Cancel during tool execution
- [ ] Cancel during permission request

## Dependencies

### Internal Dependencies

- **Feature 1:** Generating Session IDs Tracking
- **Feature 2:** Input Box Disable + Stop Button

### External Dependencies

- LLM stream abort controller support
- Backend IPC method implementation

## Related Features

- **Feature 1:** Generating Session IDs Tracking (removes on cancel)
- **Feature 2:** Input Box Disable + Stop Button (triggers cancel)
- **Feature 6:** Optimistic User Messages (may need cleanup on cancel)

---

**Status:** 📝 Spec Complete  
**Priority:** P0  
**Estimated Implementation:** 1-2 days  
**Risk Level:** Medium
