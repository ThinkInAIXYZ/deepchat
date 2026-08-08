# Durable Execution Journal Implementation Plan

## Architecture

The implementation adds a pure Execution Journal domain model, a strict Tape application service,
and narrow runtime capabilities. Context Tape and Execution Journal share the physical
`deepchat_tape_entries` table but have different persistence contracts.

```text
DeepChat loop / deferred executor
  -> ExecutionJournalWriter (strict, synchronous)
  -> TapeEntryStore transaction
  -> immutable execution/* event

Tool execution
  -> per-call commitDispatch callback
  -> final resolved Agent/MCP boundary
  -> target invocation

Startup
  -> ExecutionJournalRecoveryReader
  -> pure classifier
  -> diagnostic report with parked disposition
  -> existing interrupted-message projection
```

The application service owns identity-to-provenance derivation, canonical payload construction,
strict idempotency comparison, parsing, and classification. Generic Context Tape append methods
reject the reserved `execution/*` namespace; the strict writer uses a dedicated storage method that
accepts only the four protocol event names. That method is exposed through a dedicated Journal
persistence port and is absent from the generic `TapeEntryStore` port. Fork merge excludes the
entire reserved namespace.

`SessionTape` is process-lived while the Session SQLite connection can be closed and reopened by
import, encryption, and maintenance flows. The Journal service therefore receives a lazy store
provider and resolves it for every commit and recovery scan, matching the existing Context Tape
provider pattern. No store object backed by a concrete SQLite handle is cached across reopen.

## Domain Model

Create `src/main/tape/domain/executionJournal.ts` with:

- protocol and event-name constants;
- Run and operation identity types and validators;
- typed inputs and durable payload types for the four fact families;
- canonical operation identity hashing;
- row parsers that reject malformed or unsupported native facts;
- a pure recovery classifier and report types;
- typed persistence and corruption errors.

Operation provenance keys use a stable prefix plus a SHA-256 hash of the canonical identity tuple.
Run facts use the UUID run identity directly in their source and a hashed provenance key. Event
payloads repeat structured identity fields so rows remain self-describing and independently
auditable.

## Strict Writer

Create an Execution Journal application service over the existing Tape providers. Each commit:

1. validates and canonicalizes the typed input;
2. builds the exact expected event row fields and payload;
3. enters the existing synchronous SQLite transaction;
4. reads by provenance key;
5. returns `{ created: false }` only when every identity-bearing and payload field is canonically
   identical;
6. throws a typed corruption error when the key exists with different fields;
7. otherwise appends a non-idempotent event and returns `{ created: true }`.

An append/storage failure is wrapped with fact identity context and propagated. The service does not
log-and-continue. Canonical hashing and strict row equality use the same null-prototype JSON
implementation, including rejection of non-finite numbers, sparse arrays, accessors, `undefined`,
and symbol keys.

The writer verifies that no host transaction is active before beginning its own transaction. This
prevents an outer rollback from erasing a receipt after the execution path has treated it as durable.
Callers perform local read/validation preflight, commit T1, then enter their synchronous mutation
transaction without an intervening asynchronous boundary.

Extend the Tape capability ports with:

- `ExecutionJournalWriter` for Run and operation commits;
- `ExecutionJournalRecoveryReader` for startup classification;
- `DeepChatLoopTapePort` composition of the writer capability.

`SessionTape` delegates these methods to the new application service. No tool handler receives the
facade or raw store.

## Storage Query

Add a dedicated Journal-store query and covering event index. SQLite first identifies native
`run_started` rows that have no matching `run_terminal`, then returns only the four v1 fact names for
those Runs in deterministic order. Historical terminal Runs, Context Tape rows, and their payloads
never cross the storage port during synchronous startup. Recovery parsing treats malformed facts in
the selected Runs as corruption instead of skipping them.

The anti-join still examines the compact Run-identity index, but startup payload parsing and memory
are proportional only to unterminated Runs. No mutable operations or open-Run table is introduced.
If measurements later require constant-time enumeration, that state must be a rebuildable projection
of Tape facts rather than a second authority.

## Run Identity And Lifecycle

Replace the loop runner's process-local sequence ID with `crypto.randomUUID()`.

Normal loop ordering becomes:

```text
local Run construction and preflight
  -> commit run_started
  -> register Run
  -> execute provider/tool loop
  -> commit run_terminal
  -> transcript/status/hooks/UI terminal projection
```

