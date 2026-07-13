# Session Boundary Cleanup — Tasks

## SDD

- [x] Create the architecture SDD from merged `dev`.
- [x] Fix the stage boundary: foreign responsibilities only; no lifecycle/turn/assignment/projection
      extraction and no presenter retirement.
- [x] Resolve target owners, compatibility invariants, validation gates, and non-goals.

## 1. Characterization

- [x] Inventory all production and test callers of the methods scheduled for removal.
- [x] Add or relocate history-search characterization tests.
- [x] Add or relocate agent-session export characterization tests.
- [x] Lock translation assistant-model and locale behavior.
- [x] Lock available-agent filtering behavior.
- [x] Lock startup scheduling metadata and migration status transitions.
- [x] Lock usage backfill single-flight, stale-running recovery, and dashboard output.

## 2. Startup and Maintenance Ownership

- [x] Move `LegacyChatImportService` to the startup-migration owner.
- [x] Construct and reuse one legacy-import instance in the composition root.
- [x] Rewire legacy import startup, skill repair, and explicit SQLite import.
- [x] Extract mainline normalization into an explicit startup migration function.
- [x] Extract disabled search-tool cleanup into an explicit startup migration function.
- [x] Add `UsageStatsService` and move backfill state/execution and dashboard assembly.
- [x] Rewire the usage startup hook to `UsageStatsService`.
- [x] Rewire RTK startup and retry directly to `rtkRuntimeService`.
- [x] Remove all five startup hooks' unsafe presenter casts and optional start-method probes.

## 3. Route and Read Ownership

- [x] Extract and wire `SessionHistorySearch`.
- [x] Add and wire `AgentSessionExportService` beside the legacy exporter.
- [x] Extract shared assistant-model selection and wire session translation.
- [x] Extract the available-agent catalog policy.
- [x] Rewire `sessions.getAgents` and floating-button agent loading.
- [x] Preserve all affected typed route contracts unchanged.

## 4. Presenter and Contract Cleanup

- [x] Remove moved public methods from `AgentSessionPresenter`.
- [x] Remove moved methods and presenter-only history types from `IAgentSessionPresenter`.
- [x] Remove moved private helpers, constants, row types, promise fields, and imports.
- [x] Update `MainKernelRouteRuntime` with explicit narrow owner dependencies.
- [x] Move behavior tests out of the presenter suite and keep only presenter-owned behavior there.
- [x] Exhaust repository-wide searches for removed method names and old import paths.

## 5. Enforcement and Documentation

- [x] Add architecture guards for removed methods, forbidden imports, and unsafe startup-hook probes.
- [x] Update session management and layered-runtime architecture references.
- [x] Update current architecture, flows, and code navigation where affected.
- [x] Review the dependency diff; regenerate maintained baselines only when intentional.

## 6. Validation

- [x] Run focused owner, route, lifecycle, floating-button, and composition tests.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run test:main`.
- [x] Confirm every `spec.md` acceptance criterion and close this task list.
