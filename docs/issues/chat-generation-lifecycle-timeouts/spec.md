# Chat / Session Lifecycle Timeouts and Locks

## Issue

ChatService used a fake stream lock and agentType preflight that did not match enqueue-first
generation ownership. Session create used a 5s timeout that could fail ACP cold start. Session
delete aborted row removal when backend cleanup failed, leaving zombie sessions.

## Impact

Concurrent accepts could survive stop, timeout cleanup could hang or replace the original error,
and a late session create could publish after the route already reported failure.

## Root Cause

- ChatService stored one accept controller per session and did not bound all cleanup paths.
- `Scheduler.timeout` races but does not cancel the mutating `createSession` task.

## Fix

- ChatService: retain every concurrent accept controller per session, bound best-effort cleanup, and
  convert stop cleanup timeouts into an honest `{ stopped: false }` result
- SessionService: do not race the mutating create operation against a non-cancelling route timeout;
  keep the longer list timeout for read availability
- SessionDeletionTransaction: best-effort stages, always attempt row delete

## Tasks

- [x] Retain and abort every concurrent accept controller per session
- [x] Bound best-effort cancel and convert stop cleanup timeout into `{ stopped: false }`
- [x] Preserve the original send timeout when cleanup fails synchronously or times out
- [x] Remove the non-cancelling route timeout around session creation
- [x] Update timeout assertions and add lifecycle regression tests

## Validation

- Concurrent send accepts are both aborted by one stop request.
- Stop cleanup timeout returns `{ stopped: false }`; send timeout remains the caller-visible error.
- Session create is invoked once without a scheduler race, while session list keeps its 15s timeout.
