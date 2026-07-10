# Agent Memory Correctness and Privacy Hardening — Specification

> Status: **implemented**  
> Classification: **architecture**  
> Post-commit gate: **`memory-native-validation` passed**

## Purpose

DeepChat Agent Memory derives durable memories from the effective conversation tape, stores semantic
state in SQLite, and uses a per-agent DuckDB sidecar for vector retrieval. The system performs model-backed
extraction, semantic write decisions, embedding, reflection, persona evolution, and maintenance outside the
foreground response path.

This hardening work closes correctness and privacy gaps at the boundaries between those asynchronous
operations and authoritative state. It defines how extraction is checkpointed, how stale reads and writes are
rejected, how destructive operations cancel old work, how conflict aggregates remain valid, and how native
resources are drained safely.

## Problems Addressed

| Area | Previous risk | Required outcome |
| --- | --- | --- |
| Extraction | Prompt-side tail truncation could consume unseen messages and attach imprecise lineage | Every consumed message is presented in full through bounded, message-aligned chunks with exact lineage |
| Injection | Provider and vector awaits could return snapshots invalidated by forget, clear, edit, persona, or working-memory changes | Injection is authoritatively revalidated and fails closed on a concurrent semantic mutation |
| Destructive operations | Clear or agent deletion could race with old provider work and recreate deleted state | Old work is fenced and aborted per agent before destructive mutation begins |
| Semantic decisions | Concurrent sessions or maintenance could apply an LLM decision based on stale content | Semantic transitions use revision-checked atomic writes with bounded retry |
| Conflicts | A challenger and its target could be edited or removed independently, leaving an invalid aggregate | Conflict participants are guarded, transitions are transactional, and historical damage is repairable |
| Vector lifecycle | Query, upsert, reset, close, and dispose could overlap on the same native store | Every operation runs under a manager-owned generation lease |
| Provider lifecycle | Requests could bypass admission, outlive deadlines, or accumulate without settling | All Memory provider work uses bounded admission, deadlines, cancellation, and unsettled-request caps |
| Provenance | A lower-cased 32-bit hash could collide and suppress valid memories | New writes use a case-preserving SHA-256 key with verified legacy compatibility |
| Native validation | Native bindings, FTS, and migrations could silently skip in ordinary tests | A fresh Node ABI CI job treats missing capabilities and skipped migrations as failures |

## Architectural Invariants

1. SQLite `agent_memory` remains authoritative. DuckDB remains a rebuildable vector sidecar.
2. The raw tape remains the evidence source of truth; Memory writes only non-reconstruction anchors.
3. Extraction failure never advances the cursor past unfinished content.
4. Triage and extraction receive exactly the same complete chunk.
5. A semantic commit advances the per-agent read epoch before another await may begin.
6. Clear, agent deletion, and dispose invalidate a destructive operation generation before asynchronous
   cleanup.
7. A stale read fails the whole injection closed; the foreground path does not retry it.
8. A stale write never overwrites a newer semantic state and never falls through to an implicit `ADD`.
9. Unresolved conflict participants cannot be mutated independently.
10. Supported vector operations keep native store access inside a manager-owned scoped callback.
11. Provider deadlines include time spent waiting for rate-limit admission.
12. Public IPC, renderer DTOs, tool contracts, event payloads, and the legacy status vocabulary remain
    compatible.

## Requirements

### Extraction Chunks, Cursor, and Lineage

- Extraction input is packed on message boundaries with a CJK-aware token estimate.
- A chunk is limited to approximately 4,000 estimated tokens and 12,000 Unicode code points.
- An oversized single message is split by an iterator-based grapheme/code-point-safe linear scan.
- The cursor for an oversized message advances only after its final fragment succeeds.
- One session queue task processes at most four chunks and enqueues the immutable remainder on the same
  session chain.
- Any extraction failure, disable, dispose, or extraction-epoch change stops the chain without consuming
  unfinished content.
- `source_entry_ids` and the `memory/extract` anchor contain only the entries and fragment metadata for the
  current chunk.
