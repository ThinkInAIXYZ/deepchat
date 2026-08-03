# Proactive Multi-Agent Orchestration Specification

## Status

Active. This architecture supersedes the session-level `adaptive | workflow` executor switch in
the Workflow Runtime feature. The durable Workflow runtime remains an execution strategy; it is no
longer the user-visible orchestration mode.

Last reviewed: 2026-08-03.

## Problem

DeepChat currently models orchestration as a mutually exclusive session choice:

- `adaptive` exposes `subagent_orchestrator`;
- `workflow` hides `subagent_orchestrator` and exposes the durable `workflow` tool.

That state conflates two different questions:

1. whether the parent Agent may proactively delegate work;
2. whether a particular task should use live delegation or a durable Workflow program.

It also makes the enabled state behave unlike the product contract it communicates: enabling the
purple orchestration indicator removes the direct Subagent capability that is best suited to most
small and medium multi-Agent tasks.

The existing `subagent_orchestrator` is a bounded batch runner, not a complete live orchestration
control plane. Its run registry is process memory, it cannot steer an existing child with a
follow-up turn, and its orchestration state cannot be reconstructed after restart even though the
child Session and Tape survive.

## Product Contract

DeepChat exposes one user-facing **proactive collaboration** switch. The switch controls policy,
not an executor.

- `explicit`: the parent may delegate only when the user, an applicable project instruction, or an
  applicable Skill explicitly requests Subagents, parallel Agent work, or a Workflow.
- `proactive`: the parent may independently delegate when bounded parallel or isolated work would
  materially improve speed or quality.

Both policies keep reasoning and generation settings independent. Changing collaboration policy
must not change reasoning effort, model, temperature, Top P, token limits, permissions, or enabled
tools.

The parent chooses one of three paths for each turn:

1. complete simple or strongly sequential work directly;
2. use live delegation for a few adaptive tasks that benefit from steering or follow-up;
3. prepare a durable Workflow for large fan-out, programmatic data flow, repeatability, explicit
   approval, or recovery.

Proactive collaboration grants permission to choose these paths; it does not require a Subagent or
Workflow for every request.

## Terminology And State

The canonical session field is:

```ts
type OrchestrationPolicy = 'explicit' | 'proactive'
```

`workflow` is not a policy value. It remains:

- a durable execution strategy;
- a model-facing capability;
- a saved user-owned asset;
- an activity and recovery surface.

The current `adaptive | workflow` persisted state migrates as follows:

- `adaptive` -> `explicit`;
- `workflow` -> `proactive`.

New Sessions default to `explicit`. Existing released Sessions that predate the field also default
to `explicit`; no historical disabled-tool setting is used to infer proactive intent.

The physical Session column is renamed from `orchestration_mode` to `orchestration_policy` in a
forward migration. Compatibility normalization accepts the two historical values only at database
and import boundaries; new shared contracts, routes, and renderer state never expose them.

## Execution Strategies

### Direct parent execution

The parent answers or uses ordinary tools without delegation. This remains the expected path for
simple, latency-sensitive, or tightly sequential requests.

### Live delegation

The parent remains the orchestrator and controls independent child Sessions through lifecycle
operations:

- spawn a bounded child task;
- send a non-triggering message;
- submit a follow-up task that triggers a child turn;
- list and inspect child state;
- wait for mailbox updates;
- interrupt active child work.

Children remain first-class DeepChat Sessions with isolated context and independent Tape. The
parent receives bounded summaries and completion notifications instead of complete child
transcripts. V1 keeps Subagent recursion disabled and does not allow parallel writers with
overlapping workspace ownership.

The completed child assistant message is the only canonical copy of a live-delegation answer.
Runtime process logs, reasoning, tool responses, and action blocks are not result content. A
completed turn persists a typed result reference to the immutable child message and frozen Tape
head plus a bounded semantic handoff for the parent. It never copies the full answer into the
delegation repository or mailbox.

The handoff is a child-authored `## Handoff` section when present, with legacy `## Result` and the
final answer as deterministic fallbacks. It has an approximate 2,000-token semantic budget and a
16 KiB protocol ceiling. Truncation is explicit metadata, never silent. The complete answer remains
available through the stable child Session and a parent-authorized, cursor-based `read_result`
operation. Reading an existing result is distinct from `follow_up`, which always starts new model
work.

Each live delegation separates technical identity, execution role, and human presentation:

- `childSessionId` is the durable child identity;
- `delegationId` is the stable parent control handle;
- `turnId` identifies one initial or follow-up execution attempt;
- `slotId` and `targetAgentId` select the configured role and Agent;
- `title` is a concise, user-language task title generated by the parent Agent.

The task title describes action and scope rather than identity. Parent guidance asks for distinct
sibling titles and rejects role-only, ordinal, or person-like labels such as `Reviewer`, `Agent 1`,
or `Alice`. Runtime validation enforces only bounded display safety; duplicate titles do not affect
identity and must not reject otherwise valid work. V1 does not add a second semantic task key,
canonical Agent path, or decorative nickname because direct-child control already uses the opaque
delegation identity.

