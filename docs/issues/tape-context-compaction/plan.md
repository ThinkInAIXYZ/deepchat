# Tape-Native Context Compaction Implementation Plan

## Status

Implementation complete on `fix/tape-context-compaction`. Repository delivery follows the normal
review workflow; this plan records only the implementation and validation contract.

The original implementation slices and completion summary below are retained as a historical
record. Follow-up correctness and product work is active on `feat/compaction` under the dated plan
added after that summary.

## Implementation Slices

### 1. Separate Boundary Progress From Summary Success

- Replace the boolean compaction result with an outcome that distinguishes summarized,
  boundary-only, and unchanged states.
- On non-abort summary failure, compare-and-set a reconstruction anchor with the target cursor,
  stable reason, coverage, and bounded provenance.
- Preserve an older valid summary as `priorSummary` partial reconstruction context without
  presenting the boundary timestamp as a new summary generation time.
- Merge consecutive gap coverage into the new anchor state.
- Keep cancellation fail-closed: abort writes neither summary nor boundary.
- Treat a winning CAS state as progress only when its persisted cursor is newer than the prepared
  state.

### 2. Make Runtime Progress Observable And Correct

- Project cursor-only summary state as `compacted`, not `idle`.
- Determine context-pressure `applied` from monotonic cursor progress rather than intent presence.
- Reassemble the checkpoint and require the retry projection to differ and shrink before sending.
- Preserve manual compaction message/event compatibility for both summarized and boundary-only
  outcomes.
- Fix strict retry so its protected-tail override reaches the cache-aware fitter.

### 3. Bound Recovery Sequences

- Split the existing one-shot boolean into a sequence latch and a finite Run-level recovery count.
- Reset the sequence latch after a successful provider response, not after a failed recovery.
- Keep request sequence, physical-attempt identity, ViewManifest, provider outcome, and transient
  retry semantics unchanged.
- Add regression tests for two successful provider steps separated by independent pressure events
  and for total recovery ceiling exhaustion.

### 4. Compact Active-Turn Tool Units

- Characterize the provider message shapes emitted for assistant tool calls and tool results.
- Extract protocol-safe closed-unit selection in the existing context fitting owner.
- Reuse ToolOutputGuard offload/stub construction for eligible large inline results.
- Preserve open/pending/deferred tool units and call/result pairing.
- Run the existing changed-projection and ViewManifest paths on the reduced request.
- Do not restart the original user prompt after a tool side effect.

### 5. Add Usage-Anchored Pressure Projection

- Persist or retain in Run state the latest valid prompt-usage anchor and immutable request-envelope
  fingerprint.
- Fingerprint provider, model, system prompt, provider-visible tools, relevant generation options,
  and the anchored message prefix without retaining raw prompt data.
- Estimate only messages added after an exact anchor; invalidate on prefix or envelope drift.
- Feed projected pressure into each provider-request preflight while retaining full-estimate
  fallback and all output/tool reserves.
- Record bounded diagnostics for anchor use, invalidation reason, projected input, and cache-read
  ratio without changing aggregate billing semantics.

### 6. Final Integration And Documentation

- Exercise automatic turn-boundary compaction, provider-round pressure recovery, long tool loops,
  provider overflow, cancellation, resume, manual compaction, and CAS races through the harness.
- Update the canonical Tape/context architecture documentation with the final behavior and durable
  validation record.
- Review the complete branch against its base and remove temporary probes or implementation-only
  tests.

## Completion Summary

- Boundary progress is independent from semantic summary success and uses atomic reconstruction
  anchors with deterministic merged gap coverage.
- Semantic boundary recovery requires a durable cursor advance and a strictly smaller View;
  in-flight tool-result reduction instead requires a changed protocol-valid projection. Recovery
  resets after a successful provider response and is bounded to three sequences per Run.
- Closed active-turn tool results are compacted before model-backed summary without replaying tool
  side effects or changing raw Tape facts. The newest closed unit remains intact when compacting
  older evidence is sufficient and becomes eligible only as the next pressure fallback.