`processStream` receives the narrow writer through its I/O collaborators. Terminal settlement
commits exactly one of `completed`, `paused`, `aborted`, or `error` before calling the current
finalizers. If a post-terminal projection throws, the committed terminal fact is retained and no
conflicting terminal fact is attempted. Committed error and aborted fallback terminals are projected
through their matching finalizers, and the committed outcome takes precedence over the shape of the
projection error. Completed or paused terminal projection failures only clear transient runtime
state because the outer coordinator cannot reconstruct their full output.
If `run_started` or `run_terminal` persistence itself fails, the coordinator releases queued claims
and clears transient status without fabricating transcript/UI terminal evidence, then propagates the
Journal error. When Run execution and its fallback terminal commit both fail, a fresh typed error
retains both causes and preserves a concrete corruption classification without mutating either
captured error object.
Steer claims are the exception to release: their user messages are already durable and visible, so a
Journal failure consumes the claim to prevent duplicate replay. Cancellation classification is based
on the owned abort signal, never only on an exception name.

Deferred execution distinguishes a committed error terminal from a terminal commit failure. A
committed error terminal follows the normal error finalizer. If the terminal itself did not commit,
the interaction coordinator does not write terminal metadata/status or publish terminal events. A
pre-T1 failure leaves the approval available for an explicit retry. A post-T1 failure parks all
interactions on the message, projects only a committed T2 result or an indeterminate diagnostic into
the still-pending message, and keeps a replay guard across runtime cleanup and rehydration until the
Session is deleted.

## Tool Dispatch And Outcome Flow

Define the harness-internal execution options as `ToolCallOptions` with a required per-call
`commitDispatch` callback carrying:

- source (`agent` or `mcp`);
- normalized arguments;
- resolved tool name;
- resolved target metadata.

The loop creates the callback from the current operation identity. It marks the operation as
dispatched only after a newly created T1 receipt. An identical existing claim throws before target
invocation so an in-process retry cannot repeat the effect.

Only the internal `ToolExecutionPort.execute` contract requires this capability. Lower-level tool
services retain an optional callback because host-initiated reads and other non-Journal execution
paths remain valid. The adapter therefore forwards the typed options without a redundant runtime
presence gate.

MCP invokes the callback after argument preparation and the final policy, server, binding, client,
target, and abort checks, immediately before `targetClient.callTool`.

Agent handlers invoke the callback after their local schema, permission, path, target, session,
availability, duplicate, tombstone, and no-op checks, immediately before a persistent mutation,
process spawn, provider call, browser call, scheduler mutation, or delegation mutation. Pure reads
and local interaction tools do not claim a dispatch. When a lower service owns the final decision,
the handler forwards a once-only boundary and that service invokes it at the first actual effect.
For a local target sharing the Tape SQLite connection, T1 is committed outside the host transaction
after read preflight and immediately before the synchronous mutation transaction begins.

Handlers with a bounded internal fallback keep one operation identity in v1, but the dispatch hash
must cover the complete resolved invocation plan before the first target call. In particular, shell
execution records both an RTK-rewritten command and its capability-error fallback when that fallback
is possible. Process handlers validate the final spawn cwd before committing dispatch. A permission
response after dispatch is a protocol violation: commit it as a known error outcome, then fail the
Run closed instead of retrying or projecting it as an ordinary permission pause.

After execution, the loop normalizes and prepares the result. If T1 was committed, it commits T2
before the harness applies the finalized result to conversation messages, assistant blocks,
transcript, or UI. Live progress, runtime activation, and other events emitted inside an Agent tool
belong to the target invocation itself and can occur between T1 and T2; a crash in that interval is
classified from the resulting T1-without-T2 evidence.
The strict writer hashes the prepared response and persists only that hash and the error bit.
Response text and temporary offload paths remain with the projection consumer and are never persisted
as Journal facts.
Harness-owned skill activation occurs after T2. Activation failure is a projection/context failure
and cannot rewrite a successful target response as an error outcome. It still stops the current Run
so the next provider request cannot proceed with an outcome that claims activation while runtime
context lacks the activated Skill.
Thrown target errors are known error outcomes and receive T2. Abort or process loss before a known
result intentionally leaves T1 without T2. Permission retries clear prior attempt results before the
approved attempt begins, while a target result that has already returned is retained if cancellation
arrives during local result preparation.

Pre-dispatch `invalid_fact` errors caused by one model-controlled call are converted into that call's
refusal and do not prevent unrelated calls in the same batch. Journal persistence, corruption,
duplicate dispatch, and any post-dispatch Journal error bypass normal tool-error conversion and fail
the Run closed. They also take precedence over concurrent cancellation when parallel tool outcomes
are collected. A committed outcome receipt must be newly created; an existing receipt is treated as
a protocol violation before projection.

Parallel batches do not gain atomic result delivery in v1. If one sibling fails closed after other
siblings committed T2, their staged results can remain undelivered. The journal preserves those
known outcomes, but replaying them or exposing a durable delivered/not-delivered state requires a
separate batch-delivery contract.

