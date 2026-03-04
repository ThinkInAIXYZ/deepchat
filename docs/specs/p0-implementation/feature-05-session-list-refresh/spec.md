# Session List Auto-Refresh - Specification

## Implementation Status Sync (2026-03-04)

**Status:** ✅ Mostly Complete  
**Note:** The new chain uses `SESSION_EVENTS.LIST_UPDATED` as primary refresh signal; compatibility with legacy list events is still retained.

## Overview

Implement automatic session list refresh by listening to `CONVERSATION_EVENTS.LIST_UPDATED` events. This ensures the UI always shows the current state of sessions without manual refresh.

## User Stories

- As a user, I want the session list to update automatically when sessions change
- As a user, I need to see new sessions immediately after creation
- As a user, I want deleted sessions to disappear from the list automatically
- As a user, I expect session renames to reflect immediately

## Acceptance Criteria

### Functional Requirements

- [ ] Session list updates when CONVERSATION_EVENTS.LIST_UPDATED received
- [ ] New sessions appear immediately after creation
- [ ] Deleted sessions disappear immediately
- [ ] Renamed sessions update immediately
- [ ] Session order updates correctly
- [ ] No manual refresh needed
- [ ] Works across multiple tabs/windows

### Technical Requirements

- [ ] Frontend listens to CONVERSATION_EVENTS.LIST_UPDATED
- [ ] Session store refreshes session list on event
- [ ] Event emitted after session create/delete/rename
- [ ] Backend emits event to all windows/tabs
- [ ] Debounce rapid updates (optional optimization)

## Architecture

### Backend Changes

**Modified Files:**
1. `src/main/presenter/newAgentPresenter/sessionManager.ts` - Emit LIST_UPDATED after changes
2. `src/main/presenter/conversationManager.ts` - Emit LIST_UPDATED after changes

### Frontend Changes

**Modified Files:**
1. `src/renderer/src/stores/session.ts` - Listen to LIST_UPDATED event
2. `src/renderer/src/components/sidebar/SessionList.vue` - Reactive update

### State Management

```
Backend: Session created/updated/deleted
  ↓
Backend: emit CONVERSATION_EVENTS.LIST_UPDATED
  ↓
EventBus sends to all renderers
  ↓
Frontend: window.api.on(LIST_UPDATED)
  ↓
sessionStore.loadSessions()
  ↓
Session list reactive update
  ↓
UI refreshes automatically
```

## Event Flow

```
User creates session
  ↓
sessionManager.createSession()
  ↓
SQLite: INSERT INTO new_sessions
  ↓
eventBus.send(CONVERSATION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
  ↓
All tabs receive event
  ↓
sessionStore.loadSessions()
  ↓
sessions.value updated
  ↓
SessionList component re-renders
  ↓
New session visible
```

## Edge Cases

### 1. Rapid Session Operations

**Scenario:** User creates/deletes multiple sessions rapidly

**Handling:**
- Each operation emits LIST_UPDATED
- Frontend can debounce (optional)
- Final state is always correct

### 2. Session List Load Failure

**Scenario:** LIST_UPDATED received but loadSessions() fails

**Handling:**
- Error logged to console
- User can manually refresh
- Retry mechanism (optional)

### 3. Cross-Tab Synchronization

**Scenario:** Session created in Tab A, Tab B should update

**Handling:**
- Event sent to ALL_WINDOWS
- Both tabs receive event
- Both tabs refresh list
- State synchronized

### 4. Session Active State During Update

**Scenario:** Active session deleted in another tab

**Handling:**
- LIST_UPDATED received
- Check if activeSessionId still exists
- If not, select different session or clear
- Show appropriate UI state

## Testing Checklist

### Unit Tests

- [ ] Session store listens to LIST_UPDATED
- [ ] loadSessions called on event
- [ ] Sessions array updated correctly
- [ ] Active session handling correct

### Integration Tests

- [ ] Create session → list updates
- [ ] Delete session → list updates
- [ ] Rename session → list updates
- [ ] Cross-tab updates work
- [ ] Active session deletion handled

### Manual Tests

- [ ] Create session → appears in list
- [ ] Delete session → disappears from list
- [ ] Rename session → name updates
- [ ] Create in Tab A → visible in Tab B
- [ ] Delete active session in Tab A → Tab A handles gracefully

## Dependencies

### Internal Dependencies

- None - Independent feature

### External Dependencies

- EventBus infrastructure ✅
- CONVERSATION_EVENTS.LIST_UPDATED event ✅

## Related Features

- **Feature 1:** Generating Session IDs Tracking (may need cleanup on session delete)
- **Feature 4:** Permission Approval Flow (session-level permissions)

---

**Status:** 📝 Spec Complete  
**Priority:** P0  
**Estimated Implementation:** 2-3 hours  
**Risk Level:** Low
