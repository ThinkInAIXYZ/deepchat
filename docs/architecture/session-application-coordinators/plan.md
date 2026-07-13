# Session Application Coordinators — Implementation Plan

## Approach

The migration uses a strangler sequence inside the existing compatibility façade:

1. characterize transaction ordering and consumer behavior;
2. define consumer-owned ports and coordinator-local dependencies;
3. extract Projection first because it owns shared status/window/event state;
4. extract Assignment and its focused policy seam;
5. extract Turn, then Lifecycle over narrow Assignment/Turn/Projection ports;
6. replace route, Remote, and Cron presenter dependencies;
7. reduce the presenter to forwarding, add guards, and update current docs.

The implementation was performed on `task/session-application-coordinators`, based directly on
`dev@28e2a0e92`, without cherry-picking stage 1. After independent implementation and review, the
branch merged `dev@135779210` and reconciled both ownership changes file by file.

## Planned Module Shape

```text
src/main/presenter/sessionApplication/
├── lifecycleCoordinator.ts
├── turnCoordinator.ts
├── agentAssignmentCoordinator.ts
├── agentAssignmentPolicy.ts       # focused pure/shared resolution, if needed
├── projectionCoordinator.ts
└── ports.ts                       # coordinator dependency ports only

src/main/routes/
├── sessions/sessionService.ts     # consumer-owned lifecycle/projection ports
├── chat/chatService.ts            # consumer-owned turn/projection ports
└── hotPathPorts.ts                # provider-only adapters; no session presenter adapter

src/main/presenter/
├── agentSessionPresenter/index.ts # compatibility forwarding; stage-1 owners stay independent
├── remoteControlPresenter/        # four explicit remote session ports
└── cronJobs/                      # starter factory over lifecycle + turn ports
```

Names may follow an existing local convention, but the ownership and dependency rules in the spec are
fixed. Do not create `SessionApplicationCoordinator`, `SessionApplicationServices`, or another object
that re-exports all four capabilities.

## Module Contracts

### Projection

Projection is extracted first and constructed once. Its public surface is grouped by capability, not
by transport:

```ts
interface SessionProjectionReadPort {
  getSession(sessionId: string): Promise<SessionWithState | null>
  listSessions(filters?: SessionListFilters): Promise<SessionWithState[]>
  listLightweight(options?: SessionLightweightOptions): Promise<SessionLightweightListResult>
  getLightweightByIds(sessionIds: string[]): Promise<SessionListItem[]>
}

interface SessionWindowProjectionPort {
  activate(webContentsId: number, sessionId: string): Promise<void>
  deactivate(webContentsId: number): Promise<void>
  getActive(webContentsId: number): Promise<SessionWithState | null>
  getActiveId(webContentsId: number): string | null
}

interface SessionProjectionMutationPort {
  materialize(sessionId: string): Promise<SessionWithState | null>
  notify(input: SessionProjectionUpdate): void
  forgetStatus(sessionIds: string[]): void
  scheduleTitleGeneration(input: TitleGenerationInput): void
}
```

Message, Tape, trace, replay, rename, and pin operations remain concrete methods on the coordinator;
consumers receive only the subsets they require. Full snapshot materialization continues through
typed backend handles and may hydrate runtime state. Lightweight projection remains non-hydrating.

### Assignment

Assignment separates resolution policy from commands so Lifecycle can consume policy without a
runtime construction cycle:

```ts
interface SessionAssignmentPolicyPort {
  resolveCreateAssignment(input: CreateAssignmentInput): Promise<ResolvedSessionAssignment>
  resolveSubagentAssignment(input: SubagentAssignmentInput): Promise<ResolvedSessionAssignment>
  resolveTransferTarget(input: TransferTargetInput): Promise<ResolvedTransferTarget>
}
```

The policy may be a focused module created from the same config/catalog dependencies. The command
coordinator owns transfer and setting mutations. A required lifecycle deletion port is injected into
assignment commands through a concrete, initialized adapter; optional setters and late mutation of
dependencies are forbidden.

### Turn

Turn consumes typed handle resolution, app-session mutation, assignment workdir/runtime-setting
ports, transcript mutation, and projection mutation:

```ts
interface SessionTurnPort {
  sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult>
  steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void>
  cancelGeneration(sessionId: string): Promise<void>
  respondToolInteraction(...args: ToolInteractionArgs): Promise<ToolInteractionResult>
}
```

Pending, retry/edit/delete/clear, and compaction methods remain available to compatibility routes.
The internal initial-message method preserves current fire-and-forget create behavior without going
through `ChatService` request locks.

### Lifecycle

