# Durable Execution Journal Specification

## Background

DeepChat currently uses Tape for append-only session facts and reconstructs model context through
anchors, effective views, recall, and ViewManifest records. Those Context Tape behaviors are
independent from the execution lifecycle of a physical Agent Run and remain valid.

The execution path has a narrower reliability gap. Tool call and result facts are derived from a
terminal transcript block after execution. A process crash can therefore occur after an external
side effect but before Tape contains evidence that the call was dispatched or what outcome was
observed. Run completion is also projected to transcript, status, and UI without a prior durable
terminal fact. Startup recovery can mark pending transcript messages as interrupted, but it cannot
classify the execution state from authoritative facts.

This architecture adds a durable Execution Journal as a separate fact family in the existing
physical Tape store. It does not replace Context Tape, the DeepChat loop, or runtime ownership of
active Runs.

## Problem Statement

Two contracts are missing from the current execution path:

1. **Authority contract:** native execution facts must be written by the execution path itself.
   Transcript reconciliation may reconstruct legacy context facts, but it must not manufacture
   Execution Journal facts.
2. **Commit contract:** a potentially side-effecting call needs a durable dispatch fact after every
   local refusal gate and immediately before the resolved invocation. A known outcome needs a
   durable outcome fact before the harness delivers its finalized result to transcript, model
   context, or UI. A Run terminal fact needs to precede terminal projections.

Without these contracts, a restart cannot distinguish a call that was never authorized from a call
that may have reached its target.

## Goals

1. Give every physical DeepChat Run a restart-stable UUID identity.
2. Record native Run and tool boundary facts through a narrow, synchronous, fail-closed capability.
3. Make journal idempotency strict: the same identity and payload is idempotent; the same identity
   and a different payload is corruption.
4. Place dispatch commits after local validation, permission, policy, binding, target, and abort
   gates and immediately before the resolved side-effect boundary.
5. Commit known tool outcomes before harness-owned transcript, model-context, and UI result
   delivery, and terminal Run facts before terminal transcript, status, and UI projections.
6. Classify recovery candidates at startup as `not_dispatched`, `completed`, `indeterminate`, or
   `corruption`, without automatically retrying a tool.
7. Preserve all existing Context Tape behavior and compatibility.

## Fact Model

Execution Journal v1 uses four immutable Tape event names:

| Event | Identity | Meaning |
| --- | --- | --- |
| `execution/run_started` | `runId` | A physical Run passed local construction and entered execution. |
| `execution/dispatch_committed` | operation identity | DeepChat authorized one resolved invocation and durably claimed it immediately before dispatch. |
| `execution/tool_outcome` | operation identity | DeepChat received and prepared a known outcome for that claimed invocation. |
| `execution/run_terminal` | `runId` | The Run selected a terminal outcome before projecting it elsewhere. |

The protocol version is an explicit payload field and is independent from UUID generation.

An operation identity is the structured tuple:

```ts
{
  runId: string
  requestSeq: number
  providerToolCallId: string
}
```

The persisted provenance key is derived from a cryptographic hash of the canonical tuple. It does
not concatenate unescaped fields. Provider tool call IDs are only assumed unique within one
provider response, never across Runs or providers.

Dispatch payloads contain the operation identity, message identity, resolved tool/source/target
metadata, and a canonical argument hash. Raw arguments are not duplicated into the journal.
Outcome payloads contain only the operation identity, success/error state, and a canonical response
hash. Tool response text, structured MCP envelopes, image base64 data, and temporary offload paths
remain in the runtime/transcript projection that consumes them; they are not duplicated into the
Journal. T2 proves that a particular outcome was received without creating a second durable copy of
potentially sensitive output or promising recovery from an offload file with a shorter lifecycle.

## Required Invariants

- `runId` is a fresh UUID for every physical loop or deferred execution Run and never depends on a
  process-local counter.
