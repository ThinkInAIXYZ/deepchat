# V1 CLI Compatibility Mapping

Stage 1D record for [Standalone Agent Service Architecture](./spec.md) and its
[development plan](./plan.md). It maps the maintained V1 local-control surface onto the Stage 1
client contract, states where a compatibility handler runs, and records which mappings are proved by
the current code and which are cutover blockers. It is additive: the maintained contract is
[Local Control Plane and Bundled CLI V1](../local-control-plane/spec.md) and stays authoritative.

This slice changes no production code, no test, no maintained spec, and no frozen contract file.

## Scope

Mapped here: the V1 run surfaces — `sessions.runDetached`, `runs.get`, `runs.cancel`,
`events.subscribe` and its 14-event stream vocabulary — onto the Stage 1 client operations, error
vocabulary, cursor model, and resync path.

Not mapped here, and not claimed: session list/create/close, steering, pending-input queue mutation,
artifact read, provider/model admin, and the other `CLI_SURFACE` capabilities. They are untouched
V1 surfaces and stay where they are.

### Ablations this slice refuses

- No new generic RPC, route tunnel, or second protocol version.
- No second event bus, event owner, database owner, or runtime owner. The compatibility handler
  reuses the existing typed event hub and the service's own admission path.
- No new API surface to make V1 fit the seven client operations. Where V1 needs something the
  seven operations do not express, this document says so and names the later slice that owns it.
- No change to the V1 strict route outputs, stream event names, `recoveryReason` values, or error
  codes. The CLI validates stream events against the maintained contracts
  (`src/cli/run.ts:173-177`), so an added or renamed event is not new data — it is a fail-closed
  `internal_error` and exit `8`.
- No host port on the wire. `RunLifecyclePort`, `RunTurnPort`, `RunProjectionPort`,
  `RunSessionStorePort`, the two callback options, and the hub itself stay host-side values
  (`src/main/cli/runService.ts:50-89`). [spec.md](./spec.md) already forbids runtime instances,
  callbacks, `AbortSignal`, database connections, and provider clients crossing the boundary.

## Where the compatibility handler runs

The handler is deployed on the service-authoritative host side (Stage 3), constructed over the same
lifecycle, turn, projection, and admission path the service uses for every other client, and it
publishes into the one event hub. The CLI keeps calling it remotely (Stage 4 transport, Stage 6
commands) and loads no agent runtime, provider, credential, MCP, or database code of its own.

Concretely, the target keeps this shape and moves its construction site, not its collaborators:
today `new CliRunService({ lifecycle: sessionLifecycle, turn: sessionTurn, projection: sessionQuery,
sessions: appSessionService, getPendingAssistantMessages, hasWaitingDescendantInteraction, eventHub })`
is built by the Desktop composition root (`src/main/app/composition.ts:2156-2173`). Desktop never
reads a second database: the compatibility handler is a client of the same single owner, not a
parallel reader of the owner's database.

## Route mapping

| V1 surface | Declared in | Effect / callers / scopes | Closest Stage 1 operation | Mapping status |
| --- | --- | --- | --- | --- |
| `sessions.runDetached` | `src/shared/contracts/routes/runs.routes.ts:69`; surface entry `src/main/cli/surface.ts:552` | compute / human only / `sessions:run` | none — it is session creation plus an initial submission | host route; not expressible in the seven operations (no `createSession`) |
| `runs.get` | `src/shared/contracts/routes/runs.routes.ts:107`; `src/main/cli/surface.ts:574` | read / human + agent / `runs:read` | `readSnapshot` (shape only, not semantics) | host projection required for every field |
| `runs.cancel` | `src/shared/contracts/routes/runs.routes.ts:119`; `src/main/cli/surface.ts:584` | local-maintenance / human + agent / `runs:cancel` | `cancel` with layer `running_run` | host route over the cancellation layer |
| `events.subscribe` | `src/shared/contracts/routes/runs.routes.ts:131`; `src/main/cli/surface.ts:595` | read / human only / `runs:read` | `subscribe` (bounded catch-up only) | host adapter; live delivery is Stage 4 |

### `sessions.runDetached`

