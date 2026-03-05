# Optimistic User Messages - Plan

## Implementation Status Sync (2026-03-04)

**Status:** 🟡 Partial  
Optimistic insertion exists; merge protocol remains refresh-based instead of temp-id reconciliation.

## Current State

**What exists today:**

1. Message store exists with basic CRUD operations
2. Messages added only after backend confirmation
3. No optimistic UI pattern implemented
4. User sees delay between send and message appearance
5. No temp ID mechanism

## Target State

**What we want after implementation:**

1. Messages appear instantly after send
2. Optimistic messages have temp IDs
3. Seamless merge with real messages
4. Error handling for failed sends
5. No perceived delay for user

## Implementation Phases

### Phase 1: Message Store Updates

1. Add addOptimisticMessage method
2. Add mergeOptimisticMessage method
3. Add temp ID generation
4. Add pending state tracking

### Phase 2: ChatPage Integration

1. Create optimistic message on send
2. Add to UI immediately
3. Merge when backend returns
4. Handle errors

### Phase 3: Backend Response

1. Ensure sendMessage returns message object
2. Include real message ID
3. Include orderSeq for ordering

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/renderer/src/stores/message.ts` | Modify | Add optimistic message methods |
| `src/renderer/src/views/ChatPage.vue` | Modify | Create optimistic message on send |
| `src/main/presenter/newAgentPresenter/index.ts` | Modify | Return message in sendMessage |

## Testing Strategy

### Unit Tests

```typescript
test('addOptimisticMessage creates message with temp ID', () => {
  const message = messageStore.addOptimisticMessage('session-1', 'Hello')
  expect(message.id).toMatch(/temp-\d+/)
  expect(message.content).toBe('Hello')
  expect(message.pending).toBe(true)
})

test('mergeOptimisticMessage replaces with real message', () => {
  const optimistic = messageStore.addOptimisticMessage('session-1', 'Hello')
  
  messageStore.mergeOptimisticMessage(optimistic.id, {
    id: 'real-123',
    content: 'Hello',
    role: 'user',
    pending: false
  })
  
  const messages = messageStore.getMessages('session-1')
  expect(messages.find(m => m.id === 'real-123')).toBeDefined()
  expect(messages.find(m => m.id === optimistic.id)).toBeUndefined()
})
```

### Integration Tests

```typescript
test('optimistic message flow works end-to-end', async () => {
  // Send message
  const sendMessagePromise = chatPage.sendMessage('Hello')
  
  // Check optimistic message exists
  await nextTick()
  const messages = messageStore.getMessages('session-1')
  const optimistic = messages.find(m => m.pending)
  expect(optimistic).toBeDefined()
  
  // Wait for backend response
  await sendMessagePromise
  
  // Check merged
  const finalMessages = messageStore.getMessages('session-1')
  expect(finalMessages.find(m => m.pending)).toBeUndefined()
  expect(finalMessages.find(m => !m.pending)).toBeDefined()
})
```

## Rollback Plan

If issues found:
1. Disable optimistic UI
2. Revert to wait-for-confirmation behavior
3. No breaking changes

---

**Status:** 📝 Plan Complete  
**Priority:** P0  
**Complexity:** Low  
**Risk:** Low
