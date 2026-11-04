# DeepChat Runtime, Tool Execution, and Hook Contracts

The [Main host and portable Harness contract](../main-harness-portability/spec.md) owns the
production entry, dependency ports, host adapters, and independent Node acceptance. This document
owns the runtime safety, scheduling, pending-input, and hook-notification invariants beneath that
boundary. Direct ACP has its own backend; cross-agent state reads go through AgentManager.

## Runtime Ownership

`DeepChatAgentRuntime` owns hydrated built-in instances. Its `SessionRuntimeScope` is an instance
identity capability, not a service locator. It must not duplicate settings, database, provider, or
hook facts. Mutable Session/Run state belongs to `DeepChatAgentInstance` and `LoopRun`.

- `RunLifecycleCoordinator` owns operation controllers, active-run registration/cleanup, deferred-tool
  cancellation, terminal settlement, and the post-settlement pending-input wakeup.
- `SessionStatusPublisher` validates runtime status facts. Host projection owns wire events and UI
  effects; publication order and stale rejection follow the Main contract.
- `PendingInputAdmissionCoordinator` owns send/steer normalization, attachment acceptance, capacity,
  interaction gates, queue mutations, steer promotion, and explicit resume/interrupt intent.
- `PendingInputPump` owns steer-before-queue selection, per-instance drain leases, durable
  claim/release/consume, restart holds, and starting a claimed turn. Pending-input rows remain the
  only ordering and content source.
- `TurnCoordinator` owns initial/resume preparation. `CompactionRuntimeCoordinator` owns manual and
  automatic compaction through the existing operation, transcript, Tape, and Memory boundaries.
- Harness composition wires these owners once. The synchronous `PendingInputWakeup` feedback edge
  gives settlement and the next drain a deterministic order without an additional event bus.

Instance, run, operation-controller, and message-association fences are distinct. An operation must
check the fence that grants its actual authority; a generic ownership predicate cannot replace
all four. Asynchronous model, Agent-context, and generation-setting changes bind one scope across
awaits and cannot mutate a replacement instance. Pending-turn rollback requires the caller's held
instance and cannot hydrate a replacement as a default.

## Pending Input Settlement and Restart

Internal completion distinguishes consume, release-before-user-fact, and rollback-after-user-fact.
The pump changes pending rows; transcript, compaction, and Memory rollback retain their ordered
settlement boundary. Public `MessageStartResult`, including attachment-preparation outcomes,
continues to represent that completion losslessly.

Restart reconciliation precedes transcript recovery and scope hydration. It atomically terminalizes
unread Steer messages, Tape replacements, and pending rows. Queue rows are retained behind a
process-local hold. Listing and hydration do not start execution; ordinary completion/enqueue wakes
stop at the held FIFO head. A fresh composer Send does not release historical drafts.

`sessions.resumePendingQueue` validates Session gates and releases the hold explicitly. Manual
intent is bound to the Queue item ID across attachment blocking/resolution. The claim is consumed
before the provider Run boundary, so a returned provider error does not requeue the same operation.
Failures before that boundary release safely. A subsequent restart derives its hold from durable
rows, not a new persisted recovery marker.

An unclaimed Steer's linked messages become retryable errors with their Tape replacements and
pending consume in one transaction. A claimed Steer keeps its sent user message and exposes the
interruption through the assistant error. Neither case adds a recovery-specific renderer action.

### Settlement Invariants

| Boundary | Required behavior |
| --- | --- |
| Deferred tool progress | Re-read the assistant message after deferred execution and continue only while the same pending interaction still exists. This preserves concurrent progress and refuses stale ownership. |
| Follow-up admission | Serialize send acceptance and permit only one immediate follow-up claim; later sends observe the first claim and remain pending. |
| Rejected live-send rollback | Roll back transcript, compaction, and Memory facts before releasing the claim, so retry never duplicates a visible turn. |
| Steer marker ownership | Clear the marker only when its id matches the adopted claim, preserving a newer merge target. |
| Direct-steer ownership | Retain the steer whenever its durable state or an active generation, controller, drain, or generating projection proves another owner accepted it. |
| Promoted-steer ownership | Restore only when no durable or runtime owner accepted the promoted steer. |
| Operation-controller ownership | Treat an absent expected controller as a no-op; only the exact current controller may be cleared. |
| Follow-up/drain overlap | Keep the new input pending while another owner holds the instance-scoped drain lease. At every normal asynchronous yield point the draining turn already owns a claimed row, so the claimed-input gate also prevents a second start. The explicit lease check protects defensive or re-entrant observations; once the in-flight turn persists its user fact, transcript ordering removes the old follow-up marker and normal completion wakeup admits the pending input. |
| Atomic drain ownership | Acquire an instance-scoped drain lease synchronously before the first asynchronous state read and release it only with the exact owner token. Non-starting paths release locally; a launched turn transfers release ownership to its finalizer. Coalesce transient wake reasons only after the active claim has settled and the resulting Session status admits that reason, then replay them after lease release. Enqueues accepted while a turn is still generating continue to rely on normal completion wakeup, so an error leaves their backlog pending. The durable queue remains the sole input fact. |
| Non-hydrating readiness cleanup | Clear readiness only on an already hydrated scope. Cleanup is a no-op after eviction and cannot resurrect Session runtime state. |
| Multi-message interaction cancel | Terminalize every distinct assistant message represented by the pending interaction set, then clear the set and emit one Session terminal projection and queue wakeup. |
| Rolled-back terminal references | Clear both IDs immediately after durable transcript rollback, including returned error results, so no terminal write, event, or public result references a deleted message. |

