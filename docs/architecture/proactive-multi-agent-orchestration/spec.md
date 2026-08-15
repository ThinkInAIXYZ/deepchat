# Proactive Multi-Agent Orchestration Specification

## Status

Active. DeepChat has one Subagent execution plane: durable live delegation through child Sessions.
The unreleased QuickJS-based durable Workflow runtime is retired before merge.

Last reviewed: 2026-08-15.

## Decision

DeepChat's user goal is adaptive multi-Agent collaboration: the parent Agent may decompose a task,
start bounded child work, steer or follow up with those children, inspect durable results, and
synthesize the answer. That goal does not require a Subagent-specific JavaScript executor. The
separate Code Mode exposes the same host-owned Subagent tool directly alongside its code entrypoint;
the JavaScript runtime does not own child lifecycle or create another orchestration runtime.

The product therefore keeps:

- the session-level `explicit | proactive` orchestration policy;
- the `deepchat_subagents` model tool and durable live-delegation repository;
- first-class child Sessions, Tape lineage, result references, and bounded Handoffs;
- process-wide owner-fair admission, effect evidence, and Session deletion fencing;
- the inline and activity projections for live child work.

The product retires before release:

- the `deepchat_workflow` model tool and JavaScript authoring contract;
- QuickJS/WASM execution and its Electron utility process;
- saved Workflows, Workflow launch approvals, replay, retry, and synthesis;
- Workflow runs, invocations, routes, events, panels, and persisted tables.

`Ultra` may be used as a product label for proactive collaboration. It is not a persisted state or
runtime type. Internal state continues to describe stable behavior as `explicit | proactive`.

## Product Contract

DeepChat exposes one user-facing proactive-collaboration control. It changes delegation policy,
not model depth or generation settings.

- `explicit`: starting new child model work requires current user confirmation. Read-only control
  and cancellation operations remain available without another confirmation.
- `proactive`: enabling the control is standing Session authorization for the parent to start and
  follow up with bounded children when independent work materially improves quality or latency.

Both policies allow direct parent execution. Proactive mode does not require delegation for simple,
latency-sensitive, or strongly sequential work.

Reasoning effort, model selection, temperature, Top P, output limits, and reasoning visibility are
independent of orchestration policy. Changing one must not silently mutate the other.

## Single Execution Plane

The parent orchestrates direct child Sessions through `deepchat_subagents` operations:

- `spawn`: create and start one bounded child task;
- `send`: persist a non-triggering message for an existing child;
- `follow_up`: start a later child turn;
- `list` and `inspect`: read durable state;
- `read_result`: page through a referenced canonical child answer;
- `wait`: receive bounded mailbox updates;
- `interrupt`: explicitly stop active work.

Agent, Code, and Minimal modes expose the same tool as a direct model tool when it is enabled. In
Code Mode it appears alongside `run_code`, or alongside the Codex `exec` and `wait` entrypoints, but
is excluded from the generated JavaScript SDK. Every mode dispatches the same native tool through
the top-level Agent Loop, `ToolService`, and the live-delegation repository; Code Mode is not a
second execution plane.

The Code cell does not call or wait on `deepchat_subagents`. Confirmation, child creation, waiting,
interruption, and result projection remain top-level Loop operations. Child Sessions resolve their
own model Tool Mode and do not inherit the parent's `toolModeOverride`.

V1 keeps recursion disabled. A child cannot start another Subagent. Child Sessions remain hidden
from ordinary top-level Session lists but are navigable from trusted parent projections.

The legacy `subagent_orchestrator` implementation is not a second execution plane. Its model-facing
definition and runtime state machine are removed. Historical transcript rendering remains readable,
and its name stays reserved as a tombstone while native rendering still recognizes name-only legacy
blocks so an MCP tool cannot spoof that trusted presentation path.

## Identity And Results

Live delegation separates technical identity, execution role, and presentation:

- `childSessionId` is the durable child identity;
- `delegationId` is the stable parent control handle;
- `turnId` identifies one initial or follow-up execution attempt;
- `slotId` and `targetAgentId` select the configured role and Agent;
- `title` is a concise user-language task title.