Handler: `CliRunService.startDetachedRun` (`src/main/cli/runService.ts:247-332`). It creates a
detached session through the lifecycle port (`:257-270`, `metadata: {source: 'cli_run'}` at `:269`),
publishes `runs.created`, starts the initial turn through the turn port (`:285-289`), publishes
`runs.turn.accepted` with the original request/message/time (`:311-322`), and answers with
`runId`, `sessionId`, `status`, `requestId`, `messageId`, `createdAt` (`:324-331`).

The seven Stage 1 operations cannot express this: `client.ts` states the closed vocabulary has no
`createSession`, and `submit` requires an existing `sessionId`
(`src/shared/contracts/agent-service/client.ts:63-72,134-140,238-248`). Forcing the route into
`submit` would mean either inventing a session id client-side or extending the operation vocabulary
in a documentation slice — both refused here. Stage 2 owns extracting the session-creation port;
Stage 3 implements it in the host. Until then the route is a host-side composite of
`RunLifecyclePort.createDetachedSession` plus `RunTurnPort.sendMessage`, which is what it already is.

### `runs.get`

Handler: `CliRunService.getRun` → `buildSnapshot` (`src/main/cli/runService.ts:334-337,475-503`).
`PublicRunSnapshotSchema` is strict (`src/shared/contracts/routes/runs.routes.ts:51-67`), so every field
must be produced; a missing one is a validation failure and an `internal_error`, never a degraded
payload. That is why
"missing data" is a cutover blocker and not a drop-and-default policy.

What the host projection must supply, and why the Stage 1 snapshot cannot stand in for it:

| Field | Source today | Why `readSnapshot` cannot supply it |
| --- | --- | --- |
| `phase` (`running` / `awaiting_interaction` / `terminal`) | `runPhase` over session status, pending assistant messages, and descendant-wait (`runService.ts:125-144,495-499`) | The Stage 1 snapshot has `status` and `pendingInteractions`, but no descendant-wait fact and no in-flight assistant read |
| `agentId`, `title`, `providerId`, `modelId`, `createdAt`, `updatedAt` | the session read and its field mapping (`runService.ts:481,491-503`) | absent from the Stage 1 snapshot DTO |
| `messages[]`, `nextCursor`, `hasMore` | `projection.listMessagesPage` with `cursor`/`limit` (`runService.ts:482,159-186`) | `readSnapshot` has no cursor or limit input, so V1 keyset pagination is not expressible; `readSnapshot` answers `messagesTruncated` instead of a page cursor |
| `messages[].text`, `textTruncated` | text-only projection with `RUN_MESSAGE_MAX_TEXT_BYTES` (`src/shared/contracts/routes/runs.routes.ts:13`, `src/main/cli/runService.ts:96-107,146-157`) | The Stage 1 snapshot carries `text`/`textTruncated` and a matching 128 KiB bound (`events.ts`, `AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES`), but its `messages` are a single bounded window, not a page chain |

`readSnapshot`'s `messagesTruncated` means the opposite of what a V1 reader needs: a truncated window
plus no paging operation is history a client can never read. So the paged text read is a required
Stage 2 port, not a convenience.

### `runs.cancel`

Handler: `CliRunService.cancelRun` (`src/main/cli/runService.ts:339-361`). Only `generating` runs are
cancelled (`:342`), so `cancelRequested` is a request flag and `status` is the state observed after
the request — it may already be `idle`. The route is idempotent and ownership-checked
(`:340,452-465`), matching [local-control-plane/spec.md](../local-control-plane/spec.md).

Mapping onto the Stage 1 cancellation layers (`src/shared/contracts/agent-service/interactions.ts`,
`AGENT_SERVICE_CANCELLATION_LAYERS`) uses `running_run` only. The handler must first resolve the
legacy V1 root/session identity to the current service execution identity; it must not pass the V1
root ID as `running_run.runId`. The identity table is:

| Identity | Authority and use |
| --- | --- |
| V1 root/run ID | legacy root session ID; resolves descendants to the root for V1 ownership and stream routing |
| service session/instance identity | host-authoritative service instance plus session identity used for admission and authorization |
| internal `loop.runId` | one built-in loop execution; generation fence only, never a wire identity |
| service execution `runId` | current service execution target for `running_run`; resolved by the host from the root/session mapping |

V1 supplies only the root ID, not an expected execution. A request therefore targets the root's
active generation at admission; the host cannot distinguish a historical client's intent to cancel
an older execution. No V1 field is added. At cutover, the host must capture the service instance,
session, and execution at admission and fence that in-flight cancellation so it cannot affect a
replacement run. Today's `cancelGeneration(sessionId)` port (`runService.ts:60,344`) carries neither
service instance nor execution identity and is not proof of that fence. Admission capture and the
generation fence are Stage 2/4 proof obligations, not implemented service guarantees.

