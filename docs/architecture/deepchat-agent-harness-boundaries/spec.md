# DeepChat Agent Harness Boundaries

## Context

DeepChat's tool runtime already has a conservative parallel fast path, but the scheduling policy is
encoded in `dispatch.ts` as an Agent tool-name allowlist. That makes execution safety depend on a
string convention instead of the tool catalog that owns tool capabilities. A rename, replacement,
or new read-only tool therefore requires runtime knowledge that does not belong in dispatch.

This architecture goal establishes stable contracts around the DeepChat Agent harness over
multiple short-lived pull requests. The typed tool execution contract, the coordinator ownership
slice, and the Harness facade are complete. The current slice replaces the untyped hook fan-out with
a typed deterministic notification pipeline. Same-run steering remains a separate change, and hook
decision semantics remain an unscheduled product feature rather than part of this goal.

## Comparative Evidence

Pi places an optional `executionMode` on each Agent tool. Its loop executes a batch in parallel by
default unless global configuration or any tool requests sequential execution. This correctly puts
the capability on the tool, but its default-open policy is too permissive for DeepChat's mixed
built-in/MCP catalog, permission pauses, durable queue, and persisted tool settlement.

Bub's asynchronous executor applies `asyncio.gather` to every tool-call batch. It preserves input
result order and isolates declared tool errors, but it has no side-effect or scheduling contract.
That model cannot safely represent DeepChat tools that mutate files, settings, memory, Tape-visible
state, browser state, processes, or user interactions.

DeepChat will keep its existing fail-closed, all-or-nothing batch behavior while moving the
parallel decision from a name allowlist to an explicit catalog-owned contract.

Pi's useful runtime boundary is not its directory layout but the separation between its pure agent
loop, in-memory Agent lifecycle, persistent Harness, and Session facts. DeepChat already has the
equivalent lower layers in `DeepChatLoopEngine`, `LoopRun`, `DeepChatLoopRunner`,
`DeepChatAgentInstance`, and Session data. The remaining problem is the application orchestration
above them: lifecycle, pending-input admission, queue pumping, compaction, and projection still
route through one coordinator.

Bub likewise separates framework turn processing, Agent execution, and Tape, but its hook-first
pipeline does not model DeepChat's durable pending-input queue, interaction recovery, instance
replacement fencing, or renderer projection. This slice therefore adopts the ownership lesson,
not Bub's hook pipeline or execution semantics.

## Coordinator Ownership Slice

### Problem

`DeepChatRuntimeCoordinator` remains both composition root and implementation owner. Its child
coordinators depend on broad callback surfaces that route back to private methods on the parent.
Pending-input claim and drain mechanics are duplicated between the root and `TurnCoordinator`,
while active-run cleanup, abort settlement, status projection, and queue wakeup are spread across
initial turns, resumed turns, interactions, and manual compaction.

The result is structural rather than cosmetic coupling: changes to one lifecycle invariant usually
require coordinated edits across `DeepChatRuntimeCoordinator`, `TurnCoordinator`, and
`DeepChatLoopRunner`. Tests compound the coupling by reflecting private coordinator members through
type escapes, so moving an owner can fail only at runtime instead of at compile time.

### Ownership Model

`DeepChatAgentRuntime` remains the sole registry of hydrated instances and creates a minimal
`SessionRuntimeScope`. The scope is an identity capability, not a service locator:

```ts
interface SessionRuntimeScope {
  readonly sessionId: AppSessionId
  readonly instance: DeepChatAgentInstance

  state(): DeepChatSessionState | undefined
  isCurrent(): boolean
  assertCurrent(): void
}
```

Project-directory resolution, generation-setting resolution, Agent identity, hooks, stores, and
provider capabilities remain explicit collaborator dependencies. The scope must not cache or
duplicate mutable facts already owned by `DeepChatAgentInstance` or Session data.

Lifecycle ownership has four distinct fence semantics and must not collapse them into one generic
`ownsTurn()` predicate:

1. **instance fence**: the scope's instance is still the registry's current instance;
2. **run fence**: a `runId` still identifies the instance's active `LoopRun`;
3. **operation-controller fence**: a pre-stream or compaction `AbortController` still owns the
   current operation slot;
4. **message association**: an interaction or permission belongs to the expected assistant message
   or run.

One lifecycle owner may implement these predicates, but callers must use the specifically named
fence that matches their operation.

### Runtime Owners

- `RunLifecycleCoordinator` owns pre-stream controllers, active-run registration and cleanup,
  deferred-tool cancellation, explicit cancellation, terminal settlement, stale-run protection,
  pending-interaction projection, status transitions, and post-settlement queue wakeup. Mutable
  state remains on `DeepChatAgentInstance` and `LoopRun`.
- `SessionStatusPublisher` is the single projection path for a status transition. It preserves the
  existing order: `sessions.status.changed`, `sessions.updated`, internal session update, then UI
  refresh.
- `PendingInputAdmissionCoordinator` owns send/steer normalization, attachment acceptance lanes,
  capacity and interaction gates, queue mutation commands, steer promotion, explicit Queue resume,
  and interrupt requests. Listing pending inputs is a pure read.
- `PendingInputPump` owns steer-before-queue selection, per-session single-flight drain, claim,
  release, consume, process-local restart holds, recovery, and starting a claimed turn. Durable
  input records remain owned by `SessionPendingInputs`.
- `TurnCoordinator` continues to own the distinct initial and resume preparation algorithms, but
  delegates lifecycle settlement and pending-input disposition instead of mutating those owners
  through parent callbacks.
- `CompactionRuntimeCoordinator` expands to own manual compaction state and operation lifecycle in
  addition to its existing compaction projection; no parallel manual-compaction coordinator is
  introduced.
