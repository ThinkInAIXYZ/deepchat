# Session Boundary Cleanup — Implementation Plan

## Approach

This migration removes foreign responsibilities before any core session coordinator is extracted.
It follows three operations in order:

1. **Move sideways** — relocate startup, read, export, usage, RTK, translation, and catalog behavior to
   the modules that own those policies.
2. **Rewire callers** — typed routes, lifecycle hooks, the composition root, SQLite import, skill
   repair, and floating-button catalog loading call those owners directly.
3. **Delete forwarding surface** — remove presenter methods, private helpers, state, imports, and
   shared presenter declarations after callers are gone.

The implementation must not create an aggregate replacement for `AgentSessionPresenter`.

## Planned Module Shape

```text
src/main/
├── agent/shared/
│   ├── assistantModelSelection.ts       # shared title/translation policy
│   └── availableAgentCatalog.ts         # pure availability projection
├── presenter/
│   ├── agentSessionPresenter/
│   │   └── index.ts                     # foreign responsibilities removed
│   ├── exporter/
│   │   └── agentSessionExporter.ts      # new-session export adapter
│   ├── startupMigrations/
│   │   ├── legacyChatImportService.ts   # moved cohesive importer
│   │   └── sessionDataMigrations.ts     # two explicit startup migration functions
│   ├── usageStats.ts                    # existing pure policy helpers
│   └── usageStatsService.ts             # dashboard + backfill state owner
└── routes/sessions/
    ├── sessionHistorySearch.ts          # history read service
    └── sessionTranslation.ts            # translation route use case
```

Names may change only to match an existing local naming convention. The ownership split and the ban
on a combined boundary facade are fixed.

## Dependency Flow

```text
Presenter composition root
  ├─ creates one default-path LegacyChatImportService
  ├─ creates one UsageStatsService
  ├─ creates SessionHistorySearch with SQLite/AppSession read dependencies
  ├─ creates AgentSessionExportService with session/runtime/transcript dependencies
  └─ binds translation dependencies

createMainKernelRouteRuntime
  ├─ keeps AgentSessionPresenter for in-scope session operations
  └─ receives narrow moved-capability owners

lifecycle hooks
  ├─ obtain required composition-owned services directly
  ├─ call stateless migration functions with explicit dependencies
  └─ import rtkRuntimeService directly
```

The composition root may expose concrete service references required by lifecycle hooks. It must not
add a `SessionBoundaryServices` object or methods that forward all moved capabilities.

## Slice 1 — Characterization and Dependency Inventory

Before moving implementation:

1. Enumerate every production and test caller of all methods listed in the spec acceptance criteria.
2. Lock down existing behavior where current tests only verify presenter wiring:
   - history-search FTS, LIKE, legacy fallback, ranking, and snippet behavior;
   - all four export formats and metadata/content fallbacks;
   - translation model selection and locale mapping;
   - ACP-disabled catalog filtering;
   - startup task scheduling metadata and failure behavior;
   - migration idempotency/status transitions;
   - usage backfill single-flight and stale-running recovery.
3. Record any discovered caller not covered by this plan before implementation. Do not preserve an
   unused presenter method solely because it exists in `IAgentSessionPresenter`.

## Slice 2 — Startup and Maintenance Ownership

### Legacy import

1. Move `LegacyChatImportService` to `presenter/startupMigrations/` without changing import behavior,
   persisted status, path cleanup, normalization, overwrite/increment semantics, or skill repair.
2. Construct one long-lived default-path instance in `Presenter` after SQLite initialization.
3. Rewire:
   - `legacyImportHook` to the composition-owned service;
   - skill repair to the same service;
   - `SQLitePresenter.importLegacyChatDb` to the moved implementation while keeping explicit
     caller-provided imports scoped independently from default-import single-flight state.
4. Delete unused legacy-import forwarding methods from `AgentSessionPresenter` and
   `IAgentSessionPresenter`.

### Session data migrations

1. Move mainline normalization into an exported startup migration function.
2. Move disabled search-tool cleanup into a second exported startup migration function in the same
   focused module.
3. Preserve persisted keys, SQL ordering, batch sizes, status payloads, config cleanup, yielding, and
   error behavior.
4. Rewire both lifecycle hooks directly to these functions and the existing
   `StartupWorkloadCoordinator`.
5. Remove presenter promise fields, wrappers, and helpers that exist only for these migrations.

The coordinator already deduplicates each task within the startup run. Do not add another generic
migration coordinator. Each function must remain idempotent through its persisted status contract.

### Usage and RTK

1. Add `UsageStatsService` as the single owner of:
   - backfill single-flight state;
   - stale-running normalization;
   - backfill execution and progress;
   - dashboard assembly and usage breakdown ordering.
2. Keep reusable parsing, pricing, normalization, and calendar functions in `usageStats.ts`.
3. Rewire the usage startup hook and dashboard route to `UsageStatsService`.
4. Rewire the RTK startup hook and retry route directly to `rtkRuntimeService`.
5. Let `UsageStatsService` call `rtkRuntimeService.getDashboardData` when assembling the existing
   dashboard payload; it does not own RTK lifecycle.

