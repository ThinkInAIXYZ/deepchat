# Stage 2 ownership and transaction inventory

Status: **Finalized for Stage 2A/2C sequencing**

This record constrains the extraction. It does not create a second runtime, event bus, database
owner, or repository abstraction.

## Ownership map

| Area | Current owner | Stage 2 target | Boundary |
| --- | --- | --- | --- |
| Built-in loop and turn/run coordination | `DeepChatLoopEngine` and DeepChat runtime coordinators | kernel | awaited execution semantics; provider continuation and cancellation remain ordered |
| `DeepChatAgentHarness` | `src/main/agent/deepchat/harness` facade | host composition facade over kernel | no independent state, queue, cache, or database ownership |
| Session runtime state | `SessionStateResolver` over the existing session data owner | kernel-facing state port implemented by host | snapshots and lifecycle state; no DB connection crosses the boundary |
| Transcript and Tape | `SessionTranscript`/Tape tables and their existing projection adapters | semantic ports with host transaction owner | append/settlement atomicity stays in the adapter; not a generic repository |
| Pending input and interactions | pending-input and interaction coordinators | kernel ports/coordinators | admission, association, and settlement are awaited and ordered |
| Provider and tool execution | provider runtime and `AgentBashHandler`/tool adapters | injected provider/tool ports | concrete credentials, process, path, and authorization stay host-owned |
| Event publication | typed DeepChat event publishers | kernel event port plus host adapters | authoritative execution events are not Desktop invalidation or ACP notifications |
| Desktop projection | composition adapter and renderer bridge | Desktop projection | typed invalidation is non-authoritative and may refresh the current widget behavior |
| ACP runtime/session | direct ACP backend, ACP runtime, ACP persistence | ACP peer adapter | no built-in loop dependency and no second profile database owner |
| Memory, skills, hooks, CLI authority | current Main services | host adapters | no concrete singleton or application authority in the package entry |

`DeepChatAgentHarness` remains a compatibility facade during extraction. It is not the portable
kernel artifact. A package entry may export only neutral contracts and an independently constructible
kernel; it must not export the harness, database, Electron objects, provider clients, or ACP process
owners.

## Boundary classification

- **Awaited semantic boundary:** provider rounds, tool admission/execution, pending-input settlement,
  generation fences, interaction association, cancellation, and final turn settlement.
- **Transactional persistence boundary:** assistant/user message persistence, Tape append, transcript
  mutation, queued-input mutation, pending interaction persistence, and recovery classification.
  Existing transaction owners keep their atomic behavior. Projection invalidation failure may only be
  treated as non-authoritative when it is the UI/widget callback; it must not change Tape or durable
  projection transaction semantics.
- **Projection invalidation:** typed, bounded notification from built-in runtime to Desktop projection.
  It carries `{ sessionId, reason }` and is not a wire event, ACP notification, or source of truth.

## Transaction matrix

| Operation | Required ordering/atomicity | Owner |
| --- | --- | --- |
| Submission acceptance | authorize and validate before receipt/execution; retain the Stage 1 identity rules | host admission + kernel lifecycle |
| Queued/running transition | one ordered state transition; cancellation cannot erase an accepted queued submission | session/run owner |
| Active turn settlement | final outcome, message result, and run state settle through the existing semantic boundary | kernel with host persistence adapter |
| Assistant message persistence | durable message is committed before non-authoritative UI invalidation | transcript owner |
| Tape append | append and its durable projection behavior retain the existing transaction; failure rolls back as today | Tape/projection owner |
| Pending interaction | admission, association, resolution, and settlement preserve current ordering | interaction/pending-input owner |
| Cancellation | named layer only; no automatic uncertain external side-effect retry | kernel lifecycle + host authority |
| UI invalidation failure | does not roll back completed execution; no UI callback may substitute for durable persistence | Desktop projection adapter |
| Restart recovery | classify from the existing journal/recovery owner; do not infer authority from a transient projection | host recovery owner |

## Stage 2 gates

1. Stage 2A may remove confirmed value-import leaks and replace the Harness-facing UI callback, without
   moving host implementations or changing provider/tool/security behavior.
2. Stage 2C must give direct ACP an implementation of the smallest state contract it actually uses;
   ACP-specific lifecycle remains in the ACP peer.
3. Stage 2B may compose/extract the kernel only after the 2A/2C neutral boundaries are accepted.
4. The package gate must compile and import the emitted package entry in a clean Node consumer, with no
   `@/` or `@shared` aliases, application composition, Electron, or native host module evaluation.
5. The runtime gate must execute a fake two-round tool continuation and observe provider request,
   tool execution, tool result in the next provider request, final settlement, durable transcript,
   and event ordering.

## Explicit non-goals

No transport, CLI operation extension, renderer protocol change, universal repository, service
locator, second event bus, second database owner, plaintext credential fallback, or ACP routing
through `DeepChatLoopEngine` is part of Stage 2.
