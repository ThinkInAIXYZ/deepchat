# CancelGenerating Implementation - Plan

## Implementation Status Sync (2026-03-04)

**Status:** 🟡 Partial  
Abort/cancel is implemented, while explicit cancelled-state modeling remains open.

## Current State

**What exists today:**

1. No cancelGeneration IPC method in newAgentPresenter
2. No stop button integration (Feature 2 will add)
3. LLM stream has no abort mechanism
4. Message status doesn't include 'cancelled' state
5. No way to stop generation once started

## Target State

**What we want after implementation:**

1. cancelGeneration IPC method available
2. Stop button triggers cancel flow
3. LLM stream can be aborted
4. Message marked as cancelled with partial content
5. User can resume interaction after cancel

## Implementation Phases

### Phase 1: Backend cancelGeneration Method

1. Add cancelGeneration to newAgentPresenter
2. Implement stream abort logic
3. Mark message as cancelled
4. Emit STATUS_CHANGED('idle') event

### Phase 2: Frontend cancelGenerating Action

1. Add cancelGenerating to session store
2. Call IPC method
3. Handle cleanup

### Phase 3: Integration Testing

1. Test cancel during text generation
2. Test cancel during tool execution
3. Test cancel during permission request
4. Verify partial content preserved

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/main/presenter/newAgentPresenter/index.ts` | Modify | Add cancelGeneration method |
| `src/main/presenter/deepchatAgentPresenter/streamManager.ts` | Modify | Add abortStream method |
| `src/main/presenter/deepchatAgentPresenter/messageStore.ts` | Modify | Add cancelled status support |
| `src/renderer/src/stores/session.ts` | Modify | Add cancelGenerating action |

## Testing Strategy

### Unit Tests

```typescript
// Backend: cancelGeneration
test('cancelGeneration stops stream', async () => {
  await newAgentPresenter.cancelGeneration('session-1')
  expect(streamManager.abortStream).toHaveBeenCalledWith('session-1')
})

test('cancelGeneration marks message as cancelled', async () => {
  await newAgentPresenter.cancelGeneration('session-1')
  const message = await messageStore.getMessage('msg-1')
  expect(message.status).toBe('cancelled')
})
```

### Integration Tests

```typescript
// Full cancel flow
test('cancel flow works end-to-end', async () => {
  // Start generation
  await agentPresenter.sendMessage('session-1', 'Hello')
  
  // Cancel
  await sessionStore.cancelGenerating('session-1')
  
  // Verify stopped
  expect(sessionStore.isGenerating('session-1')).toBe(false)
  
  // Verify can send new message
  await agentPresenter.sendMessage('session-1', 'New message')
  expect(sessionStore.isGenerating('session-1')).toBe(true)
})
```

## Rollback Plan

If issues found:
1. Revert newAgentPresenter changes
2. Revert session store changes
3. Fallback: No cancel functionality (users must wait)

---

**Status:** 📝 Plan Complete  
**Priority:** P0  
**Complexity:** Medium  
**Risk:** Medium