## Deferred Execution

Approved deferred execution performs local tool/session resolution first, then creates a fresh UUID
Run with request sequence `1`. It commits `run_started`, passes the same real-boundary T1 callback,
commits a prepared T2 when dispatched, and commits a terminal fact before returning the result to
the interaction coordinator for transcript projection.

Permission responses that occur before dispatch terminate the physical deferred Run as `paused`
without fabricating T1 or T2. An ordinary pre-dispatch execution failure terminates it as `error`.
A later approval starts another physical Run.

## Startup Recovery

Harness construction reads and classifies journal facts before wiring the runtime graph and before
pending transcript messages are recovered. Classification is deterministic and never calls a tool:

- `not_dispatched`: native Run start with no dispatch;
- `completed`: every native dispatch has exactly one matching native outcome;
- `indeterminate`: at least one dispatch has no outcome;
- `corruption`: malformed, unsupported, conflicting, or orphaned facts.

Only native v1 journal event names are inputs. Transcript rows, legacy backfill facts, tool block
facts, provider attempt events, and model text cannot raise the evidence level.

The first version logs at most 100 bounded, control-character-sanitized candidate details plus a
classification summary and retains the existing interrupted-message projection. Corruption details
are ordered before indeterminate and other incomplete Runs so the display cap cannot hide the most
severe evidence. `indeterminate` and `corruption` remain parked; no replay or retry path is added.

Startup classification also returns Session-scoped message identities whose incomplete Runs are
`completed`, `indeterminate`, or `corruption`. Pending transcript recovery force-recovers those
messages even when they still contain an actionable interaction, closing the restart replay path
after a deferred parking projection could not be persisted. `not_dispatched` messages retain their
resumable interaction because no T1 exists.

The v1 recovery query uses an indexed anti-join over Run identities and loads fact payloads only for
Runs with a start and no terminal. Classification memory is proportional to those Runs and their
operations, not total Journal history or persisted response size. V1 has no durable acknowledgement
or retention state, so an unterminated Run can produce the same bounded startup diagnostic on later
launches.

Synchronous startup is not a permanent global corruption audit. Malformed facts belonging to a
selected unterminated Run remain fail-closed, while corruption hidden behind a terminal Run requires
an explicit offline/background audit. A later audit, acknowledgement, archive, or compaction design
must remain derivable from immutable facts; an arbitrary row limit is not an acceptable substitute.

Recovery normalizes inherited non-interaction `pending` or `loading` blocks to errors before a new
Run begins. Pending permission and question blocks remain resumable. A current Run still fails loudly
if it attempts to project a paused terminal with unresolved non-interaction work.

## Transcript Order Corrections

Compaction can insert a status message at an existing transcript `orderSeq` and shift later rows by
one. The shift and a Context Tape replacement for every affected message run in the same SQLite
transaction before the compaction indicator is inserted. Shift replacements use provenance that
includes the resulting order so multiple shifts within one clock tick cannot collapse into one
idempotent row. Effective Tape and transcript ordering therefore remain identical after compaction,
resume, or steer insertion. A replacement for a compaction placeholder preserves its excluded
`message/compaction_indicator` event shape rather than creating a normal assistant message fact.

Replacement writers receive an explicit revision kind. Record revisions retain the existing
updated-at identity, while order revisions add the resulting `orderSeq`; neither provenance rule is
inferred from the reason text or correction metadata. Order-shift materialization fetches only the
captured message IDs in batches of at most 500. Each batch also bounds the normalized child-table
queries, and all batches execute synchronously inside the existing outer transaction.

An order-only replacement appends the corrected message or compaction-indicator fact but does not
rewrite its tool call/result facts. Effective views project tool `orderSeq` from the corresponding
effective message and use the persisted tool payload value only when no effective message can be
resolved. Existing payloads and provenance keys remain unchanged. When changed content returns to a
previous payload hash, the new fact keeps the legacy hash prefix and adds the effective entry it
supersedes so the append cannot resolve to the older revision.

Reconciliation builds a map of the current effective tool revision by logical tool identity. Its
semantic fingerprint includes kind, name, terminal status, and every persisted tool payload field
except `orderSeq`. A backfill candidate equal to that current content is skipped; a changed candidate
is appended and becomes the new effective revision. Comparing only with the current revision is
required so a legitimate A -> B -> A content change is not mistaken for an old duplicate.

Synthetic summary checkpoint contributions cite the reconstruction anchor entry only when that
anchor carries the same normalized summary. This keeps ViewManifest lineage auditable without
attributing a legacy or otherwise unrelated summary to the latest anchor.

## Completed Process Session Reconciliation