- `cancelled` means the named target has settled due to cancellation, not merely that cancellation
  was admitted.
- `already_settled` means the named target is already inactive, whether before admission or because
  of a settlement race. It does not determine the pre-cancel `cancelRequested` observation.
- `cancelRequested` is derived from the pre-cancel generating observation. It is not an alias for
  the settled `cancelled` outcome; a later status read may already be terminal while V1 still returns
  `cancelRequested: true`.
- `queued_submission` has no V1 route today: V1 exposes pending inputs as
  `sessions.pendingInputs.changed` (not in the run stream vocabulary) and no CLI cancellation of one.
  It is unused by this mapping, not absent from the contract.
- `active_turn` has no V1 route either. `runs.cancel` cancels the root session's generation
  (`src/main/cli/runService.ts:344`), which is the run layer, not the narrower request layer.
Two directional rules follow, and both matter because only one of them is a request:

- `runs.cancel.requested` is published only when the run was still generating (`:343-353`), carries
  `requestedAt`, and says nothing about settlement. A cancellation receipt must never be emitted as
  `runs.cancel.requested`, and the event must never be read as `cancelled`.
- The receipt's `outcome`/`settledAt` must describe settlement of the captured named target;
  `cancelRequested` records the pre-cancel status. Neither fact can be synthesized from the other.

### `events.subscribe`

Handler: `CliRunService.subscribeToRun` (`src/main/cli/runService.ts:363-440`). It requires the run
to exist and be owned (`:369-372`), subscribes on the hub's run stream (`:375-378`), and emits the
snapshot plus live records. Stage 1's `subscribe` answers a bounded catch-up replay and a resync
verdict in one response (`events.ts`, `AgentServiceEventSubscriptionResponseSchema`); V1 is a live
NDJSON stream with a per-connection wire `sequence`. The compat adapter therefore owns live delivery
on top of the hub, and the Stage 1 subscription response is only its catch-up half.

`respond` has no V1 route and must not be exposed through one: V1 approval resolution is
renderer-only, and the socket exposes pending status only
([local-control-plane/spec.md](../local-control-plane/spec.md), architectural invariant 5).

## Run identity

| Identity | Today | Rule for the mapping |
| --- | --- | --- |
| V1 `runId` | the root session id, created with `metadata.source === 'cli_run'` (`runService.ts:269-271`); descendants resolve to that root by parent walk (`src/main/app/composition.ts:910-923`) | stays the only run identity on the V1 surface |
| service execution `runId` | `AgentServiceRunIdSchema`, internal execution identity (`common.ts`) | never substituted for the V1 `runId`, and never exposed as one |
| `runId` vs `sessionId` | on a detached run they are equal (`src/shared/contracts/routes/runs.routes.ts:69-105`, `src/main/cli/runService.ts:323-331`) | equality is a current fact, not a contract; a mapping must read both fields, not assume `sessionId === runId` |

`runs.created` means **creation**, not execution start. It is published immediately after the
detached session exists, before the initial turn is attempted (`runService.ts:272-281`). A service
`run.started` is a different fact and must not be projected as `runs.created`; a client that treats
the V1 event as "the run began" is already reading more than the event says.

## Event mapping: the 14 `RUN_STREAM_EVENT_NAMES`

Vocabulary and enum: `src/shared/contracts/events/runs.events.ts:76-97`. Run-target publication is
gated by `RUN_STREAM_EVENTS` in `src/main/events/sessionEventRouter.ts:9,107-111`, so the run stream
only ever carries names from that set. Names outside it are rejected by the CLI
(`src/cli/run.ts:173-177`), which is why the adapter filters to these 14 and adds none.

### Handler-owned events (5)

