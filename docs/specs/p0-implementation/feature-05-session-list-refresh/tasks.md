# Session List Auto-Refresh - Tasks

## Implementation Sync (2026-03-04)

**Overall:** ✅ Mostly Complete

### Done in current codebase

1. Backend emits list refresh events for new-agent session mutations (`SESSION_EVENTS.LIST_UPDATED`, all windows).
2. Frontend new session store listens and refreshes session list automatically.
3. Compatibility listener for legacy `CONVERSATION_EVENTS.LIST_UPDATED` remains in place.
4. Active-session delete fallback to new-thread route is handled in new session store.
5. Recent session actions (rename/pin/clear/delete from topbar) also trigger list refresh path.

### Remaining / follow-up

1. `pageRouter` still includes legacy `sessionPresenter` fallback path.
2. This task doc still references old store path/events naming and should be treated as historical draft.

### Evidence (current files)

1. `src/main/presenter/newAgentPresenter/index.ts`
2. `src/renderer/src/stores/ui/session.ts`
3. `src/renderer/src/stores/ui/pageRouter.ts`

## Task List

### Task 1: Backend Event Emission

**File:** `src/main/presenter/newAgentPresenter/sessionManager.ts`

**Required Change:**
```typescript
async createSession(data: CreateSessionInput): Promise<Session> {
  const session = await this.db.createSession(data)
  
  // Emit LIST_UPDATED to all windows
  eventBus.send(CONVERSATION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS, {})
  
  return session
}

async deleteSession(sessionId: string): Promise<void> {
  await this.db.deleteSession(sessionId)
  
  // Emit LIST_UPDATED to all windows
  eventBus.send(CONVERSATION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS, {})
}

async renameSession(sessionId: string, title: string): Promise<Session> {
  const session = await this.db.updateSession(sessionId, { title })
  
  // Emit LIST_UPDATED to all windows
  eventBus.send(CONVERSATION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS, {})
  
  return session
}
```

---

### Task 2: Frontend Event Listener

**File:** `src/renderer/src/stores/session.ts`

**Required Change:**
```typescript
import { CONVERSATION_EVENTS } from '@shared/events'

export const sessionStore = defineStore('session', {
  state: () => ({
    sessions: [] as Session[],
    activeSessionId: null as string | null,
    // ... other state
  }),

  actions: {
    initEventListener() {
      window.api.on(CONVERSATION_EVENTS.LIST_UPDATED, () => {
        this.loadSessions()
      })
    },

    async loadSessions() {
      const sessionPresenter = usePresenter('session')
      this.sessions = await sessionPresenter.listSessions()
      
      // Handle active session deletion
      if (this.activeSessionId) {
        const exists = this.sessions.find(s => s.id === this.activeSessionId)
        if (!exists) {
          this.activeSessionId = this.sessions[0]?.id || null
        }
      }
    }
  }
})

// Initialize in app startup
export function setupSessionStore() {
  const store = sessionStore()
  store.initEventListener()
  store.loadSessions()
}
```

---

### Task 3: Cleanup on Unmount

**File:** `src/renderer/src/App.vue` or main entry

**Required Change:**
```typescript
import { setupSessionStore } from '@/stores/session'

onMounted(() => {
  setupSessionStore()
})

onUnmounted(() => {
  window.api.removeAllListeners(CONVERSATION_EVENTS.LIST_UPDATED)
})
```

---

## Implementation Order

1. Task 1: Backend Event Emission - Priority: High
2. Task 2: Frontend Event Listener - Priority: High
3. Task 3: Cleanup - Priority: Medium

## Definition of Done

- [ ] All tasks completed
- [ ] Session list updates automatically
- [ ] Cross-tab sync works
- [ ] Active session deletion handled
- [ ] Tests passing
- [ ] Manual testing completed

---

**Status:** 📝 Tasks Defined  
**Estimated Time:** 2-3 hours  
**Risk Level:** Low