## Slice 3 — Route and Read Ownership

### History search

1. Move query normalization, limits, snippet extraction, scoring, FTS/LIKE selection, legacy SQL
   fallback, deduplication, and mapping into `SessionHistorySearch`.
2. Inject only the SQLite/search-document and app-session read capabilities it needs.
3. Rewire `sessions.searchHistory` directly to this owner.
4. Derive route result types from shared route contracts where practical. Remove history-search types
   from `agent-session.presenter.d.ts`; do not create a second public transport type hierarchy.

### Export

1. Add `AgentSessionExportService` beside the existing legacy `ConversationExporterService`.
2. Move new-session conversation mapping, structured message mapping, content parsing, metadata
   parsing, filename generation, and format dispatch into the new service.
3. Reuse existing exporter format functions and templates.
4. Rewire `sessions.export` directly to this service. Keep the old conversation exporter unchanged.

### Translation

1. Move assistant-model selection to one shared function used by both session title generation and
   translation.
2. Move locale mapping, translation prompt construction, completion call, and output trimming into
   the session translation route use case.
3. Rewire `sessions.translateText` directly to the use case.
4. Do not add a general-purpose AI task framework.

### Catalog

1. Move the DeepChat/ACP availability filtering rule into a pure agent-catalog function over the
   narrow `listAgents` and `getAcpEnabled` config capabilities.
2. Rewire `sessions.getAgents` and floating-button agent loading to this function.
3. Leave session list and activation calls in the floating button for later cleanup stages.

## Slice 4 — Contract and Presenter Cleanup

After all callers are rewired:

1. Delete the moved public methods from `AgentSessionPresenter`.
2. Delete the moved declarations and presenter-only history types from
   `src/shared/types/presenters/agent-session.presenter.d.ts`.
3. Delete private constants, row types, helpers, promise fields, and imports used only by the moved
   capabilities.
4. Update `MainKernelRouteRuntime` and its builder with explicit narrow dependencies. Do not group
   them under a replacement facade.
5. Update route dispatcher tests to mock the moved owner, not `IAgentSessionPresenter`.
6. Move owner tests out of `test/main/presenter/agentSessionPresenter/`; keep only actual presenter
   behavior in that suite.

## Slice 5 — Architecture Enforcement and Documentation

Add a focused architecture rule that verifies:

- `AgentSessionPresenter` does not declare the removed method names;
- it does not import legacy import, startup migrations, usage service/policy, RTK runtime, exporter
  formats, session history search, or route translation;
- the affected lifecycle hooks do not mention `AgentSessionPresenter`, `as unknown as`, or optional
  `start*Task` probes;
- `IAgentSessionPresenter` does not regain the removed capability methods.

After implementation, update maintained architecture references:

- `docs/architecture/session-management.md`;
- `docs/architecture/agent-system-layered-runtime/README.md`;
- `docs/architecture/agent-system.md`;
- `docs/ARCHITECTURE.md`, `docs/FLOWS.md`, and code navigation where affected.

Do not edit historical runtime invariants that remain true.

## Test Strategy

### Owner-level tests

- `SessionHistorySearch`: empty query, clamping, FTS, LIKE, legacy fallback, ranking, dedupe, snippets.
- `AgentSessionExportService`: session missing, all formats, message ordering/filtering, structured and
  plain content, metadata fallback, ACP defaults.
- `UsageStatsService`: completed/running/stale/failed states, single-flight, pagination fallback,
  dashboard aggregation, RTK composition.
- Session data migrations: completed skip, progress/yield, cursor ordering, normalized projections,
  config cleanup, failure status.
- `LegacyChatImportService`: existing import, status, retry, cleanup, and skill-repair suite at its new
  owner path.
- Translation: empty input, assistant model, default fallback, locale mapping, missing model, trimmed
  result.
- Available agent policy: ACP enabled and disabled.

### Wiring tests

- Route dispatcher proves each affected route calls its explicit owner and preserves contract parsing.
- Lifecycle hooks prove exact task scheduling metadata and required owner invocation.
- Floating button proves agent loading uses catalog policy.
- Composition tests prove one shared default-import instance and one shared usage service instance;
  explicit caller-provided imports remain scoped to their requested source.

### Regression gates

Run at minimum:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
```

Run `pnpm run architecture:baseline` only if the maintained baseline is intentionally affected, and
review the generated diff instead of accepting it mechanically.

## Compatibility and Rollback

- No schema or persisted-data migration is introduced, so rollback is code-only.
- Each implementation slice must preserve route contracts and can be reverted independently.
- Moved startup tasks retain their current persisted keys, so partially completed work remains valid
  across rollback.
- Do not remove a presenter method in the same commit that first introduces its replacement unless
  all production callers and tests are migrated in that commit.

## Exit Gate

This goal is complete only when every acceptance criterion in `spec.md` passes, the architecture
guard is active, maintained architecture docs describe the new owners, and no implementation task in
`tasks.md` remains open.
