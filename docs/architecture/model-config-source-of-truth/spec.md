# Model Config Source of Truth Specification

## Background

DeepChat currently stores provider-discovered model facts twice:

- `provider_models.model_json` stores sparse `MODEL_META` returned by provider discovery;
- `model_configs.config_json` stores a complete provider-managed `ModelConfig` derived from those
  facts, the provider catalog, or safe fallbacks.

The second write loses provenance. In particular, New API model discovery asks for the current
effective configuration before the model's owner and route identity are supplied. An ambiguous
unqualified model such as `gpt-5.6-sol` therefore resolves to the safe `16000 / 4096` fallback.
The discovery loop then persists that fallback as `source: provider`, and later reads prefer the
stored values over the correctly resolved OpenAI catalog limits.

Resetting a model configuration or invalidating derived configurations on an app-version change
removes an older correct cache and exposes the same failure. Provider refresh then makes the wrong
value durable again.

## Goals

1. Make provider model facts, catalog defaults, and user intent distinct sources.
2. Persist provider model facts only in `provider_models`.
3. Persist only explicit user model configuration in `model_configs`.
4. Resolve one complete effective `ModelConfig` through one main-process path.
5. Remove the `ProviderModelHelper` dependency on effective model configuration.
6. Prevent legacy import, restore, or migration paths from reintroducing provider-derived
   `model_configs`.
7. Remove per-model configuration writes and events from provider model refresh.

## Required Invariants

### Source ownership

The source precedence for every effective model configuration is:

```text
safe fallback
  < provider catalog defaults
  < raw provider MODEL_META facts
  < explicit user ModelConfig
  < provider-specific normalization policy
```

Each source has one persistence owner:

- the provider catalog owns catalog defaults and capability metadata;
- `provider_models` owns sparse facts observed from one provider service;
- `model_configs` owns explicit user intent only;
- a complete effective `ModelConfig` is derived and is never persisted as provider state.

`MODEL_META` remains the provider-fact contract. Missing values remain absent and allow the catalog
or safe fallback to supply a value. `ModelConfig` remains complete at renderer and runtime
boundaries.

Catalog-backed providers persist only model identity and provider observations, not a materialized
catalog projection. The raw model boundary strips legacy projected capability and limit fields
when reading or writing those providers. A guarded, observable migration rewrites affected legacy
rows outside read paths. The physical provider-model write boundary applies the same rule so
legacy restore cannot reintroduce projections after the migration marker is set. Genuine
custom-model facts and remote provider observations remain intact.

Provider-family fallbacks are part of the safe fallback layer, not provider facts. Unknown
Anthropic-compatible and Bedrock Claude models retain a `200000` context fallback while waiting
for a catalog update, and ACP agents retain their `8192` context fallback. Catalog data, observed
provider facts, and user intent still override those values in the normal precedence order.

### Dependency direction

`ProviderModelHelper` owns raw provider-model persistence, lookup, normalization, and caching. It
does not call `ProviderSettings.getModelConfig` and does not produce resolved models.

`ProviderSettings` coordinates:

- raw provider-model facts;
- route-only user intent;
- capability identity;
- provider catalog defaults;
- complete user configuration;
- provider-specific normalization.

A list caller passes its current `MODEL_META` into effective resolution. A single-model caller may
perform one raw composite-key lookup. Effective resolution never obtains raw facts through a
resolved provider-model list.

Legacy stores without a composite-key getter may scan their raw stored array. That fallback must
not call a resolved-model path or reintroduce the former callback cycle.

### Effective projection

Persisted provider-model lists and freshly fetched runtime model lists use the same effective
resolver and the same projection semantics. Direct catalog views remain a raw catalog projection
and do not become another effective-config implementation.

The resolver owns precedence. Projection does not independently branch on `isUserDefined` or
repeat field-level precedence rules. Raw-only fields such as description and supported endpoint
types remain on `MODEL_META`; resolved configuration fields come from the effective result.

### User-only model configuration storage

New `model_configs` rows are accepted only when they represent user intent. The active write path
normalizes accepted entries to:

