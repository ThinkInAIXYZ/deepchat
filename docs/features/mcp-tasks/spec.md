# MCP Tasks Extension

Status: externally blocked on a public v2 Tasks adapter/dispatch API as of 2026-07-29.

## Status Warning

MCP 2026-07-28 documentation presents Tasks as a first-class extension and describes
`io.modelcontextprotocol/tasks`. The authoritative `modelcontextprotocol/ext-tasks` repository,
however, currently states that it is experimental, not official, has only a draft specification,
and publishes no SDK package.

DeepChat plans against the exact pinned draft, exposes its status honestly, and avoids inventing a
private Tasks protocol. No implementation phase after the upstream gate may start while the public
API is absent. DeepChat must not claim stable Tasks conformance while the upstream repository does
not.

There is also a hard SDK incompatibility. `@modelcontextprotocol/client@2.0.0` consumes modern
`resultType` internally, rejects unknown values such as `"task"`, and explicitly rejects
`tasks/*` as removed 2025-era methods on a 2026 connection before bytes reach the transport.
`client.request(..., schema)` is not an escape hatch because `tasks/get` is a reserved spec method,
not a vendor-prefixed custom method.

Therefore DeepChat must not enable Tasks by bypassing SDK dispatch, monkey-patching its registry, or
writing directly to the transport. Implementation is gated on an upstream public extension adapter
or dispatch API that supports the draft on the modern wire.

Pinned planning baseline:

- repository commit: `2c1425d9a288b9b1f489430fe1e00bb392b47e48`;
- extension ID: `io.modelcontextprotocol/tasks`;
- draft specification:
  https://github.com/modelcontextprotocol/ext-tasks/blob/2c1425d9a288b9b1f489430fe1e00bb392b47e48/specification/draft/tasks.md
- draft schema:
  https://github.com/modelcontextprotocol/ext-tasks/blob/2c1425d9a288b9b1f489430fe1e00bb392b47e48/schema/draft/schema.json
- overview:
  https://modelcontextprotocol.io/extensions/tasks/overview
- v2 SDK modern-wire behavior:
  https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28

Before implementation, re-check the upstream status. If a stable extension revision and official
package exist, replace this baseline and update the SDD before writing the adapter.

## User Need

Long-running MCP tools should not hold a transport or a DeepChat window open for minutes or hours.
When a server returns a durable task handle, DeepChat must show progress, collect mid-flight input,
support cooperative cancellation, survive reconnect/restart, and atomically replace the pending
tool result with the final result.

## Draft Protocol

The client includes the Tasks extension in per-request capabilities. A server advertises the same
extension through `server/discover` and may return a task only for a supported request. The pinned
draft supports `tools/call`.

The initial result has:

```ts
interface CreateTaskResult {
  resultType: 'task'
  taskId: string
  status: 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  ttlMs: number | null
  pollIntervalMs?: number
}
```

DeepChat then uses:

- `tasks/get` for the complete current state;
- `tasks/update` for keyed `inputResponses`;
- `tasks/cancel` for cooperative cancellation;
- `notifications/tasks`, optionally received through `subscriptions/listen`.

There is no `tasks/list`. DeepChat must never add one.

Terminal states are immutable:

- `completed` contains the original request's result;
- `failed` contains a JSON-RPC error;
- `cancelled` records cooperative cancellation.

A completed tool task may still contain `CallToolResult.isError: true`; that is a completed task
whose tool result reports an application error, not a failed Tasks state.

## Current Evidence

- `ToolManager.callTool` assumes a tool call resolves to a final response in the same in-memory
  operation.
- `MCPToolResponse` can carry structured content, but there is no task result branch.
- Assistant block persistence can hold additive metadata in `extra_json`.
- There is no durable MCP task index or main-process polling owner.
- Existing sampling support can fulfill draft `sampling/createMessage` input requests.
- DeepChat does not currently expose roots and has no complete elicitation router.
- Typed events and message tool blocks can present asynchronous status without exposing transport
  objects to the renderer.

## Enablement

While upstream is experimental, Tasks support is controlled by one advanced MCP setting:

```text
Enable experimental MCP Tasks
```

It defaults off and is shown only after the SDK compatibility gate passes. When enabled, DeepChat
advertises the pinned extension only after its complete lifecycle is implemented. The server still
decides per request whether to return a task.

Diagnostics show the pinned upstream commit. When a stable upstream revision exists, migration,
default enablement, and removal of the experimental label require an explicit compatibility change.

## Ownership

```text
Official Tasks adapter
  exposes task results and task requests through a public v2 extension API
        |
        v
McpTaskCoordinator (main)
  owns durable records, poll/subscription scheduling, input dedupe, cancellation
        |
        +--> ToolManager: atomically updates original tool result
        +--> typed events: renderer task status
        +--> interaction router: sampling / elicitation / empty roots
```

One coordinator is justified because tasks outlive the original call, renderer component, and
process connection. Renderer timers or one timer per mounted message are forbidden.

## Durable Data

Add an encrypted SQLite table because startup must query active tasks without scanning all message
JSON:

