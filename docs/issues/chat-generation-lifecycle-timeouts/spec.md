# Chat / Session Lifecycle Timeouts and Locks

## Issue

ChatService used a fake stream lock and agentType preflight that did not match enqueue-first
generation ownership. Session create used a 5s timeout that could fail ACP cold start. Session
delete aborted row removal when backend cleanup failed, leaving zombie sessions.

## Fix

- ChatService: accept-path abort only; no mutual exclusion over runtime generation; honest stop result
- SessionService: longer create/list timeouts
- SessionDeletionTransaction: best-effort stages, always attempt row delete
