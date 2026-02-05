# Migration Guide

**Status**: Draft
**Created**: 2026-01-16
**Related**: [spec.md](./spec.md)

---

## Overview

This document provides a step-by-step migration guide for implementing the Single WebContents Architecture. It summarizes code changes needed based on analysis of the existing codebase.

---

## 1. File Changes Summary

### 1.1 New Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/src/components/VerticalSidebar.vue` | Vertical conversation sidebar |
| `src/renderer/src/components/ConversationTab.vue` | Individual conversation tab item |
| `src/renderer/src/stores/sidebarStore.ts` | Sidebar state management |

### 1.2 Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/src/App.vue` | Add VerticalSidebar, new layout |
| `src/renderer/src/stores/chat.ts` | Remove Tab-aware state |
| `src/renderer/src/router/index.ts` | Add `/conversation/:id` route |
| `src/main/presenter/windowPresenter/index.ts` | Add `createChatWindow()` |
| `src/main/presenter/tabPresenter.ts` | Remove chat window logic |

### 1.3 Files to Deprecate (Phase 3)

| File | Reason |
|------|--------|
| `src/renderer/shell/` (directory) | Chat windows no longer need Shell |
| `src/renderer/shell/stores/tab.ts` | Replaced by sidebarStore |
| `src/renderer/shell/components/AppBar.vue` | Replaced by VerticalSidebar |

---

## 2. Migration Phases

### Phase 1: Prepare Infrastructure (Week 1-2)

**Tasks**:
- [x] Create `VerticalSidebar.vue` component
- [x] Create `ConversationTab.vue` component
- [x] Create `sidebarStore.ts`
- [x] Add Vue Router routes for conversations
- [x] Add `createChatWindow()` to WindowPresenter

**No breaking changes** - existing architecture continues to work.

**Phase 1 Complete** ✅

### Phase 2: Refactor Chat Window (Week 3-4)

**Tasks**:
- [ ] Modify `App.vue` to include VerticalSidebar
- [ ] Update `chat.ts` to remove Tab-aware state
- [ ] Implement conversation switching via Vue Router
- [ ] Test conversation lifecycle (create, switch, close)

### Phase 3: Refactor Main Process (Week 5-6)

**Tasks**:
- [ ] Simplify TabPresenter (browser-only)
- [ ] Add new IPC channels for chat windows
- [ ] Update EventBus routing
- [ ] Remove unused WebContentsView code

### Phase 4: Testing & Polish (Week 7-8)

**Tasks**:
- [ ] End-to-end testing
- [ ] Performance benchmarking
- [ ] Memory profiling
- [ ] Edge case fixes

### Phase 5: Cleanup (Week 9)

**Tasks**:
- [ ] Remove deprecated Shell code
- [ ] Remove old IPC channels
- [ ] Update documentation

---

## 3. Detailed Code Changes

### 3.1 chat.ts State Removal

```typescript
// REMOVE these lines:
const activeThreadIdMap = ref<Map<number, string | null>>(new Map())  // Line 74
const messageIdsMap = ref<Map<number, string[]>>(new Map())           // Line 81
const threadsWorkingStatusMap = ref<Map<number, Map<...>>>(new Map()) // Line 91

// REMOVE these functions:
const getTabId = () => window.api.getWebContentsId()                  // Line 135
const getActiveThreadId = () => activeThreadIdMap.value.get(getTabId()) // Line 136
const setActiveThreadId = (threadId) => { ... }                       // Line 137-139

// REPLACE with:
const messageIds = ref<string[]>([])
const workingStatusMap = ref<Map<string, WorkingStatus>>(new Map())

// Active thread now from router:
// const route = useRoute()
// const activeThreadId = computed(() => route.params.id)
```

### 3.2 App.vue Layout Change

```vue
<!-- BEFORE: Shell + WebContentsView -->
<template>
  <div class="h-screen w-screen">
    <RouterView />
  </div>
</template>

<!-- AFTER: Integrated sidebar -->
<template>
  <div class="flex h-screen w-screen">
    <VerticalSidebar ... />
    <div class="flex-1 flex flex-col">
      <WindowTitleBar />
      <RouterView />
    </div>
  </div>
</template>
```

### 3.3 Router Configuration

```typescript
// ADD to router/index.ts:
{
  path: '/conversation/:id',
  name: 'conversation',
  component: ChatView
}
```

---

## 4. Testing Checklist

### 4.1 Conversation Lifecycle

- [ ] Create new conversation
- [ ] Switch between conversations
- [ ] Close conversation (not last)
- [ ] Close last conversation → navigate to /new
- [ ] Rapid conversation switching

### 4.2 State Persistence

- [ ] Sidebar state persists on window close
- [ ] Sidebar state restores on window open
- [ ] Handle corrupted state gracefully

### 4.3 Edge Cases

- [ ] Navigate to invalid conversation ID
- [ ] Conversation load timeout
- [ ] Many conversations (50+)
- [ ] Long conversation titles

---

## 5. Rollback Plan

If issues are found, rollback via feature flag:

```typescript
// In config
const USE_SINGLE_WEBCONTENTS = false  // Revert to old architecture

// In WindowPresenter
if (USE_SINGLE_WEBCONTENTS) {
  return this.createChatWindow(options)
} else {
  return this.createShellWindow({ windowType: 'chat', ...options })
}
```

---

## References

- [spec.md](./spec.md) - Architecture overview
- [components.md](./components.md) - Component specifications
- [state-management.md](./state-management.md) - State management specifications
- [main-process.md](./main-process.md) - Main process specifications
