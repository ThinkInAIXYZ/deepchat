# Chat Session View Races

## Issue

PR #1974 introduced atomic chat-session view commits and a recent-session cache, but the page and
message store retain separate readiness state. A first-turn stream completion can supersede the
page-owned restore request, commit the correct messages through another caller, and leave
`ChatPage` permanently guarded. Cached or already-visible sessions have the inverse race: the
composer is enabled while a background restore can still replace optimistic or streaming records
with a snapshot that started before those records existed.

## Impact

- The first submit can appear to do nothing even though the backend accepted it.
- Switching away and back can make the missing messages appear.
- Cached session refreshes can temporarily remove optimistic user messages or streaming assistant
  content.
- A cache miss can cancel an unrelated in-flight restore before the replacement restore starts.
- Known inactive-session updates do not invalidate cached message views.
- Late stream terminals, snapshots, pending-input mutations, and session hydration can pass a
  session-ID-only guard after an A-B-A navigation cycle.

No persisted messages are lost. The failures are renderer ownership, readiness, and stale-view
presentation problems.

## Root Cause

1. `ChatPage` owns `committedMessageSessionId` and `isSessionViewPreparing` separately from
   `messageStore.committedSessionId`. Only the page's own restore promise releases its guard.
2. `messageStore.loadMessages()` rejects superseded requests but does not protect a current request
   from optimistic, streaming, or history mutations that occur after the request starts.
3. `setCurrentSessionId()` treats an empty selected session as committed before a prepared message
   view exists so early stream records can mutate the shared visible cache.
4. `activateRecentSessionView()` invalidates active loads before it knows whether a cache entry
   exists, and cached revisions are stored without being validated or invalidated by session
   events.
5. `ChatPage` clears streaming state on mount even when the stream belongs to the newly selected
   session.
6. Stream terminal handling is scoped only by session ID, so an old completion can clear a newer
   same-session stream, duplicate terminals can launch duplicate refreshes, and a post-terminal
   snapshot can resurrect settled state.
7. Pending-input loads and session detail hydration compare only session IDs. A rapid A-B-A cycle
   makes an old A response look current again, while pending-input mutations write returned arrays
   without checking which view owns them.
8. History pagination writes records into the cache before it removes duplicate IDs, allowing an
   overlapping old page to replace a newer in-memory record.
9. Stream request ordering retains only the current request and a bounded settled-key set. A known
   superseded request can reclaim the stream with a later timestamp, and an evicted settled request
   can be resurrected by a late snapshot.

## Required Invariants

- The message store is the sole owner of the selected and committed session-view identities.
- `committedSessionId` means a complete message view, including a valid empty view; selection alone
  never commits it.
- Any successful matching store commit releases the page loading boundary, regardless of which
  caller initiated the load.
- A persisted refresh never replaces same-session message mutations that occurred after the
  refresh started.
- Target-session streams received before the first commit remain staged and become visible after
  the base view commits without mixing with a previous session.
- Cache misses do not cancel loads. Known message/session mutations invalidate matching cached
  views before activation.
- Session switches, failed sends, and late async submit preparation cannot write records into a
  different committed view.
- Stream updates are monotonic per request, a request settles once, and a terminal event cannot
  settle a different request in the same session.
- Superseded and settled stream request identities remain tombstoned for the tracked session
  lifetime and are purged only when that session is permanently removed or the binding is disposed.
- Selection and async submit guards use request generations, not session equality alone, so A-B-A
  cannot revive an earlier operation.
- Pending-input mutations refresh only their matching active view, and overlapping history pages
  never replace records already owned by the committed view.
- Message loading continues in parallel with pending-input and other secondary-state loading.

## Fix Plan

- Derive ChatPage readiness directly from the store's committed session identity and handle the
  first matching commit as a reactive transition.
- Give message loads a same-session mutation fence. Discard a prepared snapshot when the visible
  view changed after request start; allow a later persisted refresh to reconcile optimistic records.
- Stage pre-commit stream state outside the visible message cache, then hydrate the current stream
  into the newly committed view.
- Validate cached view revisions, make cache activation non-destructive on misses, and invalidate
  cache entries on known session updates/status changes.
- Scope streaming-derived UI state to the active session and preserve a matching stream during page
  mount.
- Add defensive session ownership checks around optimistic mutations and post-await submit paths.
- Fence stream snapshots and terminals by request identity and monotonic event time, including
  duplicate terminal suppression and inactive-session cache invalidation.
- Assign stream requests a per-session local generation so later updates from known older requests
  cannot reclaim ownership, and purge generations when sessions are deleted.
- Fence pending-input operations, session hydration, history pagination, and submit continuations
  against stale or ABA ownership.

## Tasks

- [x] Make committed view ownership and readiness store-driven.
- [x] Add mutation-fenced refresh commits and pre-commit stream staging.
- [x] Make recent-session cache activation and invalidation race-safe.
- [x] Update ChatPage submit, stream, and restore integration.
- [x] Fence stream terminals, pending-input mutations, history overlap, and session hydration.
- [x] Preserve superseded and settled stream tombstones until permanent session removal.
- [x] Add cold-start, first-turn completion, cached-refresh, cache-miss, and rapid-switch regressions.
- [x] Update the retained chat scroll ownership contract.
- [x] Run focused and full repository quality gates.

## Validation

- Renderer store and ChatPage Vitest suites cover deterministic deferred-promise interleavings,
  including A-B-A selection, submit, pending-input, and hydration cycles.
- Review hardening adds null compaction restore, superseded request reclamation, durable settled
  tombstone, and permanent-session purge regressions; the four focused suites pass 171/171 tests.
- Full `pnpm test` completed with 5,516 passing and 198 skipped tests. Its only three failures were
  Feishu loopback callback tests blocked from listening on `127.0.0.1` by the sandbox; the complete
  callback suite passed 22/22 when rerun with local-listen permission.
- Web/Node typecheck, format, i18n, lint, and the production build pass. The build used existing
  provider and ACP registry snapshots because the validation environment could not reach their
  remote refresh endpoints.
- The final diff contains no database, persisted-data, preload, or shared IPC contract changes.

## GitHub

No issue is linked. The requested delivery artifact is a pull request against `dev`.