- `run_started` is committed before the Run is registered or executed.
- A dispatch producer commits after every known local refusal path and directly before the resolved
  side-effect boundary.
- A dispatch commit returning an existing claim prevents a second physical invocation.
- `tool_outcome` is valid only for an operation with a native `dispatch_committed` fact.
- A known outcome is committed before the harness mutates transcript, model-context, or UI with the
  finalized tool result. Target-owned live/runtime events emitted during an Agent tool invocation
  are part of that claimed invocation and are not T2-gated projections.
- Skill activation and other harness-owned context mutations occur after T2. Their failure cannot
  replace or contradict the target outcome already recorded by T2. Activation failure stops the
  current Run after T2 rather than continuing another provider round with stale Skill context.
- `run_terminal` is committed before transcript status, runtime status, terminal hooks, or UI
  completion/failure projection advances.
- Journal persistence failure propagates through the Run. It is never reduced to a warning.
- If Run execution and its fallback terminal commit both fail, propagation retains the execution
  cause and the terminal failure cause without erasing a concrete Journal corruption type.
- A Journal failure still releases claimed inputs and exits transient runtime states. If no matching
  terminal fact was committed, cleanup must not manufacture a terminal transcript or UI projection.
- If a deferred Run cannot commit its terminal after T1, the originating interaction is parked. The
  harness may persist a non-terminal projection of its T2 result, or an explicit indeterminate
  diagnostic when T2 is absent, solely to consume the approval and prevent replay. The assistant
  message remains pending: no Run outcome metadata, terminal hook, stream terminal event, or
  terminal message status is produced.
- Same identity plus the same canonical fact is idempotent. Same identity plus a different canonical
  fact throws a typed corruption error.
- Journal commits cannot run inside a host transaction whose rollback could erase the committed
  receipt independently of the external effect.
- Every Journal commit and recovery read resolves its storage capability from the current Session
  database connection. Closing and reopening the application database cannot leave the long-lived
  `SessionTape` facade holding a store backed by the closed connection.
- Only the strict Journal writer may append names in the reserved `execution/*` namespace. Fork
  merge and generic Context Tape append paths cannot copy or create those facts. The native append
  operation is absent from the generic `TapeEntryStore` capability.
- Legacy reconciliation and transcript backfill never create an `execution/*` v1 event.
- Recovery never reuses an old `runId` and never automatically retries an indeterminate operation.
- Context Tape facts, search projection, recall, anchors, and ViewManifest retain their current
  fail-open behavior where already specified.
- A transcript operation that shifts persisted message order appends matching Context Tape
  replacement facts in the same database transaction. Effective Tape ordering must not retain the
  pre-shift `orderSeq` values. A shifted compaction placeholder remains an excluded
  `message/compaction_indicator` event and never becomes a normal message fact.
- Message replacement callers explicitly declare whether the revision changes the record or only
  its order. Provenance and child-fact behavior must not be inferred from a reason string or from
  the mere presence of correction metadata.
- Compaction order correction materializes only affected messages in bounded batches while the
  outer SQLite transaction remains active.
- Tool fact order is derived from the corresponding effective message. The persisted tool payload
  `orderSeq` remains a legacy fallback when no effective message is available, but an order-only
  message replacement does not append new tool facts.
- Backfill compares a candidate tool fact with the current effective revision using its kind, name,
  terminal status, and payload content excluding `orderSeq`. It skips only an order-only difference;
  a changed response, arguments, status, name, or other tool payload content remains a new immutable
  revision. If the changed content reuses an older payload hash, its provenance identifies the
  effective entry it supersedes rather than resolving to the historical row.
- A synthetic summary checkpoint cites the reconstruction anchor entry that supplied its summary.
  An unrelated anchor must not be recorded as summary provenance.

## Failure Semantics

The journal does not provide exactly-once execution for an arbitrary local process, MCP server, or
remote API. A crash can still occur after a target accepted an invocation but before DeepChat
received or committed its result.

The protocol instead preserves a finite evidence state:

| Durable evidence | Recovery meaning |
| --- | --- |
| No dispatch for the Run | `not_dispatched`: no journaled tool invocation crossed its dispatch boundary. |
| Every dispatch has a matching outcome | `completed`: all dispatched operation outcomes are known locally. |
| At least one dispatch has no outcome | `indeterminate`: the remote effect cannot be inferred locally. |
| Malformed, conflicting, orphaned, or unsupported facts | `corruption`: the journal cannot be trusted for automatic action. |

`indeterminate` and `corruption` are parked. The first version may expose the existing interrupted
message projection to users, but it must not turn that projection into evidence or re-execute a
tool. Reconciliation can later be completed only from external evidence or an explicit user action
that starts a new Run.

Invalid model-controlled operation identity or argument data before T1 rejects only that tool call.
Persistence failures, conflicting facts, duplicate dispatches, and failures after T1 remain fatal to
the Run. A committed `error` terminal may still be projected as that same error; a failed terminal
commit only performs runtime cleanup and cannot be represented as a durable terminal outcome.
Once an `error` or `aborted` terminal is committed, its outcome controls the matching finalizer even
if the later projection failure has a different error shape.
An exception named `AbortError` is not cancellation evidence by itself. A Run records `aborted` and
`user_stop` only when its owned abort signal is actually aborted; otherwise the exception remains an
error.

A deferred failure before T1 leaves its approval pending because the Journal proves no invocation
crossed the side-effect boundary. A failure after T1 parks every interaction on the assistant
message for the harness lifetime and, where transcript storage remains available, removes their
actionable UI state without terminalizing the message. Runtime cleanup and rehydration retain that
parking; Session deletion releases it. On restart, `completed`, `indeterminate`, and `corruption`
reports with an incomplete terminal force that pending message through the existing interrupted
recovery path using its Session and message identity together. `not_dispatched` reports do not
consume a resumable approval.

A claimed steer already has durable visible user messages. If its next Run cannot commit
`run_started`, the claim is consumed rather than released: releasing it would either violate the
pending-input contract or replay a user fact that is already visible.

## Scope

The first version covers:

- normal DeepChat loop Runs;
- MCP calls at the final resolved client boundary;
- built-in Agent tools that can cross a persistent or external side-effect boundary;
- approved deferred tool execution through a fresh physical Run;
- completed, paused, aborted, and error terminal outcomes;
- startup classification and diagnostic reporting;
- native SQLite and crash-boundary tests.

Pure validation, permission prompts, question tools, context reads, ViewManifest writes, and other
operations that never cross a persistent or external side-effect boundary do not create a dispatch
fact. Unknown MCP tools are treated conservatively because their remote behavior cannot be inferred
from local annotations.

Host-initiated MCP calls outside the DeepChat loop and deferred execution paths are outside v1 scope.
This includes host capability probes and auxiliary UI/runtime reads; they do not participate in Run
recovery until they execute through a journal-aware harness boundary.

## Compatibility

- The existing `deepchat_tape_entries` schema and row format remain compatible. Journal records use
  existing event rows and add only a query index for unterminated-Run recovery reads.
- Existing Context Tape event names and payloads are unchanged.
- Existing tool facts keep their persisted `orderSeq` and provenance keys. The field remains
  readable for orphan or legacy facts but is no longer authoritative when an effective message is
  available. New content-revision keys may add a superseded-entry suffix; no payload migration or
  historical backfill rewrite is introduced.
- Existing transcript backfill remains available for legacy context facts and remains fail-open.
- No renderer or IPC contract changes are required in v1.
- Existing run IDs in historical transcript metadata remain readable. Only new physical Runs use the
  UUID contract and participate in journal recovery.
- No data migration rewrites historical Tape rows.

## Acceptance Criteria

1. Two physical Runs in the same Session receive different UUIDs across process restarts.
2. A strict writer returns the existing row for an identical fact and throws a typed corruption
   error for a conflicting fact under the same identity.
