# Tape-Native Context Compaction And Overflow Recovery

## Issue

DeepChat retains the full conversation in its append-only Session Tape, but its runtime currently
couples two separate context strategies:

- compacting the provider-visible View by advancing a reconstruction boundary; and
- generating a semantic summary for the history hidden by that boundary.

`CompactionService.applyCompaction` advances the boundary only after an LLM summary succeeds. The
context-pressure caller then treats the existence of a prepared intent as a successful recovery,
even when the durable boundary did not move. At very large context sizes this creates a circular
failure: the recovery request depends on another large model request, and a failed summary consumes
the only recovery opportunity without reducing the View.

Full-history heuristic token estimates, protected active-turn tool traffic, and a one-shot recovery
latch amplify that defect. A long tool loop can therefore be rejected by local preflight or by the
provider even though the raw Tape contains enough information to continue from a smaller View.

## Tape.Systems Interpretation

Tape itself is not compacted. It remains an append-only fact log.

The tape.systems model defines compact as `handoff + anchor + selective view`: an anchor moves the
logical reconstruction origin and the View reads a smaller suffix. Earlier entries remain
available for recall and audit. Summary is a separate derived strategy: state attached to an anchor
with provenance, used as a reconstruction hint rather than as the authority for retained history.

DeepChat must therefore preserve these independent outcomes:

1. **Boundary progress**: a durable reconstruction anchor advances the selected View.
2. **Semantic continuity**: an optional summary describes material hidden by that boundary.

Summary generation may improve continuity, cost, and latency, but it must not be a prerequisite for
boundary progress.

## Goals

1. Make context-pressure recovery succeed whenever DeepChat can durably derive a strictly smaller,
   protocol-valid provider View, even when summary generation fails.
2. Keep Session Tape append-only and preserve all raw messages, tool calls, tool results, usage,
   errors, manifests, and anchors.
3. Define semantic recovery progress from a durable boundary, and in-flight tool-result reduction
   from a changed protocol-valid projection, not from an attempted compaction operation.
4. Keep summary provenance explicit, add deterministic gap reconstruction when a summary is
   unavailable, and avoid repeated gap-notice growth.
5. Bound long active turns by compacting only closed tool interaction units without breaking tool
   call/result pairing or replay authority.
6. Replace repeated full-prompt budgeting with provider-usage anchoring plus bounded delta
   estimation when the request envelope is unchanged.
7. Check pressure before every logical provider request, allow later recovery after a successful
   model response, and retain a finite per-Run recovery ceiling.
8. Preserve current public Session, renderer, provider, and Tape compatibility contracts.

## Required Invariants

### Storage Plane

- Session Tape entries are append-only during a Tape incarnation.
- Compaction never deletes or rewrites raw history.
- A reconstruction anchor, its legacy Session summary projection, and any cursor transition remain
  atomic on the shared SQLite connection.
- Tool-output files and persistent stubs retain their current ownership, cleanup, and path-security
  rules.

### View Plane

- The reconstruction cursor is monotonic within a Tape incarnation, except for the existing
  explicit reset/edit invalidation path.
- Semantic boundary recovery is reported as applied only when a durable boundary advances and the
  re-derived provider View is strictly smaller.
- In-flight tool-result compaction is not boundary progress. It can retry only when it produces a
  changed protocol-valid projection, recorded by the next request's ViewManifest.
- A prepared intent, an LLM call, a CAS attempt, or a changed summary alone is not View progress.
- CAS loss is successful recovery only when the winning persisted state advances beyond the
  caller's previous cursor and produces a smaller View.
- System instructions, the current user input, and provider-required tool protocol structure are
  never silently discarded.
- Every provider-visible recovered View is recorded through the existing ViewManifest path.

The reconstruction cursor is sufficient as the compaction revision because it is already durable,
monotonic, and part of every manifest. No database `viewRevision` column is added. In-flight
tool-result pruning is tracked by the resulting immutable message projection and must still pass
the existing changed-projection guard before retry.

### Summary And Gap Plane