### Durable Workflow

The parent authors an internal JavaScript orchestration program and prepares a native approval.
After launch, the QuickJS utility process owns loops, branching, pipelines, and intermediate
values. The Workflow repository owns durable replay, retry, budgets, and recovery.

The JavaScript is internal IR. Users provide natural language and may reveal source only through
an advanced disclosure. Saved Workflow files remain explicit user-owned assets.

## Shared Child Invocation Kernel

Live delegation and durable Workflow remain separate state machines and repositories. They share a
narrow child invocation kernel responsible for:

- global owner-fair admission and cancellation while queued;
- immutable execution snapshots;
- capability and workspace checks;
- correlated child Session creation;
- message handoff and runtime tracking;
- permission and question projection;
- cancellation and terminal settlement;
- usage accounting;
- write-ahead effect classification;
- frozen-head Tape lineage;
- bounded parent result delivery.

Final-answer projection is one shared runtime primitive. It selects the trailing assistant content
after the last process/tool boundary and excludes reasoning, tool responses, plans, actions, and
errors. Live delegation and durable Workflow child tracking must not maintain incompatible notions
of a child answer.

The shared kernel must not decide orchestration topology, replay identity, Workflow call paths, or
live follow-up policy.

## Tape Boundary

Tape is the append-only execution evidence layer, not the scheduler.

Each child owns an independent Tape. Parent lineage records a frozen child head; child entries are
not copied into the parent. The parent may read only authorized direct-child evidence through
existing Tape view rules.

The orchestration repositories remain authoritative for mutable run state, queues, deadlines,
budgets, retry decisions, and UI projections. Tape evidence supports audit and recovery decisions
but cannot prove that an external side effect did not occur before a crash. Write-ahead effect
classification therefore remains mandatory before a bound child tool executes.

## Model-Facing Policy

When multi-Agent capabilities are available, the parent receives a developer-level policy message
for the current Session:

- `explicit` revokes any earlier proactive delegation instruction and requires explicit intent;
- `proactive` permits delegation only when it has clear independent, isolated, or parallel value.

The model may see both the live-delegation and durable-Workflow capabilities. Tool availability
must not encode which executor the parent is required to choose.

Built-in orchestration functions use DeepChat-specific model-facing names so enabling both
capabilities does not globally shadow an unrelated MCP function named `workflow`, `spawn_agent`, or
another generic lifecycle verb. Presentation may still call the feature Workflow or Subagents.
Legacy tool blocks produced by the unreleased branch remain readable by the native renderer parser.

The policy prompt includes a stable decision contract:

- direct work for simple or sequential tasks;
- live delegation for a few adaptive tasks;
- durable Workflow for large, programmatic, recoverable, or reusable orchestration;
- never delegate merely to demonstrate that proactive mode is enabled;
- never run overlapping write-heavy children in a shared workspace.

## Workflow Authoring Contract

JavaScript remains the single durable Workflow IR. DeepChat does not introduce a second persisted
JSON graph in this architecture.

The runtime API is versioned and has one canonical definition that generates or verifies:

- runtime Zod contracts;
- model-facing JSON Schema and concise signatures;
- authoring examples;
- source semantic validation;
- runtime bindings.

Preparation is split into two conceptual phases:

1. compile and validate source without resolving a Session or generation snapshot;
2. bind the compiled source to a main-resolved workspace, capability scope, execution snapshot,
   limits, and budget.

Source diagnostics must identify the helper, expected shape, and source location when possible.
Invalid source must fail before a native approval is registered. Host-owned generation snapshots
must be normalized to bounded JSON and must not contain explicit `undefined` values.

## UI Contract

The composer continues to show the current reasoning label. Proactive collaboration is represented
by the branch icon and accent color, with an accessible label and tooltip. The compact button does
not concatenate `Workflow` with the reasoning label.

The popover contains independent sections for reasoning and proactive collaboration. User-facing
copy describes additional Agent, latency, token, and resource use.

`/workflow` opens or explicitly prepares Workflow functionality; it does not change session
policy. `/workflow <name>` prepares a saved Workflow without changing the policy.

One Agent activity surface projects live delegation and durable Workflow runs while preserving
their distinct legal controls.

Every trusted `deepchat_subagents` spawn remains visible at the point of delegation instead of
being collapsed into generic tool history. Its inline projection shows the semantic task title,
configured role, live status, bounded result or error preview, and an explicit entry to the stable
child Session as soon as that Session is bound. Active work may be interrupted from the same card.
Raw tool parameters and responses remain available through a secondary disclosure.

UI preview, model handoff, and full answer are separate projections. Cards keep a short preview;
mailbox completion carries a bounded handoff; opening the child Session shows the canonical full
answer. Context pressure may reduce a mailbox response to a result reference, but must not turn a
successfully persisted child result into a failed turn.

