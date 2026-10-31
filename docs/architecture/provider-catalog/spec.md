# Provider Catalog Architecture Specification

## Context

DeepChat currently resolves a provider's visible model catalog in the renderer. `modelStore`
combines provider-db projections, persisted `provider_models`, custom models, model status, and
per-model configuration, and separately decides whether an explicit refresh may contact the
provider. The main process also owns refresh paths: provider instance initialization,
`models.listRuntime`, `providers.refreshModels`, and provider-db background refresh.

This split produced a user-visible defect: once a provider catalog was persisted, the settings
refresh button stopped contacting the upstream `/v1/models` endpoint. A New API gateway catalog
stayed at a September snapshot (36 models) while the upstream served 29 models including
`gpt-6.1-sol`. The refresh only re-read local rows, reported success, and never surfaced staleness.

The root cause is ownership, not a missing branch. The catalog is a derived read model with
multiple inputs; it must have one owner, one write path, one merge pipeline, and an explicit
freshness contract.

## Goals

1. Make the main process the single owner of provider catalog orchestration and persistence.
2. Keep source ownership unchanged: provider facts remain distinct from provider-db defaults,
   user model configuration, and user selection.
3. Make an explicit user refresh always contact the provider's current catalog source.
4. Make catalog freshness, failure, and last successful sync observable to the renderer.
5. Keep the renderer a projection: it issues commands and renders snapshots, and never decides
   whether to discover models.
6. Remove the duplicate renderer merge/discovery path without changing CLI, agent, or provider
   request contracts.

## Non-Goals

- No new process, database engine, dependency, or generic event bus.
- No new model or capability cache. The snapshot is computed on read from existing sources.
- No change to the provider-db format, and no New API entry added to provider-db.
- No change to model enablement defaults or automatic enablement of newly discovered models.
- No change to the `ModelConfig`, CLI, or agent runtime contracts.
- No event-sourcing system; catalog revisions only order notifications.

## Source Ownership

The existing `docs/architecture/model-config-source-of-truth/spec.md` remains normative:

```text
safe fallback
  < provider catalog defaults
  < raw provider MODEL_META facts
  < explicit user ModelConfig
  < provider-specific normalization policy
```

Persistence owners remain:

- `provider_models` (source `provider`): sparse facts observed from one provider service;
- `provider_models` (source `custom`): explicit user model definitions;
- `model_configs`: explicit user model configuration only;
- `model_status`: explicit user enablement;
- provider-db: catalog defaults and capability metadata, selected through the existing
  capability-identity resolver;
- `provider_catalog_state`: operational metadata only (last successful sync, revision, last
  sanitized error). It stores no model or capability content and is not synced.

Derived effective values are never written back into `provider_models`, `model_configs`, or
provider-db. The projection is recomputable from the sources above.

## Proposed Design

One main-process `ProviderCatalogService` owns catalog reads and refreshes.

### Read path

`getSnapshot(providerId)` is pure and side-effect free. It:

1. reads the provider row and catalog state;
2. builds the union of model identities from provider-db identity records, raw
   `provider_models` source `provider`, and raw `provider_models` source `custom`;
3. resolves effective configuration through the existing `ProviderSettings` resolver
   (`resolveEffectiveModels` / `getModelConfig`), preserving the precedence above;
4. reads model status through the existing batch status path;
5. returns a `ProviderCatalogSnapshot` containing the resolved models, `revision`, derived
   freshness `status`, `fetchedAt`, `source`, and sanitized `lastErrorCode`.

The snapshot is computed on demand. No provider catalog content is cached in a new store.

### Refresh path

`refresh(providerId, reason)` is the only path that writes the provider catalog:

1. deduplicates in-flight refreshes per provider;
2. for provider-db-backed providers and an explicit user refresh, synchronizes provider-db first;
3. obtains models from the provider's pure catalog fetch adapter;
4. compares the normalized model set with the persisted source `provider` rows;
5. replaces source `provider` rows and updates catalog state in one logical operation;
6. reloads the provider instance's in-memory read-through cache;
7. emits one catalog change event and, when content changed, one legacy `models.changed` event;
8. keeps last-known-good rows and records a sanitized error code on failure.

Reasons are explicit: `user`, `stale`, `config`, `provider-db`, `sync`, and `external-write`.
Only `user` (and an explicit config change) forces an upstream request regardless of freshness.
`stale` is a background stale-while-revalidate request. `provider-db` and `sync` never contact the
upstream catalog.