## Tool Execution and Trust

`MCPToolDefinition.execution` is the canonical closed union: read tools may be sequential or
parallel; write tools are sequential. Definition sites use the frozen `TOOL_EXECUTION` presets.
The effect describes the maximum possible capability, including parameter-selected mutations,
non-idempotent actions, permission/interaction pauses, and metadata writes. Memory recall is not a
pure read because it updates access metadata.

External MCP/plugin definitions enter as write/sequential. Server `readOnlyHint` annotations are
untrusted descriptions and cannot grant concurrency. Only an explicit local read/parallel contract
permits concurrent execution. The current filesystem `read` grant does not imply a grant for glob,
grep, browser status, Tape queries, or additional tools.

The complete batch runs in parallel only in `full_access`, with at least two calls, when each call
resolves to exactly one valid read/parallel definition. Missing, malformed, duplicate, sequential,
or write definitions make the whole batch sequential. There is no segmented scheduling around
writes. Each call settles independently while results commit in provider call order.

Execution metadata stays out of provider tool schemas, legacy XML prompts, context token reserves,
and ViewManifest tool-definition hashes. A future execution-policy replay identity must be separate
from the provider-view identity. Historical `update_plan` has only the
[retired read-compatibility contract](../agent-plan-retirement/spec.md).

## Hook Notifications

`HookEvent` correlates one session envelope with one closed event-body variant. Foreign facts must
be rejected on variables as well as literals. The event-name set, version-1 payload, settings,
environment variables, command placeholders, and redaction remain public contracts.

`RuntimeHookSink` creates a producer-local `RuntimeHookScope` with immutable identity facts. It
persists nothing and carries no service graph. Working-directory resolution is lazy and cached per
scope; an unobserved event does no enrichment, cloning, row read, or spawning. Omitted workdir may
be resolved, while explicit null is authoritative. Resolution failure leaves it unanswered and does
not suppress notification. The current settings resolver may hydrate a built-in scope; this is not
a side-effect-free query guarantee.

`RuntimeHookScope.terminal` is the single Stop/SessionEnd projection for initial, resumed,
interaction, cancellation, and provider-return paths. It emits Stop before SessionEnd and uses
explicit null for missing usage/error. Producers supply prompt previews; assistant-message lookup
cannot fabricate them. Tool previews are truncated before cloning; only the permission record
requires a clone. The loop keeps its own tool-fact vocabulary and adapts through the hook scope.

HookService owns configuration and its subscription index. Eligible command identity is captured
at event acceptance and revalidated immediately before spawn after asynchronous enrichment. A
later enable/edit does not receive old events; disabling a queued command prevents delivery.
Accepted events start commands in emission order per Session. Sessions do not wait for each other,
external completion order is not guaranteed, and Agent execution never awaits hook commands.

Failure isolation exists at the producer, scope, per-delivery, and per-command boundaries. Spawn
errors, command errors, and timeouts cannot stall sibling hooks, later events, or run settlement.
Timeout resolves without waiting for a shell close that may never arrive. Captured diagnostics are
bounded while streaming, not only truncated after exit. Whole-process-tree cancellation, command
concurrency limits, and an environment allowlist remain separate lifecycle/security work.

The three producer scopes may observe settings changed during a turn; there is no per-turn settings
snapshot guarantee. Hook commands have no decision, request-rewrite, permission-grant, or tool-
replacement channel. Portable plugin context is a separate attributed Tape contribution, admitted
before provider assembly and rechecked before dispatch; projection/retry does not reexecute hooks.
Its supported lifecycle and budgets remain in [User Plugins](../../features/user-plugins/spec.md).

## Boundary and Regression Protection

Runtime/loop/instance/memory/resource modules cannot import the Harness layer. External consumers
use its factory and public types, not private owner deep imports or mutable registry/observer
accessors. The agent cleanup guard also constrains the facade and export surface. The Node proof
checks production dependencies and persistence/recovery behavior outside Vitest setup.

Tests protect observable status/order, authority fences, pending disposition, terminal persistence,
recovery, and public results. Owner tests need a distinct contract to justify their cost; aggregate
coverage counts and one-suite-per-class are not invariants. The remaining test-boundary work and
unapproved hook/same-run steering follow-ups are tracked in [plan.md](./plan.md).
