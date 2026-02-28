# CancelGenerating Implementation - Tasks

## Task List

### Task 1: Backend cancelGeneration Method

**File:** `src/main/presenter/newAgentPresenter/index.ts`

**Required Change:**
```typescript
async cancelGeneration(sessionId: string): Promise<void> {
  const session = await this.sessionManager.getSession(sessionId)
  if (!session) throw new Error('Session not found')
  
  // Stop the stream
  await this.deepchatAgentPresenter.abortStream(sessionId)
  
  // Mark message as cancelled
  await this.messageStore.updateMessageStatus(sessionId, 'cancelled')
  
  // Emit status change
  eventBus.sendToMain(SESSION_EVENTS.STATUS_CHANGED, {
    sessionId,
    status: 'idle'
  })
  
  // Emit stream end
  eventBus.sendToRenderer(STREAM_EVENTS.END, {
    sessionId,
    cancelled: true
  })
}
```

---

### Task 2: Stream Abort Logic

**File:** `src/main/presenter/deepchatAgentPresenter/streamManager.ts`

**Required Change:**
```typescript
private abortControllers: Map<string, AbortController> = new Map()

async abortStream(sessionId: string): Promise<void> {
  const controller = this.abortControllers.get(sessionId)
  if (controller) {
    controller.abort()
    this.abortControllers.delete(sessionId)
  }
}

async startStream(sessionId: string, ...): Promise<void> {
  const controller = new AbortController()
  this.abortControllers.set(sessionId, controller)
  
  // Use controller.signal in fetch/stream calls
  const response = await fetch(url, { signal: controller.signal })
  // ...
}
```

---

### Task 3: Frontend cancelGenerating Action

**File:** `src/renderer/src/stores/session.ts`

**Required Change:**
```typescript
export async function cancelGenerating(sessionId: string) {
  const newAgentPresenter = usePresenter('newAgent')
  
  try {
    await newAgentPresenter.cancelGeneration(sessionId)
  } catch (error) {
    console.error('Failed to cancel generation:', error)
  } finally {
    // Always remove from generating set
    removeGeneratingSession(sessionId)
  }
}
```

---

## Implementation Order

1. Task 2: Stream Abort Logic - Priority: High
2. Task 1: Backend cancelGeneration - Priority: High
3. Task 3: Frontend cancelGenerating - Priority: High

## Definition of Done

- [ ] All tasks completed
- [ ] Tests passing
- [ ] Type check passing
- [ ] Manual testing completed
- [ ] Partial content preserved
- [ ] User can send new message after cancel

---

**Status:** 📝 Tasks Defined  
**Estimated Time:** 1-2 days