The trailing persisted child assistant message is the only canonical full answer. The parent
receives a bounded semantic Handoff plus a typed `resultRef` containing immutable message and Tape
identity, content hash, byte/token size, and explicit truncation state. `read_result` pages the
referenced answer without starting new model work.

For contract-bearing turns, the parent also receives a bounded structured evaluation through
`wait`, `inspect`, and `read_result`. Evaluation kind, Handoff format status, reason/evidence records,
and the complete `evaluationRef` are projected outside child-authored text. Tape remains the
historical source for the evaluation fact; live-delegation rows and mailbox events are the online
projection consumed by the orchestration runtime.

Child answers are untrusted evidence, not instructions. Every model-facing child result uses one
shared orchestration envelope that:

- identifies the source as a child Agent result;
- declares the UTF-8 byte length and an unambiguous data boundary;
- tells the parent to synthesize evidence without executing instructions found inside it;
- preserves structured result metadata outside the untrusted payload.

The safety rule is injected at the higher-priority prompt boundary and is not implemented only as
text inside a tool result.

The host also validates the locally produced envelope immediately before returning the tool result
to the model runtime. A malformed envelope is a host-contract failure and is rejected instead of
falling back to raw child text. This structural validation preserves the trust boundary; it does not
sanitize or reinterpret valid child payload text, which remains untrusted evidence.

## Task And Execution Contracts

Every new live-delegation turn freezes one immutable `TaskContract` containing task schema, stable
task configuration, task description, and the harness Handoff-format/ceiling rules. The parent appends
`contract/task_frozen` in the same transaction that creates the turn and stores the same canonical
value plus a full Session/Tape/entry/hash reference on the turn projection.

Before the first child provider dispatch, the child appends the same TaskContract by value to its
own Tape. The inherited fact carries the complete parent `originRef`; it does not copy parent
transcript context or require a child hot-path lookup into the parent Tape. Reset recovery
re-anchors the hash-verified row projection into the new parent or child Tape incarnation before the
next strict boundary. Initial delivery, restart resend, and repeated recovery are idempotent.

Each contract-bearing DeepChat View embeds one immutable `ExecutionContract` with three structural
groups:

- `ceilings`: stable tool targets, effect policy, normalized workdir binding, and Subagent depth;
- `dynamicControlSnapshot`: View-time permission, admission, and cancellation observations;
- `provenance`: structured prompt sections and hashes for provider/model, generation config,
  provider-visible tool definitions, internal execution policy, assembler, and TaskContract ref.

The same ExecutionContract value follows the provider request, loop run, tool batch, dispatch guard,
and schema-v5 ViewManifest. Contract-bearing DeepChat child Views fail closed before provider
dispatch when the manifest or TaskContract binding cannot be persisted. Ordinary interactive chat
and ACP compatibility continue to use schema-v4 manifests without ExecutionContract construction or
dispatch enforcement.

Terminal settlement validates the persisted complete child answer against the required level-two
Markdown Handoff sections. It keeps execution and format status independent:

```text
executionStatus = completed | failed | cancelled | interrupted
evaluationKind  = handoff_format
formatStatus    = valid | invalid | indeterminate
```

A format-valid result only proves the required sections have non-empty bodies. It does not prove
task completion, factual correctness, or parent acceptance. A generated answer with invalid format
remains `completed` and returns the delegation to `idle`, allowing an explicit parent `follow_up`.
Every contract-bearing terminal settlement atomically appends `contract/evaluated`, updates the turn
and delegation projections, and emits the terminal mailbox event with the same canonical evaluation.
If that transaction cannot complete, the turn remains recoverable rather than becoming terminal
without an evaluation.

## Consent And Permissions

Host enforcement, not prompt wording, owns delegation consent.

- Under `explicit`, `spawn` and `follow_up` require native confirmation because they start model
  work and consume additional resources.
