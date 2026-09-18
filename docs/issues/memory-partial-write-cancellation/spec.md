# Partial memory writes and cancellation

## Cause and reproduction

Extraction can restore an existing archived claim during candidate preparation, then await the
decision provider for another candidate. Mutation epochs and working projection invalidation were
deferred until the whole batch returned. Disabling memory while the provider was pending skipped
that bookkeeping; enabling memory again reused the old working projection despite the restored row.

A deterministic deferred-provider test is needed before the fix because the failure depends on
partial commit, cancellation and re-enable ordering. It reproduces the stale projection; clear and
dispose variants characterize the existing no-late-write contract.

## Design and boundaries

Record mutation epochs and dirty working state synchronously when a batch candidate commits, before
another provider await. The shared kernel owns this for extraction and model-assisted remember;
direct remembers keep their synchronous bookkeeping. Do not duplicate it after batch completion.

Cancellation still returns failure for extraction, so the ingestion cursor does not advance. Keep
the fence around final events, embedding and consolidation: the cancelled batch must not dispatch
late work, recreate cleared claims, or revive disposed runtime state. Existing recovery drains own
pending embeddings. This does not alter Tape/Journal dispatch, database schema or shared events.

## Acceptance and implementation

- [x] After partial commit then disable/re-enable, injection reflects the committed claim.
- [x] Clear/dispose while a decision is pending prevents late writes, events and provider work.
- [x] Successful and failed batches retain their outcome, audit and retry contracts.
- [x] Review P0-P3 risks, ablate unnecessary design, and run the memory and static gates.

## Validation outcome

The disable/re-enable regression fails against the base implementation and passes with the fix.
The clear/dispose variants pass on both versions, preserving the existing cancellation boundary.
Immediate preparation, initial decision application and retry application all record committed
outcomes through one helper. The remaining direct map assignments record no-op outcomes only.
Post-batch duplicate bookkeeping is removed; no new callback, scheduler or public contract is added.

Combined branch verification passed: format, i18n, lint, typecheck, 940 memory behavior tests,
334 native tests (two VSS-dependent legacy tests skipped), ten performance tests and seven evals.
Final P0-P3 reviews found no remaining findings in the change scope.

Rollback is code-only. No push or GitHub issue sync is authorized.
