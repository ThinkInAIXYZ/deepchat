# MCP Tasks Extension Implementation Plan

Phases 1-9 are blocked design, not authorized implementation steps, until Gate 0 passes. With the
currently verified SDK, the correct execution result is to stop after Gate 0 and keep the extension
unadvertised.

## Gate 0: Revalidate Upstream

Before code:

1. inspect `modelcontextprotocol/ext-tasks` status, tags, packages, and current commit;
2. compare the current schema with pinned commit
   `2c1425d9a288b9b1f489430fe1e00bb392b47e48`;
3. verify that an official package or v2 public extension API can:
   - expose a modern `"task"` result before the SDK rejects it;
   - send `tasks/get`, `tasks/update`, and `tasks/cancel` on a modern connection;
   - receive `notifications/tasks`;
4. if stable/public artifacts exist, update this SDD and use them;
5. otherwise stop implementation and retain no Tasks advertisement.

Do not silently migrate to a moving `main`.

`client.request(request, schema)` alone does not pass this gate: v2 recognizes `tasks/*` as removed
legacy spec methods and rejects them on the modern era.

## Phase 1: Official Extension Adapter

After MCP v2 lossless result support:

- integrate the upstream public Tasks result/dispatch API;
- let the core SDK continue consuming standard complete/input-required results;
- distinguish a task only through the public extension adapter;
- preserve normal complete tool behavior;
- reject task results for methods not supported by the pinned draft;
- persist a task record before returning the pending projection.

Add a bounded pending projection for model/provider compatibility and a task descriptor for the tool
block.

## Phase 2: Pinned Schema Validation

If the public adapter does not package validators:

1. vendor `schema/draft/schema.json` at the pinned commit;
2. include Apache-2.0 provenance, source URL, commit, and SHA-256;
3. select/generate validators for create-task result, get, update, cancel, and notification state;
4. pass those validators through the public extension API;
5. add fixtures copied as protocol examples, not implementation code;
6. add a script/test that reports upstream hash drift but never rewrites files.

Keep the adapter under `src/main/mcp/tasks/`; no shared app type imports an upstream v1 SDK symbol.
If only private SDK hooks or direct transport writes can use the schemas, stop.

## Phase 3: Durable Task Store

Add a normalized SQLCipher table and migration:

```text
mcp_tasks
  random record_id primary key
  server_id + binding_hash + task_id unique
  server_generation + server_name_snapshot
  conversation_id + message_id + tool_call_id unique
  block_index_hint (non-authoritative)
  task_revision + transcript_revision
  protocol status and server timestamps
  scheduling fields and host state
  bounded detailed/input/result JSON
  handled input keys
  updated_at
```

Operations:

- insert before pending response;
- load active by server;
- compare-and-update full state transactionally;
- mark cancel requested;
- record pending/acknowledged input response;
- finalize task and the block found by `(messageId, toolCallId)` in one `SessionDatabase`
  transaction with task/transcript compare-and-set;
- cascade through existing conversation/server deletion services.

Do not let route handlers access the table directly; use `McpTaskStore`.
Audit existing history for duplicate `(messageId, toolCallId)` before adding the uniqueness
constraint. A duplicate/missing locator makes that task ineligible; never fall back to block index.

## Phase 4: Main Coordinator

Add one `McpTaskCoordinator` owned by the MCP presenter:

- register task;
- restore active tasks after database initialization;
- attach/detach server clients;
- choose subscription or polling;
- schedule the earliest due poll through one timeout;
- validate and persist full state;
- dispatch input requests;
- issue cancellation;
- finalize the original tool response;
- publish versioned task events.

Use a min-heap only if measured active-task volume makes sorted in-memory records too expensive.
With the hard limit of 256 tasks, sorting due timestamps is sufficient.

## Phase 5: Polling And Subscription

Polling:

- missing interval: 5 seconds;
- effective interval: at least 1 second and never less than the server value;
- jitter that does not move a request earlier than the server interval;
- exponential failure backoff capped at 5 minutes;
- no polling while server is disconnected, disabled, or auth-blocked.

Subscription:

- request task IDs through `subscriptions/listen`;
- start notification mode only after acknowledgement;
- process full states through the same validator/update function;
- fall back to polling on disconnect, rejection, or subscription loss.

