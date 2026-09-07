# Tape Contract Lineage Specification

## Status

V1 implementation and local validation are complete. This architecture extends DeepChat's existing
Tape, provider View, and live-delegation execution planes with explicit task and execution contracts.
Automatic repair/retry/override and ReplaySlice expansion remain deferred. The implementation does
not add a second scheduler or make Tape an online permission service.

Last reviewed: 2026-08-09.

## Decision

DeepChat will represent agent contracts at two lifetimes:

- `TaskContract` freezes stable task semantics for one live-delegation turn;
- `ExecutionContract` records and constrains one provider-visible View.

The contracts form one lineage without sharing one physical record. A TaskContract is an
append-only Tape fact plus a runtime projection. An ExecutionContract is embedded in the existing
`view/assembled` fact because it has the same identity and lifetime as that View.

Runtime remains the online authority. Runtime never reads Tape on the tool-dispatch hot path.
Canonical values are constructed once and passed through request assembly, enforcement, and
persistence. Recovery may rebuild runtime projections from persisted facts.

## Motivation

DeepChat can currently prove which messages and provider-visible tool definitions formed a View,
but it cannot prove the section-level source of the system prompt, the internal execution policy
that accompanied provider-visible tools, or the Handoff format contract applied to a delegated result.
Live delegation asks child Sessions to return a structured Handoff, but terminal settlement only
requires a non-empty answer and silently falls back when expected sections are absent.

That gap prevents a parent Agent from distinguishing a structurally valid child Handoff from a
malformed one. It does not let the host determine whether the child's claims are correct. The View
gap also makes historical provider requests difficult to explain and compare.

## Goals

1. Record the exact structured prompt, capability, dynamic-control, and provenance inputs used by
   every contract-bearing DeepChat child View.
2. Enforce the immutable capability ceiling associated with the exact View that produced a tool
   call while continuing to honor current runtime revocation.
3. Freeze one durable TaskContract for every new live-delegation turn.
4. Hand the canonical TaskContract to the child by value and persist an inherited copy in the
   child Tape before provider dispatch.
5. Produce one explicit evaluation for every terminal settlement of a contract-bearing turn.
6. Atomically persist the evaluation fact, live-delegation projection, and terminal mailbox event.
7. Surface Handoff format status through existing parent-facing orchestration operations.
8. Preserve old View manifests and live-delegation rows without retroactive evaluation.

## Non-Goals

- Automatic format repair, task retry, or result override.
- A third contract layer for Agent configuration.
- A new replay store or replay authority.
- Deterministic replay with copied prompt or tool payload bodies.
- Generic workflow execution, recursive Subagents, or scheduler policy.
- Treating a contract hash, Tape fact, or ReplaySlice as online permission authority.
- Retrofitting terminal historical turns with evaluations they never received.

## Domain Model

### TaskContract

A TaskContract is stable for one live-delegation turn and contains the four task inputs described by
tape.systems:

- `taskSchema`: task/result structure and contract schema versions;
- `taskConfig`: stable task-level configuration and consumer-driven retry mode;
- `taskDescription`: title, prompt, scope, slot, and target identity;
- `taskHarness`: Handoff format requirements and host-enforced behavioral ceilings.

The persisted V1 field remains named `taskHarness.acceptance` for feature-branch schema
compatibility. Its only producer is the fixed Handoff format requirement below; the field name does
not represent task success or parent acceptance.

For a contract-bearing child, every per-View ExecutionContract ceiling must be less than or equal
to the stable Task Harness ceiling. A later View may narrow that maximum but cannot expand it.

TaskConfig v1 records `creationReason=delegation_created|legacy_recovery`. Compatibility recovery
uses `legacy_recovery` with no retroactive Handoff format requirements, so a recovered contract remains
distinguishable without adding a second runtime flag.

V1 supports one Handoff format requirement kind: `required_sections`, a list of required level-two
Markdown section names. Requirements compose conjunctively. A named section is valid only when its
heading is recognized outside a Markdown fence and its body is non-empty. This check proves Handoff
shape only; it does not prove task completion, factual correctness, or parent acceptance. Missing
candidate data, cancellation, or interruption makes format status `indeterminate`. Any semantic
change to Markdown section extraction, evidence normalization, or format-status reduction must bump
`evaluatorVersion`.

The canonical contract excludes timestamps, entry IDs, and origin references from its content hash.
Its identity is the canonical JSON value plus a versioned SHA-256 hash.

V1 applies these UTF-8 persistence limits before mutation:

- canonical TaskContract: 128 KiB, including at most 64 Handoff format requirements;
- canonical ExecutionContract: 64 KiB, including at most 256 tool identities and 64 prompt sections;
- canonical evaluation projection: 32 KiB, including at most 64 bounded reason/evidence records.

### TaskContract Reference And Inheritance

The parent freezes `contract/task_frozen` in its Tape in the same SQLite transaction that creates
the live-delegation turn. The turn row stores the same canonical value and its origin reference as
the runtime projection.