```text
source: user
config.isUserDefined: true
```

Legacy input may be recognized as user intent when:

- `source === "user"`; or
- `source` is absent and `config.isUserDefined === true`; or
- `source` is absent and the legacy metadata explicitly lists the cache key in `userConfigKeys`.

Explicit provider or system entries are discarded. Unknown entries are not guessed from their
numeric values.

The legacy `__meta__`, `lastRefreshVersion`, and `userConfigKeys` mechanism is removed after the
one-time migration because the store no longer contains derived entries.

All physical and in-memory import paths apply the same normalization rule. Whole-SQLite overwrite
and incremental restore paths normalize the copied database before it is reopened by the
application. Export includes user configuration only. Old backups containing provider entries
remain readable, but those entries are ignored.

An entry already mislabeled as explicit user intent is indistinguishable from a real user setting
without external provenance. The migration preserves it rather than risking user-data loss.

### Performance

Provider refresh performs one provider-model replacement transaction and emits one models-changed
event. It does not perform one model-config upsert, metadata upsert, cache invalidation, or
configuration-changed event per discovered model.

List resolution is linear in the number of models and uses the supplied facts. Catalog and cache
lookups remain constant time. No new persistent cache, LRU, or speculative memoization is added.
Single-model existence checks use raw point lookup and the catalog index; they never resolve a
complete provider or custom-model list. A normalized raw-list scan is retained only as a
case/prefix compatibility fallback.

## Acceptance Criteria

1. New API `gpt-5.6-sol` with `ownedBy: openai` and `endpointType: openai` resolves to context
   `1050000` and derived max tokens `32000`.
2. Initial load, reset, provider refresh, and app-version change all produce the same
   `1050000 / 32000` effective configuration.
3. A user override to context `200000` wins until reset, after which the effective context returns
   to `1050000`.
4. Provider discovery never writes a `source: provider` model-config entry.
5. Upstream limits present in `MODEL_META` override catalog limits; missing upstream limits fall
   through to the resolved catalog.
6. Ambiguous models without authoritative owner, route, namespace, or provider override retain the
   safe fallback.
7. Direct providers and known provider custom models do not inherit same-name limits from another
   provider.
8. Persisted provider-model and freshly fetched runtime-list routes project identical effective
   configuration fields.
9. Real user model settings continue to import, export, survive migration, override defaults, and
   reset normally.
10. Provider-derived entries from current storage, typed import, legacy backup restore, and legacy
    Electron Store migration are discarded.
11. Provider model refresh emits no per-model configuration events and performs no per-model
    model-config writes.
12. No model-config resolution path recursively calls through a resolved provider-model list.
13. Legacy catalog projections in `provider_models` cannot override a newer catalog after upgrade,
    while genuine upstream facts and custom-model facts retain precedence.
14. Provider-model reads are side-effect free; legacy projection cleanup runs only through the
    guarded migration or an explicit provider-model write.
15. Unknown Anthropic-compatible, Bedrock Claude, and ACP models retain their provider-family
    context fallbacks without persisting synthetic facts.
16. User-only migration preserves the original `created_at` value for every retained row.

## Constraints

- Preserve the typed preload and IPC boundaries.
- Preserve current `ModelConfig` renderer and runtime contracts.
- Preserve provider-level `capabilityProviderId` behavior.
- Do not infer OpenAI ownership merely from OpenAI-compatible transport.
- Do not use value-based heuristics to delete historical configuration.
- Keep the change local to model facts, effective configuration, migration, and their tests.
- Every local commit requires a severity-ordered review covering hidden side effects,
  compatibility, boundaries, performance, security, naming, tests, and maintenance.
- Do not push the branch.

## Non-Goals

- Changing the provider catalog format.
- Adding New API to the provider catalog.
- Persisting an additional sparse provider-config type.
- Changing user-facing model configuration fields.
- Selecting an arbitrary provider for ambiguous unqualified model IDs.
- Introducing a new catalog or effective-config cache.

## Open Questions

None. Source ownership, precedence, migration safety, and performance behavior are fixed by this
specification.