Lifecycle consumes assignment policy, the initial-turn port, projection mutation, app-session/runtime
ports, and the existing skill/permission owners. It owns a reusable required deletion transaction
port so Assignment can perform batch empty-draft deletion without duplicating cleanup ordering.

Create methods continue to return materialized `SessionWithState`; no new public restore or close
operation is introduced.

## Integration Enumeration

Every real creation/call/injection relationship must be verified. Unit mocks do not satisfy these
integration tasks by themselves.

| Producer/caller | Consumer | Required integration evidence |
| --- | --- | --- |
| `Presenter` composition root | four coordinators | each constructed exactly once with real narrow adapters |
| composition root | compatibility `AgentSessionPresenter` | forwarding reaches the same coordinator instances |
| Lifecycle | Assignment policy | create/draft/subagent resolve canonical kind/config through real policy |
| Lifecycle | Turn initial-message port | initial message is accepted after successful initialization and remains fire-and-forget |
| Lifecycle | Projection mutation | bind/materialize/notify/forget behavior uses the shared projection instance |
| Assignment | Lifecycle deletion port | batch deletion uses the real child-first transaction, not a stub implementation |
| Assignment/Turn | Projection mutation | post-mutation materialization/events use the shared projection instance |
| `createMainKernelRouteRuntime` | `SessionService` | real lifecycle/projection ports replace presenter adapter |
| `createMainKernelRouteRuntime` | `ChatService` | real turn/projection/permission ports replace presenter adapter/cast |
| `RemoteControlPresenter` | four remote ports | runner operations reach the real coordinator set; generation port remains separate |
| composition root | Cron starter | starter is installed before startup without route-runtime priming |
| Cron starter | Lifecycle + Turn | detached create, max-turn send, and cancel use real coordinators |
| compatibility routes/tools | façade | forwarding remains available for consumers deferred to stage 3 |

## Slice 1 — Characterization and Port Contracts

1. Inventory all core presenter methods, private helpers, state, and production/test callers.
2. Add missing characterization for:
   - pending update/move/convert/steer/delete;
   - retry/delete/edit message;
   - fork and compaction failure paths;
   - tool-interaction validation;
   - lifecycle rollback/error precedence;
   - assignment transfer partial-result and conservative checks;
   - projection active binding, lightweight cache, malformed read data, and title CAS;
   - Remote status/output truth table;
   - Cron metadata/max-turn/output/status semantics.
3. Define consumer-owned SessionService, ChatService, Remote, and Cron ports using shared DTOs.
4. Do not define any port as `Pick<IAgentSessionPresenter, ...>`.

## Slice 2 — Projection Coordinator

1. Move `sessionStatusSnapshots`, session/message/Tape/trace read projection, active window operations,
   rename/pin, event publication, UI refresh, materialization, lightweight mapping, and title generation
   into `SessionProjectionCoordinator`.
2. Keep stage-1 history search and export code outside this coordinator after integration.
3. Add owner tests for full vs lightweight behavior, status cache, per-window binding, missing/malformed
   reads, title generation, and update events.
4. Add forwarding methods in `AgentSessionPresenter` without duplicating policy/state.

## Slice 3 — Assignment Coordinator

1. Extract shared create/subagent/transfer resolution into the focused assignment policy seam.
2. Move transfer impact/batch/single commands, settings/ACP controls, and subagent Tape finalize into
   `SessionAgentAssignmentCoordinator`.
3. Use Projection mutation for post-commit state/event publication.
4. Use the required lifecycle deletion transaction for empty-draft/bulk deletion.
5. Add owner tests for target validation, conservative failure handling, preflight-before-mutation,
   partial transfer errors, setting mutation order, ACP restrictions, and subagent Tape validation.
6. Retain façade forwarding for deferred consumers.

## Slice 4 — Turn Coordinator

1. Move send/steer, pending operations, message mutation, clear/cancel, tool interaction, and compaction.
2. Preserve draft promotion and ACP workdir synchronization ordering.
3. Provide a narrow initial-turn operation for Lifecycle without routing through `ChatService`.
4. Add owner tests for method-specific missing-session behavior, queue metadata, cancellation ordering,
   retry flags, ACP interaction validation, and compaction restrictions.
5. Retain façade forwarding for deferred consumers.

## Slice 5 — Lifecycle Coordinator

1. Move create/detached/subagent/draft/fork/delete and initialization/cleanup helpers.
2. Consume Assignment policy, Turn initial-message, and Projection mutation ports.
3. Preserve create precedence, transaction timing, retries, fire-and-forget initial send, rollback,
   descriptor-independent deletion, and error precedence.
4. Add owner tests for all creation variants, failed initialization, ACP draft reuse, fork cleanup,
   recursive deletion, and shared projection integration.
5. Retain façade forwarding for deferred consumers.