Use fake timers for scheduling tests and real local server integration for subscription/reconnect.

## Phase 6: Shared Input Router

Create one MRTR input router used by direct v2 input-required responses and Tasks:

- sampling delegates to the existing sampling service;
- elicitation maps form schemas into host-owned controls or opens validated URLs with consent;
- roots returns an empty result;
- cancellation rejects pending user interaction;
- stable input keys deduplicate across poll, notification, remount, and restart.

Persist response intent before `tasks/update`. Mark completion only after acknowledgement.

The renderer receives an opaque interaction ID, presentation schema, local task `recordId`, and
localized server/tool identity. It does not receive the task transport handle, immutable server ID,
generation, or binding hash. Main resolves all actions from `recordId`, verifies
`RouteContext`/conversation ownership, and ignores renderer-supplied remote identity.

## Phase 7: Tool History Integration

On task creation:

- write one pending response to the existing tool block;
- allow the current provider step to complete.

On terminal state:

- validate the final result against the original request type;
- normalize it through the same `ToolManager` result path as a synchronous result;
- locate the block by `(messageId, toolCallId)`;
- verify its local `recordId` and expected transcript/task revisions;
- compare-and-set the task row and replace the pending response/descriptor in one
  `SessionDatabase` transaction;
- publish one renderer event;
- never append another provider tool response.

Add a Continue action that creates a normal user follow-up through the existing chat API. It is not
triggered automatically.

## Phase 8: Renderer

Extend `MessageBlockToolCall.vue` with a focused task status child component:

- working status and last update;
- paused/unavailable state;
- cancel/cancel-requested;
- input request using existing interaction primitives;
- completed/failed/cancelled terminal display;
- Continue with result.

Keep current tool detail, image, diff, and MCP App presentation working for the final result. Task
state comes from persisted blocks plus versioned events; no renderer timers poll the server.

Add the experimental toggle under advanced MCP settings with upstream revision copy.

## Phase 9: Lifecycle

- Resume enabled-server tasks after app restart.
- Pause disabled, missing, or auth-required servers.
- Pause config-generation/binding mismatches; rename updates only the display snapshot.
- Confirm and best-effort cancel before deleting a server with active tasks.
- Best-effort cancel during conversation deletion, then remove local rows transactionally.
- Persist without cancelling on normal app shutdown.
- Stop locally on TTL and expose retry/check action without inventing protocol status.

## Test Matrix

### Schema And State

- all five states;
- result/error/input required shape;
- unsupported task-augmented method;
- completed `isError`;
- stale update and terminal regression;
- TTL changes and invalid timestamps.

### Scheduling

- default/server interval;
- minimum, jitter, and backoff;
- no duplicate timers;
- subscription acknowledgement/fallback;
- disconnect/reconnect;
- 256-task bound.

### Input

- sampling approve/reject/cancel;
- elicitation form/URL approve/reject/cancel;
- empty roots;
- repeated/changed/reused keys;
- update acknowledgement and retry;
- restart with pending interaction.

### Durability

- create-before-pending ordering;
- restart resume;
- disabled/missing/auth-blocked server;
- atomic terminal result replacement;
- current-block resolution by `(messageId, toolCallId)` after a full message-block rewrite;
- stale task/transcript revision and duplicate/missing tool-call locator rejection;
- conversation/server deletion;
- no duplicate provider tool response.

### Renderer

- every status and host state;
- input focus/accessibility;
- cancel requested;
- Continue action;
- final normal result and MCP App rendering.
- no task ID, server ID, or binding hash in renderer routes/events.

### Packaged Smoke

Do not run or claim this smoke while Gate 0 is blocked. After an official public v2 adapter exists,
pin it and execute `MV-TASK-01` from
`../../architecture/mcp-v2-protocol/manual-verification.md` with a deterministic local server that:

- completes after multiple polls;
- sends task notifications;
- requests input;
- ignores cancellation then completes;
- returns a failed state;
- survives client restart.

## Rollback

Disable extension advertisement and leave task rows/descriptors inert. Existing pending tasks remain
visible as paused experimental tasks and can be removed locally. Do not rewrite them into successful
tool results.

If the upstream draft changes incompatibly, keep the pinned adapter available long enough to finish
or cancel existing pinned-revision tasks while new connections use no Tasks extension until the
migration lands.