- `DeepChatRuntimeCoordinator` becomes a compatibility adapter and composition root. Moving wiring
  into a factory is allowed only after the callback graph is reduced; moving the existing callback
  graph unchanged does not satisfy this architecture goal.

### Pending Input Completion

Internal turn execution returns a typed completion that explicitly carries the disposition of a
claimed pending input. The disposition distinguishes consume, release-before-user-fact, and
rollback-after-user-fact semantics. The pump applies queue-state mutations; transcript, compaction,
and Memory rollback remains an ordered turn-settlement operation.

The pump and turn lifecycle form a real feedback loop. They communicate through narrow synchronous
`TurnStarter` and `PendingInputWakeup` interfaces wired by the composition root. An asynchronous
event bus is not used because claim settlement and the next drain must observe a deterministic
order. Public `MessageStartResult`, including `attachmentPreparation`, remains unchanged and is
mapped losslessly from the internal completion.

### Pending Input Restart Boundary

Harness construction reconciles active pending inputs before transcript recovery and before any
Session scope is hydrated. `SessionPendingInputs` returns the affected Session IDs and Queue input
IDs that must be held. It terminalizes unread Steer messages, their Tape replacements, and their
pending rows atomically instead of handing them to a later global recovery phase.

The pump installs Queue IDs in a process-local hold set. Automatic `enqueue` and `completed` wakes
stop at a held Queue FIFO head; pending-input listing and Session hydration never schedule a drain.
An explicit composer Send may start without releasing historical drafts. The typed
`sessions.resumePendingQueue` operation validates normal Session gates, releases the Session hold,
and drains with a `manual` wake reason. Before that manually resumed turn enters the provider Run,
the pump consumes its Queue claim; a returned provider error therefore cannot restore the same item
to Queue. Manual intent is tracked by Queue item ID, so attachment block and resolution cannot erase
that boundary. The pending-input list projects authoritative resume availability, and Resume returns
`false` without draining when no hold exists. Failures before the provider boundary still release
safely. Durable Queue rows remain the only ordering and content source, and a later restart derives
a new hold from whatever rows remain.

An unclaimed Steer belongs to the previous process's interrupted delivery attempt. Startup changes
its linked messages to retryable `error`, appends their Tape replacements, and consumes its pending
row in one transaction. The renderer hides its receipt and adds no recovery-specific action; the
standard message toolbar remains unchanged. A claimed Steer keeps its sent user message and exposes
the interruption through the assistant error. Neither path adds a persisted recovery marker, age
policy, schema migration, or hydration-triggered execution.

### Test Boundary

Before production extraction, tests stop reflecting private coordinator members. Existing cases
must assert public behavior or construct the new owner through typed test ports. This test-only
stage changes no production source and must pass the complete main-process suite.

Production extraction preserves all observable assertions except for the twelve corrections listed
in the next section. Tests may move to owner-specific suites or replace structural mocks with typed
ports, but expected status, event order, queue disposition, terminal persistence, hooks, Tape,
Memory, permissions, and public return values outside those corrections must not change. Each
correction requires a regression test that distinguishes its old and new behavior.

### Included Runtime Corrections

This ownership slice contains three explicit bug fixes, five corrections exposed while moving the
owning code, and four additional ownership defects found during full pull-request review. They
remain in this pull request because later extraction rewrote or relocated the same control flow, so
separating them now would require replaying and resolving the complete ownership refactor without
restoring an independently reversible change.

| Correction | Previous behavior | Required behavior and rationale |
| --- | --- | --- |
| Deferred tool progress | A deferred tool resumed from the interaction's pre-execution block snapshot and could overwrite progress or terminal data written while the tool ran. | Re-read the assistant message after deferred execution and continue only while the same pending interaction still exists. This preserves concurrent progress and refuses stale ownership. |
| Follow-up admission | Concurrent direct sends answering a completed tool question could both pass admission before the first turn established its durable claim. | Serialize send acceptance and permit only one immediate follow-up claim; later sends observe the first claim and remain pending. |
| Rejected live-send rollback | Releasing a claimed live send after its user fact was persisted left a visible user message and derived compaction or Memory facts for a turn that never started. | Roll back transcript, compaction, and Memory facts before releasing the claim, so retry never duplicates a visible turn. |
| Steer marker ownership | Adopting any steer claim unconditionally cleared the instance's active steer marker, including a newer marker installed concurrently. | Clear the marker only when its id matches the adopted claim, preserving a newer merge target. |
| Direct-steer ownership | A false drain result caused deletion unless the narrow draining/generating checks happened to be visible at that instant. | Retain the steer whenever its durable state or an active generation, controller, drain, or generating projection proves another owner accepted it. |
| Promoted-steer ownership | A false drain result restored a promoted steer even when another drain had already claimed or consumed it. | Restore only when no durable or runtime owner accepted the promoted steer. |
| Operation-controller ownership | Cleanup without an exact controller reference could clear a replacement operation's controller. | Treat an absent expected controller as a no-op; only the exact current controller may be cleared. |
| Follow-up/drain overlap | A direct follow-up could attempt a second immediate start while another pending-input turn owned the single-flight pump. | Keep the new input pending while another owner holds the instance-scoped drain lease. At every normal asynchronous yield point the draining turn already owns a claimed row, so the claimed-input gate also prevents a second start. The explicit lease check protects defensive or re-entrant observations; once the in-flight turn persists its user fact, transcript ordering removes the old follow-up marker and normal completion wakeup admits the pending input. A regression test constructs that conservative overlap and verifies admission after the transition. |
| Atomic drain ownership | Concurrent `drain()` calls could both pass the Boolean single-flight check before either call marked the instance as draining, claim different rows, and later clear each other's state. A wake arriving while the owner finalized could also be lost. | Acquire an instance-scoped drain lease synchronously before the first asynchronous state read and release it only with the exact owner token. Non-starting paths release locally; a launched turn transfers release ownership to its finalizer. Coalesce transient wake reasons only after the active claim has settled and the resulting Session status admits that reason, then replay them after lease release. Enqueues accepted while a turn is still generating continue to rely on normal completion wakeup, so an error leaves their backlog pending. The durable queue remains the sole input fact. |
| Non-hydrating readiness cleanup | Clearing `firstTurnReady` used `getOrCreateScope`, so cleanup after eviction could recreate a runtime instance with no active operation. | Clear readiness only on an already hydrated scope. Cleanup is a no-op after eviction and cannot resurrect Session runtime state. |
| Multi-message interaction cancel | Canceling recovered pending interactions terminalized only the first assistant message before dropping every interaction reference. | Terminalize every distinct assistant message represented by the pending interaction set, then clear the set and emit one Session terminal projection and queue wakeup. |
| Rolled-back terminal references | A thrown pending-input turn rolled back its user and assistant messages but retained their IDs, then attempted error persistence and emitted stream failure for deleted records. | Clear both IDs immediately after durable transcript rollback, including returned error results, so no terminal write, event, or public result references a deleted message. |