The inline card and Agent activity surface consume one renderer-side projection backed by the
typed list route and live change event. The main-process repository remains the only authority;
transcript blocks provide immutable delegation correlation and an initial snapshot, not a second
mutable status store. Ordinary Session lists continue to hide child Sessions so background work
does not pollute the user's top-level chat history. The child view remains read-only for ordinary
conversation mutation and exposes a back-to-parent action. A pending child permission or question
is the sole exception: the child view renders the existing typed interaction response surface so
the user can unblock work without enabling composition, editing, retry, or deletion. While input is
required, parent projections promote their existing child-navigation control to the primary action;
they do not duplicate the child interaction or become another response authority.

Session deletion coordinates with live delegation before runtime and Session storage cleanup. A
parent or bound child being deleted interrupts and drains every related active turn through the
same lifecycle path used by an explicit parent interruption. Cleanup remains best-effort so an
orchestration failure cannot leave the user-visible Session row undeletable. The write-ahead
dispatch transition is projected immediately; delivery acceptance remains a distinct in-memory
fact used by terminal and Tape settlement.

## Compatibility And Safety

- Direct ACP Sessions and child Sessions cannot enable proactive collaboration.
- Existing DeepChat regular Sessions migrate without inferring intent from disabled tools.
- Existing `subagent_orchestrator` callers retain a compatibility path until lifecycle controls are
  stable; the model must not see both overlapping live-delegation surfaces in the same turn.
- Generic same-name MCP tools remain reachable because built-in orchestration functions use
  DeepChat-specific names instead of global reservation.
- Existing Workflow run rows, immutable source snapshots, approvals, and recovery remain readable.
- A policy change affects subsequent parent turns only. Active children and launched Workflows use
  their immutable execution snapshot.
- One process-wide admission layer applies to both execution strategies, with strategy-local caps.
- Session deletion interrupts related active delegation work before removing runtime or durable
  Session state, without making orchestration cleanup a deletion gate.
- V1 does not promise exactly-once external effects or automatic parallel-writer isolation.

## Acceptance Criteria

1. The persisted session contract is `explicit | proactive`, defaults to `explicit`, and migrates
   the unreleased `adaptive | workflow` values deterministically.
2. Reasoning changes and orchestration-policy changes remain independent in state, IPC, UI, and
   execution snapshots.
3. A regular parent can access live delegation and durable Workflow capabilities without mutually
   exclusive executor routing.
4. Explicit policy prevents proactive delegation through a developer-level instruction while
   honoring explicit user, project, and Skill requests.
5. Proactive policy allows the parent to choose direct work, live delegation, or Workflow based on
   task shape.
6. Live child work can be listed, followed up, waited on, interrupted, and reconciled after restart
   through durable parent-child identities.
7. Both execution strategies use shared admission, immutable settings, permission boundaries,
   effect evidence, and Tape lineage.
8. Invalid Workflow helper shapes and non-JSON execution snapshots fail before approval with
   actionable diagnostics.
9. The composer displays reasoning independently and communicates proactive collaboration through
   icon, accent, tooltip, and accessible state.
10. Existing saved Workflows and durable Workflow history remain usable.
11. Every trusted live-delegation spawn has a persistent inline task projection that follows live
    status, opens its stable child Session, preserves raw tool disclosure, and remains visible after
    ordinary reasoning/tool activity is collapsed.
12. Live-delegation task titles follow the task-first naming contract without introducing another
    routing identity or decorative nickname.
13. Child process output and tool responses never contaminate the live-delegation result; the
    canonical full answer remains in the child Session and the parent receives a bounded,
    explicitly truncated handoff with a stable result reference.
14. An authorized parent can page through the frozen result without starting another child turn;
    unrelated parents, mutable later child messages, and forged cursors cannot be read.
15. A waiting child permission or question can be answered from the read-only child view without
    broadening the child's conversation-mutation or permission policy.
16. Parent projections make a waiting child's navigation action prominent without persisting or
    routing another copy of the interaction.
17. Deleting a parent or bound child drains related live delegation work before Session cleanup,
    and write-ahead running state is visible before handoff delivery resolves.

## Non-Goals

- Binding proactive collaboration to maximum reasoning effort.
- Requiring delegation or a Workflow for every substantive task.
- Replacing the Workflow JavaScript IR with another persisted graph language.
- Automatically merging parallel code edits or creating Git worktrees.
- Allowing recursive Subagent trees in V1.
- Making direct ACP backends participate in DeepChat-owned local orchestration.
- Treating Tape as the mutable run-state database.
- Adding human persona names, canonical task paths, or nested Agent routing before recursive
  Subagents and cross-Agent addressing exist.
- Running a second model call merely to summarize a completed child answer.
- Treating an unbounded child answer as an ordinary parent tool result.