| Event | Schema | Producer today | Semantics the mapping must preserve |
| --- | --- | --- | --- |
| `runs.created` | `src/shared/contracts/events/runs.events.ts:17-27` | `src/main/cli/runService.ts:272-281` | payload: `runId`, `sessionId`, `status`, `createdAt`; creation only, not a start or first-token signal |
| `runs.turn.accepted` | `src/shared/contracts/events/runs.events.ts:29-40` | `src/main/cli/runService.ts:311-322` | payload: `runId`, `sessionId`, nullable `requestId`, nullable `messageId`, `acceptedAt`; acceptance of the initial turn, not reconstructible later |
| `runs.turn.failed` | `src/shared/contracts/events/runs.events.ts:42-52` | `src/main/cli/runService.ts:295-304` | payload: `runId`, `sessionId`, `failedAt`, `error`; initial-turn start failure only, with fixed sanitized text `Detached Agent run could not start`; provider failure is `chat.stream.failed` |
| `runs.cancel.requested` | `src/shared/contracts/events/runs.events.ts:54-63` | `src/main/cli/runService.ts:343-353` | payload: `runId`, `sessionId`, `requestedAt`; request only when the run was generating |
| `runs.snapshot` | `src/shared/contracts/events/runs.events.ts:65-74` | `src/main/cli/runService.ts:393-402` | payload: `cursor`, `recoveryReason`, `run`; authoritative resync record; CLI requires cursor and requested run ID match (`src/cli/run.ts:107-113`) |

### Session/chat events (9)

All nine are existing events with existing payload schemas; the mapping adds no schema and no
producer. The compatibility handler emits only events produced by the matching existing producer;
it does not forward arbitrary payloads through `event.data`. The actual fields and producers are
listed below, with projection and path rules called out where they matter.

| Event | Schema | Producer today | Notes for the mapping |
| --- | --- | --- | --- |
| `chat.stream.updated` | `src/shared/contracts/events/chat.events.ts:10-22` | `src/main/agent/deepchat/runtime/dispatch.ts:1901`; `src/main/agent/deepchat/runtime/deepChatLoopRunner.ts:2723,2734`; `src/main/agent/deepchat/runtime/echo.ts:18` | payload: `kind` (`snapshot`), `requestId`, `sessionId`, `messageId`, optional `providerId`/`modelId`, `updatedAt`, `blocks`; blocks are client-projected |
| `chat.stream.completed` | `src/shared/contracts/events/chat.events.ts:24-32` | `src/main/agent/deepchat/runtime/messageProjectionService.ts:28`; `src/main/agent/deepchat/runtime/dispatch.ts:3538,3560`; `src/main/agent/acp/compatibility/adapters.ts:194` | payload: `requestId`, `sessionId`, `messageId`, `completedAt`; provider-round progress, not run termination |
| `chat.stream.failed` | `src/shared/contracts/events/chat.events.ts:34-43` | `src/main/agent/deepchat/runtime/turnCoordinator.ts:1465,1846,2045`; `src/main/agent/deepchat/runtime/dispatch.ts:3581`; `src/main/agent/deepchat/runtime/interactionCoordinator.ts:549`; `src/main/agent/deepchat/runtime/providerPermissionCoordinator.ts:238` | payload: `requestId`, `sessionId`, `messageId`, `failedAt`, `error`; provider-round failure, not `runs.turn.failed` |
| `chat.plan.updated` | `src/shared/contracts/events/chat.events.ts:45-56` | `src/main/agent/deepchat/runtime/dispatch.ts:938` | payload: `sessionId`, `messageId`, optional `toolCallId`, `plan`, optional `explanation`, `revision`, `updatedAt`, optional `terminalReason` |
| `sessions.status.changed` | `src/shared/contracts/events/sessions.events.ts:41-48` | `src/main/agent/deepchat/runtime/sessionStatusPublisher.ts:45-48` | payload: `sessionId`, `status`, `version`; `version` is currently `Date.now()` at line 48, not the service event sequence; only root-session `idle`/`error` terminates its run stream |
| `sessions.compaction.changed` | `src/shared/contracts/events/sessions.events.ts:50-57` | `src/main/agent/deepchat/runtime/compactionRuntimeCoordinator.ts:540` | payload: `status`, `cursorOrderSeq`, `summaryUpdatedAt`, `boundaryReason` (default null), `sessionId`, `emitSeq`, `latestAnchorEntryId`; inherited state fields: `src/shared/contracts/common.ts:130-135`; not a run terminal |
| `sessions.acp.modes.ready` | `src/shared/contracts/events/sessions.events.ts:86-96` | `src/main/agent/acp/runtime/acpProcessManager.ts:2226`; `src/main/agent/acp/createRuntimeOwner.ts:30` | payload: optional `conversationId`, `agentId`, `workdir`, `current`, `available`, `version`; ACP-only |
| `sessions.acp.commands.ready` | `src/shared/contracts/events/sessions.events.ts:98-106` | `src/main/agent/acp/createRuntimeOwner.ts:40` | payload: `conversationId`, `agentId`, `commands`, `version`; no `workdir` |
| `sessions.acp.configOptions.ready` | `src/shared/contracts/events/sessions.events.ts:108-117` | `src/main/agent/acp/runtime/acpProcessManager.ts:2238`; `src/main/agent/acp/createRuntimeOwner.ts:35` | payload: optional `conversationId`, `agentId`, `workdir`, `configState`, `version`; ACP-only |