- Prompt pressure uses provider usage plus exact-prefix suffix projection when the request envelope
  is unchanged and the sent payload matches the continuation View, with conservative full-estimate
  fallback for fitted projections and malformed cache usage.
- Canonical behavior is documented in `docs/architecture/tape-system.md` and
  `docs/architecture/agent-system.md`.

## Follow-up Compaction Correctness And Product Completion (2026-08-15)

### Frozen Decisions

- Keep the existing append-only Tape, monotonic reconstruction cursor, anchor, selective View,
  summary-gap, raw recall, and request-level ViewManifest architecture.
- A summary is a provenance-bearing derivative and may be absent. It never replaces or deletes the
  source facts it describes.
- Do not introduce pointer-based or copied retained tails, durable tool-result replacement, surface
  replacement as a fact, prompt replay after tool effects, model-controlled reset/handoff, or a
  second compaction engine.
- Recovery remains bounded and may continue only after durable boundary progress or a measurably
  smaller protocol-valid projection. Free View reductions remain ahead of model-backed summary in
  the existing request-pressure ladder.

### Ordered Follow-up Slices

#### 0. Correct The Durable Contract

- Preserve the original completion record while documenting the difference between an in-memory
  retry-projection restore and a durable anchor rollback.
- Freeze the commit-time shrink formula, the summary-gap reason family, scope, implementation order,
  and the design gates below before changing runtime behavior.

#### 1. Reject Non-Shrinking Semantic Checkpoints

- Validate that model context length is finite and greater than zero before using it for pressure
  or compaction arithmetic.
- In `applyCompaction`, before `commitSummaryBoundary`, compare the canonical next checkpoint with
  the canonical current checkpoint plus only the newly hidden provider-visible turns.
- Build the current checkpoint with the real reconstruction anchor, not a null placeholder. Use the
  shared provider-message token estimator on both sides and require strict shrinkage.
- On rejection, reuse `commitBoundaryOnly` with `summary_rejected_larger`; do not persist the
  generated summary.
- Treat `summary_rejected_larger` and `summary_unavailable` through one shared summary-gap predicate
  in pending-gap recovery, consecutive-gap merge, and checkpoint/recall rendering.
- Add focused regression coverage for smaller, equal, and larger checkpoints; prior checkpoint and
  gap inputs; abort; and invalid context lengths.

#### 2. Add Checkpoint Provenance Text

- Render the source coverage already present on the reconstruction anchor in the canonical
  checkpoint and point the model to `tape_search` / `tape_context` for raw recall.
- Keep the text deterministic and bounded. Do not fabricate an order range when the anchor does not
  carry one.
- Rely on slice 1's canonical checkpoint comparison so provenance overhead cannot bypass the shrink
  guarantee.

#### 3. Reconcile Compaction Markers After A Crash

- First define the small durable state machine. Provision one `compactionAttemptId` before work and
  correlate marker, intent, anchor, and later usage records with that identity.
- On startup, reconcile incomplete markers against durable Tape anchors. Preserve `status: 'sent'`
  as transport state rather than reinterpreting it as compaction truth; handle legacy markers
  without an attempt ID conservatively through normal retraction/correction facts.

##### Marker Recovery State Machine

- Provision a UUID once, when `prepareCompaction` returns an intent. The immutable ID follows every
  application of that intent into the synthetic marker and either the summarized or boundary-only
  reconstruction anchor. It is a correlation key, not an authorization token, and no error text,
  provider response, or secret is copied into it or the anchor.
- The durable transitions are `prepared -> marker(compacting) -> anchor committed ->
  marker(compacted)`. Marker insertion/update and Tape indicator/retraction use one transcript
  transaction; summary state plus reconstruction anchor use one CAS transaction. Do not create a
  cross-owner transaction. A crash may therefore leave a sent `compacting` marker on either side of
  the anchor commit, and the reconstruction anchor is the settlement authority.
- Startup reads only valid sent assistant rows whose metadata identifies a `compacting` compaction
  marker, using a partial SQLite index rather than scanning the sent transcript. Resolve an
  attempt-bearing reconstruction anchor by `(sessionId, compactionAttemptId)` through an indexed
  Tape lookup; a later reset or handoff must not erase proof that this attempt committed.