The last rule deliberately does not let ordinary queue-origin inputs bypass the tool-follow-up gate.
`PendingInputEnqueueSource` remains the admission distinction. The production invariant is the
durable claimed row plus the instance's single-flight drain marker, so no additional persisted fact
or second source of truth is introduced.

## Coordinator Ownership Goals

- Establish one explicit owner for Session identity, run lifecycle, status projection, pending-input
  admission, queue pumping, turn settlement, and compaction orchestration.
- Replace parent-private callback surfaces with concrete collaborators or narrow typed ports.
- Preserve every public contract and observable runtime ordering while making owner tests
  independently constructible.
- Leave a stable internal ownership model for the later Harness facade and typed hook reducer.

## Harness Facade Slice

### Problem

The coordinator ownership slice extracted lifecycle, admission, pump, and compaction owners, but
`DeepChatRuntimeCoordinator` remains the composition root, the implementation site for every
remaining cross-cutting session concern, and the only object every owner can reach. Its constructor
contains 72 arrow functions, and the class body still implements session initialization and
destruction, session-state hydration, Agent identity resolution, transcript mutation coordination,
message refresh projection, subagent tool-call progress, system prompt assembly, tool result
normalization, and auto-approve permission review.

Because those implementations live on the root, every extracted owner must accept a callback that
points back into it. The dependency graph is therefore a cycle rather than a layered runtime:
root creates owner, owner holds a closure over a root private method, and that method reaches a
different owner. The consequences are structural:

- Owners are not independently constructible, so runtime coverage concentrates in one 12918-line
  suite instead of owner suites.
- `DeepChatLoopRunnerPorts` (32 members), `TurnCoordinatorPorts` (26 members), and
  `InteractionCoordinatorPorts` (13 members) are wide because they must carry root helpers rather
  than collaborators.
- `DeepChatAgentInstance` holds a `DeepChatAgentInstanceDelegate` that calls back into orchestration,
  so the runtime registry cannot become a pure state owner and the registry hydrator closes the
  largest construction cycle in the module.
- The root is at 1185 of its 1300-line architecture ceiling, so no further owner can be absorbed.

### Service Ownership

Each remaining root implementation moves to exactly one owner. New owners are ordinary classes with
concrete dependencies and no reference to the facade.

| Owner | Responsibility | Replaces |
| --- | --- | --- |
| `SessionIdentityService` | Agent identity resolution with instance cache and persisted fallback; ACP-backed subagent classification | `getSessionAgentId`, `isAcpBackedSubagentSession` |
| `SessionStateResolver` | Runtime-state read and database hydration, including pending-interaction status projection and missing-session eviction | `getResolvedSessionState`, `getSessionState`, `getSessionListState` |
| `SessionLifecycleCoordinator` | Session initialization and destruction ordering across settings, runtime state, compaction, Memory, durable queue, transcript, and tool mappings | `initSession`, `destroySession` |
| `TranscriptMutationCoordinator` | Clear, retry, truncate, and fork coordination against the transcript mutation contract | `prepareClearMessages`, `finishClearMessages`, `prepareRetry`, `cancelForTranscriptMutation`, `invalidateTranscriptFrom`, `finishTranscriptTruncate`, `resetForkTarget` |
| `MessageProjectionService` | Assistant message refresh projection and subagent tool-call progress persistence | `emitMessageRefresh`, `updateSubagentToolCallProgress` |

Three existing domain implementations gain bound entry points instead of moving.
`buildSystemPromptWithSkills` keeps its implementation in `resources/systemPromptBuilder.ts` and
gains a binding that owns `BasePromptAssembler` and `PostCompactionPromptAssembler` construction.
`normalizeToolResultContent` and `reviewAutoApproveToolPermission` stay domain functions and are
bound once through named ports at composition time. Mechanically wrapping a single function in a
class adds indirection without adding an owner.

Instance access and staleness fencing are registry reads, not lifecycle operations. Owners that
only need `getInstance`, `getHydratedInstance`, `getRuntimeState`, or `assertCurrent` take a narrow
`SessionScopeRegistry` (`getOrHydrateScope`, `getHydratedScope`, `scopeFor`) and use
`SessionRuntimeScope` directly. This removes those four callback shapes from every port surface and
deletes an artificial dependency on `RunLifecycleCoordinator`.

### Port Narrowing

