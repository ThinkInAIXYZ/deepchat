# Memory service boundaries

## Context and scope

Memory decision and recall retrieval duplicate vector readiness, failure classification and row
validation. Forget and user archive duplicate one lifecycle transition. Conflict resolution also
depends back on maintenance scheduling, while maintenance owns both orchestration and merge logic.

This refactor removes those duplications and separates merge work from orchestration. It does not
change database schemas, shared event reasons, retrieval contracts, configuration or UI. Repository
decomposition and a separate scheduler are out of scope.

## Design and invariants

- Retrieval shares readiness/warmup, vector failure classification and authoritative vector-row
  validation predicates, not a callback-driven traversal. Decision retrieval retains batching,
  snapshot reuse, conflict exclusion and pinned ordering. Recall retains cancellation, circuit
  breaking, refill, pruning and reindex/backfill.
  Shared filtering must not add database calls or repeat fingerprint derivation for each row.
- Management owns a single archive transition. The public forget and archive methods retain their
  signatures and audit identities. The forget hook runs after all guards and before invalidation;
  idempotent archive, transactions and mutation notifications retain their existing behavior.
  The private transition derives the fixed audit event from its actor without an event/actor
  options object.
- The facade schedules successful user conflict resolution. Maintenance owns scheduling after
  automated challenge resolution; ConflictService has no dependency on maintenance. Preserve a
  follow-up for applied resolutions even if a later challenge fails or is cancelled.
- MergeService owns bounded near-duplicate selection and transactional merge application. The
  maintenance runner retains timers, concurrency, cooldown, budget, stop and drain. Merge receives
  the runner's existing operation fence and timestamp rather than capturing newer ones.
- Keep the existing lambda dependency pattern and event reason `extract`. No new setting, external
  dependency, credential, migration or public API is required.

## Acceptance and compatibility

Existing facade contracts, scope isolation, lifecycle rejection, retrieval ordering and recovery
remain valid. Stop/drain must still prevent stale writes. The change must preserve bounded work and
provider call counts. Each implementation slice is independently usable and locally committed after
review and verification. Rollback is a code revert without data migration. No push or PR creation.

## Open questions

None. Implementation is authorized; C(2) event-reason changes are explicitly deferred.
