# Memory database-maintenance drain

## Cause and scope

The application closes SQLite after Memory's stop/drain handshake. That handshake only tracks
consolidation passes: started startup prewarms and durable clears can still access the repository
after drain reports success. Controlled async probes reproduced both continuations.

## Design

Keep the existing MemoryService boundary. Pause Memory admission in the runtime context before
stopping timers, invalidate existing execution fences and abort provider work. Drain accepted
consolidation, embedding and clear work under the existing shared timeout. Report pending Agent
IDs on timeout so the application refuses to close SQLite. New memory routes must be blocked
during the application's database-maintenance window, just like session routes.

Clear stops at a batch/await boundary with its durable job intact and rejects the interrupted
request rather than claiming completion. Resume admission and pending clears only after database
reopen. Preserve shutdown behavior, schema and public route contracts. Do not split agentMemory.ts
or introduce another scheduler, setting or dependency.

## Acceptance

- [x] Started prewarm cannot access SQLite after a successful drain.
- [x] Pending clear pauses durably and resumes after reopening.
- [x] Unsettled work is reported at the deadline; resume does not revive old execution fences.
- [x] Review P1/P2/P3, ablate unnecessary design, and run relevant and combined verification.

## Validation

Six maintenance regressions cover prewarm, clear batch boundaries, replacement databases,
blocked vector reset, early resume after a failed drain, and dirty working projections. All six
fail against the unchanged production baseline. Combined validation with the scoped retrieval
fix passes format, i18n, lint, application and Memory test typechecks, 951 behavior tests,
334 native tests (two skipped), 10 performance tests and seven evaluation tests.

Review found and fixed dirty projection access during pause. Simplification removes the separate
maintenance pause flag and drain implementation; accepted task maps and the shared deadline helper
remain the source of truth. Clear is not tied to model/config execution generations: a failed drain
prevents database replacement, so resuming the unchanged database may finish the accepted clear.
Recovery reloads pending clear fences from the reopened database rather than retaining stale jobs.

No push or GitHub issue sync is authorized.
