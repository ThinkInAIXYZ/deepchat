# Session List Auto-Refresh - Plan

## Implementation Status Sync (2026-03-04)

**Status:** ✅ Mostly Complete  
Cross-window list refresh is live in new chain; legacy fallback paths still remain for compatibility.

## Current State

**What exists today:**

1. CONVERSATION_EVENTS.LIST_UPDATED event exists ✅
2. EventBus infrastructure exists ✅
3. Session store has loadSessions method ✅
4. Backend emits event in some places (inconsistent)
5. Frontend may not be listening consistently

## Target State

**What we want after implementation:**

1. Consistent LIST_UPDATED emission from backend
2. Frontend always listens and updates
3. Session list always in sync
4. Cross-tab synchronization works
5. No manual refresh needed

## Implementation Phases

### Phase 1: Backend Event Emission

1. Ensure all session mutations emit LIST_UPDATED
2. Create session → emit
3. Delete session → emit
4. Rename session → emit
5. Update session → emit (if needed)

### Phase 2: Frontend Event Listening

1. Add listener in session store
2. Call loadSessions on event
3. Clean up listener on unmount
4. Handle errors gracefully

### Phase 3: Testing

1. Test create/delete/rename
2. Test cross-tab updates
3. Test active session deletion
4. Test rapid operations

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/main/presenter/newAgentPresenter/sessionManager.ts` | Modify | Emit LIST_UPDATED consistently |
| `src/main/presenter/conversationManager.ts` | Modify | Emit LIST_UPDATED consistently |
| `src/renderer/src/stores/session.ts` | Modify | Listen to LIST_UPDATED event |

## Testing Strategy

### Unit Tests

```typescript
test('session store listens to LIST_UPDATED', () => {
  const store = createSessionStore()
  store.initEventListener()
  
  window.api.emit(CONVERSATION_EVENTS.LIST_UPDATED)
  
  expect(store.loadSessions).toHaveBeenCalled()
})
```

### Integration Tests

```typescript
test('session list updates after create', async () => {
  const initialCount = sessionStore.sessions.length
  
  await sessionStore.createSession('New Session')
  await nextTick()
  
  expect(sessionStore.sessions.length).toBe(initialCount + 1)
})

test('cross-tab session sync works', async () => {
  // Tab A creates session
  await tabA.sessionStore.createSession('Test')
  
  // Tab B should see it
  expect(tabB.sessionStore.sessions).toHaveLength(2)
})
```

## Rollback Plan

If issues found:
1. Remove frontend listener
2. Add manual refresh button as fallback
3. No breaking changes

---

**Status:** 📝 Plan Complete  
**Priority:** P0  
**Complexity:** Low  
**Risk:** Low