```ts
interface PersistedMcpTask {
  recordId: string
  serverId: string
  serverGeneration: number
  bindingHash: string
  serverNameSnapshot: string
  taskId: string
  conversationId: string
  messageId: string
  toolCallId: string
  blockIndexHint?: number
  transcriptRevision: number
  taskRevision: number
  toolName: string
  status: TaskStatus
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  ttlMs: number | null
  pollIntervalMs?: number
  nextPollAt?: number
  inputRequests?: Record<string, unknown>
  handledInputKeys: string[]
  finalResult?: Record<string, unknown>
  finalError?: Record<string, unknown>
  hostState: 'active' | 'paused' | 'cancel-requested' | 'unavailable'
  updatedAt: number
}
```

Use a random local `record_id` as the primary key. Enforce unique protocol binding
`(server_id, binding_hash, task_id)` and unique history binding `(message_id, tool_call_id)`.
`serverNameSnapshot` and `blockIndexHint` are display hints only. Validate all strings, timestamps,
nesting, and payload byte limits before persistence.

Task IDs are sensitive durable handles. They remain only in the SQLCipher table and main-to-server
protocol calls. Renderer routes, events, assistant-block descriptors, UI, and routine logs use the
random local `recordId`; main resolves it to the exact server/task binding and verifies
`RouteContext` plus conversation ownership.

The assistant tool block stores a smaller task presentation descriptor in `extra_json`. It is
updated atomically with the task row:

```ts
interface McpTaskDescriptor {
  version: 1
  recordId: string
  serverName: string
  toolName: string
  status: TaskStatus
  statusMessage?: string
  lastUpdatedAt: string
  hostState: 'active' | 'paused' | 'cancel-requested' | 'unavailable'
}
```

It contains no `taskId`, server endpoint, or binding hash.

## Tool Loop Semantics

Provider tool protocols generally require an immediate tool response. DeepChat therefore does not
leave an unresolved provider tool call or keep a model stream open for the task lifetime.

When a server creates a task:

1. persist the task before acknowledging it to the model loop;
2. place one bounded pending-task projection in the original tool response;
3. end the current provider tool step normally;
4. update the same tool response in place when the task becomes terminal;
5. never append a second response for the same provider tool call ID.

The authoritative history locator is `(messageId, toolCallId)`, not `blockIndex`. Terminal update
uses a compare-and-set on the expected task and transcript revisions, resolves the current block by
that locator, verifies its `recordId`, and updates the task row plus assistant block inside one
`SessionDatabase` transaction. `blockIndexHint` may speed display lookup but cannot authorize or
select an update. The transaction fails closed if the message was replaced, the tool call is
missing/duplicated, the descriptor changed, or another terminal update won.

DeepChat does not automatically start a new model turn when a task completes. The UI notifies the
user and offers **Continue with result**, which submits a normal user-controlled follow-up. Any
future turn sees the atomically updated final result in conversation history.

This avoids duplicate tool results, unsolicited model spending, and a continuation after the user
has changed conversation context.

## Polling And Notifications

Polling is the required baseline:

- use one scheduled timeout for the next due task, not one interval per task;
- honor `pollIntervalMs` and never poll faster than the server requests;
- default to 5 seconds when omitted;
- enforce a 1-second host minimum against zero/abusive values;
- add bounded jitter and exponential backoff after transport failures;
- reset backoff after a valid task state;
- stop on terminal state, local expiry, server removal, or explicit pause.

If `subscriptions/listen` acknowledges `notifications/tasks` for task IDs, use full-state
notifications instead of normal polling. On disconnect or subscription loss, return to polling.

Reject stale updates that would move a terminal task or regress a newer observed
`lastUpdatedAt`. A valid full-state notification and `tasks/get` response use the same validation
and persistence path.

`ttlMs` is measured from server `createdAt` and may change. When the observable TTL elapses without
a usable server state, stop polling and set host state `unavailable`; do not invent an `expired`
protocol status.

## Mid-Flight Input

An `input_required` state carries stable keyed requests. Persist outstanding keys and handled keys
before showing interaction UI.

Route each request through the same policy as its direct equivalent:

- `sampling/createMessage`: existing sampling review/provider path;
- `elicitation/create`: a host-owned typed form or URL action with explicit user consent;
- `roots/list`: return a truthful empty roots result because DeepChat exposes no client roots.

The input router is shared with modern core multi-round requests. It deduplicates a key for the
lifetime of one task. A renderer remount, repeat poll, notification, or restart must not show the
same input request twice.

After user response:

1. persist a pending response associated with the exact key;
2. call `tasks/update`;
3. mark the key handled only after an acknowledged update;
4. resume observation;
5. retry an unacknowledged update idempotently with the same key/value.

Reject unknown, reused, oversized, or changed requests under an existing key.

## Cancellation

The UI may request cancellation while a task is nonterminal.

- Persist `cancel-requested` before sending `tasks/cancel`.
- Cancellation acknowledgement means intent accepted, not task cancelled.
- Continue observing until a terminal state or TTL/unavailability.
- A later `completed` or `failed` state is valid because cancellation is cooperative.
- Conversation deletion cancels active tasks best-effort, then removes their local rows in the same
  deletion transaction.