- Under `proactive`, the Session-level control is standing authorization for those operations.
- Code Mode invokes `spawn` and `follow_up` as ordinary top-level tool calls. Under `explicit`, the
  existing Agent Loop confirmation path pauses and resumes that tool call without involving a Code
  cell.
- `send`, `list`, `inspect`, `read_result`, `wait`, and `interrupt` do not start model work and do
  not require orchestration confirmation.
- Every child tool call still follows the ordinary DeepChat permission broker. Proactive mode does
  not grant filesystem, network, shell, or external-service permissions.
- A cross-Agent child receives the least-authority composition of the parent Session and target
  Agent policies: permission modes are intersected, disabled built-in tools are unioned, and MCP
  allowlists are intersected with a missing list treated as unrestricted. The host applies the
  same composition to catalog construction and execution-time MCP dispatch, and a missing parent
  or unreadable child policy fails closed. Assignment, catalog, and execution use one pure authority
  composer; each boundary supplies every persisted and configured parent/child source it owns.
- Tool dispatch additionally computes a typed meet between the exact View's frozen ceilings and
  current runtime authority. Tool sets intersect, numeric maxima use `min`, effect classes choose the
  more restrictive value, and the current normalized Session workdir must exactly match the frozen
  View workdir. This workdir binding rejects stale Views after a directory change; it is not
  argument-level path authorization or a filesystem sandbox. Frozen ceilings cannot expand within
  a View; permission mode and other dynamic controls use the current runtime value and may tighten
  or relax according to their existing host contract.
- Tool-catalog context records the immutable Session kind. A successfully identified regular
  Session may bypass Subagent composition until that context is cleared, but an unknown or known
  Subagent identity that can no longer be resolved fails closed. Execution checks current authority
  before recording effect intent and again immediately before dispatch, so an already-disabled tool
  does not create false write evidence while concurrent revocation remains conservative.
- The tool permission broker issues an execution-bound confirmation receipt after an explicit
  approval. `spawn` and `follow_up` pass that receipt into the live-delegation service, which
  re-reads the current Session policy before mutation. An `explicit` Session rejects a missing,
  mismatched, or stale receipt even when a caller bypasses the model-tool adapter; a `proactive`
  Session needs no per-call receipt because its Session policy is the standing authorization. The
  receipt is claimed around the synchronous repository mutation, consumed only when persistence
  succeeds, and released when persistence rejects. Creation returns its persisted projection from
  the same transaction, so a post-commit projection read cannot be misclassified as a retryable
  failed mutation.

Generation settings and safety state have different lifetimes:

- model and generation settings are frozen when each child turn starts;
- permission mode, workdir identity, Session deletion, and capability revocation are checked
  continuously and take effect for active work;
- the host revalidates safety before authorization, immediately before tool dispatch, and before a
  suspended child resumes; a permission change between authorization and dispatch fails closed;
- changing a child workdir clears remembered grants and stages `default` permission before crossing
  the boundary, so a partial update cannot retain broad authority over either workdir;
- changing proactive policy controls future `spawn` and `follow_up` operations. Existing work
  remains visible and explicitly interruptible.

## Admission And Waiting

Process-wide admission limits actively running child computation, not durable lifecycle occupancy.
A child waiting for permission or a user answer must not hold a global running permit indefinitely.

Admission therefore exposes a state-aware lease:

- dispatch acquires a permit with cancellation support;
- transition to a host-owned waiting state suspends the lease;
- continuation reacquires before computation or a protected tool action resumes;
- interruption and terminal settlement release the lease exactly once;
- per-parent active-child limits remain separate from the process-wide running limit and are
  enforced atomically with both initial-turn and follow-up persistence;
- mailbox waits retain a process-wide safety ceiling plus a per-parent fairness ceiling, so one
  Session cannot exhaust every waiter slot.

Owner fairness prevents one Session from monopolizing queued capacity. It does not replace correct
lease suspension.

## Follow-Up Mailbox

Non-triggering messages use UTF-8 byte budgets at the repository boundary. `send` applies atomic
backpressure before a message can make the pending mailbox exceed its bounded capacity.