3. A failed dispatch commit prevents the target invocation. An existing dispatch claim also
   prevents a second target invocation.
4. MCP and side-effecting Agent tool tests prove that all local rejection paths occur before T1 and
   that the target call occurs after T1.
5. A failed outcome commit prevents harness-owned transcript/model-context result delivery.
6. A failed terminal commit prevents terminal transcript/status/UI projection.
7. Deferred approval execution uses a new UUID Run and follows the same T1, T2, and terminal order.
8. Startup recovery classifies native v1 facts into the four required states and never invokes a
   tool.
9. Transcript backfill cannot create journal facts and journal classification ignores reconstructed
   context facts.
10. Relevant unit, native SQLite, failpoint, and real process restart tests pass.
11. Existing Context Tape, loop, permission, and deferred execution regression suites remain green.
12. No remote Git operation is performed.
13. Generic append and fork merge cannot create native `execution/*` facts, and a Journal commit
    attempted inside a host transaction fails before writing.
14. Journal failures cannot leave the Session generating or claimed inputs unsettled, while cleanup
    never fabricates an uncommitted terminal projection.
15. A deferred terminal-commit failure after T1 cannot replay the approved interaction in-process
    or after restart, and its parking projection does not publish a Run terminal state.
16. A completed background process session retains conversation ownership until explicit cleanup or
    utility-host expiry, so cleanup mutations remain authorized without allowing cross-conversation
    access.
17. A fallback terminal-commit failure retains both failure causes and its concrete Journal error
    classification.
18. Compaction order correction preserves indicator fact semantics for shifted placeholders, and
    summary checkpoint manifests cite only the anchor that supplied the summary.
19. Repeated compaction and a subsequent backfill do not append duplicate tool facts, while a real
    tool content revision still supersedes the previous effective fact.
20. Compaction shift reads only affected message IDs in bounded batches and recall derives tool
    order from an effective message with a legacy payload fallback.
21. Synchronous startup recovery loads payload rows only for native Runs that have `run_started` and
    no `run_terminal`; terminal Runs and unrelated Context Tape rows are excluded by SQLite.
22. A durable tool outcome contains a response hash and error bit but no response text or temporary
    offload path.
23. The harness-internal tool execution port requires `commitDispatch` in its type contract, while
    lower-level tool APIs retain optional callbacks for non-Journal callers.

## Constraints

- Journal writes remain synchronous with the existing SQLite transaction model so no asynchronous
  gap is introduced between a fact commit and its local side-effect boundary.
- The strict writer requires transaction ownership. A caller must commit T1 after local preflight
  and before opening its mutation transaction; the writer rejects an already-active host transaction.
- The tool subsystem receives a per-call commit callback, not a global Tape dependency.
- Fact payloads are canonical, versioned, and bounded. Raw invocation arguments, terminal error
  strings, tool response text, structured MCP envelopes, temporary file paths, and binary data are
  not duplicated.
- Synchronous recovery reads are restricted to native Runs without a terminal fact and use a
  dedicated index. It can repeatedly report an unterminated Run because v1 has no durable
  acknowledgement or retention state.
- Complete historical corruption auditing is not part of synchronous startup. If required, it must
  run outside launch or use a separately designed durable checkpoint that cannot hide unaudited
  history.
- Every commit requires an unstaged and staged diff review, severity-ordered findings, relevant
  validation, and correction of identified issues before commit.

## Non-Goals

- Exactly-once execution without target-side idempotency support.
- Automatic retry or automatic reconciliation of indeterminate calls.
- A separate operations table or mutable journal state machine.
- Per-operation invocation-attempt identities or automatic retry under the same provider or nested
  operation identity. Journal v2 adds independently journaled nested children; `childOrdinal`
  identifies one child operation, not an attempt.
