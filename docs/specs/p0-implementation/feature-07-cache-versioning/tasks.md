# Message Cache Version Bumping - Tasks

## Task List

### Task 1: Cache Version Constant

**File:** `src/renderer/src/utils/cache.ts`

**Required Change:**
```typescript
// Cache version - bump when cache schema changes
export const CACHE_VERSION = 1

// Cache key generator
export function getCacheKey(type: string, sessionId: string): string {
  return `${type}-v${CACHE_VERSION}-${sessionId}`
}

// Cache loader with version check
export function loadFromCache<T>(type: string, sessionId: string): T | null {
  const key = getCacheKey(type, sessionId)
  const data = localStorage.getItem(key)
  
  if (!data) return null
  
  try {
    return JSON.parse(data) as T
  } catch (error) {
    // Cache corrupted, invalidate
    localStorage.removeItem(key)
    return null
  }
}

// Cache saver
export function saveToCache<T>(type: string, sessionId: string, data: T): void {
  const key = getCacheKey(type, sessionId)
  localStorage.setItem(key, JSON.stringify(data))
}

// Cache invalidation
export function invalidateCache(type: string, sessionId?: string): void {
  if (sessionId) {
    // Invalidate specific session
    const key = getCacheKey(type, sessionId)
    localStorage.removeItem(key)
  } else {
    // Invalidate all sessions of this type
    const prefix = `${type}-v${CACHE_VERSION}`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) {
        localStorage.removeItem(key)
      }
    }
  }
}
```

---

### Task 2: Update Message Store

**File:** `src/renderer/src/stores/message.ts`

**Required Change:**
```typescript
import { loadFromCache, saveToCache, getCacheKey } from '@/utils/cache'

export const messageStore = defineStore('message', {
  actions: {
    async loadMessages(sessionId: string): Promise<Message[]> {
      // Try cache first
      const cached = loadFromCache<Message[]>('messages', sessionId)
      
      if (cached) {
        this.messages[sessionId] = cached
        return cached
      }
      
      // Load from backend
      const messagePresenter = usePresenter('message')
      const messages = await messagePresenter.listMessages(sessionId)
      
      // Cache for next time
      this.messages[sessionId] = messages
      saveToCache('messages', sessionId, messages)
      
      return messages
    },

    async refreshMessages(sessionId: string): Promise<void> {
      // Invalidate cache
      const key = getCacheKey('messages', sessionId)
      localStorage.removeItem(key)
      
      // Reload from backend
      await this.loadMessages(sessionId)
    }
  }
})
```

---

### Task 3: Update Virtual Scroll

**File:** `src/renderer/src/composables/useVirtualScroll.ts`

**Required Change:**
```typescript
import { loadFromCache } from '@/utils/cache'

export function useVirtualScroll(sessionId: string) {
  const messages = ref<Message[]>([])
  
  // Load from cache or backend
  onMounted(async () => {
    const cached = loadFromCache<Message[]>('messages', sessionId)
    
    if (cached) {
      messages.value = cached
    } else {
      // Load from backend via store
      await messageStore.loadMessages(sessionId)
      messages.value = messageStore.getMessages(sessionId)
    }
  })
  
  return {
    messages,
    // ... virtual scroll logic
  }
}
```

---

### Task 4: Document Version Bump Process

**File:** `src/renderer/src/utils/cache.ts` (comments)

**Required Change:**
```typescript
/**
 * Cache Version Management
 * 
 * Bump CACHE_VERSION when:
 * - Message schema changes
 * - Cache structure changes
 * - Virtual scroll logic changes
 * - Breaking changes to message data
 * 
 * Version History:
 * - v1 (2026-02-28): Initial version with session-based caching
 * 
 * When bumping version:
 * 1. Update CACHE_VERSION constant
 * 2. Update this changelog
 * 3. Test cache invalidation
 * 4. Document in changelog
 */
export const CACHE_VERSION = 1
```

---

## Implementation Order

1. Task 1: Cache Version Constant - Priority: High
2. Task 2: Update Message Store - Priority: High
3. Task 3: Update Virtual Scroll - Priority: Medium
4. Task 4: Documentation - Priority: Low

## Definition of Done

- [ ] All tasks completed
- [ ] Cache version working
- [ ] Invalidation works
- [ ] Virtual scroll smooth
- [ ] Tests passing
- [ ] Documentation complete

---

**Status:** 📝 Tasks Defined  
**Estimated Time:** 1-2 hours  
**Risk Level:** Low
