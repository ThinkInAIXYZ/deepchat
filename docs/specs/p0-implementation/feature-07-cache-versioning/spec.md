# Message Cache Version Bumping - Specification

## Overview

Implement cache version bumping for messages to ensure virtual scroll compatibility and prevent stale cache issues. When message structure or caching logic changes, the version bump forces cache invalidation and refresh.

## User Stories

- As a user, I want the message list to always show the latest data
- As a user, I don't want to see stale or corrupted messages due to cache issues
- As a user, I need virtual scroll to work smoothly with cached messages
- As a developer, I need a mechanism to invalidate caches when schema changes

## Acceptance Criteria

### Functional Requirements

- [ ] Message cache includes version number
- [ ] Version checked on cache read
- [ ] Cache invalidated if version mismatch
- [ ] Version bumped when cache logic changes
- [ ] Virtual scroll works correctly with versioned cache
- [ ] No stale data shown to users

### Technical Requirements

- [ ] Cache key includes version prefix
- [ ] Version constant defined in code
- [ ] Version check on cache retrieval
- [ ] Automatic cache refresh on version mismatch
- [ ] Version documented for future changes

## Architecture

### Backend Changes

**None** - This is a frontend-only caching optimization.

### Frontend Changes

**Modified Files:**
1. `src/renderer/src/stores/message.ts` - Add version to cache key
2. `src/renderer/src/composables/useVirtualScroll.ts` - Use versioned cache
3. `src/renderer/src/utils/cache.ts` - Add version management

### State Management

```
App startup
  ↓
Load messages from cache
  ↓
Check cache version
  ↓
If version mismatch: invalidate cache, reload from backend
  ↓
If version match: use cached data
  ↓
Virtual scroll uses versioned cache
```

## Event Flow

```
Component mounts
  ↓
useVirtualScroll(sessionId)
  ↓
Get cache key: `messages-v${CACHE_VERSION}-${sessionId}`
  ↓
Try to load from cache
  ↓
If cache exists && version matches: use cache
  ↓
If cache missing || version mismatch: load from backend
  ↓
Update cache with current version
  ↓
Render messages
```

## Edge Cases

### 1. Version Bump During Active Session

**Scenario:** App updated while user has session open

**Handling:**
- Next reload will use new version
- Cache invalidated automatically
- Fresh data loaded from backend

### 2. Multiple Sessions with Different Versions

**Scenario:** Different sessions cached with different versions

**Handling:**
- Each session checked independently
- Old version sessions refreshed
- New version sessions use cache

### 3. Cache Corruption

**Scenario:** Cache data corrupted but version matches

**Handling:**
- Try-catch on cache read
- On error: invalidate and reload
- Log error for debugging

### 4. Virtual Scroll with Versioned Cache

**Scenario:** Virtual scroll needs to work seamlessly with versioned cache

**Handling:**
- Cache key includes session ID and version
- Virtual scroll queries same cache
- No special handling needed

### 5. Offline Mode

**Scenario:** User offline, cache version old

**Handling:**
- Use old cache if available
- Show warning about potentially stale data
- Refresh when back online

## Testing Checklist

### Unit Tests

- [ ] Cache version constant defined
- [ ] Cache key includes version
- [ ] Version mismatch invalidates cache
- [ ] Version match uses cache

### Integration Tests

- [ ] App startup with matching version → uses cache
- [ ] App startup with mismatched version → reloads
- [ ] Virtual scroll works with versioned cache
- [ ] Cache refresh works correctly

### Manual Tests

- [ ] Bump version → cache invalidated
- [ ] Reload app → fresh data loaded
- [ ] Virtual scroll smooth
- [ ] No stale data shown
- [ ] Offline mode handles gracefully

## Dependencies

### Internal Dependencies

- None - Independent optimization

### External Dependencies

- LocalStorage or IndexedDB for caching ✅
- Virtual scroll library ✅

## Related Features

- **Feature 6:** Optimistic User Messages (messages cached after merge)
- **Feature 1:** Generating Session IDs Tracking (generation state not cached)

---

**Status:** 📝 Spec Complete  
**Priority:** P0  
**Estimated Implementation:** 1-2 hours  
**Risk Level:** Low