`follow_up` consumes pending messages only in the same transaction that persists a prompt containing
those messages or an explicit recovery notice. If the follow-up task leaves no room for either, the
transaction rejects and keeps every pending message unread; the host never silently consumes data.
Compatibility handling for malformed or oversized unreleased rows must otherwise converge instead
of repeatedly rolling back on the same data. Character-count validation must not claim to enforce a
byte limit.

A follow-up is a new turn with a newly frozen TaskContract. Its task configuration cites the prior
`evaluationRef` from the same parent Session; it does not mutate the previous contract, replay the
previous Run identity, or reinterpret a format-valid child claim as trusted. Cross-Session
predecessor references fail canonical contract validation.

Child-to-parent terminal events are a durable cursor stream and remain available until their parent
Session is deleted. Only already-consumed parent-to-child messages may be compacted without a
persisted reader cursor; an arbitrary row-count window must not discard unread completion events.

## Persistence And Migration

The live execution plane owns:

- `live_delegations`;
- `live_delegation_turns`;
- `live_delegation_events`.

The Workflow tables are removed:

- `workflow_invocations` is dropped before `workflow_runs`;
- every `trg_workflow_*` trigger is removed before its referenced table;
- the Workflow definitions are removed from the schema catalog only after the forward cleanup is
  defined.

The commits that introduced schema versions 57 and 59 exist only on `feat/workflow-runtime`; they
are absent from every tag and from `origin/dev` and `origin/main`. The unreleased history may
therefore be simplified so version 59 adds `orchestration_policy` directly without creating the
short-lived `orchestration_mode` column.

Databases that ran the feature branch may already record version 63. Version 64 is a forward-only
decommission migration that removes Workflow artifacts and preserves monotonic schema history. The
code must never lower the latest schema version below a version already observed by those databases.

Version 65 adds nullable, bounded TaskContract, parent/child reference, and evaluation projection
columns to `live_delegation_turns`. Version 66 adds the bounded evaluation value/reference projection
to `live_delegation_events`, so a parent mailbox consumer receives the same Handoff format status
without querying Tape. Existing rows remain valid with null contract/evaluation fields; historical terminal
turns are not assigned fabricated evaluations.

Schema version numbers are monotonic high-water marks. Upgrade paths record intentionally empty
versions so abandoned numbers cannot be reused later. Database import and encryption migration use
the same dependency-aware table-copy planner, including trigger-enforced dependencies that SQLite
does not expose through foreign-key metadata.

## UI Contract

The compact composer control continues to display reasoning effort. Proactive collaboration is
communicated through the branch icon, accent, tooltip, and accessible pressed state without adding
`Workflow` to the button label.

The popover contains independent reasoning and proactive-collaboration sections. Reasoning controls
are gated by model capability, not by orchestration capability or DeepChat executor ownership.

The Agent activity surface and inline cards project the same revision-aware live-delegation state.
They show title, role, status, bounded preview, child navigation, interruption, and interaction
discovery. The activity surface revalidates from the durable repository when mounted or when its
Session changes; IPC events are an optimization, not a second authority or the sole terminal-state
delivery path.

For a Code Mode caller, `deepchat_subagents` keeps its direct Subagent tool card and durable activity
surface. The code wrapper only shows cell and nested-call summaries and never becomes a second
progress authority.

Workflow panels, saved Workflow commands, launch approvals, and `/workflow` are removed.

## Compatibility And Safety

- Direct ACP Sessions and child Sessions cannot enable proactive collaboration.
- Existing released Sessions default to `explicit`; intent is never inferred from disabled tools.
- Existing feature-branch databases migrate forward through version 66; pre-contract rows remain
  readable with nullable projections.
- ViewManifest schemas 1-4 remain readable. Contract-bearing DeepChat child schema-v5 manifests bind
  one ExecutionContract to the exact request and fail closed on a missing or conflicting binding;
  ordinary interactive chat and ACP continue to write schema 4 without an ExecutionContract.
- Legacy active turns freeze an explicit `legacy_recovery` contract before continuation. Historical
  terminal turns remain unevaluated; a contract-bearing terminal turn without an evaluation is
  invalid and remains recoverable.
