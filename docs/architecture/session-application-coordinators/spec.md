# Session Application Coordinators

> Status: implemented, integrated, and validated
> Original base: `dev@28e2a0e92`
> Integrated base: `dev@135779210` via merge commit `1122b2406`
> Branch: `task/session-application-coordinators`

## Context

The layered runtime migration established the execution boundary:

- `AppSessionService` owns the persisted app-session shell and window bindings;
- `AgentManager` resolves strict descriptors and typed DeepChat/direct-ACP handles;
- backend instances own runtime state and turn execution;
- transcript, Tape, permission, skill, and UI adapters retain their existing data ownership.

`AgentSessionPresenter` still combines four application responsibilities above those owners:

1. session lifecycle transactions;
2. turn commands and message mutations;
3. agent/runtime assignment policy and transfer;
4. renderer-facing session, message, Tape, title, status, and window projections.

It is also the common dependency of typed session/chat services, Remote, Cron, subagent tooling, and
compatibility routes. Consumers therefore depend on a large presenter contract even when they need
only one or two operations.

This goal is stage 2 of the session boundary cleanup sequence:

1. foreign capability cleanup (`codex/session-boundary-cleanup`, merged in PR #1957);
2. **session application coordinators** (this goal);
3. presenter retirement after all remaining compatibility consumers are rewired.

This branch was developed from `dev@28e2a0e92`, independently of stage 1, so both ownership changes
could be reviewed separately. It later merged `dev@135779210`; the integration preserves both splits
across the composition root, presenter, routes, guards, tests, current docs, and architecture
baselines.

## Problem

The current façade produces five concrete architecture failures:

1. `SessionService` and `ChatService` reach application behavior through
   `createPresenterHotPathPorts(IAgentSessionPresenter)` instead of explicit owners.
2. `RemoteConversationRunner` receives the complete `IAgentSessionPresenter` despite using a fixed,
   narrow subset of lifecycle, turn, assignment, and projection operations.
3. Cron wiring is installed as a side effect of `createMainKernelRouteRuntime`, so startup must prime
   the route runtime before `CronJobsService.start()`.
4. `AgentSessionPresenter` owns policy, transaction ordering, window/status caches, and title state,
   making these invariants difficult to test without a 4,000-line fixture.
5. `ChatService` obtains permission cleanup through a presenter-only intersection cast instead of the
   existing permission owner.

## Goals

1. Extract four composition-owned application coordinators:
   `SessionLifecycleCoordinator`, `SessionTurnCoordinator`,
   `SessionAgentAssignmentCoordinator`, and `SessionProjectionCoordinator`.
2. Move the corresponding policy, state, transaction ordering, private helpers, and tests out of
   `AgentSessionPresenter`.
3. Keep `AgentSessionPresenter` as a compatibility façade that forwards existing public methods to
   the four coordinators. Presenter retirement remains stage 3.
4. Make `SessionService`, `ChatService`, Remote, and Cron depend on consumer-owned narrow ports rather
   than `IAgentSessionPresenter`.
5. Construct one shared coordinator set in the composition root and reuse it across the compatibility
   façade, routes, Remote, Cron, tools, and other migrated consumers.
6. Remove Cron's route-runtime priming dependency and wire its existing
   `CronJobRunSessionStarter` from the composition root.
7. Preserve route/event/data contracts and all DeepChat/direct-ACP behavior.
8. Add architecture enforcement that prevents the migrated consumers from regaining the presenter
   dependency or an aggregate replacement façade.

## Non-goals

- Reimplementing or absorbing stage-1 history, import, migration, usage, RTK, export, translation, or
  catalog ownership. After integration those capabilities remain with their explicit stage-1 owners.
- Removing `AgentSessionPresenter`, deleting `IAgentSessionPresenter`, or rewiring every remaining
  compatibility caller. That is stage 3.
- Moving runtime state out of `DeepChatAgentInstance`, `AcpAgentInstance`, or `LoopRun`.
- Reworking `AgentManager`, backend handles, transcript/Tape schemas, permission policy, skills,
  providers, or ACP protocol behavior.
- Changing renderer route names, inputs, outputs, typed events, preload clients, database schemas, or
  persisted formats.
- Changing `SessionService`/`ChatService` timeout, retry, locking, cancellation, or error semantics.
- Changing Remote commands, bindings, status/output projection, active-event cancellation, or media
  delivery.
- Changing Cron scheduling, snapshot policy, detached-session metadata, completion detection,
  timeout, output ordering, or delivery behavior.
- Introducing a generic service container, command bus, repository hierarchy, coordinator registry,
  or combined `SessionApplicationServices` façade.
- GitHub issue synchronization.

## Ownership Decisions

### SessionLifecycleCoordinator

Owns lifecycle transactions and their rollback/cleanup ordering:

- create window-bound sessions;
- create detached sessions;
- create subagent sessions;
- ensure/reuse ACP draft sessions;
- fork sessions;
- delete a session tree;
- runtime initialization, ACP workdir synchronization, and failed-create cleanup.

It consumes narrow assignment policy, initial-turn, projection mutation, app-session, runtime,
transcript, skill, and permission ports. It does not own window activation, title generation,
transfer policy, ordinary turns, or read projection.

### SessionTurnCoordinator

Owns turn commands and message mutation ordering:

- send and steer;
- pending-input list/queue/update/move/convert/steer/delete;
- retry/delete/edit message;
- compaction state and manual compaction;
- clear session messages;
- cancel generation;
- respond to tool interactions;
- the narrow initial-message operation used by lifecycle creation.

`ChatService` retains request-level locking, scheduler timeouts, stop-by-request lookup, and
all-settled permission/cancellation cleanup.

### SessionAgentAssignmentCoordinator

Owns executable assignment and runtime-setting policy:

- create/subagent/transfer assignment resolution;
- transfer impact, batch move/delete, and single-session transfer;
- model, project, permission, generation settings, disabled tools, and subagent-enabled settings;
- ACP config options and commands;
- subagent Tape merge/discard.

Session deletion remains a lifecycle transaction. Assignment may call a required narrow lifecycle
deletion port, but the composition graph must not use optional setters or circular construction.
Assignment resolution shared with lifecycle may be implemented as a focused pure policy module; it
must not become a fifth aggregate coordinator.

### SessionProjectionCoordinator

Owns renderer-facing projection state and projection operations:

- full and lightweight session materialization/listing;
- message/page/message-id/search-result/trace reads;
- Tape info/search/context/anchors/handoff/view-manifest/replay projection operations;
- active window binding and lookup;
- rename and pin updates;
- asynchronous title generation and compare-and-set protection;
- session status snapshot cache;
- `sessions.updated` publication and session UI refresh.

It is a composition-owned singleton. Creating one instance per consumer is forbidden because window
bindings and status snapshots must remain coherent.

History search and export remain stage-1 foreign capabilities after integration and must not be
absorbed into Projection.

## Target Dependency Shape

```text
Presenter composition root
  ├─ SessionProjectionCoordinator (one instance)
  ├─ SessionAgentAssignmentCoordinator (one instance)
  ├─ SessionTurnCoordinator (one instance)
  ├─ SessionLifecycleCoordinator (one instance)
  └─ AgentSessionPresenter compatibility façade
       └─ forwards existing core methods to the four coordinators

typed routes
  ├─ SessionService -> lifecycle + projection ports
  └─ ChatService -> turn + projection + existing permission/catalog ports

RemoteControlPresenter / RemoteConversationRunner
  ├─ remote lifecycle port
  ├─ remote turn port
  ├─ remote assignment port
  ├─ remote projection port
  └─ existing AgentManagerGenerationPort

CronJobsService
  └─ CronJobRunSessionStarter
       ├─ lifecycle.createDetachedSession
       └─ turn.sendMessage / cancelGeneration
```

Ports are owned by the consumer that needs them and use shared route/domain DTOs. They must not be
defined as `Pick<IAgentSessionPresenter, ...>` and must not be grouped under a replacement aggregate.

## Boundary Rules

1. A coordinator may orchestrate existing owners but must not copy their state or persistence logic.
2. Coordinators depend on the smallest required typed ports. They must not receive the entire
   `Presenter`, `IAgentSessionPresenter`, `AgentSharedDataPorts`, or concrete SQLite presenter.
3. The compatibility façade contains forwarding only for migrated core methods. Coordinator state,
   policy, and private helpers must not remain duplicated there.
4. `SessionService`, `ChatService`, Remote runner/interfaces, Cron starter, and
   `createPresenterHotPathPorts` must not import or accept `IAgentSessionPresenter` after migration.
5. `SessionService` continues to compose restore as projection lookup plus paged messages; there is no
   new restore coordinator method.
6. `ChatService.activeControllers` remains in `ChatService`.
7. Remote generation stop continues through `AgentManagerGenerationPort.cancelGenerationByEventId`;
   it must not be replaced with ordinary session cancellation.
8. Cron starter construction occurs in the composition root, not as a route-runtime side effect.
9. Required dependencies fail fast. No optional coordinator methods, capability probes, no-op
   fallbacks, or `as unknown as` wiring are permitted.
10. Stage-1 foreign owners remain independent after integration and are not imported by the new
    coordinators.

## Compatibility Invariants

### Lifecycle

- Create precedence, missing provider/model/workdir errors, permission normalization, active-skill
  persistence, and direct-ACP initialization remain unchanged.
- `createSession(projectDir: null)` continues to suppress project fallback; detached blank/null input
  keeps its current fallback behavior.
- Runtime initialization completes before window binding and `created` publication.
- Initial send remains fire-and-forget; its failure is logged and does not fail creation.
- Failed initialization removes the app row, best-effort clears ACP compatibility state/closes the
  handle, and rethrows the original error.
- Subagent creation keeps at most two attempts with a fresh session ID per attempt and publishes only
  after successful materialization.
- ACP draft transcript-read failure remains conservative: the draft is not reused.
- Delete remains descriptor-independent, child-first, and preserves backend/shared-data error
  precedence and permission/skill/app-row/status cleanup ordering.
- Normal delete never becomes `resolveSessionHandle(...).close()`.

### Turn

- Send/steer/queue promote drafts before runtime work and do not roll back promotion on later failure.
- Queue source, project directory, `emitRefreshBeforeStream`, and `maxProviderRounds` forwarding remain
  unchanged.
- Missing-session behavior remains method-specific: pending list returns `[]`, cancellation is a
  no-op, and other mutations throw the existing error.
- Delete/clear cancel before mutation; edit does not cancel.
- Direct ACP tool interaction and DeepChat/manual compaction restrictions remain unchanged.
- Session/Chat routes retain existing scheduler timeout values, send lock, retry, stop, and
  all-settled cleanup behavior.

### Assignment

- Transfer validates the target and all batch entries before mutation; ACP targets and DeepChat
  targets whose default provider is ACP remain rejected.
- Conservative transcript/pending checks, active-generation blocking, sample limits, partial-transfer
  error text, update order, and post-commit ACP cleanup remain unchanged.
- Project updates retain their current non-transactional order; no rollback is introduced.
- ACP model lock, workdir requirement, permission modes, generation settings, disabled tools, and
  config/command behavior remain unchanged.
- Subagent parent/slot/agent validation, ACP forced runtime settings, and Tape merge/discard parent
  checks remain unchanged.

### Projection

- Full session snapshots may hydrate the backend; restore must not become a pure database read.
- Lightweight lists do not hydrate, retain cached/default status, dedupe/order rules, cursor behavior,
  and unavailable-agent skip behavior.
- Message/page/Tape/trace/search-result missing and malformed-data behavior remains unchanged.
- Active binding remains per-window; activation does not add session validation, and failed active
  projection continues to unbind without emitting a new deactivation event.
- Title generation remains asynchronous, waits at most 30 seconds with 250 ms polling, uses the
  assistant-model preference/fallback, performs both compare-and-set checks, normalizes to 80
  characters, and only warns on failure.
- Event ID trim/dedupe, reason defaults, active-session payloads, and UI refresh behavior remain
  unchanged.

### Remote

- Deleted bindings are cleared; missing bindings and completed/no-response/pending-interaction status
  projections keep their current payloads.
- `/open`, model selection, search-result fallback, old-event filtering, generated-image text, and
  pending interaction behavior remain unchanged.
- Remote channel command/router public APIs remain unchanged.

### Cron

- Every run creates a new detached session with unchanged source/job/run/scheduled metadata.
- ACP routing, pinned-model and snapshot policy, system-instruction precedence, and max-turn mapping
  remain unchanged.
- `messageId` remains the output message ID; completion remains event-driven.
- Output segment precedence/labels, concurrency skip/queue, timeout cleanup order, late-failure
  fencing, and delivery behavior remain unchanged.

## Acceptance Criteria

1. One composition-owned instance exists for each of the four coordinators.
2. Core lifecycle, turn, assignment, and projection implementation/state/private helpers no longer
   live in `AgentSessionPresenter`; its existing core public API forwards to coordinators.
3. `SessionService` uses explicit lifecycle/projection ports and `ChatService` uses explicit
   turn/projection/permission/catalog ports without `IAgentSessionPresenter`.
4. `createPresenterHotPathPorts` no longer imports or adapts `IAgentSessionPresenter`; unused message
   list adapters and the permission intersection cast are gone.
5. Remote presenter/runner receives separate lifecycle, turn, assignment, and projection ports and no
   longer imports or accepts `IAgentSessionPresenter`.
6. Cron receives its existing starter from the composition root; route runtime no longer installs it,
   and the Cron startup hook no longer primes route runtime.
7. `SessionService`, `ChatService`, Remote, and Cron route/command/output contracts and behavior remain
   unchanged under characterization and integration tests.
8. Remaining non-target consumers either use a narrow coordinator port or the explicit compatibility
   façade; no aggregate replacement is introduced.
9. Architecture guards reject presenter dependency reintroduction in migrated consumers, duplicate
   coordinator construction, and coordinator imports of stage-1 foreign owners.
10. Current architecture, flow, session-management, and code-navigation docs describe the four
    coordinators and narrow consumer ports without rewriting historical runtime invariants.
11. Formatting, i18n validation, lint, full typecheck, main tests, and architecture guards pass.

## Risks

- Moving 4,000 lines of interleaved behavior can silently change transaction ordering. Tests must be
  relocated by owner before the façade helpers are deleted.
- Projection must remain singleton; duplicate caches would produce inconsistent status/window views.
- Lifecycle, Turn, and Assignment have real call chains. Breaking their construction with optional
  setters would replace one service-locator problem with another.
- Full session projection intentionally hydrates runtime state. Treating Projection as a read-only
  repository would break restore and Remote behavior.
- Remote and Cron often receive `{ requestId: null, messageId: null }` because send means accepted,
  not completed. Coordinator extraction must not await generation completion.
- Stage 1 and stage 2 both touch the presenter, composition root, routes, tests, guards, and docs.
  Integration requires a deliberate rebase/merge review; neither branch may overwrite the other's
  owner wiring.