- The shared lineage codec accepts non-negative safe integers, filters invalid elements, preserves first-seen
  order, removes duplicates, and returns `null` when no valid IDs remain.

### Authoritative Injection Finalization

- Every injection captures the current per-agent read epoch before asynchronous retrieval.
- After all provider and vector awaits, retrieval performs one agent-scoped `listByIds` read for the union of
  candidate IDs and replaces snapshots with the latest rows.
- Persona and working memory are read only after the final retrieval await.
- Before reading persona and working memory, injection verifies the original epoch and synchronously flushes
  correctness-only working-memory dirty state.
- Injection captures the post-flush epoch, assembles the payload, performs one final
  enabled/managed/disposed/epoch gate, and returns without another await.
- Runtime rechecks memory enablement before prompt append, selected-memory access accounting, and the
  `memory/view_assembled` anchor.

### Destructive Operation Fencing

`MemoryOperationFence` contains an `agentId` and a monotonically increasing destructive generation.

- `clearMemories` invalidates the generation before deleting SQLite rows, including when no rows exist.
- Agent deletion invalidates the generation before its first await.
- Dispose invalidates all active work and stops new provider, task, and vector-lease admission.
- Generic edit, archive, forget, delete, and restore do not invalidate the destructive generation; they rely
  on revision CAS, authoritative reads, and conflict guards.
- Extraction, decision, maintenance, reflection, persona, and embedding continuations recheck the fence after
  every external await and before side effects.
- A stale continuation cannot write SQLite rows, cursors, audits, events, working memory, or vectors.

### Conflict Aggregate Integrity

- Generic edit, archive, forget, delete, and restore reject both an unresolved challenger and a target
  referenced by an unresolved challenger.
- Whole-agent clear remains permitted because it removes the entire aggregate.
- `CHALLENGE` commits challenger insertion and the target transition in one SQLite transaction guarded by
  target revision and liveness.
- Maintenance archival and lifecycle preview exclude rows with non-null `conflict_state`.
- A challenged target remains lifecycle-active and recallable while being archive-ineligible.
- Integrity repair is idempotent:
  - a valid live target missing `challenged` state is repaired;
  - a challenger with a missing, cross-agent, or invalid target is archived and unlinked;
  - a challenged target with no valid challenger is cleared;
  - a non-conflicted row with a residual `conflict_with` link is unlinked.
- Repair emits only content-free aggregate audit metadata.
- Participant lookup uses the `(agent_id, conflict_with, status, superseded_by)` index.

### Revisioned Semantic Writes

Schema migration v41 adds:

```sql
decision_revision INTEGER NOT NULL DEFAULT 1
```

- Content, category, importance, lifecycle, supersede, conflict, and persona semantic changes increment the
  revision.
- Access accounting, decay, embedding metadata, audit writes, consolidation stamps, and provenance re-key do
  not increment it.
- UPDATE atomically checks agent, ID, expected revision, liveness, and conflict state while replacing content,
  category, provenance, and last-access time; it also resets embedding metadata and queues re-embedding.
- UPDATE and its confidence change run in one transaction.
- SUPERSEDE and CHALLENGE combine insertion with a conditional target transition in one transaction.
- A first revision conflict performs one complete fresh provenance lookup, recall, prompt, and model decision.
- During retry, only an explicit valid `ADD` may create a row. Another conflict, provider failure, or parse
  failure returns `concurrent-update`.
- Maintenance merge records both participant revisions before the model await and applies survivor content,
  embedding reset, importance/confidence, and retired-row supersede in one transaction.
- If either participant changed, maintenance rolls back and skips the stale result without another model call.
- A provenance owner equal to the secondary participant may become the survivor. An unrelated third owner
  causes a safe skip and consolidation stamp.

### Vector Store Lifecycle

- Query, query-by-ID, upsert, delete, and reconcile run through `withStoreLease`.
- A lease carries the per-agent store generation. The manager does not return the raw store, and callers must
  not retain the callback argument; TypeScript cannot prevent deliberate closure caching.
- Close, reset, delete, and dispose stop new admission and wait for active leases before touching the native
  store.