Projection rules:

- **`blocks` must be projected before emission.** `chat.stream.updated` payloads are built for
  clients through the renderer projection, which strips `providerReplayJson` from block extras
  (`src/main/session/clientMessageProjection.ts:15-32,34-47`). The same rule guards transcript reads
  (`:49-67`). A compatibility adapter that forwards hub payloads wholesale inherits whichever
  projection the producer applied; one that builds a payload from transcript rows must apply this
  projection itself. `providerReplayJson` is provider continuation state and must not reach CLI
  NDJSON.
- **ACP events are not fabricatable.** The three `sessions.acp.*` events come from ACP producers,
  not the built-in loop. Routing permits a session that resolves to a CLI run root
  (`src/main/app/composition.ts:910-923`). The inspected detached path calls
  `createDetachedSession` (`runService.ts:257`), which resolves an assignment
  (`src/main/session/lifecycle.ts:193-203`); the assignment policy supports ACP
  (`src/main/session/assignmentPolicy.ts:52-71`). There is no `resolveRunConfig` rejection in this
  revision, so absence of ACP events from a built-in execution is not proof that all detached runs
  reject ACP. The Desktop ACP peer retains its trusted workspace boundary and existing payload.
  Missing required data never permits silent degradation, field removal, or an invented empty path.
  `commands.ready` has no `workdir`. This mapping adds no capability or workspace-path design.
- **A silent stream is not a finished run.** The router drops events whose session no longer resolves
  to a CLI run root (`src/main/events/sessionEventRouter.ts:105-111`). Absence is not completion.
  `isTerminalEvent` (`src/main/cli/runService.ts:442-449`) terminates only for `runs.turn.failed`
  whose `runId` matches the subscribed run, or `sessions.status.changed` whose `sessionId` equals
  the root run ID and whose `status` is `idle` or `error`. A child's `idle` never ends the root stream.
  An already-terminal snapshot also ends the subscription (`runService.ts:392-410`); resync uses
  `runs.snapshot`.

## Cursors, epochs, and resync

A cursor is only meaningful inside the stream that issued it. Three different things are called a
sequence in this migration:

| # | Stream | Meaning | Lifetime |
| --- | --- | --- | --- |
| 1 | V1 hub run stream | `${hubEpoch}_${streamIncarnation}:${sequence}` (`src/main/events/typedEventHub.ts:364,376`) | authoritative for the V1 surface |
| 2 | Stage 1 session event stream | the envelope's `cursor` and `sequence`, which the schema forces to agree (`events.ts`, `AgentServiceEventEnvelopeSchema`) | the service's own ordering |
| 3 | NDJSON wire `sequence` | counted per HTTP stream response, starting at `0` for each request (`src/main/cli/server.ts:1087-1106`) | a delivery counter, not a resume position |

Rules:

- **Same schema is not the same stream.** A service `sequence` counts that service stream's events;
  a hub `sequence` counts events published to that run target; the wire `sequence` counts records in
  one response. No zero-transformation mapping exists between them, and no comparison of the numbers
  is meaningful. The V1 hub cursor stays authoritative on the V1 surface
  (`src/main/cli/runService.ts:389,417-418,439`).
- **The wire counter restarts.** A resumed subscription restarts its NDJSON `sequence` at `0` while
  the hub cursor continues, so the CLI resumes only by cursor (`src/cli/run.ts:173-177`). A client
  that stored a wire `sequence` as its position has stored nothing.
