# Session Boundary Cleanup

> Status: approved for implementation  
> Base: `dev@28e2a0e92`  
> Branch: `codex/session-boundary-cleanup`

## Context

The layered agent runtime migration established the correct runtime ownership model:

- `AppSessionService` owns the persisted app-session shell and window binding;
- `AgentManager` resolves strict agent descriptors and typed session handles;
- DeepChat and direct ACP own separate runtime implementations;
- shared transcript and Tape ports own persisted conversation projections.

`AgentSessionPresenter` intentionally remained as a route/application/shared-projection facade during
that migration. It is now 4,077 lines and still owns behavior that is unrelated to session lifecycle,
turn execution, agent assignment, or session projection. The problem is not the line count itself. The
problem is that unrelated state, policies, persistence work, route use cases, and startup tasks all use
the presenter as a common owner and service locator.

This goal is the first of three independent cleanup stages:

1. **Session boundary cleanup** — move unrelated capabilities to their actual owners.
2. **Session application coordinators** — extract lifecycle, turn, assignment, and projection
   invariants.
3. **Presenter retirement** — rewire remaining consumers and remove the compatibility facade when it
   no longer owns behavior.

Only stage 1 is in scope here.

## Problem

`AgentSessionPresenter` currently owns or exposes all of the following unrelated capabilities:

- history search ranking, fallback SQL, and snippet construction;
- legacy chat import startup and skill repair;
- SQLite mainline normalization and retired-tool cleanup migrations;
- usage-stat backfill state and dashboard assembly;
- RTK startup health checks, retry, and dashboard integration;
- standalone translation completion and locale policy;
- renderer-visible agent catalog filtering;
- conversion of new session records into legacy export models and formats.

This creates four concrete architecture failures:

1. Startup hooks use `as unknown as` and optional method probes against
   `AgentSessionPresenter` because startup work is not part of its public contract.
2. Typed routes call the presenter for use cases whose real owners already exist elsewhere.
3. `IAgentSessionPresenter` exposes unrelated route conveniences as if they were one session-domain
   interface.
4. Tests for search, export, usage, migration, translation, and catalog policy are coupled to the
   presenter fixture instead of the behavior owner.

## Goals

1. Move usage, migration, export, history search, RTK, translation, and catalog behavior out of
   `AgentSessionPresenter`.
2. Move `LegacyChatImportService` out of the `agentSessionPresenter` directory and give startup and
   skill-repair consumers one explicit service owner.
3. Make lifecycle hooks call typed owners directly, with no optional presenter method probing and no
   `as unknown as` casts.
4. Make typed session routes call narrow capability owners while preserving every route name, input,
   output, error boundary, and renderer client.
5. Remove the corresponding public methods from `IAgentSessionPresenter` and the corresponding
   imports, state, constants, and private helpers from `AgentSessionPresenter`.
6. Keep the composition root responsible only for constructing and wiring concrete owners; do not
   replace the presenter with another aggregate facade.
7. Add a mechanical architecture guard that prevents these responsibilities from returning to
   `AgentSessionPresenter`.

## Non-goals

- Extracting session creation, draft activation, send/steer/pending behavior, transfer, deletion,
  state projection, or active-window behavior.
- Removing `AgentSessionPresenter` or all remaining `IAgentSessionPresenter` consumers.
- Reworking `SessionService`, `ChatService`, `hotPathPorts`, Remote, or Cron beyond wiring required by
  the capabilities moved in this stage.
- Changing route contracts, event contracts, preload APIs, renderer clients, database schemas, or
  persisted data formats.
- Changing search ranking, FTS/LIKE fallback, export output, translation prompts, locale mapping,
  assistant-model selection, agent visibility, usage calculations, RTK semantics, or migration keys.
- Redesigning the generic lifecycle framework or removing unrelated presenter casts in the floating
  button, Remote, tools, or other future-stage consumers.
- Creating a generic `SessionBoundaryService`, service container, command bus, repository hierarchy,
  or interface for every concrete implementation.
- GitHub issue synchronization.

## Ownership Decisions

| Capability | Current owner | Target owner | Direct consumers after cleanup |
| --- | --- | --- | --- |
| Usage dashboard and backfill | `AgentSessionPresenter` | `UsageStatsService` beside existing `usageStats.ts` policy helpers | typed route, usage startup hook |
| RTK health check and retry | `AgentSessionPresenter` | existing `rtkRuntimeService` | RTK startup hook, retry route, `UsageStatsService` dashboard composition |
| Legacy chat import | `agentSessionPresenter/legacyImportService.ts` | startup-migration module with one long-lived default-import owner | legacy-import hook, skill repair, explicit SQLite import entry point |
| Mainline normalization | `AgentSessionPresenter` | stateless session-data migration function | normalization startup hook |
| Disabled search-tool cleanup | `AgentSessionPresenter` | stateless session-data migration function | cleanup startup hook |
| History search | `AgentSessionPresenter` | session history read service | `sessions.searchHistory` route |
| Agent-session export | `AgentSessionPresenter` | exporter-owned `AgentSessionExportService` | `sessions.export` route |
| Translation | `AgentSessionPresenter` | session translation route use case plus shared assistant-model selection policy | `sessions.translateText` route |
| Available agent list | `AgentSessionPresenter` | pure agent-catalog availability policy over `IConfigPresenter` | `sessions.getAgents` route, floating button |

The composition root may retain references to stateful services such as `UsageStatsService` and the
default-import `LegacyChatImportService`. Holding references for assembly is not behavior ownership.
It must not introduce a new object that re-exports all moved capabilities. Explicit imports from a
caller-provided database path may use the same importer implementation with call-scoped state; they
must not share or bypass the default-import single-flight state accidentally.

