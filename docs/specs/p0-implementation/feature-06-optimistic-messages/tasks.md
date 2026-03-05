# Optimistic User Messages - Tasks

## Implementation Sync (2026-03-04)

**Overall:** 🟡 Partial

### Done in current codebase

1. Renderer message store has optimistic insertion (`addOptimisticUserMessage`).
2. `ChatPage` inserts optimistic user message immediately before calling backend send.

### Not done / still open for this spec line

1. No explicit temp-id → real-id merge API; reconciliation is currently done by full `loadMessages()` reload after stream end/error.
2. `newAgentPresenter.sendMessage(...)` still returns `Promise<void>`, not a persisted user message payload.
3. Error rollback policy is coarse-grained (reload-based), not fine-grained optimistic record reconciliation.

### Evidence (current files)

1. `src/renderer/src/stores/ui/message.ts`
2. `src/renderer/src/pages/ChatPage.vue`
3. `src/main/presenter/newAgentPresenter/index.ts`

## Task List

### Task 1: Message Store Optimistic Methods

**File:** `src/renderer/src/stores/message.ts`

**Required Change:**
```typescript
export const messageStore = defineStore('message', {
  state: () => ({
    messages: {} as Record<string, Message[]>, // sessionId -> messages
    optimisticMessages: new Map<string, Message>(), // tempId -> message
  }),

  actions: {
    addOptimisticMessage(sessionId: string, content: string): Message {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      const message: Message = {
        id: tempId,
        sessionId,
        content,
        role: 'user',
        status: 'pending',
        createdAt: new Date().toISOString(),
        orderSeq: this.getNextOrderSeq(sessionId)
      }
      
      // Add to messages array
      if (!this.messages[sessionId]) {
        this.messages[sessionId] = []
      }
      this.messages[sessionId].push(message)
      
      // Track for merge
      this.optimisticMessages.set(tempId, message)
      
      return message
    },

    mergeOptimisticMessage(tempId: string, realMessage: Message) {
      const messages = this.messages[realMessage.sessionId]
      if (!messages) return
      
      // Find optimistic message
      const optimisticIndex = messages.findIndex(m => m.id === tempId)
      if (optimisticIndex === -1) return
      
      // Replace with real message
      messages[optimisticIndex] = realMessage
      
      // Remove from optimistic tracking
      this.optimisticMessages.delete(tempId)
    },

    removeOptimisticMessage(tempId: string) {
      const message = this.optimisticMessages.get(tempId)
      if (!message) return
      
      const messages = this.messages[message.sessionId]
      if (!messages) return
      
      // Remove from array
      const index = messages.findIndex(m => m.id === tempId)
      if (index !== -1) {
        messages.splice(index, 1)
      }
      
      // Remove from tracking
      this.optimisticMessages.delete(tempId)
    }
  }
})
```

---

### Task 2: ChatPage Optimistic Send

**File:** `src/renderer/src/views/ChatPage.vue`

**Required Change:**
```typescript
import { messageStore } from '@/stores/message'

async function sendMessage(content: string) {
  const sessionId = sessionStore.activeSession?.id
  if (!sessionId) return
  
  // Create optimistic message
  const optimisticMessage = messageStore.addOptimisticMessage(sessionId, content)
  
  // Add to generating set (Feature 1)
  sessionStore.addGeneratingSession(sessionId)
  
  try {
    // Send to backend
    const realMessage = await agentPresenter.sendMessage(sessionId, content)
    
    // Merge optimistic with real
    messageStore.mergeOptimisticMessage(optimisticMessage.id, realMessage)
    
  } catch (error) {
    // Remove optimistic message on error
    messageStore.removeOptimisticMessage(optimisticMessage.id)
    
    // Remove from generating set
    sessionStore.removeGeneratingSession(sessionId)
    
    // Show error
    showErrorNotification('Failed to send message')
    
    throw error
  }
}
```

---

### Task 3: Backend Return Message

**File:** `src/main/presenter/newAgentPresenter/index.ts`

**Required Change:**
```typescript
async sendMessage(sessionId: string, content: string): Promise<Message> {
  // Create message in DB
  const message = await this.messageStore.createMessage({
    sessionId,
    content,
    role: 'user',
    status: 'completed'
  })
  
  // Start stream processing
  this.processStream(sessionId, message)
  
  // Return message immediately
  return message
}
```

---

## Implementation Order

1. Task 1: Message Store Methods - Priority: High
2. Task 3: Backend Return Message - Priority: High
3. Task 2: ChatPage Integration - Priority: High

## Definition of Done

- [ ] All tasks completed
- [ ] Optimistic messages appear instantly
- [ ] Merge works seamlessly
- [ ] Error handling works
- [ ] Tests passing
- [ ] Manual testing completed
- [ ] No visual glitches during merge

---

**Status:** 📝 Tasks Defined  
**Estimated Time:** 3-4 hours  
**Risk Level:** Low
