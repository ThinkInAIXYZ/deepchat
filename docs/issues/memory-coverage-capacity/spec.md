# Memory coverage verification at capacity

## Problem and cause

Coverage verification uses the embedding drain's 200-batch guard for both SQLite and vector ID
enumeration. A full final page is indistinguishable from an unfinished listing. At 102,400 current
IDs, warming never certifies the store and requests a full reindex even when no vector is missing.
Rebuilding does not reduce the ID count, so subsequent warms repeat the same recovery.

## Design

Keep keyset pages of 512 IDs, but bound verification by the existing vector lease deadline rather
than the drain batch count. Enumerate both sources inside that lease. Yield between SQLite pages
so the main process can run cancellation and deadline callbacks; revalidate the operation fence,
read epoch and lease generation around asynchronous work. An unfinished or invalidated listing
must neither certify readiness nor trigger a reset merely because verification did not finish.

Use one ID set for the remaining missing vectors, subtracting each sidecar page as it arrives;
retain only orphan IDs separately. Requeue missing rows and delete orphans in batches of at most
512 IDs, yielding and checking cancellation between batches. The lease bounds total work, while
page limits bound each synchronous database mutation. This is not a new vector index, scheduler or
configurable limit. Embedding drain limits, database schemas, Tape semantics and the authoritative
SQLite/projection boundary remain unchanged.

## Acceptance and implementation

- [x] Healthy coverage below, at and above the former page cap can become ready without reset.
- [x] Missing-vector requeue and orphan deletion remain bounded to one page per call.
- [x] Cancellation, clear or an expired lease stops verification and prevents late readiness.
- [x] Review P0-P3 risks, remove unnecessary design, run behavior/native/performance and static gates.

## Validation outcome

- Boundary tests enumerate 102,399, 102,400 and 102,401 IDs; the last case has equal source/store
  counts but a missing ID and an orphan, guarding against count-only certification.
- On the base implementation the two larger boundary cases fail, as do the deadline and 513-ID
  repair/cancellation cases. They pass with the fix. These large enumerations use port fixtures;
  they are not a latency benchmark for a real 100k-row SQLite/DuckDB database.
- Review found a synchronous bulk-requeue risk after removing the page cap. Batching the repair
  resolves it; follow-up assumption, concurrency, cascade and scale reviews found no remaining
  P0-P3 findings. Ablation removed the duplicated complete ID arrays/sets and the truncation flag.
- Combined branch gates passed: format, i18n, lint, typecheck, 940 memory behavior tests,
  334 native tests (two VSS-dependent legacy tests skipped), ten performance tests and seven evals.

No GitHub issue sync or push is authorized. Rollback is a code revert without a data migration.