Owners depend on concrete collaborators wherever construction order already permits it:
`TurnCoordinator` on `DeepChatLoopRunner`, `InteractionCoordinator` on `TurnCoordinator` and
`DeferredToolExecutor`, `PendingInputPump` on `TurnCoordinator`, and `DeepChatLoopRunner` on
`CompactionRuntimeCoordinator`. Narrow structural interfaces are retained where they express a real
contract, such as `PendingInputTurnStarter`, but they are satisfied directly instead of by anonymous
adapters.

The six Tape capability ports on `DeepChatLoopRunnerPorts` (`tapeReconciliation`,
`tapeViewManifestReader`, `tapeViewManifestWriter`, `tapeProviderAttemptReader`,
`tapeProviderAttemptWriter`, `tapeToolFactWriter`) become one composed domain port. Tape is a single
subsystem, and splitting one collaborator across six fields describes the capability types rather
than the dependency.

### Late Binding

Exactly one runtime cycle is real: run settlement wakes the pending-input pump, and the pump starts
turns through the lifecycle owner. It is expressed as one named binding module rather than an
anonymous closure, and it is the only permitted deferred wiring in the graph.

The `DeepChatAgentRuntime` hydrator cycle is not real and is removed rather than deferred.
`DeepChatAgentInstanceDelegate` exists only to give `DeepChatAgentInstance` the four methods the
manager backend calls. Routing those through the harness port makes the registry a pure state owner,
deletes the hydrator, and removes `dispose()`, which has no production caller.

### Facade Contract

The facade implements only contracts that already exist. It adds no new public vocabulary, no
subscription channel, and no state of its own:

- `DeepChatAgentBackendPort` for the manager backend, extended with one `send` entry point that
  absorbs the queue routing previously performed inside the instance delegate.
- `SessionStatePort` for session state and settings.
- `SessionTranscriptRuntimePort` for transcript mutation coordination.
- The ACP compatibility dependency factory, the tool registry refresh entry point, the Memory
  ingestion observer, and the runtime registry accessor.

The facade owns no phase machine, queue, cache, subscription, or derived fact, and every method
delegates to exactly one owner. Multi-owner sequences belong to `SessionLifecycleCoordinator` or
`TranscriptMutationCoordinator`. The ACP compatibility dependency factory is bound at composition
and reaches the facade as one pre-bound function rather than as raw infrastructure fields.

The harness barrel exports only `createDeepChatAgentHarness`, the facade type, and its dependency
types. The composed owner graph, its factory, and the pending-input wakeup binding stay
package-private, because exporting them would let a caller reach an owner around the facade and
would let a second graph run the restart-recovery side effects the factory performs. Deep imports
into the harness directory from outside it are rejected for the same reason.

### Zero-Behavior-Change Constraint

This slice changes no runtime behavior. Any defect found while moving code is recorded and deferred
to a separate branch rather than fixed in place, because a behavior change inside a graph rewrite
cannot be reviewed or reverted independently.

Four sequences are load-bearing and must move verbatim:

1. **State hydration side effects.** `hasPendingInteractions` is read before `setRuntimeState`;
   a missing database row evicts the runtime instance and returns null; Agent identity resolution
   writes back onto the instance; only the full hydration mode warms effective generation settings.
2. **Message refresh order.** `chat.stream.completed` publishes first, then the transcript message is
   read, then the internal session update publishes. A non-assistant or unparsable message returns
   after the first publication.
3. **Status publication order.** `sessions.status.changed`, `sessions.updated`, internal session
   update, then UI refresh.
4. **Destroy ordering.** Memory destroy begins, scope operations cancel, readiness clears, then
   durable pending inputs, transcript, and session settings are deleted, then owned state clears,
   the instance is evicted, Memory destroy finishes, and tool mappings clear.

The durable pending-input queue, Tape, Memory, and permission recovery keep their existing single
sources of truth. No fact is duplicated onto the facade or onto a new service.

One documented exception applies to source behavior only. The repository's build preflight rewrites
`resources/model-db/providers.json` and `resources/acp-registry/registry.json`, which changes model
availability, capability and price metadata, and executable ACP package versions. The refresh is
required maintenance and is kept, but it lands in its own commit so it is reviewable and revertible
independently, and ACP version bumps deserve the same supply-chain attention as any dependency
change.

### Final Review Corrections

The final review admits three narrow hardening changes without broadening the facade design:

| Finding | Disposition |
| --- | --- |
| Async Session settings ownership | `setModel`, `setAgentContext`, and `updateGenerationSettings` bind one `SessionRuntimeScope` across every await, recheck status/model identity before persistence, and never mutate a replacement instance. Focused tests cover replacement during provider-default resolution, Memory reassignment fencing, generation-setting sanitization, and skill revalidation. |
| Harness barrel AST completeness | The export-surface guard handles export assignments, enums, modules/namespaces, import-equals declarations, anonymous default declarations, and destructured variable exports. Unsupported names fail closed under the existing allowlist. |
| Pending-input rollback fence | `rollbackPendingInputTurn` requires the caller's already-held instance instead of silently hydrating a current instance through a default parameter. Both callers already provide that ownership token. |

Other review observations do not belong in this correction:

- The steer merge race remains deferred below because closing it changes queue/cancel product
  semantics.
- Compaction cleanup ordering predates this slice and is covered by the explicit requirement to
  retain stale-instance and transcript ordering. Changing it requires a separate complex-bug spec.
- Provider and ACP catalogs are external generated snapshots. Their current upstream sources still
  contain the reported model metadata, so local edits would be overwritten by the next build.
- `uvx` resolves package `requires-python` metadata with managed Python downloads; the ACP package's
  Python range is not constrained by DeepChat's host interpreter range.

### Deferred Findings

Defects observed while moving code are recorded here and fixed on a separate branch.