- If that related anchor exists, materialize the transcript row as `compacted`; derive
  `summaryUpdatedAt` from a summary-bearing anchor and otherwise keep it null. If no matching anchor
  exists, retract and remove the marker through the normal transcript-delete path. A valid legacy
  marker without an attempt ID is always retracted because its outcome cannot be proven. Malformed
  unrelated metadata is not guessed into the compaction state machine.
- Reconciliation is idempotent: finalized rows no longer match the recovery query, removed rows are
  absent, indicator writes retain their existing provenance identity, and a retraction cannot
  repeat after its transcript row is removed in the same transaction. Per-session runtime
  serialization permits at most one unsettled attempt; if corrupt duplicate rows exist, apply the
  same anchor comparison independently and never mutate or delete an anchor.
- Test both crash boundaries (before and after anchor commit), summary and boundary-only anchors,
  legacy and mismatched identities, duplicate startup execution, transaction failure, and query
  planning against the partial recovery index. Normal completion and abort behavior remain
  unchanged.

#### 4. Expose Race-Free Renderer Compaction State

- Add `boundaryReason` to the shared state as a value derived from the latest anchor, without
  inventing a fourth live status or a separate UI authority.
- Define a per-session, process-lifetime monotonic `emitSeq` owned outside replaceable runtime
  instances. Atomically return `state + emitSeq + latestAnchorEntryId` from the snapshot path.
- The renderer subscribes and buffers first, reads the snapshot second, then discards buffered
  events at or below the snapshot sequence and applies newer events in order.

##### Renderer State Synchronization Contract

- `CompactionRuntimeCoordinator` owns a process-lifetime `Map<sessionId, emitSeq>`. It is shared by
  every runtime generation served by that coordinator and therefore does not reset when a hydrated
  instance is evicted or replaced. A successful permanent session destroy releases its entry; a
  runtime-only cleanup does not. Each publish increments the sequence before emitting, and the
  snapshot reads the current sequence at the same synchronous coordinator serialization point.
- The snapshot is `{ state, emitSeq, latestAnchorEntryId }`. `latestAnchorEntryId` is the SQLite
  Tape `entry_id` of the latest reconstruction anchor, or null for a session without one. It proves
  which durable append-only boundary produced the snapshot and remains useful across process
  restarts; it is not an event-order substitute. `emitSeq` is process-local because Electron main
  termination also tears down the renderer connection. No wall-clock timestamp participates in
  ordering.
- `boundaryReason` is nullable and is read only from the latest reconstruction anchor's `state`.
  It is exposed only for a persisted compacted boundary; idle and transient compacting states use
  null so an older boundary reason cannot be mistaken for the outcome of in-flight work. Legacy or
  malformed anchors also yield null. The three live statuses remain `idle`, `compacting`, and
  `compacted`.
- The renderer establishes the global event subscription when the session store is created. For
  each active-session transition it marks that session as synchronizing, buffers replacement-state
  events, then requests the snapshot. It applies the snapshot, discards buffered events with
  `emitSeq <= snapshot.emitSeq`, and applies the remaining events in ascending sequence order.
  After synchronization, duplicate or stale events are ignored and strictly newer events replace
  the active read model directly.
- Activation has its own generation token. A late snapshot, event, or failed request from a prior
  selection cannot overwrite the current session. Closing or deleting the active session clears
  its renderer state. Event tracking for permanently deleted sessions is purged, preventing an
  unbounded renderer map.
- A renderer reload against a surviving main process receives the coordinator's current sequence
  in its first snapshot. A full application restart starts new process-local sequences at zero and
  rebuilds state plus `latestAnchorEntryId` from Tape. Direct ACP sessions return the fixed idle
  state with sequence zero and no anchor and never emit DeepChat compaction events.
- Existing transcript compaction markers remain the durable historical divider. This slice does
  not infer history from transient renderer state, mutate Tape facts, or persist a second UI truth.
  The synchronized state is the live read model used by later occupancy and status presentation.

Focused coverage must force an event between subscription and snapshot completion, multiple emits
within one millisecond, stale and duplicate delivery, session switching with a late snapshot,
runtime instance replacement, process-sequence restart with a stable anchor ID, boundary-only and
legacy anchor reasons, and the normal compacting-to-compacted transition.

