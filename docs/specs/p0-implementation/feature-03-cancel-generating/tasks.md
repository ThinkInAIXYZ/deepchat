# CancelGenerating Implementation - Tasks

## Implementation Sync (2026-03-04)

**Overall:** 🟡 Partial

### Done in current codebase

1. `newAgentPresenter.cancelGeneration(sessionId)` exists and is callable from renderer.
2. `deepchatAgentPresenter` abort controller path is live and can stop in-flight streams.
3. Frontend stop action is wired from `ChatPage` and user can continue sending new messages after cancel.

### Not done / differs from this task doc

1. No dedicated message status `cancelled` in the new-agent message model.
2. Abort currently ends as error-style stream termination (`STREAM_EVENTS.ERROR` with `Generation cancelled`) rather than explicit `END(cancelled=true)`.
3. Spec text in this task file assumes a separate stream manager file path that no longer matches current structure.

### Evidence (current files)

1. `src/main/presenter/newAgentPresenter/index.ts`
2. `src/main/presenter/deepchatAgentPresenter/index.ts`
3. `src/main/presenter/deepchatAgentPresenter/process.ts`
4. `src/renderer/src/pages/ChatPage.vue`

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