| Finding | Observation | Current handling |
| --- | --- | --- |
| Steer merge race | Merging two rapid steer inputs into one turn depends on an in-flight `steerActiveTurn` reaching the instance steer marker before a settlement-triggered drain adopts the claim. Nothing serializes the two, so the window is defined only by the async depth of the pump's session-state read. | Behavior preserved by keeping that read behind its own async boundary, with the reason recorded at the wiring site. Closing the race requires holding the steer lane across queue and cancel, which is a behavior change. |
| Duplicated drain logging | `RunLifecycleCoordinator.schedulePendingInputDrain` and `PendingInputPump.schedule` both catch a rejected drain and log the identical `drainPendingQueueIfPossible` message, so one owner is redundant. | Left as is; both paths keep their existing coverage. |

### Test Boundary

Every extracted owner gets a focused suite that constructs it directly through typed dependencies
instead of building the whole runtime. Assertions move rather than change; total executed test count
must not drop.

The former root suite is retained as the full-runtime integration suite and renamed with the
harness. Moving its owner-specific describe blocks into the owner suites is deferred: the file
declares four module-scope `vi.mock` factories that Vitest hoists per file, so splitting it requires
restructuring the mock wiring rather than moving text. That restructuring is its own change and must
not be smuggled into a graph rewrite.

## Harness Facade Goals

- Give every remaining root implementation exactly one named owner outside the facade.
- Make the runtime dependency graph one-directional, with a single named late binding.
- Make `DeepChatAgentInstance` and `DeepChatAgentRuntime` pure runtime-state owners.
- Reduce the facade to delegation against contracts that already exist.
- Prevent re-accretion with an architecture guard that fails on runtime modules importing the
  harness layer and on protected implementation symbols reappearing in the facade.
- Leave a stable service layer for a later typed hook reducer without exposing that layer as a
  service locator.

## Typed Hook Notification Pipeline Slice

### Problem

Hooks are user-configured shell commands that observe the Agent lifecycle. The contract that reaches
them is a single flat `HookContext` whose fields are all optional, so the event name and its payload
are uncorrelated. `dispatch('Stop', { tool })` compiles, `dispatch('PreToolUse', { sessionId })`
compiles, and adding a name to `HOOK_EVENT_NAMES` fails no build.

That weak contract produced measurable defects:

- Every dispatch site hand-assembles the session envelope, and the `Stop` plus `SessionEnd` pair has
  four independent implementations in `runtimeHookSink`, `turnCoordinator`, `interactionCoordinator`,
  and the ACP compatibility path. The ACP copy already dropped `usage`.
- `HookService` re-read `hooksNotifications` on every event. That key is a sensitive app setting, so
  each read is a database read plus a JSON deep clone, a Zod normalization, and two `JSON.stringify`
  calls, performed twice per tool call even when no hook is configured.
- A tool event was `structuredClone`d three times before truncation, so multi-megabyte tool
  arguments and responses were copied for a payload that keeps 1200 characters of each.
- Payload enrichment read the session row whenever `workdir` was falsy, so a session with no project
  directory paid a database read per event.
- The `messageId` to `promptPreview` fallback read a message row and described the assistant's own
  output as the user's prompt, because every producer passes an assistant message id.
- Events were dispatched through independent microtasks with per-event asynchronous enrichment, so
  the order in which hook commands started did not match the order in which events happened.
- Three nested layers repeated the same defensive catch with two different loggers, while
  `dispatchEvent` remained a public untyped bypass of the runtime sink.
- `observeTerminal` resolved the project directory as an argument expression outside the sink's
  guard, so an envelope failure could propagate into run settlement.

### Event Contract

`HookEvent` is a discriminated union of one session envelope and one event body. Each variant is
closed against every fact it does not declare, so tool facts cannot ride on `Stop` and `PreToolUse`
cannot omit them. Closing the variants matters because excess property checking alone only refuses
surplus fields on a fresh literal: a variable carrying both `stop` and `tool` would otherwise
satisfy the union. Two compile-time guards keep it honest: one fails when the union and
`HOOK_EVENT_NAMES` drift apart in either direction, and one pins the combinations the union must
refuse, for both missing and foreign facts.

`HookEventName`, the settings shape, and the `payloadVersion: 1` wire payload are unchanged, because
they are the renderer contract and the user script contract respectively.

### Runtime Scope

`RuntimeHookSink` becomes a factory for `RuntimeHookScope`, a bound emitter that resolves one session
envelope once for the producer that created it: session and message identity, provider, model,
agent, and working directory. The scope holds no service graph, persists nothing, and duplicates no
runtime state. Producers emit event bodies against it, so no emit site assembles an envelope
field by field.

The scope is per producer, not per turn. A normal turn creates three: `TurnCoordinator` for the
submitted prompt, `DeepChatLoopRunner` for the run and its tool facts, and
`RuntimeHookSink.observeTerminal` for settlement, which reaches the sink from
`RunLifecycleCoordinator` without the turn's scope. Threading one scope through the run lifecycle
would add a new state carrier to that owner and is out of this slice, so a setting changed mid-turn
can still be observed by later events of the same turn.

The scope resolves the working directory lazily and once. An unobserved event resolves nothing, and
a resolution failure leaves the directory unanswered rather than dropping the notification, so
delivery can still resolve it from the session row.

`RuntimeHookScope.terminal` is the single terminal projection. Every settled turn, whatever its entry
point, reports `Stop` then `SessionEnd` through it.

The loop keeps its own tool-fact vocabulary. `DeepChatLoopNotification` describes what a tool batch
did, not what a hook consumes, and the scope's tool observer is the one adapter between them. Making
the loop import the hook contract to remove a structural duplicate would trade a real layer boundary
for cosmetic reuse.

### Delivery Semantics