#### 5. Record Silent Overflow Without Replaying Completed Work

- Design an attempt-local durable observation for successful responses whose provider-reported
  prompt usage exceeds the context window and for near-empty `length` stops at the window edge.
- Use DeepChat's provider usage contract: cache-read tokens are details within input tokens, not an
  additional bucket, and physical-attempt usage must not be replaced by a logical-round aggregate.
- Consume the observation at the next pre-turn boundary; a newer reconstruction anchor settles it.
  Do not create a background queue and do not replay an already completed response or user prompt.

##### Silent Pressure State And Persistence Contract

- The detector runs when one physical provider attempt settles, before its existing
  `provider/attempt_completed` fact is appended. It uses that attempt's status, stop reason, and
  usage plus the positive safe-integer effective context window captured from the same request
  preflight. It emits `successful_prompt_overflow` only for `status=completed`,
  `stopReason=complete`, and `inputTokens > contextWindowTokens`. It emits
  `zero_output_length_at_limit` only for `status=completed`, `stopReason=max_tokens`,
  `outputTokens=0`, and `inputTokens >= max(1, ceil(contextWindowTokens * 0.99))`. Cache-read
  detail is not added to input.
- Provider-attempt schema v3 adds nullable `contextPressure: { kind, contextWindowTokens,
  thresholdTokens }`. The observation is the durable decision; top-level usage and attempt identity
  are its evidence. v1/v2 facts parse with `contextPressure=null`. The existing provenance key
  remains unchanged, so retry/replay idempotence still binds one physical attempt to one fact.
- Add an indexed Tape query for the newest valid pressure-bearing attempt after a supplied entry ID,
  scoped to session, provider, and model. The application reader supplies the latest reconstruction
  anchor's `entry_id` as that lower bound. This avoids transcript scans and avoids loading a long
  session's provider-attempt history. Malformed or unknown observation kinds do not trigger work.
- Pre-turn preparation reads this pending observation only after Tape readiness is established. If
  present, `prepareForNextUserTurn` retains the configured tail but bypasses its percentage trigger
  and uses `auto_handoff/context_overflow`; the existing automatic-compaction enabled setting still
  applies. Normal marker, CAS, boundary-only fallback, and memory-observer behavior are reused.
- A committed reconstruction anchor with `entry_id` greater than the observation settles it without
  mutating either fact. One anchor settles every older matching observation. A threshold compaction,
  boundary-only compaction, reset, or handoff can therefore settle stale pressure naturally. If no
  intent can advance, the next turn may inspect the same fact once but starts no retry loop.
- Detection and persistence are fail-open: an append failure is logged through the existing provider
  outcome path and cannot invalidate a completed answer. No response, user prompt, or side-effecting
  tool call is replayed for either signature. This is DeepChat's product policy; unlike pi's length
  recovery, `max_tokens` does not request an automatic continuation.

Focused coverage must prove both signatures, exact boundary negatives, cache-read non-duplication,
per-physical-attempt isolation across retries, v1/v2 compatibility, idempotent append, indexed
lookup, anchor settlement, model scoping, disabled/no-progress behavior, and next-turn force without
provider replay.

#### 6. Account For Compaction Model Usage

- Design this as a vertical capture-to-reporting slice. Capture every summary call that returns
  usage, including successful map-reduce chunks whose enclosing compaction later fails.
- Associate records with `compactionAttemptId`, provider, model, and a dedicated category. Keep
  synthetic transcript markers excluded from ordinary message backfill; only their physical
  provider-call facts enter the compaction category.
- Record unavailable usage as unknown. Never estimate it as billed usage or write zero values that
  contaminate cache-hit denominators.

##### Compaction Usage Identity And Projection Contract

- `applyCompaction` passes one observer scoped to the immutable `compactionAttemptId` through direct
  and recursive summary generation. Immediately before each `generateText` call, provision a
  random `providerCallId`. A retry or repeated application is a new paid call with a new ID;
  persistence retry of the same observation retains its ID and is idempotent.
