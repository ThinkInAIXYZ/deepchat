# Agent Memory Correctness and Privacy Hardening — Implementation Plan

> This document describes the implemented architecture. Requirements and acceptance criteria are defined in
> [spec.md](./spec.md); implementation evidence is tracked in [tasks.md](./tasks.md).

## Architecture

The hardening design introduces two independent per-agent clocks:

- **Read epoch**: changes after a committed semantic mutation and invalidates an in-progress injection.
- **Operation generation**: changes only for destructive cancellation and invalidates old asynchronous work.

Revision CAS protects individual semantic rows, while vector-store generations protect native sidecar work.
Together they form four distinct consistency scopes:

| Scope | Mechanism | Protects against |
| --- | --- | --- |
| Injection snapshot | Read epoch | Concurrent semantic mutation after retrieval begins |
| Destructive cleanup | Operation generation | Late work recreating cleared or deleted data |
| SQLite semantic row | `decision_revision` | Stale online or maintenance LLM decisions |
| DuckDB sidecar | Store generation lease | Late native completion after reset, close, or dispose |

These scopes intentionally do not share a single counter. Ordinary edits should invalidate an injection but
should not abort every provider request; clear should cancel all old work even when it deletes zero rows.

## Extraction Data Flow

1. Runtime reads the monotonic session cursor and the effective tape view.
2. Visible message text and exact tape entry IDs are collected in the same pass.
3. The pure chunk builder packs whole messages under the token and code-point budgets.
4. An oversized message is emitted as Unicode-safe fragments; only its final fragment exposes a cursor commit
   boundary.
5. Runtime processes up to four chunks in the current session task.
6. Each chunk passes unchanged through triage and extraction.
7. Candidates are applied sequentially. Every committed candidate immediately advances the read epoch and
   marks working memory dirty before another await.
8. A shared `finally` path flushes working memory and schedules embedding, events, and maintenance for already
   committed rows.
9. Runtime advances the cursor only after the chunk succeeds. An anchor is written only for rows created by
   that chunk and contains its exact lineage and fragment metadata.
10. Remaining chunks are queued as an immutable continuation on the same session chain.

A partial candidate batch deliberately leaves the cursor unchanged. Replay converges through provenance
resolution and revision CAS while preserving finalization for rows that committed before the failure.

## Injection Data Flow

1. Capture the initial read epoch.
2. Run keyword and vector retrieval without access accounting.
3. After every provider/vector await, verify the ordinary read guard.
4. Perform one `listByIds(agentId, ids)` authoritative read for the union and replace candidate snapshots.
5. Verify the initial epoch.
6. Synchronously flush correctness-only working dirty state.
7. Capture the finalized epoch.
8. Read active persona and working memory.
9. Assemble and sanitize the injection payload and manifest.
10. Perform the final enabled/managed/disposed/finalized-epoch gate and return without another await.
11. Runtime separately guards prompt append, selected-memory access accounting, and view-anchor persistence.

An epoch change returns no injection. The foreground path does not retry because privacy correctness is more
important than opportunistically recovering recall within the first-token path.

## Destructive Cancellation

`MemoryRuntimeContext` owns the per-agent operation generation and the provider gateway.

- `captureOperationFence(agentId)` returns the current generation.
- `isOperationFenceCurrent(fence)` also checks global disposal.
- `invalidateAgentOperations(agentId)` increments the generation and calls `abortAgent(agentId)`.

Clear invalidates before SQLite deletion. Agent cleanup invalidates before waiting for vector retirement or
other service cleanup. The operation-generation entry is retained through deleted-agent cleanup so an older
generation can never become current again by falling back to the default generation.

Ordinary semantic mutations use the read epoch and row revision instead of destructive cancellation.

## Conflict and Semantic Transactions

### Conflict Membership

The repository resolves participant membership in an agent-scoped indexed query. A row is protected when it
is a live challenger or when a live challenger points to it. Management mutations check membership before
applying a generic single-row transition.

Integrity repair loads only rows with conflict state or links, computes valid same-agent pairs, and applies
idempotent corrections in a transaction. Audit output contains counts only.

### Online Decisions

UPDATE uses `updateDecisionContentIfRevision` to atomically:

- validate agent, ID, expected revision, liveness, supersede state, and conflict state;
- write content, category, provenance, and access time;
- set `status = 'pending_embedding'`;
- clear embedding ID, dimension, and model;
- increment `decision_revision`.

Confidence changes are included in the same transaction. SUPERSEDE and CHALLENGE insert their new row and
conditionally transition the target in one transaction. Any failed condition rolls the complete mutation
back.

`coordinateWrite` allows at most two complete attempts. The second attempt is built from a fresh provenance
lookup, recall set, prompt, and model response. It never converts a stale-target failure into an implicit
`ADD`.

### Maintenance Merge

Maintenance snapshots both rows before the model call. Apply chooses the primary or secondary participant as
the survivor, then CAS-updates the survivor and CAS-supersedes the retired row in one transaction. Importance
and confidence can only rise. A stale participant, uniqueness conflict, or unrelated third provenance owner
causes a safe skip; stale model output is never reused.