`HookService` owns its configuration as state instead of re-reading a store per event. The
configuration and the derived subscription index are rebuilt as one unit, so a subscription probe
can never disagree with the hooks the delivery path will run. Every write path refreshes it
atomically: the routes write through the service, and `start()` covers the maintenance window that
already brackets configuration import.

`isObserved` is a synchronous set lookup exposed to producers. An unsubscribed event costs one
lookup: no envelope resolution, no projection, no clone, no database read, and no spawn.

An observed event is projected synchronously into detached wire facts, with previews truncated
first, so no oversized string reaches a clone. The permission record is the only field of unbounded
shape and receives the single bounded clone.

Delivery is serialized per session. Events of one session reach their commands in emission order,
and unrelated sessions never wait for each other. The guarantee is event acceptance and command start
order; completion order of external processes is not ordered, no hook is awaited, and Agent tool
execution never blocks on one.

Configuration is owned at acceptance, not at delivery. An accepted event carries the identity and
command of every hook eligible at that moment, and delivery runs a hook only when it is still
eligible under the same command. A hook enabled or edited after an event happened therefore never
receives it, and one disabled while the event was queued stops receiving it. Because enrichment is
asynchronous, that revalidation is settled immediately before spawning rather than when the delivery
was dequeued.

A hook command that outlives its timeout settles its own result. A killed shell can keep a process
tree alive and never emit `close`, so waiting for exit could leave the settings test call pending
forever. Captured stdout and stderr are bounded by the diagnostic limit they are truncated to, so a
command that streams for its whole timeout window cannot grow main-process memory without bound.

Fault isolation stays layered rather than collapsed. The loop guards its notification boundary, the
scope guards the runtime boundary so no hook failure reaches settlement, the service guards each
queued delivery, and each hook command is isolated from its siblings and from the next event.

### Included Corrections

| Correction | Previous behavior | Required behavior and rationale |
| --- | --- | --- |
| Terminal drift | Four independent `Stop` plus `SessionEnd` implementations computed their own reason and fallbacks, and each could drift again. | One projection owns the pair and normalizes a missing `usage` or `error` to an explicit null. ACP still reports `usage: null` because `AcpObserverPort.terminal` carries no token accounting; giving ACP real usage needs protocol design and is not part of this slice. |
| Assistant text as prompt preview | An event carrying a message id but no preview read that message and reported its text as `user.promptPreview`. Every producer passes an assistant message id, so the fallback was wrong at every call site and cost a row read per event. | Prompt previews come from the producer that owns the prompt. The message lookup and its query port are removed; `user.messageId` is unchanged. |
| Answered null project directory | Enrichment triggered whenever `workdir` was falsy, so an explicit null cost a session read that returned null. | Only an unanswered field triggers a lookup. |
| Unguarded envelope resolution | `observeTerminal` resolved the project directory outside the sink's guard, so a stale-instance assertion could propagate into run settlement. | Envelope resolution happens inside the guarded region and degrades to an unanswered field. |

`user.promptPreview` therefore becomes empty for tool events and for a resumed `SessionStart`, where
it previously contained assistant output. The payload shape, `payloadVersion`, environment variables,
command placeholders, command timeout, redaction, and settings contract are unchanged. `time` is now
captured when the event occurs rather than when its payload is assembled.

### Deferred Findings

| Finding | Observation | Current handling |
| --- | --- | --- |
| Hydrating project-directory read | `resolveProjectDir` reaches `getOrHydrateScope`, so resolving a hook envelope can recreate a runtime instance for an evicted session. | Pre-existing. The subscription gate removes the call entirely for unconfigured installations; making the read non-hydrating changes `SessionSettingsCoordinator` and belongs to its own change. |
| Hook command environment inheritance | Hook commands spawn with the full parent environment, so any secret in the Agent process environment is visible to them. | Pre-existing and out of scope for a delivery contract. Closing it requires an allowlist design and a settings surface. |
| Orphaned process trees | A timed-out command is killed with `SIGKILL` on the shell only, so grandchildren can survive and keep the child registered until the process exits. | The result no longer depends on that exit. Killing the whole tree and bounding concurrent hook processes is separate reliability work. |
| Per-turn envelope resolution | Three producers each resolve their own envelope, so a setting changed mid-turn can be observed by later events of the same turn. | Accepted. Threading one scope through the run lifecycle adds a state carrier to `RunLifecycleCoordinator` and belongs to its own change. |

## Typed Hook Notification Pipeline Goals

- Make the event name and its payload one value that cannot describe an impossible event.
- Give the terminal projection, and every session envelope, exactly one implementation.
- Make an unconfigured installation pay one map lookup per event.
- Make delivery order within a session deterministic without coupling sessions or blocking the Agent.
- Keep the user-facing hook contract, including the version 1 payload, byte-compatible.

## Typed Tool Execution Contract Goals (Completed)

- Define one canonical, typed execution contract for every `MCPToolDefinition`.
- Make a tool's maximum side effect and concurrency permission explicit at its definition site.
- Make `write + parallel` unrepresentable in TypeScript.
- Admit external MCP tools with a conservative contract without trusting server-supplied hints.
- Keep current runtime behavior: only a multi-call batch composed entirely of explicitly parallel
  read tools may run concurrently, and only in `full_access` mode.
- Preserve tool-call result ordering, failure isolation, abort behavior, permission recovery,
  interaction pauses, output fitting, and durable execution-state updates.
- Keep execution-only metadata out of provider payloads, context-window token estimates, and
  provider-view tool-definition hashes.

## Execution Contract

The canonical definition uses a closed discriminated union:

```ts
type ToolExecutionMode = 'sequential' | 'parallel'
type ToolEffect = 'read' | 'write'

type ToolExecutionContract =
  | { effect: 'read'; mode: ToolExecutionMode }
  | { effect: 'write'; mode: 'sequential' }

type MCPToolDefinition = MCPToolDefinitionBase & {
  execution: ToolExecutionContract
}
```