Before sending the child Handoff, DeepChat appends the same canonical value to the child Tape as
`contract/task_frozen`, with an `originRef` containing:

- parent Session ID;
- parent Tape identity;
- parent entry ID;
- TaskContract hash.

The inherited append is idempotent and strict. It records that the child received that contract; it
does not copy parent transcript history. The child provider request cannot begin until the inherited
fact is durable. The child runtime consumes the passed value or its local projection and never
performs a hot-path parent Tape lookup.

Tape reset creates a new incarnation and invalidates the old physical reference. When a parent or
child contract reference no longer matches the current incarnation, the contract service may append
the same hash-verified canonical value from the turn projection into the new Tape and atomically
replace only the runtime reference. The new fact records `projection_recovery` provenance and the
superseded reference. It does not change task semantics or invent a new contract. Re-anchoring must
complete before child provider dispatch or terminal evaluation; otherwise the turn remains
recoverable and non-terminal.

### ExecutionContract At View

Every schema-v5 ViewManifest embeds one ExecutionContract with three structural groups:

- `ceilings`: provider-visible tool identities, reviewed effect ceiling, normalized workdir binding,
  and Subagent nesting ceiling;
- `dynamicControlSnapshot`: View-time permission and admission/cancellation observations;
- `provenance`: prompt sections, provider/model identity, effective generation-config hash,
  provider-visible tool-definition hash, internal execution-policy hash, source hashes, and
  assembler version.

Prompt sections record stable kind, source reference, inclusion state, content hash, and bounded
degradation codes. Omitted or degraded contributions remain visible without copying their source
body into the manifest.

The final provider payload and the ExecutionContract are immutable siblings. The same contract
value is retained by the loop run and passed to tool dispatch. A session-global "latest contract"
cache is forbidden because retries, tool rounds, steering, and concurrent Session work make it an
ambiguous authority.

If a tool batch pauses for a host permission interaction, its action projection stores the complete
View request identity and contract hash while the Session runtime retains the exact contract value.
Normal continuation uses that runtime value without reading Tape. After process restart, the host
may reconstruct the value only from the single hash-verified schema-v5 ViewManifest named by the
binding. A present binding with a missing, duplicate, malformed, or conflicting View fails closed;
legacy interactive projections without a binding retain their existing compatibility behavior.

### Runtime Enforcement

Effective authority is a typed meet:

```text
effectiveCapability = meet(frozenCeilings, currentRuntimeAuthority)
```

Meet semantics are field-specific:

- sets use intersection;
- numeric maxima use `min`;
- side-effect classes use the declared partial order;
- a View workdir must be within the TaskContract workdir at construction, and dispatch requires the
  current normalized Session workdir to equal the exact frozen View workdir;
- dynamic controls use the current runtime value and are not frozen ceilings.

The schema retains the field name `workspace`, but V1 uses it only as a workdir identity and stale-
View guard. It does not inspect tool arguments, establish a filesystem sandbox, or prove that a tool
cannot access paths outside that directory. Tool-specific path authorization remains a separate
runtime responsibility. Any workdir change requires a new View before another tool dispatch.

An expansion of a ceiling takes effect only in a later View. Permission, cancellation, admission,
Session deletion, and revocation remain live controls and may immediately tighten or relax according
to their existing host contracts.

### Evaluation And Settlement

Execution status and Handoff format status are independent axes:

```text
executionStatus = completed | failed | cancelled | interrupted
evaluationKind  = handoff_format
formatStatus    = valid | invalid | indeterminate
```

A successfully generated but format-invalid answer remains `executionStatus=completed` and leaves
the delegation `idle`, so the parent may inspect the untrusted evidence and explicitly start a new
follow-up turn. `formatStatus=valid` never means that the delegated task succeeded or that the parent
accepted the child's conclusion.

For each contract-bearing terminal turn, the settlement transaction must:

1. append `contract/evaluated` to the parent Tape;
2. store the same canonical evaluation value and fact reference on the turn projection;
3. update turn and delegation execution state;
4. append the terminal mailbox event.

The transaction uses the existing MainDatabase connection. `contract/*` has a reserved strict
writer that may participate in a host transaction. It must not reuse ExecutionJournalService,
whose external-effect facts intentionally reject host transactions.

The evaluation idempotency identity includes the turn ID, TaskContract hash, candidate-result hash
or explicit absence marker, and evaluator version. An existing identity with different canonical
content is corruption, not a successful retry.

Current writers emit evaluation content schema v2 with hash recipe v1 and evaluator
`handoff-format-v1`. Feature-branch databases may contain the earlier schema-v1
`task-contract-v1` value. That value remains read-only: DeepChat verifies its original canonical
hash and keeps its evaluation ref and `contract/evaluated` Tape fact unchanged, then projects only
the production-reachable required-section evidence into the current parent-facing Handoff format
summary. A repeated terminal settlement may recognize the same legacy fact by turn, contract,
execution status, and complete candidate identity, but it must not replace the fact or append a new
mailbox event. Dormant legacy result-schema evaluations had no production producer and remain
unsupported rather than being reinterpreted as Handoff evidence. Evaluation ref schema v1 and the
`contract/evaluated` fact envelope/provenance version remain unchanged.

