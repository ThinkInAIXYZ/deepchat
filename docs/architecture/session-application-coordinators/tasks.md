# Session Application Coordinators — Tasks

## SDD and Inventory

- [x] Audit Lifecycle, Turn, AgentAssignment, and Projection methods, state, dependencies, and tests.
- [x] Enumerate SessionService, ChatService, Remote, and Cron create/call/inject chains.
- [x] Resolve ownership of active-window state, title, draft, transfer, permission cleanup, and Cron
      starter wiring.
- [x] Write the approved spec and implementation plan from `dev@28e2a0e92`.

## 1. Characterization and Ports

- [x] Add missing lifecycle rollback and deletion error-precedence characterization.
- [x] Add pending/message mutation, fork, compaction, and tool-interaction characterization.
- [x] Lock assignment transfer, setting mutation, and subagent Tape behavior.
- [x] Lock projection cache/window/title/read fallback behavior.
- [x] Lock Remote status/output and Cron metadata/max-turn/output behavior.
- [ ] Define consumer-owned narrow ports without `Pick<IAgentSessionPresenter, ...>`.

## 2. SessionProjectionCoordinator

- [x] Extract full and lightweight session materialization and status cache.
- [x] Extract message, Tape, trace, manifest, replay, and search-result projection operations.
- [x] Extract active-window binding, rename/pin, title generation, events, and UI refresh.
- [x] Construct one composition-owned Projection instance.
- [x] Rewire compatibility presenter forwarding and move owner tests.

## 3. SessionAgentAssignmentCoordinator

- [ ] Extract focused create/subagent/transfer assignment policy.
- [ ] Extract transfer impact, batch/single transfer, and agent-session deletion orchestration.
- [ ] Extract model/project/permission/generation/tools/subagent settings and ACP controls.
- [ ] Extract subagent Tape merge/discard.
- [ ] Use narrow lifecycle deletion and projection mutation ports without circular construction.
- [ ] Rewire compatibility presenter forwarding and move owner tests.

## 4. SessionTurnCoordinator

- [ ] Extract send, steer, and pending-input operations.
- [ ] Extract retry/delete/edit/clear message operations.
- [ ] Extract cancellation, tool-interaction response, and compaction.
- [ ] Add the narrow initial-turn operation used by Lifecycle.
- [ ] Rewire compatibility presenter forwarding and move owner tests.

## 5. SessionLifecycleCoordinator

- [ ] Extract create, detached, subagent, ACP draft, fork, and recursive delete transactions.
- [ ] Extract runtime initialization, workdir sync, and failed-create cleanup.
- [ ] Connect real Assignment policy, Turn initial-message, and Projection mutation owners.
- [ ] Rewire compatibility presenter forwarding and move owner tests.

## 6. SessionService and ChatService

- [ ] Inject Lifecycle/Projection ports into `SessionService`.
- [ ] Inject Turn/Projection and existing permission/catalog ports into `ChatService`.
- [ ] Remove the `IAgentSessionPresenter` hot-path adapter, unused message adapter, and permission cast.
- [ ] Preserve route schemas, timeout/retry/lock/cleanup semantics, and add integration tests.

## 7. Remote and Cron

- [ ] Inject separate Lifecycle, Turn, Assignment, and Projection ports into Remote.
- [ ] Keep Remote active-generation lookup/cancel on `AgentManagerGenerationPort`.
- [ ] Replace untyped Remote presenter fixtures with typed port stubs.
- [ ] Build the Cron starter from Lifecycle/Turn in the composition root.
- [ ] Remove route-runtime starter side effects and startup route-runtime priming.
- [ ] Preserve Cron metadata, max-turn, output, status, timeout, and delivery semantics.

## 8. Façade and Enforcement

- [ ] Remove migrated implementation state/helpers/imports from `AgentSessionPresenter`.
- [ ] Keep stage-2 compatibility signatures and forwarding; do not retire the façade.
- [ ] Exhaust production/test searches for presenter dependencies in migrated consumers.
- [ ] Add architecture guards for consumer imports, duplicate construction, foreign-owner imports,
      and combined façade regression.
- [ ] Update current architecture, session management, flows, and code navigation.
- [ ] Review the dependency diff and regenerate maintained baselines only when intentional.

## 9. Validation

- [ ] Run focused coordinator, service, route, Remote, Cron, composition, and guard tests.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run test:main`.
- [ ] Run `pnpm run lint:architecture` and `git diff --check`.
- [ ] Confirm every acceptance criterion in `spec.md` and close this task list.