- Observe the provider call at its physical boundary, not at final-summary return. A returned
  response is recorded before content sanitization. A throw or abort records a terminal observation
  with null usage. This preserves successful chunk charges when a later chunk, reduce pass,
  shrink proof, or enclosing compaction fails.
- Add a typed `compaction/model_call_completed` Tape event owned by a narrow compaction-usage writer.
  Its source is the runtime event for `compactionAttemptId` and its provenance key includes the
  provisioned provider-call ID. In the same transaction, the writer reuses an existing event for
  that provenance or assigns the next positive source sequence for the attempt. The schema
  allowlists terminal status and independently validates nullable non-negative safe-integer usage
  fields, records the actual summary provider/model, marker message ID, call sequence, and bounded
  timestamps, and excludes prompt/response/error content. A usage object must contain at least one
  measured component; otherwise the event records `usage: null`.
- Persist the Tape fact and usage reporting projection in one synchronous Session SQLite
  transaction. The observer is diagnostics-only and fail-open: log a persistence failure without
  changing summary acceptance, committing a different boundary, or repeating the provider call.
  Marker finalization/retraction and crash reconciliation neither create nor delete usage facts.
- Migrate `deepchat_usage_stats` from a message-keyed row shape to a stable `usage_id` projection.
  Keep nullable `message_id`; add category `chat | compaction`, nullable
  `compaction_attempt_id`/`provider_call_id`/`provider_call_seq`, and nullable token/cache columns.
  Legacy rows preserve all values as `chat` with `usage_id = message_id`. Ordinary message
  upserts remain one row per message; compaction uses one row per provider call.
- Returned `totalUsage` writes each valid measured prompt/completion/total component independently.
  An absent or invalid component remains null and total is never synthesized from input plus output.
  A call with no valid measured component writes a compaction projection row with null token fields
  so the call remains observable without pretending it was free. `generateText` exposes no cache
  read/write detail, so compaction cache columns stay null and its input tokens are absent from the
  cache-hit denominator.
- Dashboard total tokens aggregate all known usage. Preserve existing message count, daily message
  activity, and most-active-day semantics by counting only category `chat`. Add a category
  breakdown with event count, known-usage count, unknown-usage count, and tokens so users can
  distinguish conversation usage from compaction overhead. Provider/model attribution uses the
  actual model chosen by `generateRollingSummary`, including a configured assistant model.
- Focused tests cover one-call success, direct missing usage, thrown/aborted calls, recursive
  map-reduce accumulation, successful chunks before a later failure, actual assistant-model
  attribution, idempotent observation replay, marker retraction independence, v68 migration, chat
  message-count compatibility, category reporting, and cache-rate denominator exclusion.

#### 7. Add A Context-Occupancy Read Model

- Report the most recent durable provider request, not a speculative next-request reconstruction.
  The request identity and effective context-window denominator come from the session's latest valid
  ViewManifest. Do not repurpose `useContextLength`; it measures composer draft plus selected files,
  not provider-visible conversation context.
- Prefer `inputTokens` from the final completed physical provider attempt for the exact manifest
  message/request identity and matching provider/model. Cache reads are already included in input
  and must not be added. If valid usage is absent, conservatively use
  `estimatedPromptTokens + toolReserveTokens`; never represent missing usage as zero or fall back
  from a malformed final physical attempt to an earlier retry.
- Return a typed snapshot with `current | stale | unavailable` freshness, `provider | estimated`
  source when available, occupied/window token counts, request identity, evidence entry IDs, and
  evidence time. Derive percentages in the renderer and preserve values above 100% as provider
  evidence even if the progress fill is visually clamped.
- Mark evidence current only when the active DeepChat provider/model, recomputed effective context
  window, and latest reconstruction-anchor entry still match the manifest. A model/window change,
  missing process-local provider-limit observation after restart, or a newer reconstruction boundary
  makes it explicitly stale. A missing/invalid manifest and every direct ACP session are
  unavailable, never zero. An invalid newest manifest must not reveal an older request as current.
- Add indexed readers for the latest session ViewManifest and the final attempt of its exact
  request. Reuse the indexed latest-anchor reader. The snapshot path must not load the complete
  Tape, fold the transcript, or parse included/excluded View payloads to calculate occupancy.