### Parent Visibility

The Tape fact is historical evidence, not a model-facing delivery mechanism. Existing
`wait`, `inspect`, and `read_result` projections expose:

- `evaluationKind`;
- `formatStatus`;
- bounded reason codes and evidence references;
- `evaluationRef`.

The existing child-result envelope carries these structured fields outside untrusted child text.
Parent-initiated `follow_up` creates a new turn and a new TaskContract that references the prior
evaluation. The predecessor reference must name the same parent Session as the new TaskContract; a
cross-Session reference is invalid provenance. A follow-up is not an automatic replay of the
previous attempt.

## Write Disciplines

| Fact/path | Failure policy | Transaction rule |
| --- | --- | --- |
| Interactive `view/assembled` | fail-open with bounded diagnostic | independent append before request |
| Contract-bearing `view/assembled` | fail-closed | durable before provider request |
| `execution/*` | fail-closed | independent commit across external-effect boundary |
| parent `contract/task_frozen` | fail-closed | same transaction as turn creation |
| child inherited `contract/task_frozen` | fail-closed | durable before child Handoff dispatch |
| `contract/evaluated` | fail-closed | same transaction as terminal projection/event |

This table describes write disciplines, not a count of all Tape event families.

## Compatibility

- ViewManifest schemas 1 through 4 and their historical hash versions remain readable.
- Contract-bearing DeepChat child writes use ViewManifest schema 5 and manifest hash version 3.
  Ordinary interactive chat and ACP compatibility use schema 4 and do not construct or enforce an
  ExecutionContract. Contract-bearing DeepChat child requests never take that fallback.
- New live-delegation contract/evaluation columns are nullable for historical rows.
- Historical terminal turns remain readable with no evaluation; no facts are fabricated for them.
- Hash-valid schema-v1 `task-contract-v1` evaluations written by earlier feature heads remain
  readable without rewriting their projection, reference, mailbox copy, or Tape fact. New writes
  use evaluation content schema v2.
- A legacy active turn without a TaskContract must freeze a compatibility contract before it may
  resume. That contract records `legacy_recovery` provenance and does not retroactively impose new
  required sections on already-started work.
- A contract-bearing terminal turn without an evaluation is invalid and remains recoverable rather
  than silently committing a terminal state.
- A reset parent or child Tape re-anchors the hash-verified runtime projection into the new
  incarnation before the next strict contract boundary.
- A contract-bearing queued turn with a bound idle child and no `startedAt` may resend its Handoff
  after restart: the existing write-ahead protocol records `startedAt` before crossing delivery, so
  its absence proves that delivery did not begin. Legacy rows without a contract keep the existing
  interruption behavior.
- Ordinary interactive chat keeps its current non-blocking ViewManifest failure behavior.

## Security And Privacy

- Contract manifests store hashes and bounded source references, not secrets, raw headers, or copied
  prompt source files.
- Tool ceilings use stable tool target identity, not only a model-visible name.
- Runtime revalidates current permission, workdir identity, Session lineage, and tool authority
  immediately before dispatch.
- Child output remains untrusted even when its Handoff format is valid.
- Error projections use bounded reason codes and sanitized messages.

## Acceptance Criteria

1. Every successfully assembled contract-bearing DeepChat child View has a schema-v5 manifest
   containing a verifiable ExecutionContract built from the exact request inputs; ordinary
   interactive chat and ACP compatibility retain their documented schema-v4 behavior without an
   ExecutionContract.
2. Tool dispatch receives the exact View contract and rejects a tool outside its frozen ceiling even
   when current runtime authority would otherwise permit it.
3. Current revocation still interrupts or rejects active child work before dispatch.
4. Interactive manifest persistence remains fail-open; contract-bearing child Views fail closed
   before provider execution.
5. Every new live-delegation turn atomically stores a parent TaskContract fact and runtime projection.
6. Child execution cannot start until the same TaskContract is durably inherited into the child Tape.
7. Every terminal contract-bearing turn atomically stores evaluation fact, turn projection, state
   transition, and mailbox event.
8. Handoff format failure does not rewrite successful provider execution as an execution failure.
9. Parent-facing orchestration results expose evaluation kind, format status, and evaluation identity.
10. Old manifests and historical delegation rows remain readable without fabricated evaluations.
11. Contract namespace conflicts, idempotency conflicts, dangling origin identity, and malformed
    projections fail closed on automated-consumer paths.
12. Permission pause and continuation preserve the originating View contract; restart recovery
    validates the durable binding against exactly one schema-v5 View before deferred dispatch.