The main process retains completed utility-process session ownership so the owning conversation can
clear, kill, or remove a completed session without opening cross-conversation access. A single
unref'ed reconciliation timer queries each affected conversation at the utility host's cleanup
cadence and removes local completed entries only after the host confirms they are absent. Explicit
remove remains idempotent when host TTL cleanup wins the race, while transport and unrelated host
errors continue to propagate.

## Test Strategy

### Pure Unit Tests

- operation identity validation and collision-safe key derivation;
- parser rejection for malformed and unsupported facts;
- all four recovery classifications;
- outcomes without dispatch, facts without Run start, duplicate terminals, and session mismatch;
- response/argument payload hashing and bounded data rules.
- strict canonical JSON rejection and `__proto__` preservation in both write and equality paths.

### Native SQLite Tests

- identical strict commit is idempotent;
- conflicting strict commit throws and preserves the original row;
- dispatch commit failure propagates and prevents the supplied target callback from running;
- unterminated-Run query uses the intended index and excludes terminal Runs and Context Tape events;
- outcome facts retain a response hash without persisting response text or an offload path;
- restart-style reconstruction from persisted rows.
- reserved namespace guards, fork exclusion, and rejection of commits inside host transactions.
- bounded compaction-shift message materialization under the portable SQLite parameter limit.
- repeated order shifts followed by reconciliation without tool fact growth.

### Runtime Tests

- UUID Run creation and run-start-before-registration ordering;
- explicit record/order replacement modes and order-derived tool recall refs;
- tool content revisions remain append-only and supersede the prior effective revision;
- MCP validation/policy/target failures produce no T1;
- MCP T1 precedes the target call and duplicate T1 prevents a second call;
- representative Agent mutation boundaries produce the same ordering;
- T2 precedes harness-owned finalized result projection for success and known failure;
- T2 failure prevents projection;
- committed error and aborted outcomes select their matching finalizers even when projection throws;
- a parallel sibling failure leaves earlier T2 facts intact without claiming atomic batch delivery;
- terminal commit precedes every terminal projection and failure prevents projection;
- terminal fallback failure preserves the Run error, commit cause, and Journal corruption subtype;
- deferred approval uses a new Run and obeys the same ordering;
- startup classification runs before interrupted transcript recovery, loads only unterminated Runs,
  and never executes tools;
- internal tool execution requires its dispatch capability at compile time and forwards it unchanged;
- Run-start and terminal persistence failures release claims and clear transient status without
  fabricating terminal projections;
- deferred terminal-commit failure after T1 consumes and guards the approval without writing Run
  terminal metadata/status/events, and startup recovery cannot expose it for replay;
- cron, process, memory, and delegation no-op/refusal paths produce no T1, while their first actual
  side effect follows T1;
- completed process sessions retain owner metadata until explicit cleanup or confirmed utility-host
  expiry, while cross-conversation mutations remain rejected;
- completed process-session ownership is periodically reconciled with the utility host, and a
  cleanup request remains idempotent when the host already removed the completed session by TTL;
- closing and reopening the Session database does not invalidate later Journal commits;
- compaction insertion that shifts transcript order produces matching effective Tape order;
- visible steer claims are consumed when the next Run cannot commit `run_started`;
- concurrent cancellation cannot turn deferred Journal parking into an aborted terminal projection;
- projection failure followed by runtime cleanup cannot make a parked deferred tool replayable;
- target outcomes commit before skill activation, and activation failure cannot change T2;
- non-user `AbortError` exceptions remain errors unless the owned signal is aborted;
- inherited unresolved non-interaction blocks are normalized before resume/pause projection.

### Crash Tests

Add deterministic failpoints immediately inside/outside T1, T2, and terminal boundaries. A native
child-process test sends `SIGKILL`, reopens the same SQLite database, runs classification, and proves
the expected evidence state. Platform-gate the real signal test where necessary while keeping pure
and native SQLite coverage portable.

## Validation

Run the smallest relevant suites during implementation, then before handoff run:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm exec vitest run <relevant Tape, loop, tool, deferred, and harness suites>
```

Run native SQLite tests through the repository's documented native test command or environment
gate. Report any platform-gated crash test separately.

## Commit Strategy

1. Architecture SDD.
2. Execution Journal domain, strict Tape service, storage query, and focused tests.
3. UUID Run identity plus normal loop T1/T2/terminal integration and tests.
4. Agent/MCP resolved-boundary coverage and tests.
5. Deferred execution, startup classification, crash tests, and architecture documentation updates.

Before each commit, review unstaged and staged diffs for hidden side effects, compatibility,
boundary conditions, performance, security, naming, test gaps, and maintenance cost. Fix findings,
rerun relevant validation, then commit with a concrete Conventional Commit message. Do not push.