- A successful summary is attached to the new boundary with its source range and message IDs.
- A failed non-abort summary attempt commits the same boundary with a stable
  `summary_unavailable` reason and coverage range. Provider error text, timestamps, secrets, and
  stack data are not included in model-visible gap state.
- If an older valid rolling summary exists, the gap anchor retains it as `priorSummary` rather than
  claiming it as a newly generated `summary`; the checkpoint may use it as partial reconstruction
  context while identifying the unsummarized `summaryGap` range separately.
- Consecutive summary gaps merge into one bounded coverage range on the latest anchor. They do not
  add one provider-visible notice per failure.
- Gap checkpoint text is deterministic for equal anchor state. It contains no generated timestamp
  or unstable error wording.
- A later successful summary replaces the gap state for the newly covered range. Background model
  work is not required for correctness and is outside the hot recovery transaction.

### Active-Turn Protocol Safety

- The active turn is segmented into closed interaction units at assistant tool-call/result
  boundaries. An open tool call, pending permission, deferred execution, or unmatched result is
  protected.
- Existing ToolOutputGuard offload stubs remain intact. Eligible large inline results use a stable
  bounded head/tail projection that points back to Tape recall; it never invents a file path or
  marks unpersisted content as an offload artifact.
- The newest closed tool unit remains intact while compacting older eligible units is enough to
  relieve pressure. It becomes eligible only as the next bounded fallback, before semantic
  recovery, so the model retains its most recent action evidence whenever possible.
- Pruning changes provider-visible projections, not raw Transcript or Tape tool facts, unless the
  existing persistent replacement contract is explicitly used.
- Recovery never blindly replays the original user request after tools may have produced external
  effects. If no protocol-safe reduction can fit the active turn, the Run fails with the existing
  bounded overflow diagnostic rather than duplicating side effects.

### Token Meter And Cache Safety

- A successful provider attempt may anchor the next pressure estimate with its provider-reported
  prompt usage.
- Delta projection is used only when provider, model, system prompt, provider-visible tool schema,
  relevant generation envelope, and the anchored message prefix are unchanged.
- Envelope or prefix drift invalidates the anchor and falls back to a full conservative estimate.
- A successful attempt establishes a new anchor only when its actual provider payload is identical
  to the continuation View. A fitted historical projection must not anchor an untrimmed in-memory
  prefix.
- Provider usage is never trusted to reduce the estimate below known tool/schema/output reserves.
- Malformed, negative, cumulative-only, ambiguous usage data, or cache-read usage greater than
  total prompt usage is ignored.
- Cache-read tokens are normalized according to the existing provider-attempt usage contract; they
  are not double-counted as additional prompt tokens.
- Gap notices, offload stubs, and summary instructions are byte-stable when their semantic inputs
  are unchanged so they do not create avoidable prefix-cache churn.

### Recovery Lifecycle

- Pressure is evaluated before each logical provider request, including requests after tool
  settlement.
- A successful provider response permits a later context-overflow recovery sequence in the same
  Run. Failed retries without an intervening successful response cannot loop indefinitely.
- The Run keeps a finite total recovery ceiling. The sequence latch and the total ceiling are
  separate state.
- Context recovery continues to create a new request sequence and ViewManifest; transparent
  transient retry continues to reuse its immutable payload and manifest.

## Recovery State Machine

```text
assemble candidate View
  -> estimate pressure
  -> fits: send provider request
  -> pressure:
       1. compact older eligible closed inline tool results while preserving the newest closed unit
       2. if pressure remains, compact the newest eligible closed unit as a bounded fallback
       3. if the changed projection fits: send it as a new request
       4. otherwise prepare a reconstruction boundary and try semantic summary
       5. summary fails: commit deterministic boundary-only anchor
       6. reassemble and require a strictly smaller View for semantic recovery
       7. strict output-reserve retry when only output reduction can help
       8. fail only when protected content cannot fit or recovery made no progress
```

After a successful provider response, the sequence-level overflow latch resets. A later tool step
may run the state machine again until the Run-level recovery ceiling is reached.

## Compatibility

- Existing reconstruction anchors containing a summary remain valid and retain their hash and
  replay meaning.
