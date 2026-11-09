# DeepChat Runtime, Tool Execution and Hooks

> Planned replacement: [dim Rust harness migration](../dim-rust-harness-migration/spec.md).
> This document remains the current implementation contract until the migration gates pass;
> the new RFC is not yet implemented.

The [Main host contract](../main-harness-portability/spec.md) defines the production entry and
execution/persistence/output ports. This document defines the runtime owners beneath that boundary.
Direct ACP uses its own backend; cross-agent state reads go through AgentManager.

## Runtime Owners

`DeepChatAgentRuntime` owns hydrated built-in instances. `SessionRuntimeScope` carries instance
identity, not a service graph or duplicate settings. Mutable state belongs to
`DeepChatAgentInstance` and `LoopRun`.

| Owner | Responsibility |
| --- | --- |
| RunLifecycleCoordinator | Controllers, active-run registration/cleanup, deferred cancellation, terminal settlement and pending-input wakeup. |
| SessionStatusPublisher | Validate runtime status; host projection owns delivery and UI effects. |
| PendingInputAdmissionCoordinator | Normalize send/steer, accept attachments, check capacity/interactions, mutate queued input and handle explicit resume/interrupt. |
| PendingInputPump | Steer priority, instance-scoped drain leases, durable claim/release/consume, restart holds and turn startup. |
| TurnCoordinator | Distinct initial/resume preparation with explicit lifecycle and input disposition. |
| CompactionRuntimeCoordinator | Manual/automatic compaction through transcript, Tape and Memory boundaries. |

Harness composition wires the owners once. The synchronous PendingInputWakeup edge orders terminal
settlement before the next drain. Instance, Run, operation-controller and message-association fences
grant different authority. Async work retains its original scope; stale cleanup, settings changes
and rollback cannot hydrate or mutate a replacement.

## Pending Input and Settlement

- Durable rows own input order/content. Internal completion distinguishes consume, release before
  the user fact, and rollback after it; public MessageStartResult preserves attachment outcomes.
- Follow-up admission is serialized. The pump acquires a drain lease before its first await;
  non-starting paths release locally and launched turns release in their finalizer with the exact
  token. A claimed input or active drain prevents a second start.
- Transcript/compaction/Memory rollback precedes claim release and clears terminal message IDs.
  Deferred execution re-reads the assistant message and continues only for the same interaction.
  Cancellation settles every assistant message in the pending interaction set, then publishes one
  terminal Session projection and wakeup.
- Steer markers clear only for the adopted claim. Accepted durable/runtime ownership retains direct
  or promoted steer; promotion is restored only when no owner accepted it. Absent controllers are
  a no-op, and only the exact current controller can be cleared.
- Transient wakes coalesce after claim settlement and replay after lease release only when status
  admits them. Inputs queued during generation rely on normal completion; errors leave the backlog
  pending. Readiness cleanup never creates an evicted scope.

Restart reconciliation precedes transcript recovery and hydration. Unread Steer messages, their Tape
replacements and pending consumption settle atomically as retryable errors. Claimed Steer retains
its sent user message and reports interruption through the assistant error.

Queue rows remain behind a process-local FIFO hold. Listing, hydration, ordinary wakes and a fresh
composer Send do not release historical input. `sessions.resumePendingQueue` validates gates and
releases it explicitly. Manual intent follows the item across attachment blocking. Consumption occurs
before the provider Run, so a provider error cannot requeue it; pre-boundary failures release safely.
Restart derives the next hold from durable rows without a recovery marker or extra renderer action.

## Tool Execution

`MCPToolDefinition.execution` is a closed capability contract using frozen TOOL_EXECUTION presets:
read tools may be sequential/parallel, and writes are sequential. Effects include parameter-selected
mutations, permission/interaction pauses and metadata writes; Memory recall is not a pure read.
External MCP/plugin tools enter as write/sequential. Untrusted readOnlyHint cannot grant concurrency,
and filesystem read permission grants no additional tools.

A complete batch runs in parallel only in full_access, with at least two calls, each resolving to
exactly one valid read/parallel definition. Missing, malformed, duplicate, sequential or write
definitions make the whole batch sequential. Calls settle independently and commit in provider order.
Execution metadata is absent from provider schemas, XML prompts, token reserves and ViewManifest
hashes. Historical update_plan follows [retired read compatibility](../agent-plan-retirement/spec.md).

## Hook Notifications

HookEvent pairs one immutable Session envelope with a closed body variant. Event names, payload
version 1, settings, environment variables, command placeholders and redaction form the public
contract. RuntimeHookSink creates producer-local scopes without persistence or service lookup.

Working-directory resolution is lazy and cached: omission may resolve, explicit null is authoritative,
and failure leaves it unanswered without suppressing notification. Unobserved events perform no
enrichment, clone, row read or spawn. The settings resolver can hydrate a built-in scope; it is not
a side-effect-free query. Producer scopes can observe settings changes during a turn.

RuntimeHookScope.terminal emits Stop before SessionEnd for every settlement path, using explicit
null for absent usage/error. Producers supply prompt previews. Tool previews are bounded before
cloning; only permission records require a clone. The loop adapts its own facts to the hook contract.

HookService captures eligible command identities at acceptance and revalidates them before spawn.
Later enable/edit cannot receive old events, and disable blocks queued delivery. Commands start in
Session order; unrelated Sessions and Agent execution do not wait for command completion. Spawn
errors, failures and timeouts cannot block siblings, later events or settlement. Timeout settles
without shell close, and diagnostic capture is bounded while streaming.

Hooks carry notifications, not decisions, request rewrites, permission grants or tool replacements.
Portable plugin context is a separate attributed Tape contribution admitted before provider assembly
and rechecked before dispatch; projection/retry does not rerun it.
[User Plugins](../../features/user-plugins/spec.md) defines its lifecycle and budgets.

## Dependencies and Limits

Runtime/loop/instance/memory/resource modules cannot import Harness. Consumers use its factory and
public types, without private owner imports or mutable registry/observer access. The cleanup guard
protects this surface; the standalone Node proof exercises production dependencies and persistence.

The aggregate Harness suite still contains owner-local scenarios; distinct integration, recovery,
persistence and authority contracts remain necessary. Hook process-tree cancellation, concurrency
limits and an environment allowlist are not provided by notification delivery. Same-run steer and
hook decision semantics are outside this contract. Drain-error reporting overlaps service/runtime
owners and requires coordinated changes to avoid duplicate diagnostics.