- **A service restart must break continuity, not hide it.** With a surviving hub, the stream for a
  run is still alive in the same epoch and incarnation, so a cursor issued before the restart would
  resolve as an ordinary continuation (`src/main/events/typedEventHub.ts:391-406`) even though the
  execution the client was watching is gone. The current hub incarnation change alone maps to
  `cursor_expired`, not `server_restarted`. Before cutover, the host must explicitly record the
  service instance change and choose a recovery override or epoch invalidation that proves
  `server_restarted`; never claim the current API already provides that signal.
- **Retention is bounded, in two ways.** A hub stream retains up to 4 MiB and the hub up to 32 MiB
  (`src/main/events/typedEventHub.ts:101-102`). A record larger than the per-stream budget is
  delivered live but not retained (`src/main/events/typedEventHub.ts:286-288`). Do not overstate this
  as an automatic `cursor_expired`: `resolveRecovery` checks the oldest retained sequence, so a
  retained `a`, oversized (unretained) `b`, and normal retained `c` can leave the hole in `b`
  undetected. Before cutover, prove gap recovery and that coalescing cannot silently confuse a missing
  event with a retained one. Replay is a convenience, never the recovery mechanism — `runs.snapshot` is.

### Resync reason mapping

Stage 1 reasons: `events.ts`, `AGENT_SERVICE_EVENT_RESYNC_REASONS`. V1 reasons:
`runs.events.ts:10-15`.

| Stage 1 | V1 | Where it surfaces |
| --- | --- | --- |
| `cursor_expired` | `cursor_expired` | in-band `runs.snapshot`, then the same live stream unless terminal; no blind retry |
| `cursor_ahead` | `cursor_ahead` | in-band `runs.snapshot`, then the same live stream unless terminal; no blind retry |
| `service_restarted` | `server_restarted` | in-band `runs.snapshot`, then the same live stream unless terminal; no blind retry |
| `replay_limit_exceeded` | `cursor_expired` | in-band `runs.snapshot`. V1 has no separate name, and adding a fifth `recoveryReason` would extend a strict payload |
| `buffer_overflow` | not a reason | **not** an in-band reason: the V1 outcome for a subscriber that cannot keep up is the terminal `409 result_too_large` carrying `details.lastCursor` (`runService.ts:426-433`) |
| V1 `cursor_missing` | `cursor_missing` | produced when the subscription carried no cursor (`typedEventHub.ts:391`); Stage 1's `cursor: null` ("start from now", `events.ts`) must project onto this, and it must carry a snapshot, because a V1 client with no snapshot has no authoritative state |

Current V1 snapshot recovery continues on the same subscription unless terminal
(`runService.ts:391-424`); it does not require resubscription. This is not a generic next-action rule
for a Stage 1 resync verdict: the later adapter must honor that verdict and its authoritative snapshot
requirements, not blindly retry V1. A terminal buffer overflow closes the stream; any reconnect must
explicitly use `details.lastCursor` and process recovery. A capacity refusal creates no subscription;
a later connection attempt is a separate admission, not in-band recovery.

Two further limits must not be invented:

- **`429 rate_limited` is hub capacity, not a service error.** The only 429 today is
  `TypedEventHubCapacityError` at subscribe (`runService.ts:379-386`), i.e. too many active
  subscribers. The Stage 1 error vocabulary has no equivalent code — `service_unavailable` means the
  service is unavailable, not that one subscriber too many arrived — so a service-side capacity
  refusal must not be mapped onto 429. It is a Stage 4 decision.
- **Accepted budgets must reflect the real hub.** The Stage 1 subscription request allows
  `maxBufferedEvents` up to 1024 (`events.ts`, `AGENT_SERVICE_EVENT_MAX_BUFFERED_EVENTS`), while the
  hub's per-subscriber queue defaults are 64 events and 1 MiB (`typedEventHub.ts:103-104`) and its
  retained-window default is 256 events (`:100`). The adapter must echo the budget it can actually
  keep in `acceptedMaxBufferedEvents` and `acceptedMaxReplayEvents`; declaring 1024 is not a promise
  the current hub can honour.

## Error mapping

`AGENT_SERVICE_ERROR_CODE_TO_LOCAL_CONTROL_CODE` (`common.ts`) is total by construction. Combined
with `src/cli/errors.ts:39-60`, the V1 surface maps as follows:

| Stage 1 code | Local-control code | CLI exit |
| --- | --- | --- |
| `invalid_request` | `invalid_request` | `2` usage |
| `unauthorized` | `authentication_failed` | `4` authorization |
| `forbidden` | `permission_denied` | `4` authorization |
| `not_found` | `not_found` | `6` domain |
| `conflict` | `conflict` | `6` domain |
| `duplicate_submission` | `conflict` | `6` domain |
| `capability_unavailable` | `unavailable` | `3` unavailable |
| `service_unavailable` | `unavailable` | `3` unavailable |
| `internal` | `internal_error` | `8` internal |

These nine service codes are not the complete CLI error table. Existing CLI-only outcomes retain
exit `5` for approval required, exit `7` for timeout/cancel, and exit `0` for success; they are not
additional service error codes and must not be presented as a one-to-one nine-code CLI table.

Three consequences the mapping must not paper over:

- `capability_unavailable` and `service_unavailable` collapse into one local-control code, and
  `duplicate_submission` collapses into `conflict`. The distinguishing detail has to survive
  somewhere other than the code.
- The V1 error object is strict (`src/shared/contracts/localControl.ts:186-193`), so detail cannot be
  added as new top-level fields, and no new code may be added without changing the maintained error
  table.
- The existing `details` record has room for the distinction. The V1 projection must preserve the
  original service code in the existing details map, without reparsing it into the eight-key service
  details schema: `{ ...safeDetails, agentServiceCode: error.code, capability, requiredClient }`.
  `agentServiceCode` is authoritative and must not be overwritten by `safeDetails`; `capability` and
  `requiredClient` are added only when present. This is a V1 projection, not a second service-details
  parse, so the service's ninth semantic key is not a reason to reject the error. Enforce the existing
  V1 detail budgets and never include secret-bearing or absolute-path error text. Nothing new may be
  projected from `message`, which is display text.

The fixed sanitized start failure stays fixed: `RUN_START_FAILURE_MESSAGE`
(`runService.ts:47,301,305`) is the only public text for a failed initial turn, and the upstream
error is never echoed to the response, the event, or the log (`:291-294` logs the error name only).

## Frozen submission, interaction, and cancellation semantics