- Reset failure marks `requiresReset`; later leases retry reset under the per-agent lock and fail open to FTS
  for the current request when recovery still fails.
- Permanent retirement and dispose keep admission closed.
- Embedding-ready status, warm readiness, and reconcile watermarks are accepted only for the generation that
  produced them.
- Store drains run per agent in parallel. One stuck native operation does not prevent other idle stores from
  closing.
- After the shared five-second dispose deadline, only stores with an active native operation may remain open.

### Provider Gateway and Bounded Dispose

All Memory text, embedding, and dimension requests pass through one agent-aware provider gateway.

| Purpose | Deadline |
| --- | ---: |
| Query embedding | 800 ms |
| Dimension lookup | 15 s |
| Embedding batch or warmup | 30 s |
| Extraction, decision, or maintenance text | 60 s |
| Dispose drain | 5 s |

- Rate-limit admission is required and precedes the provider call.
- The gateway always passes an optional `AbortSignal`; it does not infer provider support from function arity.
- Requests are grouped by agent, provider, model, and purpose.
- At most two underlying unsettled requests are allowed per group and 64 globally.
- Capacity is released only when the underlying promise settles, not when an outer deadline wins the race.
- Agent clear or deletion aborts that agent's active controllers. Dispose aborts all controllers.
- Providers that ignore cancellation may finish later, but their results and rejections are absorbed without
  side effects or unhandled rejections.

### Provenance Compatibility

New provenance keys use:

```text
v2:<kind>:<sha256>
```

The digest input is:

```text
agentId + NUL + kind + NUL + NFC(trim(collapseWhitespace(content)))
```

- Case is preserved.
- New writes use only v2.
- Lookup order is v2, then legacy v1.
- A legacy hit must belong to the same agent and kind and must match v2-normalized content.
- A matching legacy row is lazily re-keyed in a short transaction.
- A mismatched legacy hit is treated as a collision and does not suppress a new v2 row.
- Working memory supports its historical fixed-seed legacy key and removes a redundant legacy internal row
  when the v2 row already exists.
- Lazy compatibility cleanup does not increment `decision_revision`; no eager backfill runs at startup.

### Native SQLite Validation

The `memory-native-validation` GitHub Actions job uses Node 24 and a fresh dependency installation.

- It explicitly runs the native dependency's install lifecycle for the Node ABI.
- It executes an open/read/write/reopen/close smoke test.
- It sets `DEEPCHAT_REQUIRE_NATIVE_SQLITE=1` for the focused suite.
- Missing bindings, unavailable FTS, fresh-schema failure, skipped migration, or incomplete migration fail the
  job.
- The suite covers fresh schema, legacy schema migration to v41, reopen, catalog repair coexistence, conflict
  indexing, and real FTS behavior.
- Local Electron development does not switch the shared `node_modules` tree to the Node ABI.

## Compatibility and Failure Semantics

- Migration v41 is additive; existing rows receive `decision_revision = 1`.
- The existing cursor column remains authoritative; fragment persistence is not introduced.
- Legacy provenance remains readable and is migrated lazily.
- Public Memory routes, renderer DTOs, tools, events, and status values are unchanged.
- Recall remains fail-open to keyword retrieval when provider or vector infrastructure fails.
- Injection privacy validation, stale semantic writes, conflict integrity, and destructive cancellation fail
  closed.
- User-visible semantic audit data is preserved; new repair audit data remains content-free.

## Non-Goals

- Replacing the current FTS index or keyword-selection algorithm.
- Adding a tape ingestion projection or batch decision protocol.
- Adding working-memory debounce, vector-store LRU, management pagination, or audit retention.
- Splitting the legacy status field into separate lifecycle and embedding state columns.
- Changing renderer behavior or public Memory contracts.
- Automatically switching a developer's shared native dependencies between Node and Electron ABIs.

## Acceptance

The implementation is accepted when all requirements above are represented in code and regression tests,
the architecture documentation is self-contained, non-native local validation passes without changing the
Electron ABI, and the post-commit `memory-native-validation` job passes in GitHub Actions.