`effect` describes the maximum observable capability of the tool, not the behavior of one selected
argument branch:

- `read` means the tool has no durable, external, user-interaction, or non-idempotent mutation that
  can conflict with another call.
- `write` includes any tool that can mutate state, incur an externally visible action, pause for an
  interaction, or select a mutating operation based on arguments.

`execution.mode` is a positive scheduling grant. A `read` tool may remain sequential because of
resource limits, internal mutable caches, ordering requirements, or because concurrency has not yet
been validated. Only an explicit `read + parallel` contract authorizes parallel execution.

A single deeply frozen `TOOL_EXECUTION` preset catalog represents the three valid contracts.
Definition sites assign one atomic `execution` value, for example `TOOL_EXECUTION.write` or
`TOOL_EXECUTION.read.parallel`, instead of spreading independent fields into the definition. Runtime
freezing prevents one definition from mutating the shared preset used by every other definition.
This keeps execution-only metadata namespaced, makes the classification concise and reviewable, and
lets provider-facing projections remove the complete contract when it evolves. `MCPToolDefinition`
has one canonical declaration under `src/shared/types/core`; the broader shared MCP module aliases
that declaration instead of maintaining a second structural copy.

## Trust And Classification

Built-in Agent definitions declare their contract at the owning definition site. For compatibility
with current behavior, only the filesystem `read` tool is initially `read + parallel`.

- Filesystem `glob` and `grep`, Tape queries, `skill_list`, and `get_browser_status` are
  `read + sequential` until their concurrency behavior is deliberately validated.
- File mutation, commands, processes, questions, plans, settings, image generation, cron jobs,
  subagents, skill activation/management/execution, and browser navigation/CDP are
  `write + sequential`.
- All memory tools are `write + sequential`; recall updates access metadata and is not a pure read.
- Parameter-dependent tools use their maximum capability. A tool that can either inspect or mutate
  is classified as `write`.

External MCP and plugin tools enter the catalog as `write + sequential`. MCP annotations such as
`readOnlyHint` are descriptive hints from an untrusted server and never grant local concurrency.
Supporting trusted per-server overrides would require a separate authenticated policy design.

## Batch Scheduling

A pure runtime policy selects `parallel` only when every condition holds:

1. the Session permission mode is `full_access`;
2. the batch contains at least two calls;
3. every call resolves to exactly one definition;
4. every resolved definition is `read + parallel`.

Missing, malformed, or duplicate definitions fail closed to `sequential`. Mixed batches remain
fully sequential; this change does not introduce segmented scheduling around write calls. Parallel
execution continues to settle independently and commit results in provider call order.

## Compatibility

- The runtime tool-definition shape gains one additive internal `execution` object, so structural
  readers and IPC consumers remain compatible. The contract is intentionally required in
  TypeScript, which is a source-level contract tightening for definition constructors; all
  in-repository constructors are updated atomically. No persisted format or database migration
  changes.
- Provider adapters continue projecting only model-visible function metadata. Legacy XML prompt
  generation also continues reading only function metadata.
- Context reserve estimation excludes the execution object so this internal contract does not
  reduce user-visible context capacity.
- Tape ViewManifest tool-definition hashes exclude the execution object, preserving their existing
  provider-view identity. Future execution-policy replay must use a separate versioned identity.
- Existing external MCP tools remain sequential. Existing built-in behavior remains unchanged:
  only Agent filesystem `read` batches gain the parallel path they already had.
- Permission preflight, auto-grant, post-call permission handling, and interaction semantics remain
  owned by dispatch.

## Non-Goals

- Do not parallelize additional built-in or MCP tools in this slice.
- Do not infer execution policy from MCP annotations, names, schemas, permission results, or call
  arguments.
- Do not add per-call dynamic effect classification or a segmented dependency scheduler.
- Do not rewrite tool dispatch or change durable queue and Tape semantics.
- Do not add the typed hook reducer in the harness facade slice.
- Do not change provider retry, tool scheduling, dispatch internals, public IPC/API contracts,
  persisted formats, Tape semantics, or Memory semantics beyond the corrections explicitly listed
  above while extracting runtime owners.
- Do not add a Pi-style `run`/`steer`/`followUp`/`subscribe` vocabulary or any third event channel;
  the facade implements the existing manager and session contracts only.
- Do not pass the composed service graph to hooks as a container. `RuntimeHookScope` carries
  immutable session facts only.
- Do not give hooks a decision channel. Blocking, replacing, cancelling, or rewriting provider
  requests and tool arguments would require a versioned stdout protocol, a conflict and timeout
  policy, argument revalidation, permission recheck after rewriting, and a trust surface. It is a
  product feature with its own security model, not part of a delivery contract, and DeepChat has no
  in-process participant that could use it today.
- Do not fix defects discovered while moving code beyond the narrow final-review corrections listed
  above; record them and open a separate branch.
- Do not move durable pending inputs into `DeepChatAgentInstance` or add another source of truth.
- Do not make `SessionRuntimeScope` a dependency container or introduce a generic runtime kernel.
- Do not add same-run steering or change abort semantics, queue ordering, or visible-turn behavior
  beyond rollback of a rejected claimed live send described above.
- Do not create or synchronize a GitHub issue for this architecture work.

## Typed Tool Execution Acceptance Criteria (Completed)

1. The canonical type rejects `write + parallel`, and all production definition ingress paths
   produce an explicit valid contract.
2. Two or more `read + parallel` calls run concurrently only in `full_access`, while result commits
   preserve call order.