These contract semantics are integrated at `b17577182` and independently accepted. They are not
runtime or V1 integration evidence. [plan.md](./plan.md#stage-1--freeze-the-client-facing-contract)
is the sole acceptance tracker; the mapping depends on these rules:

- `submissionId` idempotency scope is `(serviceInstanceId, sessionId, submissionId)`, and
  authorization is decided before the key is consulted: authorization prevents an unauthorized read
  or mutation, but scope has no caller component. Two authorized clients sharing the same service
  instance and session can therefore collide on one submission key; that is intentional and must be
  handled by the duplicate-submission rule. An unauthorized submission never receives a duplicate
  receipt.
- A retaining binding answers a repeat of the same key with the same text as the **same** acceptance
  (duplicate receipt, no second execution); the same key with different text is
  `duplicate_submission` with no execution.
- Submission identity and acceptance are retained through the queued and running lifetime. After a
  prune, `not_found` reports that this binding holds no record — absence is not proof of
  non-execution, and `not_found` never authorizes a resubmission.
- A binding that answers `receipt_not_retained` promises no deduplication at all; a client must not
  auto-retry on it.
- `running_run` cancellation must not delete queued submissions as a side effect. `active_turn`
  stops the named request's output only; it does not settle the run.
- `messagesTruncated` still requires a paged read to be complete. The seven operations do not expose
  pagination today, so no client may treat a truncated snapshot as the transcript.

The V1 route above is unaffected in shape by these rules — it has no submission id and no layered
cancellation. `querySubmission` is already one of the seven Stage 1 operations, so a claim that the
contract lacks receipt query is incorrect. V1 itself does not expose that operation; the compatibility
handler must not invent a V1 route for it. Pending-input queue state and queued cancellation already
have DTO/event representation; the later gap is steering and explicit queue-management routes, not
an absent queue capability.

## Snapshot consistency requirement

`runs.snapshot` must be taken at the cursor it publishes, and the CLI enforces the cursor half of
that (`src/cli/run.ts:107-113`). The ordering half is not proved by the current code: the handler
subscribes at the current hub position (`runService.ts:375-378`), then reads session state
asynchronously (`:391` into `:475-503`, a `Promise.all`), then emits the snapshot labelled with the
pre-read cursor (`:394-402`). Events published between subscribe and the state read are both
reflected in that state and delivered afterwards, so an event can arrive that the snapshot already
includes.

Before cutover, the handler must establish one of: (a) the snapshot state is a function of the
transcript at the published cursor, or (b) exactly which snapshot fields are exempt from that
ordering, and why a client re-applying a later event is unaffected. Choosing neither and calling the
current async read proof of atomicity is not acceptable — the property is needed because the V1
contract says resync is authoritative.

## Cutover blockers

Recorded as blockers rather than resolved by dropping data or defaulting it:

1. **Host projection ports (Stage 2/3).** Session metadata, text-only keyset message pagination,
   in-flight assistant messages, and root/descendant waiting must exist as narrow host ports. Without
   them `runs.get` cannot produce a strict-valid output.
2. **Snapshot and cursor ordering** as stated above.
3. **Service-restart cursor invalidation**: a pre-restart cursor must not read as a valid
   continuation.
4. **Service-side subscriber capacity** has no V1 error code; the 429 producer today is hub-only.
5. **The seven operations are not the terminal client vocabulary.** `querySubmission`,
   `snapshot.queuedSubmissions`, and `cancel` with `queued_submission` already exist. Session
   create/list/delete, steering, explicit queue management, and paged transcript/artifact reads do
   not. The consuming stage must extend the typed contract before depending on these missing
   operations; no private channel or silent degradation substitutes for that extension.
6. **Cancellation admission and generation fencing (Stage 2/4)** must bind the in-flight request to
   the captured execution, as specified above; a V1 root ID cannot encode historical client intent.

## Remaining ownership and startup conditions

| Work | Owner stage | Starts only when |
| --- | --- | --- |
| Narrow projection, lifecycle, and turn ports for the compatibility handler | Stage 2 | Stage 1 closes under [plan.md](./plan.md#stage-1--freeze-the-client-facing-contract): 1D independently accepted and integrated; semantics already accepted at `b17577182` |
| Single-owner host implementing those ports; credential strategy | Stage 3 | the Stage 2 kernel is constructible in a clean Node consumer |
| Local transport carrying the same admission path, live delivery, cursor recovery | Stage 4 | the Stage 3 host runs the two-turn scenario with Desktop absent |
| Desktop client migration | Stage 5 | the Stage 4 transport passes the contract scenario in-process and cross-process |
| CLI headless commands over the typed client | Stage 6 | Stage 5 keeps Desktop behavior unchanged |
| `safeStorage` compatibility or reauthorization decision | Stage 3 | unchanged release blocker; no plaintext fallback |

The toolchain is available, not missing: this record was produced with Node `v24.18.0` and pnpm
`10.34.5` (the declared ranges), and the installed Electron matches the lockfile (`43.6.0`), so
`node_modules` is not in the drifted state Stage 0 observed. Dependencies here come from a prepared
read-only `node_modules` link rather than a fresh `pnpm install --frozen-lockfile`, and the Stage 0
environment rows in [baseline.md](./baseline.md) remain the historical record of that revision. The
`safeStorage` blocker is a separate Stage 3 release blocker and is not affected by either.

## Verification record

Local verification for the integrated documentation at `66cbb25fd` used Node `v24.18.0` and pnpm `10.34.5`:

- `pnpm run typecheck:contracts`: passed (one contract test and four contract source roots).
- `pnpm exec vitest run --config vitest.config.ts test/main/contracts test/main/scripts/agentServiceContractTypeGate.test.ts`:
  9 files, 129 tests passed, including 46 client tests.
- All 31 relative Markdown links and anchors resolve; `git diff --check` passes.
- `pnpm run format:check`, `pnpm run lint`, and `pnpm run i18n` pass under the same Node 24 toolchain.
- Independent acceptance is recorded in
  [plan.md](./plan.md#stage-1--freeze-the-client-facing-contract): Emma PASS for `66cbb25fd`.
  The controller independently reran the contract checks and quality gates on the integrated commit.
  These checks accept the documentation/contract boundary only; they do not claim runtime migration.
- These are DTO- and fake-level checks, not runtime transport, service host, Desktop/CLI integration,
  or end-to-end evidence. Formatter/lint coverage limitations are in
  [plan.md](./plan.md#non-blocking-verification-risks).

## Unverified

- Windows named-pipe transport, Electron native-module packaging, and dev, build, and e2e wrapping
  were not exercised; nothing in this mapping is a claim about them.
- No V1 route or event was executed against a service; every mapping above is a static reading of
  the cited sources at `2230a4627`.
