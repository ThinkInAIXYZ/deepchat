# P0 Design Decisions

**Date:** 2026-02-28  
**Branch:** `feat/new-arch-complete`  
**Status:** ✅ Finalized - Ready for Implementation

---

## Context

This document captures all design decisions made for P0 critical features. These decisions were reviewed and finalized based on spec-driven development methodology.

---

## Decision 1: generatingSessionIds Update Timing

**Status:** ✅ DECIDED

### Problem
When should we add/remove session IDs from the `generatingSessionIds` Set?

### Decision: **Option A - Frontend Control**

```typescript
// Add immediately when sending message
sessionStore.generatingSessionIds.add(sessionId)

// Remove on END/ERROR events
sessionStore.generatingSessionIds.delete(sessionId)
```

### Rationale

After analysis, **Frontend Control** provides the best UX:
- **Immediate feedback**: UI responds instantly when user sends message
- **Simpler implementation**: No need to wait for backend STATUS_CHANGED event
- **Consistent with optimistic UI**: Matches Feature 6 (Optimistic Messages) pattern
- **Backend events as backup**: END/ERROR events ensure cleanup even if frontend logic fails

### Implementation

See: `docs/specs/p0-implementation/feature-01-generating-session-ids/`

---

## Decision 2: cancelGenerating Message State

**Status:** ✅ DECIDED

### Decision

- **Keep partial content** ✅
- **Message status**: `'cancelled'` (new status type)
- **User can manually send new message** ✅
- **No automatic retry**

### Rationale

- **Partial content**: Users should see what was generated before cancel (better UX)
- **Cancelled status**: More accurate than 'completed', helps with analytics and debugging
- **Manual retry**: Gives user control, avoids accidental regeneration

### Implementation

See: `docs/specs/p0-implementation/feature-03-cancel-generating/`

---

## Decision 3: Permission Mode Change Behavior

**Status:** ✅ DECIDED

### Decision: **Option B - Only Affects New Requests**

- Pending requests stay pending
- New tool calls use new mode
- User must manually approve/deny pending requests

### Rationale

**Safety first**: Permission changes should be explicit. If user switches from Default to Full, they should consciously approve pending requests rather than having them auto-approved.

### Implementation

See: `docs/specs/p0-implementation/feature-04-permission-approval/`

---

## Decision 4: Input Box Disable Strategy

**Status:** ✅ DECIDED

### Decision

- Input box disabled when `isGenerating(sessionId) === true`
- Disabled state applied via ChatInputBox `disabled` prop
- Stop button shown when generating
- Stop button click triggers cancelGenerating

### Rationale

**Clear visual feedback**: Users should immediately understand when system is busy and have control to stop.

### Implementation

See: `docs/specs/p0-implementation/feature-02-input-disable-stop/`

---

## Decision 5: Session List Auto-Refresh

**Status:** ✅ DECIDED

### Decision

- Listen to `CONVERSATION_EVENTS.LIST_UPDATED`
- Automatic refresh on create/delete/rename
- Cross-tab synchronization via EventBus
- No manual refresh button needed (fallback only)

### Rationale

**Always in sync**: Users should never need to manually refresh. Event-driven architecture ensures all tabs stay synchronized.

### Implementation

See: `docs/specs/p0-implementation/feature-05-session-list-refresh/`

---

## Decision 6: Optimistic User Messages

**Status:** ✅ DECIDED

### Decision

- Show user message immediately with temp ID
- Mark as `pending: true`
- Merge with real message when backend returns
- Remove on error with user notification

### Rationale

**Instant feedback**: Zero perceived latency. Users see their message immediately, making the app feel responsive.

### Implementation

See: `docs/specs/p0-implementation/feature-06-optimistic-messages/`

---

## Decision 7: Message Cache Version Bumping

**Status:** ✅ DECIDED

### Decision

- Cache key includes version: `messages-v{VERSION}-{sessionId}`
- Version constant defined in code
- Automatic invalidation on version mismatch
- Document version bump process

### Rationale

**Future-proof**: Prevents stale cache issues when schema changes. Makes migrations safe and predictable.

### Implementation

See: `docs/specs/p0-implementation/feature-07-cache-versioning/`

---

## Decision 8: Implementation Strategy

**Status:** ✅ DECIDED

### Approach

**Incremental with Testing:**
- Each feature = separate commit
- Test immediately after each commit
- Roll back individual features if issues found
- Integration test after all features implemented

### Testing Checklist

```
Feature 1 (generatingSessionIds):
  [ ] Send message → Set contains session ID
  [ ] Receive END → Set doesn't contain session ID
  
Feature 2 (cancelGenerating):
  [ ] Click Stop → generation cancels
  [ ] After cancel → Set doesn't contain session ID
  
Feature 3 (Input disable):
  [ ] Send message → input disabled
  [ ] Click Stop → input re-enabled
  
Feature 4 (Permission flow):
  [ ] Tool call → permission dialog shown
  [ ] Approve → tool executes
  [ ] Deny → error shown
  
Feature 5 (Session list):
  [ ] Create session → list updates
  [ ] Delete session → list updates
  [ ] Cross-tab sync works
  
Feature 6 (Optimistic messages):
  [ ] Send message → appears immediately
  [ ] Backend returns → seamless merge
  
Feature 7 (Cache versioning):
  [ ] Cache works with version
  [ ] Version bump → cache invalidated
```

---

## Implementation Order

**Phase 1: Core UI Bindings (Features 1-3)**
1. Feature 1: generatingSessionIds tracking
2. Feature 2: Input box disable + stop button
3. Feature 3: cancelGenerating implementation

**Phase 2: Backend Integration (Feature 4)**
4. Feature 4: Permission approval flow

**Phase 3: UX Polish (Features 5-7)**
5. Feature 5: Session list auto-refresh
6. Feature 6: Optimistic user messages
7. Feature 7: Message cache version bumping

---

## Architecture References

All P0 features integrate with:

- **New Agent Presenter**: `src/main/presenter/newAgentPresenter/`
- **DeepChat Agent Presenter**: `src/main/presenter/deepchatAgentPresenter/`
- **Session Store**: `src/renderer/src/stores/session.ts`
- **Message Store**: `src/renderer/src/stores/message.ts`
- **Event System**: `src/main/eventbus.ts` and `src/main/events.ts`

### Related Documentation

- [P0 Implementation README](./docs/specs/p0-implementation/README.md)
- [Event System](./docs/architecture/event-system.md)
- [Agent System](./docs/architecture/agent-system.md)
- [AgentPresenter MVP Replacement](./docs/specs/agentpresenter-mvp-replacement/)

---

## Quality Gates

Before marking any feature as complete:

- [ ] All spec requirements implemented
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Type check passing (`pnpm run typecheck`)
- [ ] Lint passing (`pnpm run lint`)
- [ ] Format passing (`pnpm run format`)
- [ ] Manual testing completed
- [ ] Edge cases validated

---

## Next Steps

1. ✅ All design decisions finalized
2. ✅ All specifications written
3. ✅ All implementation plans created
4. ✅ All task lists defined
5. ⏳ Review documentation with team
6. ⏳ Begin Phase 1 implementation

---

**Status:** ✅ Finalized  
**Last Updated:** 2026-02-28  
**Ready for:** Implementation