- Cursor-only handoff anchors already read as `summaryText: null`; that behavior becomes an
  intentional compacted state rather than being projected as cursor 1/idle.
- `SessionCompactionState` keeps its public fields and status values. A boundary-only state uses
  `status: 'compacted'`, the persisted cursor, and `summaryUpdatedAt: null`. A retained
  `priorSummary` may populate `summaryText` for the next summarization attempt while the null time
  continues to state that this boundary has no newly generated summary.
- Existing `AgentTapeHandoffState` and model-facing `tape_handoff` continue to require a summary.
  Runtime reconstruction anchors use the narrower generic anchor capability and do not weaken the
  model-tool contract.
- No persisted table or route migration is required for boundary-only compaction or usage
  anchoring. Any later diagnostic field must be additive and backward compatible.
- Existing isolated and recursive summary requests remain the semantic-summary path.
  Prefix-preserving summary generation is outside this change.

## Security And Privacy

- Gap anchors store an allowlisted reason and bounded provenance only. Raw provider errors are not
  persisted or shown to the model.
- Summary and reconstruction content remains untrusted user-role data and never enters the system
  role.
- Tool-output pruning can reference only paths created by the existing guarded offload owner.
- Tape recall remains subject to the existing Session, fork, and frozen-head authorization.
- Token-anchor fingerprints contain hashes and numeric usage only, not prompt text, tool output,
  credentials, or provider headers.

## Acceptance Criteria

1. A non-abort summary failure advances a durable cursor-only or partial-summary reconstruction
   anchor and recovery retries with a strictly smaller View.
2. An intent with no durable cursor progress reports `applied: false` and cannot consume a recovery
   attempt as if it succeeded.
3. A CAS race reports progress only when the winning cursor is newer and the derived View shrinks.
4. Cursor-only persisted state is exposed as compacted with the real cursor and null summary time.
5. Consecutive boundary-only compactions produce one stable gap notice describing the merged
   coverage, with no raw error or timestamp.
6. Abort during summary generation commits no boundary and preserves the previous state.
7. Manual and automatic compaction retain their existing projection lifecycle while distinguishing
   semantic-summary success from boundary-only success.
8. Strict retry and active-turn pressure reduction honor complete turn/tool protocol units and can
   remove eligible closed units without dropping the current user input.
9. A successful provider response re-enables a later recovery sequence, while the Run-level ceiling
   prevents an infinite compact/retry loop.
10. Usage-anchored projection estimates only the suffix after an exact request-envelope/prefix
    match and falls back safely after any envelope drift.
11. ViewManifest, provider-attempt, replay, Session IPC, renderer compaction state, and existing
    anchor reads remain backward compatible.
12. Focused runtime, Session/Tape, provider-loop, ToolOutputGuard, and harness tests pass, followed by
    formatting, i18n validation, lint, type checking, and the relevant broader main-process suite.

## Implementation Record

Implemented on `fix/tape-context-compaction`. The durable behavior is split into
reviewable commits for boundary/summary decoupling, bounded recovery, usage anchoring, closed tool
result View compaction, and canonical documentation. No persisted schema or public route migration
was required.

The canonical post-implementation contracts live in:

- `docs/architecture/tape-system.md` for append-only Tape, selective View, reconstruction anchors,
  usage anchoring, and tool-unit compaction;
- `docs/architecture/agent-system.md` for request identity and recovery lifecycle.

Validation covers summary success/failure/abort/CAS races, cursor-only state, strict protected-tail
fitting, repeated bounded recovery, usage-anchor invalidation, closed/open tool units, harness
replay, ViewManifest provenance, and Session/Tape compatibility.

## Non-Goals

- Physically deleting or rewriting old Tape entries.
- Making summary text authoritative history.
- Silently truncating system instructions or the current user input.
- Exposing unrestricted `tape_handoff` to default chat models.
- Guaranteeing a provider cache hit or relying on undocumented provider token semantics.
- Replaying side-effecting tools merely to reconstruct an abandoned continuation.
- Adding a background summary worker in this change; boundary-only state remains correct without
  delayed semantic enrichment.