3. A sequential read, write, missing definition, malformed contract, duplicate definition, or
   non-`full_access` permission mode makes the complete batch sequential.
4. External MCP definitions remain `write + sequential` even when `readOnlyHint` is true.
5. Parallel failures remain isolated per call; abort and already-returned-result settlement retain
   current behavior.
6. Execution metadata is absent from provider tool schemas and does not change the historical tool
   token reserve or ViewManifest tool-definition hash.
7. Focused tests, type checks, formatting, i18n validation, and lint pass before handoff.

## Coordinator Ownership Acceptance Criteria

1. Tests no longer reflect coordinator private members that move in this slice; owner tests use
   public behavior or typed ports.
2. `DeepChatAgentRuntime` is the only hydrated-instance registry, and the minimal scope exposes no
   project, settings, hook, store, or provider service access.
3. Instance, active-run, operation-controller, and message-association fences remain explicit and
   retain their existing semantics.
4. Status transitions preserve their current four-sink ordering and stale instances/runs cannot
   overwrite a replacement's status.
5. One owner performs terminal settlement and active-run cleanup for initial, resume, interaction,
   cancel, and provider-return paths without duplicate queue wakeups.
6. `PendingInputPump` is the only queue-drain and claim-state owner. Steer priority, blocked-input
   gates, restart recovery, and per-session single flight remain compatible; retry rollback and the
   twelve enumerated corrections follow their explicitly tested semantics.
7. Internal turn completion maps losslessly to the existing `MessageStartResult`, including OCR and
   attachment-preparation outcomes.
8. Manual and automatic compaction retain current abort, stale-instance, status, transcript, Tape,
   and Memory ordering through the existing compaction owner.
9. `DeepChatRuntimeCoordinator` contains composition and public compatibility delegation rather
   than lifecycle, admission, pump, settlement, or compaction implementations. Owner modules do not
   import the concrete root coordinator.
10. Focused owner tests, the full main-process suite, type checks, formatting, i18n validation,
    lint, and architecture guards pass before handoff.

## Harness Facade Acceptance Criteria

1. `deepChatRuntimeCoordinator.ts` no longer exists. Identity, state resolution, session lifecycle,
   transcript mutation, and message projection each have one named owner, and the prompt assembler,
   tool result normalization, and permission review remain domain modules bound at composition.
2. No module under `src/main/agent/deepchat/{runtime,loop,instance,memory,resources}` imports the
   harness layer, enforced by the agent cleanup guard.
3. The composition root is the only module that wires owners, and the graph contains exactly one
   named late binding, from `RunLifecycleCoordinator` to `PendingInputPump`.
4. `DeepChatAgentInstance` exposes runtime state only; `DeepChatAgentInstanceDelegate`, the registry
   hydrator, and `DeepChatAgentRuntime.dispose()` are gone, and the manager backend reaches send,
   cancel, snapshot, and close through the harness port.
5. The facade declares no field other than its owners and the bound ACP compatibility dependency
   factory, and satisfies `DeepChatAgentBackendPort`, `SessionStatePort`, and
   `SessionTranscriptRuntimePort` by explicit `implements` clauses.
6. `DeepChatLoopRunnerPorts`, `TurnCoordinatorPorts`, and `InteractionCoordinatorPorts` shrink, the
   six Tape capabilities are one composed port, and no port member is a closure over the facade.
7. Every owner introduced or narrowed in this slice is constructible in a test without building the
   full runtime, and each has a focused suite. Compacting the retained full-runtime suite is
   deferred with its reason recorded in the test boundary.
8. The four load-bearing sequences in the zero-behavior-change constraint are pinned by tests that
   fail if their order changes.
9. No source behavior, public contract, persisted format, event payload, or event ordering changes,
   apart from the build preflight resource refresh and final-review corrections recorded above.
   Executed test count does not drop.
10. The harness barrel exports only the factory entry point and its types, deep imports into the
    harness directory are rejected from outside it, and both rules fail closed in the guard.
11. The runtime source graph is acyclic across the owners this slice touched: no owner pair and no
    harness module pair import each other, including type-only imports.
12. Focused owner suites, the full main-process suite, type checks, formatting, i18n validation,
    lint, the agent cleanup guard, and a regenerated layered-runtime baseline pass before handoff.

## Typed Hook Notification Pipeline Acceptance Criteria

1. `HookEvent` correlates every event name with its payload, refuses a foreign fact through a
   variable as well as a literal, and the coverage and rejection guards fail compilation when a name
   loses its body variant or a required fact becomes optional.
2. No emit site assembles a session envelope field by field, and `Stop` plus `SessionEnd` has one
   implementation that all four previous entry points reach.
3. An event with no enabled subscriber performs one subscription lookup and nothing else: no
   envelope resolution, projection, clone, settings read, session read, or spawn.
4. A configuration write through the service refreshes the subscription index atomically, and a
   write that bypasses the service is picked up by the next explicit refresh or service restart.
   A hook enabled or edited after an event was accepted never receives that event, and a hook
   disabled while the event was queued does not run it.
5. Tool previews are truncated before any clone, and the permission record receives the only clone.
6. Events of one session start their commands in emission order under delayed enrichment, and a
   stalled session does not delay another.
7. A hook command that fails to spawn, times out, or throws does not stall its siblings or the next
   event, and no hook failure reaches run settlement. A timed-out command settles its own result
   without waiting for an exit that may never arrive, and captured diagnostics stay bounded.
8. `payloadVersion`, the stdin payload shape, environment variables, command placeholders, the
   command timeout, and the settings contract are unchanged; `user.promptPreview` reports only a
   prompt the producer supplied.
9. Focused suites, the full main-process suite, type checks, formatting, i18n validation, lint, and
   the agent cleanup guard pass, and executed test count does not drop.