- Historical `subagent_orchestrator` transcript blocks remain renderable but cannot start the old
  in-memory batch executor. The legacy name remains reserved only as a renderer trust tombstone.
- Generic MCP tools remain reachable unless their names collide with an active native tool or an
  explicitly documented historical-renderer tombstone.
- Code Mode exposes `deepchat_subagents` only as a direct top-level tool. It is absent from the
  generated subtool binding, so cell waiting and cleanup cannot capture Subagent lifecycle.
- Session deletion fences new delegation and child creation before runtime cleanup, drains active
  work, and then removes the stable child tree.
- V1 does not promise exactly-once external effects or automatic parallel-writer isolation.

## Acceptance Criteria

1. The persisted policy is `explicit | proactive`, defaults to `explicit`, and is independent of
   all generation settings.
2. `deepchat_subagents` is the only model-facing Subagent execution tool.
3. No QuickJS, Workflow runtime, saved Workflow, Workflow route/event, or Workflow UI surface ships.
4. Schema version 64 removes Workflow triggers and tables, and versions 65-66 add nullable bounded
   contract/evaluation projections without regressing released or feature-branch databases.
5. Explicit policy requires host confirmation for `spawn` and `follow_up`; proactive policy is
   standing authorization for those operations.
6. Child tool permissions remain governed by ordinary permission mode and live safety state.
7. Child answers reach the parent only through the shared untrusted-result boundary and typed
   result-reference contract.
8. Pending follow-up messages cannot exceed their UTF-8 repository budget or permanently poison a
   delegation.
9. Waiting children do not indefinitely consume process-wide running permits and reacquire before
   protected work resumes.
10. Live child work remains durable, restart-reconciled, inspectable, interruptible, and navigable.
11. The old `subagent_orchestrator` executor is removed while historical transcript rendering stays
    compatible.
12. Reasoning controls remain available whenever the selected model supports them, independently
    of proactive-collaboration availability.
13. Every new delegation turn freezes a parent TaskContract, and the child durably inherits the
    same value before provider dispatch without reading the parent Tape on its hot path.
14. Every contract-bearing DeepChat child View carries one schema-v5 ExecutionContract and enforces
    the typed meet of its frozen ceilings with current runtime authority.
15. Every contract-bearing terminal settlement atomically persists one evaluation fact, turn and
    delegation projections, and mailbox event; execution status remains independent from Handoff
    format status.
16. `wait`, `inspect`, and `read_result` expose bounded structured evaluation metadata outside
    untrusted child text.
17. Code Mode exposes `deepchat_subagents` directly beside its code entrypoint and excludes it from
    the generated subtool binding; confirmation and durable child state remain owned by the top-level
    Agent Loop.

## Non-Goals

- Adding a Subagent-specific JavaScript runtime or durable Workflow executor.
- Deterministic script replay, saved Workflows, or programmatic pipeline persistence.
- Binding proactive collaboration to maximum reasoning effort.
- Requiring delegation for every substantive task.
- Automatically merging parallel code edits or creating Git worktrees.
- Allowing recursive Subagent trees in V1.
- Making direct ACP backends participate in DeepChat-owned local orchestration.
- Treating Tape as the mutable scheduler or promising exactly-once side effects.
- Adding a batch/fan-out DSL before ordinary multi-call spawning proves insufficient.
- Automatically repairing, retrying, or overriding a parked result in V1.
- Treating ReplaySlice or a contract hash as a second online authority.

## Reconsideration Triggers

Durable declarative automation should be reconsidered only after observed product demand for at
least one of these capabilities:

- unattended recurring execution outside an active conversation;
- resumable topology across application restarts;
- user-owned reusable automation exposed through an API or scheduler;
- programmatic data flow that cannot be represented by adaptive parent/child turns.

If that demand appears, prefer a bounded typed host-owned graph before reintroducing a
Turing-complete guest runtime. QuickJS is justified only when arbitrary control flow is itself a
validated product requirement.