## Slice 6 — SessionService and ChatService Integration

1. Replace `SessionRepository`/`MessageRepository` presenter adaptation with explicit consumer-owned
   lifecycle/projection ports.
2. Replace `ProviderExecutionPort` session methods with a Turn port; keep provider connection methods
   in provider-specific wiring.
3. Inject the existing permission cleanup owner directly and remove the presenter intersection cast.
4. Delete unused message-list hot-path adapters.
5. Keep route schemas, scheduler timings, retries, locks, and response mapping unchanged.
6. Add service and dispatcher integration tests with independent coordinator doubles.

## Slice 7 — Remote and Cron Integration

### Remote

1. Replace the full presenter in Remote interfaces, presenter construction, and runner construction
   with four explicit ports.
2. Preserve `AgentManagerGenerationPort` for active-event lookup/cancel.
3. Remove optional `getSearchResults` capability probing; the required projection port is called and
   its existing failure fallback remains local to Remote.
4. Replace untyped partial presenter fixtures with typed port stubs.

### Cron

1. Add a Cron-owned starter factory over Lifecycle and Turn ports.
2. Install the starter in the composition root before lifecycle startup.
3. Remove `setRunSessionStarter` side effects from route-runtime construction.
4. Remove route-runtime priming from `cronJobsStartHook`.
5. Preserve `CronJobRunExecutor` as the narrow consumer of `CronJobRunSessionStarter`.

## Slice 8 — Façade Cleanup, Guards, and Documentation

1. Remove migrated state, policy, private helpers, imports, and direct implementations from
   `AgentSessionPresenter`; leave only forwarding for the four domains while stage-1 foreign behavior
   remains with its explicit owners.
2. Keep `IAgentSessionPresenter` public signatures unchanged in stage 2.
3. Move behavior tests to coordinator suites; presenter tests cover forwarding/compatibility only.
4. Add architecture guards that reject:
   - `IAgentSessionPresenter` imports in SessionService/ChatService hot paths, Remote runner/interfaces,
     Cron starter, and migrated composition helpers;
   - duplicate coordinator construction outside the composition root/tests;
   - coordinator imports of stage-1 foreign owners;
   - a combined session application façade.
5. Update current architecture/session/flow/code-navigation docs. Do not rewrite historical BEFORE
   sections or layered-runtime invariants that remain true.
6. Review generated architecture baseline changes; regenerate maintained outputs only when the diff is
   intentional and the relevant tree is clean.

## Test Strategy

### Owner tests

- Lifecycle: creation precedence, initialization, detached/subagent/draft/fork, rollback, recursive
  deletion, error precedence.
- Turn: send/steer/pending/message mutation/clear/cancel/tool interaction/compaction.
- Assignment: policy resolution, transfer, settings, ACP controls, subagent Tape finalize.
- Projection: full/lightweight session state, message/Tape/trace projection, active binding, title,
  status cache, events.

### Consumer tests

- `SessionService`: create/restore/list/page/activate/deactivate/get-active with exact timeout/retry
  behavior.
- `ChatService`: send lock, unavailable session/agent, steer, stop-by-request, timeout cleanup, tool
  interaction.
- Remote: command and status/output truth table over typed port stubs.
- Cron: starter metadata, ACP/pinned model snapshot, max-turn mapping, cancellation, executor output and
  terminal fencing.

### Integration tests

- Composition identity proves one shared coordinator set reaches façade, routes, Remote, and Cron.
- Real coordinator chains cover Lifecycle → Assignment/Turn/Projection and Assignment/Turn →
  Projection without mocks at those boundaries.
- Dispatcher tests prove unchanged route contracts while using independent coordinator doubles.
- Startup test proves Cron no longer primes route runtime.

### Regression gates

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
pnpm run lint:architecture
git diff --check
```

Run `pnpm run architecture:baseline` only after reviewing a temporary generated diff and only from a
clean relevant tree.

## Compatibility and Rollback

- No schema, route, event, or persisted-data migration is introduced; rollback is code-only.
- Each coordinator slice keeps façade forwarding, so later slices can be reverted independently.
- Do not remove a façade implementation until owner tests and all migrated consumers call the new
  owner.
- Stage-1 integration was completed by merging `dev@135779210`. The resolution preserved stage-1
  foreign owner wiring and stage-2 coordinator wiring file by file; no presenter, composition, or
  route conflict was accepted wholesale.

## Exit Gate

This goal is complete only when all spec acceptance criteria pass, all four coordinators are the sole
owners of their domain behavior, the four named consumer groups use narrow ports, the compatibility
façade contains forwarding rather than duplicated logic, architecture guards are active, current docs
are updated, and every task in `tasks.md` is closed.