- Multi-writer continuation fencing or cross-process Run ownership.
- A TaskRun envelope, graph scheduler, or replacement of the current harness.
- Atomic delivery or automatic redelivery of sibling results after a parallel tool batch fails. That
  requires a separate durable batch-delivery contract; v1 may retain committed sibling outcomes
  without projecting them when another sibling fails closed.
- Redesigning Context Tape, effective views, anchors, recall, ViewManifest, transcript storage, or
  provider attempt journaling.
- GitHub issue creation, pull request creation, branch push, or release work.

## Resolved Questions

None. Any future automatic reconciliation policy requires a separate design because it changes the
current fail-closed recovery contract.

## Approved Execution Journal v2 Extension

Journal v2 adds nested Programmatic operations without rewriting v1. Existing provider operation
identity retains its v1 meaning. Readers discriminate:

```text
provider operation: (runId, requestSeq, providerToolCallId)
nested operation:   (runId, requestSeq, providerToolCallId, childOrdinal)
```

`childOrdinal` is an independent child operation, not an attempt. It is bounded, allocated in
canonical batch plan-array order before any child approval/T1, never reused, and never assigned by
the caller, materialized data, or completion order. The controller reserves the complete contiguous
ordinal-to-step/template mapping process-live before execution. Canonical nested payload includes
real target, `definitionHash`, `argumentsHash`, and
`capabilityHash`; same identity with different payload is corruption. Provider and nested operations
still have no attempt identity or same-identity automatic retry. Historical v1 rows are not migrated.

Provider Context records only the outer exec call/result. Nested operations are real Journal/UI and
approval facts parented to that outer provider operation, never fabricated provider-native Context
facts. Mandatory causality is outer T1, child preflight/approval, child T1, physical call, child T2,
nested finalized projection, canonical outer result, outer T2, then transcript/model/UI. Child T1
requires parent T1; child creation is forbidden after outer T2; every child T1 requires T2 before
outer T2; all operations are forbidden after `run_terminal`. For a Run containing a Programmatic
outer operation, terminal commit additionally requires outer T2 and a matching T2 for every outer or
nested T1. Unmatched T1 forbids outer T2 and `run_terminal`, leaving the Run unterminated and parked
for startup recovery. Duplicate T1 prevents physical repeat.

A process-live parent-operation controller and settlement receipt enforce this across the CLI
boundary; stdout is not authority. Nested Journal persistence failure or corruption is Run-fatal,
not a CLI stderr/exit result. Every child independently rechecks frozen Programmatic membership,
definition drift, TaskContract typed meet, effect/workdir/depth ceilings, current authority,
permission/approval, quotas, and abort before T1.

The per-View capability exists before any provider tool-call ID. Runtime derives a separate
invocation grant when the outer exec operation is known. A token prepared for process environment
injection remains unarmed until a newly created parent T1 receipt activates the grant; parent T1
failure revokes it and prevents spawn. Programmatic CLI execution cannot yield, detach, or complete
outer T2 while its local-control request or a started child remains unsettled. The settlement receipt
binds the canonical outer-result hash rather than trusting shell stdout.

Known success/error receives T2. Pre-T1 denial/cancel creates no child fact; pending approval stays
before T1. Post-T1 cancellation receives T2 only for a known outcome, otherwise remains
indeterminate. T1-only is parked. A crash does not recover the batch controller. All children having
T2 while outer T2 is absent remains incomplete and is not automatically projected. Explicit model
retry creates a new provider operation and identities. Exception name `AbortError` alone remains
insufficient cancellation evidence.

A deterministic refusal before child T1 may yield a known outer error without a child fact. A child
Journal write failure/corruption is Run-fatal; it may settle the outer operation only if the Journal
remains trusted and can durably record that exact outer outcome. No fallback terminal may hide an
unmatched Programmatic T1.

Journal v2 persists canonical hashes, status, and bounded provenance only. Raw arguments, response
or error text, MCP envelopes, binary data, and temporary paths are excluded, matching the detailed
v1 payload-minimization contract.