- App shutdown persists active state; it does not issue mass cancellation.

## Restart And Server Lifecycle

On startup:

1. query nonterminal task rows;
2. validate descriptor and TTL;
3. group by immutable server identity and binding;
4. resume only after an enabled server connects;
5. leave disabled/missing servers paused with a visible action;
6. subscribe or schedule the next poll;
7. process pending acknowledged/unknown input responses safely.

Renaming preserves `serverId` and only refreshes the display snapshot. A config-generation or
binding-hash mismatch pauses the task and never transfers it to a re-pointed server. Deleting a
server asks whether active tasks should be best-effort cancelled, then removes local handles.
Authentication-required servers pause tasks until auth completes.

## Schema Boundary

There is no official Tasks package. Do not design an extension framework or hand-maintain a fork.

At implementation time:

1. require an official package or a v2 public extension API that can receive `"task"` and send
   `tasks/*` on the modern wire;
2. prefer an official package if one exists;
3. use the upstream adapter's schemas, or vendor the exact draft JSON Schema only as supplemental
   validation;
4. commit upstream license, source URL, commit, and SHA-256 provenance for any vendored schema;
5. add a drift check that reports upstream movement without auto-updating;
6. stop the implementation if the public API gate is still absent.

Do not import the draft repository's v1 `@modelcontextprotocol/sdk` types into DeepChat. Do not call
`tasks/*` through a private transport or cast around `MethodNotSupportedByProtocolVersion`.

## UI Shape

Before:

```text
+------------------------------------------------------+
| Tool · deploy_environment                            |
| Running...                                           |
|                                                      |
+------------------------------------------------------+
```

After:

```text
+------------------------------------------------------+
| Tool · deploy_environment                            |
| Task running · Building release image                |
| Updated 14:32 · next check in 5s                     |
|                                           [Cancel]   |
+------------------------------------------------------+

+------------------------------------------------------+
| Tool · deploy_environment                            |
| Input required                                       |
| Deploy release 2.4.0 to production?                  |
|                                                      |
|                                [Reject] [Approve]     |
+------------------------------------------------------+

+------------------------------------------------------+
| Tool · deploy_environment                            |
| Completed · Environment is healthy                   |
|                                           [Continue] |
+------------------------------------------------------+
```

Advanced setting:

```text
+------------------------------------------------------+
| MCP                                                  |
| [ ] Enable experimental MCP Tasks                    |
|     Implements draft 2c1425d; protocol may change.   |
+------------------------------------------------------+
```

Use the existing tool block and interaction primitives. Do not add a separate Tasks page. Status,
cancel, and input controls are keyboard accessible, localized, and do not rely on color.

## Resource Limits

- Maximum 1 MiB serialized full task state.
- Maximum 64 outstanding input keys per task.
- Maximum 256 active nonterminal tasks process-wide.
- Maximum status message length of 4 KiB.
- Maximum poll backoff of 5 minutes after failures.
- Completed task results use the core MCP tool result limits.

Reject new task creation above the active limit before advertising a successful pending result.

## Non-Goals

- No `tasks/list`.
- No private DeepChat task wire protocol.
- No Tasks support for methods not named by the pinned draft.
- No auto-started model continuation.
- No renderer-owned polling or task truth.
- No exposure of task IDs in normal logs or UI copy.
- No claim that the current upstream draft is stable.
- No migration of ACP's separate task/plan semantics into MCP Tasks.

## Acceptance Criteria

- Tasks are not advertised while the experimental setting is off.
- Tasks are not advertised when the SDK compatibility gate is absent, regardless of settings.
- No Tasks source, schema vendoring, migration, setting, or UI is added while Gate 0 remains
  unsatisfied; planning documentation is the only deliverable.
- With the setting on, compatible tool calls accept either complete or task results.
- Task state is durable before the pending tool result is returned.
- Polling respects server intervals, backoff, TTL, cancellation, and enabled server lifecycle.
- Acknowledged subscriptions replace polling and reconnect returns safely to polling.
- Restart resumes every valid active task exactly once without duplicate input UI.
- Sampling, elicitation, and empty-roots input paths preserve their direct trust behavior.
- Cancellation remains cooperative and accepts later completed/failed states.
- Terminal result/error atomically replaces the original pending tool response without a duplicate
  provider tool result.
- Terminal replacement locates history by `(messageId, toolCallId)`, verifies local `recordId`, and
  compare-and-sets task/transcript revisions in one database transaction; block index is never
  authoritative.
- Renderer routes/events expose only local record/interaction IDs and cannot select a server or
  protocol task handle.
- Server rename preserves a task binding; config-generation or binding mismatch pauses it.
- Completed `isError` tool results remain completed Tasks with an error tool presentation.
- Continue-with-result is user controlled.
- Upstream schema provenance is pinned and no v1 SDK type enters core.
- No private transport write, SDK registry patch, or unsafe type cast is used to cross the SDK
  compatibility gate.
- ACP-owned work is unchanged.
- Format, i18n validation, lint, typecheck, focused task/persistence/renderer tests, restart tests,
  and packaged long-running smokes pass.