### Freshness

Freshness is derived from the persisted `fetched_at` and the source-specific TTL:

- remote catalog sources: six hours;
- runtime sources (`openai-codex`, Ollama, ACP): sixty seconds;
- provider-db and config sources: effectively infinite until a provider-db/config event.

`ensureFresh(providerId)` schedules a background `stale` refresh only when the provider is
enabled, the snapshot is stale or unknown, no refresh is in flight, and an error backoff has
elapsed. Reads remain pure; callers explicitly request revalidation.

### Events and routes

Typed routes:

- `providers.catalog.get` -> one snapshot;
- `providers.catalog.list` -> snapshots for the requested or all providers;
- `providers.catalog.refresh` -> refresh result and fresh snapshot;
- `providers.catalog.ensureFresh` -> whether a background refresh was scheduled.

Typed event `providers.catalog.changed`:

```text
providerId, revision, status, reason, changed, added?, removed?, updated?, errorCode?, version
```

`revision` is monotonic per provider and guards against out-of-order IPC responses across
windows. `changed: false` status events update freshness without refetching the model list.
The legacy `models.changed` event remains during migration for capability, chat-mode, and Ollama
consumers.

## Invariants

1. Only `ProviderCatalogService` writes provider catalog rows. Provider instances, draft
   validation, and ACP adapters use the service or a pure fetch adapter.
2. A user refresh always attempts the current catalog source; a non-empty local catalog never
   suppresses it.
3. A failed refresh never deletes last-known-good models.
4. Derived provider-db, fallback, or user values are never persisted as provider facts.
5. One refresh performs one source-row replacement and emits one catalog change event, not one
   event per model.
6. Custom model definitions remain intact across upstream refreshes and take precedence over
   upstream facts for the same provider and model ID, without duplicate rows.
7. The renderer never merges catalog sources or chooses freshness policy.
8. `provider_catalog_state` is local operational metadata; it is not synced and contains no model
   content, `ModelConfig`, or capabilities.
9. Provider-model reads remain side-effect free; only explicit refresh, config, sync, or ACP
   external-write paths mutate catalog state.

## Compatibility and Migration

- Additive schema migration (version 26) creates `provider_catalog_state`; existing rows,
  sync triggers, and provider-db format are untouched.
- Existing providers without state read as `unknown`, so the first catalog read schedules a
  background refresh. This self-heals stale snapshots after upgrade.
- New routes and events are additive. Existing routes and `models.changed` keep working during
  migration; legacy paths are removed only after the renderer projection switches.
- Rollback leaves the additive table in place; older code ignores it. No user model data is
  rewritten.

## Acceptance Criteria

1. A local mock provider returning catalog A on its first `/v1/models` response and catalog B on
   the second: two explicit refreshes produce two requests, and the model added in B is visible.
2. A failed refresh keeps the previous models, exposes a sanitized error state, and a retry
   recovers.
3. Offline startup renders the persisted catalog immediately; a later background revalidation
   updates it without a blank list.
4. Provider-db metadata changes re-project capabilities without an upstream request.
5. A model status or model config change updates the renderer without a full catalog refetch.
6. Two windows converge through catalog revision; an older snapshot response cannot overwrite a
   newer one.
7. Synced provider/model changes invalidate the local snapshot and re-project.
8. CLI and agent reads keep using the refreshed `provider_models` rows with unchanged contracts.
9. No `setProviderModels` call exists outside the catalog service and the settings persistence
   implementation.
10. Format, i18n, lint, typecheck, targeted unit/component tests, and the catalog smoke test pass.

## Rejected Alternatives

- **Button-only fix**: call `providers.refreshModels` from the settings button. Fixes one path,
  keeps two orchestration layers, and leaves the next provider type with the same defect.
- **Renderer-owned stale-while-revalidate**: the renderer decides stale and fetch policy. Multiple
  windows duplicate state, CLI/agent do not share it, and the renderer keeps the merge.
- **Fetch-only catalogs**: no persistence. Breaks offline startup, provider-db enrichment, and
  request routing metadata.
- **Write-time merge**: persist one resolved model row. Loses provenance, makes resets and catalog
  updates incorrect, and violates the existing source-of-truth specification.