## Target Dependency Shape

```text
typed session routes
  ├─ SessionHistorySearch
  ├─ AgentSessionExportService
  ├─ session translation use case
  ├─ UsageStatsService
  ├─ rtkRuntimeService
  └─ available-agent policy

lifecycle hooks
  ├─ LegacyChatImportService
  ├─ UsageStatsService
  ├─ session-data migration functions
  └─ rtkRuntimeService

AgentSessionPresenter
  └─ session lifecycle / turn / assignment / projection responsibilities only
     (further cleanup is explicitly deferred)
```

## Boundary Rules

1. `AgentSessionPresenter` must not import usage-stat policy helpers, RTK runtime, exporter format
   helpers, startup task context, legacy import, history-search DTOs, or migration row types after
   this stage.
2. Lifecycle hooks must use required typed owners. They must not silently skip work because a
   presenter method is absent.
3. Stateful deduplication belongs to the stateful service that performs the work. Stateless startup
   migrations rely on `StartupWorkloadCoordinator` task deduplication plus their persisted migration
   status keys.
4. Route handlers remain transport adapters: parse input, call one owner, parse output. Business
   behavior must not be copied into the route switch.
5. Existing owners are reused. New abstractions are permitted only where a capability has state or a
   non-trivial policy that cannot be expressed as a small function.
6. No capability moved in this stage may call back through `AgentSessionPresenter`.

## Compatibility Invariants

### Startup tasks

- Existing task IDs, targets, phases, resource classes, label keys, priorities, and non-critical
  failure behavior remain unchanged.
- Legacy import remains single-flight and preserves persisted status and retry behavior.
- Usage backfill remains single-flight, stale-running detection remains unchanged, and dashboard
  reads continue to expose its normalized status.
- Mainline normalization retains `sqlite-mainline-normalization-v1`, batch size, cursor ordering,
  progress writes, yielding, completion metadata, and failure metadata.
- Disabled-tool cleanup retains `agent-disabled-search-tool-cleanup-v1`, session and agent-config
  cleanup behavior, progress yielding, and completion/failure metadata.

### History search

- Empty normalized queries return an empty list.
- Limits remain clamped to `1..50`, with the existing default.
- FTS results are preferred, LIKE search is the first fallback, and the legacy table query remains
  the final fallback.
- Ranking, deduplication, snippets, role filtering, regular-session filtering, and update-time
  tie-breaking remain unchanged.

### Export

- Supported formats, filenames, ordering, sent-message filtering, content parsing, metadata fallback,
  model settings, and Nowledge Mem output remain byte-for-byte compatible for equivalent records.
- The legacy conversation exporter remains intact; the new-session adapter is added beside it rather
  than merging old and new persistence models.

### Translation and catalog

- Translation keeps the same assistant-model preference, default-model fallback, prompt,
  temperature, token limit, locale-to-language mapping, trimming, and missing-model error.
- The available agent list continues to include all DeepChat agents and includes ACP agents only when
  ACP is enabled.

### Usage and RTK

- Dashboard totals, calendar window, provider/model labels, breakdown ordering, cache-hit rate, cost,
  recording start, and RTK payload remain unchanged.
- RTK startup health check progress and explicit retry behavior remain unchanged.

## Acceptance Criteria

1. The following methods no longer exist on `AgentSessionPresenter`:
   `searchHistory`, `getLegacyImportStatus`, `retryLegacyImport`, `startLegacyImport`,
   `startLegacyImportTask`, `startUsageStatsBackfill`, `startUsageStatsBackfillTask`,
   `startMainlineNormalizationBackfill`, `startMainlineNormalizationBackfillTask`,
   `startDisabledSearchToolCleanupBackfill`, `startDisabledSearchToolCleanupBackfillTask`,
   `startRtkHealthCheck`, `startRtkHealthCheckTask`, `retryRtkHealthCheck`, `getUsageDashboard`,
   `repairImportedLegacySessionSkills`, `translateText`, `getAgents`, and `exportSession`.
2. `IAgentSessionPresenter` no longer declares history search, legacy import, translation, agent
   catalog, export, usage dashboard, or RTK retry capabilities.
3. `AgentSessionPresenter` owns none of the three startup/backfill promises and contains none of the
   private search, export, usage, migration, translation, or catalog helpers moved by this goal.
4. All affected typed routes keep their existing shared contracts and call explicit owners.
5. All five affected startup hooks contain no `as unknown as`, no optional start-method probes, and no
   dependency on `AgentSessionPresenter`.
6. The floating button obtains available agents from the catalog availability policy instead of
   `AgentSessionPresenter.getAgents`; unrelated floating-button presenter calls are deferred.
7. Existing behavior is covered by owner-level tests and route/lifecycle wiring tests.
8. Architecture guards reject reintroduction of the removed methods or forbidden imports.
9. Current architecture reference docs describe the new owners after implementation.
10. Formatting, i18n validation, lint, typecheck, main tests, and architecture guards pass.

## Risks

- Constructing more than one default-path `LegacyChatImportService` or more than one
  `UsageStatsService` could break in-flight deduplication. The composition root must own exactly one
  long-lived instance for each of those stateful paths.
- Moving route dependencies can accidentally turn route mocks into integration mocks. Tests must use
  narrow capability doubles.
- Translation and title generation currently share assistant-model selection. That policy must move
  once and remain shared rather than being duplicated.
- Moving legacy import can create an import cycle with `SQLitePresenter`. The implementation must use
  type-only dependencies or a narrow dependency object where necessary.
- Removing presenter methods before all callers are rewired can leave hidden optional-call paths.
  Production and test callers must be exhausted with repository-wide searches before deletion.
