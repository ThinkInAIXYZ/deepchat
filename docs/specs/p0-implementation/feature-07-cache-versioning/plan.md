# Message Cache Version Bumping - Plan

## Implementation Status Sync (2026-03-04)

**Status:** ⚪ Not Started  
Versioned persistent cache invalidation is still not implemented in current new UI message path.

## Current State

**What exists today:**

1. Message caching may exist in some form
2. No version management
3. Risk of stale cache after schema changes
4. Virtual scroll may have cache issues
5. No systematic cache invalidation

## Target State

**What we want after implementation:**

1. Cache includes version number
2. Automatic invalidation on version mismatch
3. Clean cache migration path
4. Virtual scroll works flawlessly
5. No stale data issues

## Implementation Phases

### Phase 1: Cache Version Constant

1. Define CACHE_VERSION constant
2. Document what triggers version bump
3. Add to cache utilities

### Phase 2: Versioned Cache Keys

1. Update cache key generation to include version
2. Update all cache read/write operations
3. Add version check on read

### Phase 3: Cache Invalidation Logic

1. Add version mismatch detection
2. Invalidate old cache
3. Reload from backend
4. Update cache with new version

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/renderer/src/utils/cache.ts` | Modify | Add version management |
| `src/renderer/src/stores/message.ts` | Modify | Use versioned cache keys |
| `src/renderer/src/composables/useVirtualScroll.ts` | Modify | Use versioned cache |

## Testing Strategy

### Unit Tests

```typescript
const CACHE_VERSION = 1

test('cache key includes version', () => {
  const key = getCacheKey('session-1')
  expect(key).toBe(`messages-v${CACHE_VERSION}-session-1`)
})

test('version mismatch invalidates cache', () => {
  // Set cache with old version
  localStorage.setItem('messages-v0-session-1', JSON.stringify({...}))
  
  // Try to load with new version
  const data = loadMessages('session-1')
  
  // Should be null (cache invalidated)
  expect(data).toBeNull()
})
```

### Integration Tests

```typescript
test('cache version bump works', async () => {
  // Set old cache
  const oldKey = 'messages-v0-session-1'
  localStorage.setItem(oldKey, JSON.stringify({messages: [...]}))
  
  // Load with new version
  await messageStore.loadMessages('session-1')
  
  // Should have loaded from backend
  expect(messageStore.messages.length).toBeGreaterThan(0)
  
  // Should have new cache
  const newKey = 'messages-v1-session-1'
  expect(localStorage.getItem(newKey)).toBeDefined()
})
```

## Rollback Plan

If issues found:
1. Revert version constant
2. Clear all caches
3. Reload from backend
4. No data loss

---

**Status:** 📝 Plan Complete  
**Priority:** P0  
**Complexity:** Low  
**Risk:** Low
