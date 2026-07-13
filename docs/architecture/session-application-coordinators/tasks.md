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
- [x] Define consumer-owned narrow ports without `Pick<IAgentSessionPresenter, ...>`.

## 2. SessionProjectionCoordinator

- [x] Extract full and lightweight session materialization and status cache.
- [x] Extract message, Tape, trace, manifest, replay, and search-result projection operations.
- [x] Extract active-window binding, rename/pin, title generation, events, and UI refresh.
- [x] Construct one composition-owned Projection instance.
- [x] Rewire compatibility presenter forwarding and move owner tests.

## 3. SessionAgentAssignmentCoordinator

- [x] Extract focused create/subagent/transfer assignment policy.
- [x] Extract transfer impact, batch/single transfer, and agent-session deletion orchestration.
- [x] Extract model/project/permission/generation/tools/subagent settings and ACP controls.
- [x] Extract subagent Tape merge/discard.
- [x] Use narrow lifecycle deletion and projection mutation ports without circular construction.
- [x] Rewire compatibility presenter forwarding and move owner tests.

## 4. SessionTurnCoordinator

- [x] Extract send, steer, and pending-input operations.
- [x] Extract retry/delete/edit/clear message operations.
- [x] Extract cancellation, tool-interaction response, and compaction.
- [x] Add the narrow initial-turn operation used by Lifecycle.
- [x] Rewire compatibility presenter forwarding and move owner tests.

## 5. SessionLifecycleCoordinator

- [x] Extract create, detached, subagent, ACP draft, fork, and recursive delete transactions.
- [x] Extract runtime initialization, workdir sync, and failed-create cleanup.
- [x] Connect real Assignment policy, Turn initial-message, and Projection mutation owners.
- [x] Rewire compatibility presenter forwarding and move owner tests.

## 6. SessionService and ChatService

- [x] Inject Lifecycle/Projection ports into `SessionService`.
- [x] Inject Turn/Projection and existing permission/catalog ports into `ChatService`.
- [x] Remove the `IAgentSessionPresenter` hot-path adapter, unused message adapter, and permission cast.
- [x] Preserve route schemas, timeout/retry/lock/cleanup semantics, and add integration tests.

## 7. Remote and Cron

- [x] Inject separate Lifecycle, Turn, Assignment, and Projection ports into Remote.
- [x] Keep Remote active-generation lookup/cancel on `AgentManagerGenerationPort`.
- [x] Replace untyped Remote presenter fixtures with typed port stubs.
- [x] Build the Cron starter from Lifecycle/Turn in the composition root.
- [x] Remove route-runtime starter side effects and startup route-runtime priming.
- [x] Preserve Cron metadata, max-turn, output, status, timeout, and delivery semantics.

## 8. Façade and Enforcement

- [x] Remove migrated implementation state/helpers/imports from `AgentSessionPresenter`.
- [x] Keep stage-2 compatibility signatures and forwarding; do not retire the façade.
- [x] Exhaust production/test searches for presenter dependencies in migrated consumers.
- [x] Add architecture guards for consumer imports, duplicate construction, foreign-owner imports,
      and combined façade regression.
- [x] Update current architecture, session management, flows, and code navigation.
- [x] Review the dependency diff and regenerate maintained baselines only when intentional.

## 9. Validation

- [x] Run focused coordinator, service, route, Remote, Cron, composition, and guard tests.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run test:main`.
- [x] Run `pnpm run lint:architecture` and `git diff --check`.
- [x] Confirm every acceptance criterion in `spec.md` and close this task list.

## 10. Stage 1 Integration

- [x] Merge the latest `dev`, including Stage 1 PR #1957 and subsequent #1958/#1960 changes.
- [x] Preserve Stage 1 foreign owners and Stage 2 coordinators across composition, routes, and the
      compatibility façade.
- [x] Reconcile tests, guards, current docs, and architecture baselines without restoring a broad
      presenter dependency.
- [x] Run focused and full validation.
- [x] Push the integration commits and confirm PR #1961 is mergeable.