- Use an additive GET route rather than a second runtime state machine. Refresh the active renderer
  snapshot on activation, settled generation status, compaction replacement, and successful local
  model/window updates. Guard requests with a renderer-local generation so late responses cannot
  cross session or refresh boundaries. Do not add a streaming occupancy event or wall-clock
  revision.
- Render a compact status-bar percentage only when evidence is available. The tooltip identifies
  provider-measured versus estimated input, shows occupied/window token counts, and labels stale
  evidence. Unavailable evidence stays absent rather than displaying a misleading `0%`.
- Focused tests cover exact-attempt selection, cache-read non-duplication, estimate fallback,
  provider/model/window and anchor staleness, malformed/absent evidence, provider-side values above
  the window, ACP unavailability, indexed query shape, late renderer responses, session switching,
  and current/estimated/stale status-bar presentation.

#### 8. Add Selective First-User Pinning

- Introduce `cache_aware_context_v2` / `cache-aware-v2` as the default policy while retaining the
  complete v1 policy and parser contract. V2 alone opts the cache-aware builders into pinning, so a
  stored or explicitly requested v1 policy is never silently reinterpreted.
- Reuse the effective `historyRecords` already prepared for chat and resume. Select the earliest
  surviving user record, which is already the latest ranked edit; a retracted first user naturally
  exposes the next one. Tape generation reset, not `summary/reset`, defines a new incarnation. Do
  not add an incarnation lookup or another full-Tape fold on the request path.
- Materialize the user through the canonical historical record projector. Remove that record from
  ordinary history turns and order the View as system, pinned user, checkpoint, retained tail, then
  active turn. Do not duplicate a new active input or a resume owner that is already part of the
  protected active turn.
- Carry a typed authoritative pin descriptor in View metadata and the Run's pending View context.
  It contains the effective message record and a canonical hash of the exact provider-visible pin;
  it is not a `DeepChatTapeViewSyntheticContribution` and is never persisted as a new message fact.
- Add `pinned_first_user` to the manifest reason allowlist. Initial selection resolves the latest
  effective message entry through the existing source maps and records it as both `entryId` and the
  sole `sourceEntryIds` value. Tool-loop/recovery request refs use the same descriptor only when an
  exact pinned-message hash is still present, avoiding false provenance after any future projection
  change.
- Extend cache-aware preflight and strict-retry fitting to recognize the v2 pin between system and
  checkpoint as protected leading input. Include it in fixed-token and physical-window checks;
  shed optional memory/directives and complete tail turns first, then fail closed if the protected
  set cannot fit. Never truncate or silently discard the pinned instruction.
- Keep the original user trust level. The pin receives neither the derivative-content fence nor a
  historical-quotation wrapper. Existing attachment projection and historical Skill markers remain
  unchanged.
- Focused coverage must prove v2/v1 policy selection, provider order, latest effective edit and
  retraction behavior, no duplication before or after the cursor, `summary/reset` non-incarnation,
  protected overflow, resume behavior, tool-loop fitting, and manifest source/hash provenance.

#### Independent Cleanup

- Remove or rename dead compaction settings UI and composer-token helpers only after confirming each
  has no live consumer. Keep cleanup independent from correctness slices.

### Post-Implementation Seam Hardening (2026-08-15)

- [x] Align cache-aware v2 pin accounting with compaction: include the fixed pin in trigger and
  retained-input arithmetic, remove it from summary input/provenance without creating a cursor hole,
  and protect the strict-shrink proof with a pin regression.
- [x] Exclude internal compaction usage observations from effective View/search; reserve both
  provider-attempt and compaction-model-call event names for exact persistence writers without
  changing existing provider-attempt read-model semantics.
- [x] Settle compaction markers independently of obsolete runtime instances, isolate startup
  reconciliation failures per row, and rerun restart reconciliation after Session database reopen.
- [x] Make compaction usage a rebuildable projection, preserving independently measured token
  fields without inventing totals.
- [x] Hydrate occupancy snapshots directly so renderer request ordering cannot create a cold-session
  blind spot.
