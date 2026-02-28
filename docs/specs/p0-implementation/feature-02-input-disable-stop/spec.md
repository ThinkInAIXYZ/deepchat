# Input Box Disable + Stop Button - Specification

## Overview

Add proper disabled state management to the ChatInputBox component and implement a stop button that appears during generation. This provides users with clear visual feedback and control over the generation process.

## User Stories

- As a user, I want the input box to be disabled while a message is being generated
- As a user, I need a visible stop button to cancel ongoing generation
- As a user, I want clear visual feedback that the system is processing my message
- As a user, I should not be able to send multiple messages while one is being processed

## Acceptance Criteria

### Functional Requirements

- [ ] ChatInputBox accepts a `disabled` prop
- [ ] ChatInputBox applies disabled state to textarea element
- [ ] StopButton component is created/updated
- [ ] StopButton accepts a `showStopButton` prop
- [ ] StopButton emits `stop` event when clicked
- [ ] Input box is disabled when session is generating
- [ ] Stop button is visible when session is generating
- [ ] Stop button is hidden when no generation is in progress

### Technical Requirements

- [ ] ChatInputBox disabled prop is reactive
- [ ] StopButton uses event emission pattern
- [ ] Components integrate with generatingSessionIds state (Feature 1)
- [ ] No changes to backend required
- [ ] Components are reusable across different views

## Architecture

### Backend Changes

**None** - This is a frontend-only UI feature.

Backend will handle stop/cancel logic separately (see Feature 3).

### Frontend Changes

**New/Modified Components:**

1. `src/renderer/src/components/chat/ChatInputBox.vue` - Add disabled prop
2. `src/renderer/src/components/chat/StopButton.vue` - Create or update stop button
3. `src/renderer/src/views/ChatPage.vue` - Wire up disabled and stop logic

### State Management

```
Session Store (Feature 1)
  ↓
generatingSessionIds Set
  ↓
isGenerating(sessionId) computed
  ↓
ChatInputBox.disabled = isGenerating(sessionId)
StopButton.show = isGenerating(sessionId)
```

## Event Flow

### Input Disable Flow

```
User sends message
  ↓
sessionStore.addGeneratingSession(sessionId)
  ↓
isGenerating(sessionId) returns true
  ↓
ChatInputBox disabled prop = true
  ↓
Textarea is disabled (user cannot type)
```

### Stop Button Flow

```
User sends message
  ↓
sessionStore.addGeneratingSession(sessionId)
  ↓
isGenerating(sessionId) returns true
  ↓
StopButton show prop = true
  ↓
Stop button becomes visible
  ↓
User clicks Stop button
  ↓
StopButton emits 'stop' event
  ↓
ChatPage.handleStop() called
  ↓
sessionStore.cancelGenerating(sessionId) (Feature 3)
```

## Edge Cases

### 1. Rapid Clicking on Stop Button

**Scenario:** User clicks stop button multiple times rapidly

**Handling:**
- Stop button can be disabled after first click
- Backend should handle duplicate cancel requests gracefully
- Visual feedback (loading state) on button

### 2. Input Box State on Session Switch

**Scenario:** User switches sessions while one is generating

**Handling:**
- Input box disabled state tied to active session
- If active session is not generating, input is enabled
- Other sessions' generating state preserved

### 3. Stop Button During Backend Error

**Scenario:** Backend errors before stop can be processed

**Handling:**
- Stop button hidden on ERROR event
- Input box re-enabled on ERROR event
- Error message shown to user

### 4. Disabled State Persists After Stop

**Scenario:** User clicks stop but input remains disabled

**Handling:**
- Ensure cancelGenerating removes from generatingSessionIds
- Timeout fallback (optional): auto-enable after X seconds
- Manual recovery: switch sessions and back

### 5. Multiple Tabs/Sessions

**Scenario:** User has multiple sessions open in different tabs

**Handling:**
- Each tab tracks its own generating sessions
- Stop button only shows for active tab's generating session
- No cross-tab interference

## Testing Checklist

### Unit Tests

- [ ] ChatInputBox disabled prop works correctly
- [ ] ChatInputBox disabled state is reactive
- [ ] StopButton show prop works correctly
- [ ] StopButton emits stop event on click
- [ ] StopButton can be hidden/shown dynamically

### Integration Tests

- [ ] Input box disabled when session starts generating
- [ ] Input box enabled when generation ends
- [ ] Stop button appears when generation starts
- [ ] Stop button disappears when generation ends
- [ ] Stop button click triggers cancel flow

### Manual Tests

- [ ] Send message → input disables, stop button appears
- [ ] Wait for completion → input enables, stop button disappears
- [ ] Click stop button → generation cancels, input enables
- [ ] Try to send message while disabled → blocked
- [ ] Switch sessions → correct disabled state shown
- [ ] Trigger error → input re-enables

### Accessibility Tests

- [ ] Disabled input has proper ARIA attributes
- [ ] Stop button has clear label
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Screen reader announces disabled state
- [ ] Focus management correct when disabling

## Dependencies

### Internal Dependencies

- **Feature 1:** Generating Session IDs Tracking (provides generating state)

### External Dependencies

- None

## Related Features

- **Feature 1:** Generating Session IDs Tracking (prerequisite)
- **Feature 3:** CancelGenerating Implementation (stop button action)
- **Feature 4:** Permission Approval Flow (may also disable input)

---

**Status:** 📝 Spec Complete  
**Priority:** P0  
**Estimated Implementation:** 2-3 hours  
**Risk Level:** Low