Every successful merge immediately advances the read epoch, synchronizes working memory, queues embedding,
and emits the existing update event.

## Working-Memory Finalization

The working-memory service maintains a correctness-only dirty set, not a debounce timer.

- Every atomic semantic memory commit marks the agent dirty.
- Extraction finalization and synchronous management paths flush dirty state.
- Injection flushes dirty state after its initial epoch check and before its finalized snapshot.
- Cold-start refresh uses a macrotask so it cannot race ahead of the current runtime continuation.
- Dispose and deleted-agent cleanup clear pending timers and dirty state.

The service resolves v2 working provenance first, then the historical fixed-seed v1 key. Duplicate internal
legacy rows are removed without treating cleanup as a semantic revision.

## Vector Lifecycle

`VectorStoreManager` owns one `VectorStoreLeaseState` per agent:

```ts
interface VectorStoreLeaseState {
  generation: number
  accepting: boolean
  active: number
  requiresReset: boolean
}
```

`withStoreLease` opens or recovers the store under the per-agent lock, increments the active count, passes the
store and generation to a scoped callback, and decrements the count in `finally`.

Drain operations set `accepting = false`, increment generation, clear readiness, wait for active leases, and
then close or reset under the lock. Reset failure keeps the store recoverable by setting `requiresReset` and
reopening admission after the failed request. Permanent retirement and global disposal do not reopen it.

Embedding and reconcile code carry the lease generation through SQLite writeback. A mismatched generation
turns the writeback into a no-op. Query failures continue to degrade to FTS.

`closeAllStores` starts all per-agent drains concurrently. The outer dispose deadline does not force-close a
store with an active native operation.

## Provider Gateway

`MemoryProviderGateway` is the only Memory path to text, embedding, and dimension providers.

For each request it:

1. Creates and registers an agent-scoped `AbortController`.
2. Captures the provider generation for that agent.
3. Starts the absolute purpose deadline.
4. Passes the request through required `executeWithRateLimit` admission.
5. Rechecks generation and cancellation after admission.
6. Reserves an unsettled-request capacity slot.
7. Calls the provider with `AbortSignal`.
8. Rechecks generation after provider resolution.
9. Releases capacity only when the underlying provider promise settles.
10. Removes the outer controller when the deadline/cancellation/provider race settles.

The underlying promise always has a rejection observer, so a provider that ignores cancellation cannot cause
an unhandled late rejection. All downstream services still verify their operation fence before side effects.

## Provenance Migration

The v2 key is generated with SHA-256 over agent ID, kind, and case-preserving normalized content. A central
resolver performs v2 lookup first and legacy lookup second.

Legacy lookup is not trusted on hash equality alone. The resolver verifies agent ownership, kind, and
normalized content, then performs a conditional transaction that replaces the expected v1 key with the v2
key. A uniqueness race resolves to the existing v2 owner. Mismatched content is a collision, not a duplicate.

There is no eager migration because lazy re-keying keeps startup bounded and preserves collision safety.

## Schema and Indexes

Fresh schema and migration v41 add `decision_revision` with a non-null default of `1`. Startup asserts that a
database claiming the current global version contains the required column, turning migration skip into a
hard failure.

The conflict-target index is created in fresh schema, during the conflict-link migration, and by idempotent
table initialization for existing databases. It does not consume another schema version.

## Native CI

Native SQLite validation lives only in the `memory-native-validation` GitHub Actions job.

The job uses a fresh checkout and dependency tree, explicitly prepares the Node ABI binding, runs the smoke
script directly, and invokes the focused Vitest files with `DEEPCHAT_REQUIRE_NATIVE_SQLITE=1`. Package-level
local scripts are intentionally absent so ordinary Electron development cannot accidentally replace the
installed Electron binding with a Node ABI artifact.

## Dispose Order

Dispose follows one order:

1. Mark the runtime disposed.
2. Abort provider requests.
3. Stop maintenance, background-task, and vector-lease admission.
4. Start one absolute five-second drain covering provider-visible work, maintenance, embedding, and vector
   leases.
5. Close every idle vector store, allowing only active native operations to outlive the deadline.
6. Clear timers, working state, epochs, generations, and service caches.

Every late continuation checks disposal or generation before database, cursor, audit, event, or vector side
effects.

## Compatibility and Rollback

- Migration v41 is additive and does not rewrite existing content.
- Older provenance keys remain readable.
- The legacy status field remains the public and internal vocabulary for this change.
- No public IPC, renderer, tool, or event shape changes.
- SQLite remains sufficient for correctness when DuckDB or provider infrastructure fails.
- Rolling code back across v41 leaves an extra ignored column; no destructive down-migration is required.

## Validation Strategy

Local validation keeps the Electron ABI installed and runs type checking, non-native Memory suites, renderer
Memory suites, formatting, i18n, lint, and diff checks. The fresh Node ABI native suite runs only in GitHub
Actions.