- [x] Treat each persisted provider-pressure threshold as durable observation data: validate it
  against its physical attempt without reapplying the current detector policy, and degrade malformed
  pressure to null without discarding the provider-attempt fact or reviving older cache metrics.
- [x] Exclude source-session compaction indicators from transcript forks; the target Session may
  inherit user and assistant facts, but it must not claim a compaction attempt or anchor that never
  occurred in its own Tape incarnation.
- [x] Reject new zero context-window settings and normalize legacy/model-catalog zero values to the
  established runtime default before pressure or compaction arithmetic.
- [x] Persist each settled marker's boundary-only reason from its same-attempt Tape anchor and render
  the two reason substates without inferring history from a nullable summary timestamp.
- [x] Keep stale occupancy evidence in the tooltip, but clear its live percentage and fill; mark
  current View-derived estimates distinctly from provider measurements.
- [x] Remove the unreachable legacy compaction settings section, its orphaned translations and
  tests, and the unused composer-draft `useContextLength` helper.
- [x] Require the transcript's compaction usage writer at composition time instead of silently
  discovering an optional capability that can drop audit and billing facts.
- [ ] Review each completed slice for hidden side effects, compatibility, failure behavior,
  performance, security, naming, regression coverage, and maintenance cost before committing it.

### Design Gates

Slices 1 and 2 have implementation-level contracts and may proceed consecutively. Slices 3–5 each
need their small state transition and persistence contract written immediately before coding.
Slices 6–8 stop for a separate design review at their stage because their accounting, read-model,
and selective-View consequences are broader. This follow-up plan fixes scope and order; it does not
pretend those later designs are already implementation-ready.

## Test Matrix

| Area | Required evidence |
| --- | --- |
| Compaction service | summary success, summary failure boundary, abort, CAS winner/loser, merged gap |
| Session settings/Tape | cursor-only state, atomic anchor/state write, reset/edit invalidation |
| Runtime coordinator | cursor-only compacted projection, manual lifecycle, projection cleanup |
| Input/context coordination | no-intent, no-progress intent, real progress, strictly smaller retry |
| Provider loop | preflight pressure, provider 400, two later recovery sequences, finite ceiling |
| Context builder | strict protected-tail override, closed tool units, open-unit protection |
| ToolOutputGuard | existing artifact reuse, bounded stub, cleanup ownership, path safety |
| Token meter | exact anchor, suffix delta, every fingerprint invalidation, malformed usage fallback |
| Harness/replay | ViewManifest provenance, provider attempt identity, no duplicated tool effect |

## Commit And Review Discipline

Each implementation slice is committed only after:

1. inspecting the complete unstaged and staged diff;
2. reviewing findings in severity order for hidden side effects, compatibility, edge cases,
   performance, security, naming, test gaps, and maintenance cost;
3. fixing every material finding and repeating the relevant checks;
4. using a conventional commit that describes the concrete behavior, never the review activity.

Documentation and implementation may use separate commits, but boundary/summary decoupling and
truthful runtime progress reporting must land in the same implementation commit so no intermediate
code state can consume recovery without shrinking the View.

## Validation Commands

Focused commands will be selected per slice. Before handoff run at least:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --silent=passed-only \
  test/main/agent/deepchat/runtime/compactionService.test.ts \
  test/main/agent/deepchat/runtime/compactionRuntimeCoordinator.test.ts \
  test/main/agent/deepchat/runtime/contextBuilder.test.ts \
  test/main/agent/deepchat/runtime/toolOutputGuard.test.ts \
  test/main/agent/deepchat/loop/contextCoordinator.test.ts \
  test/main/agent/deepchat/loop/inputPreparationCoordinator.test.ts \
  test/main/agent/deepchat/loop/loopRun.test.ts \
  test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts \
  test/main/session/data/settings.test.ts \
  test/main/session/data/tapeViewManifest.test.ts \
  test/main/session/data/tapeViewReplay.test.ts
pnpm format
pnpm i18n
pnpm lint
pnpm typecheck
```

Any environment-gated native SQLite tests or unrelated baseline failures will be reported
explicitly rather than presented as passing.
