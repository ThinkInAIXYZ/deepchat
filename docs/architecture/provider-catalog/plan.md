# Provider Catalog Implementation Plan

Specification: [spec.md](./spec.md)

## Phase 1: Main-process catalog core

- [x] Add shared catalog types and zod contracts: snapshot, status, source, refresh reason,
  refresh result, error code, `providers.catalog.get/list/refresh/ensureFresh`, and
  `providers.catalog.changed`.
- [x] Add `provider_catalog_state` to the settings schema (migration version 26) with revision,
  fetched time, source, last reason, sanitized error code/time, and no sync triggers.
- [x] Add raw provider/custom model and catalog-state accessors to `ProviderSettings`; keep
  effective resolution in the existing resolver.
- [x] Implement the pure catalog projection: provider-db identities + raw provider facts +
  custom definitions -> one `resolveEffectiveModels` call -> `RENDERER_MODEL_META[]` with status.
- [x] Implement `ProviderCatalogService`: snapshot read, list, ensure-fresh, refresh dedupe,
  diffing, state transitions, sanitized errors, last-known-good behavior, revision events.
- [x] Add pure `fetchCatalog` and `reloadModelsFromSettings` to the base provider; keep current
  persistence and legacy routes untouched.
- [x] Wire the service in `ProviderRuntime`, register routes, register the typed event, and keep
  legacy `models.changed` emissions.
- [x] Add main tests: projection precedence, refresh success/diff, failure preservation,
  dedupe, status derivation, revision monotonicity.

Completion condition: routes return correct snapshots and a mocked upstream refresh updates rows;
no renderer behavior changes yet.

## Phase 2: Settings refresh uses the catalog service

- [x] Add a renderer provider-catalog client for the new routes and event.
- [x] Change the provider settings refresh button to `catalog.refresh(user)`, then refresh the
  existing model-store projection; show the existing success/failure notifications.
- [x] Show last successful sync time from the snapshot; on error, keep the existing failure copy.
- [x] Extend the provider smoke spec with a two-catalog mock server: first refresh returns catalog
  A, second refresh returns catalog B, and the new model becomes visible.

Completion condition: the reported stale-catalog defect is fixed through the new service; the
renderer still uses the legacy model store for the rest of the page.

## Phase 3: Renderer projection

- [x] Replace `refreshStandardModels`/`refreshCustomModels` merging and the empty-catalog
  discovery gate with catalog snapshot reads.
- [x] Derive `allProviderModels`, `enabledModels`, and `customModels` from snapshots while keeping
  the store's public shape for existing consumers.
- [x] Initialize from one catalog list call and request stale revalidation for enabled providers.
- [x] Listen to `providers.catalog.changed` for catalog updates; keep status/config listeners.
- [x] Remove renderer `getDbProviderModels`, per-model effective-config lookups, and the
  discovery/rerun state machine from the standard path.
- [x] Keep the ACP special path until Phase 4; include Ollama installed models through the
  catalog source.
- [x] Update renderer store tests and run chat/model-chooser component tests.

Completion condition: standard providers and Ollama render from main snapshots; no renderer code
decides whether to contact the upstream catalog.

## Phase 4: Single writer and cleanup

- [x] Make provider `fetchCatalog` the only fetch adapter; remove persistence from `fetchModels`
  and from draft validation.
- [x] Delegate `providers.refreshModels` and the provider-db background refresh to the catalog
  service.
- [x] Route ACP catalog writes through `replaceFromSource`; route synced provider/model changes
  through `invalidateFromSync`.
- [x] Invalidate provider config-driven catalogs on base URL, API key, or protocol changes.
- [x] Remove obsolete discovery helpers, unused routes, and legacy refresh state; keep
  `models.changed` only for non-catalog consumers.
- [x] Add an architecture guard proving `setProviderModels` is only called by the catalog service
  and the settings persistence layer.
- [x] Update `ARCHITECTURE.md` or the retained feature documentation if the catalog ownership is
  referenced there.

Completion condition: one writer, one merge, one explicit refresh contract; no hidden catalog
fetch remains in provider initialization.

## Whole-change review and validation

- [ ] Review the complete diff for source-of-truth violations, duplicated merges, secret leakage
  in errors/logs, and behavior changes to CLI/agent paths.
- [ ] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`.
- [ ] Run targeted main and renderer suites plus the provider catalog smoke spec.
- [ ] Remove temporary probes; keep only durable regression coverage.
- [ ] Do not push. Leave the branch and validation evidence for the user.
