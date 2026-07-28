# Model Config Source of Truth Implementation Plan

## 1. Separate raw model storage from effective resolution

Remove the effective-config callback from `ProviderModelHelper`. Make its public model reads return
normalized raw `MODEL_META` values and add a raw single-model getter backed by
`ProviderModelDbStore.getProviderModel` when available.

Retain a raw array lookup only for legacy stores that do not implement the composite-key getter.
Route metadata reads use the same raw getter and never invoke model-config resolution.

Move effective model-list projection to `ProviderSettings`, which already owns provider identity,
catalog access, model configuration, and provider-specific behavior.

## 2. Add one effective model-config resolver

Extend the internal resolution input with optional provider facts. `ProviderSettings` resolves
route metadata and capability identity from:

- a supplied `MODEL_META` for list calls; or
- one raw provider/custom model lookup for a single-model call.

Pass the resolved identity and sparse provider facts to `ModelConfigHelper`. It builds the complete
configuration in this order:

1. catalog defaults or safe fallback;
2. explicit provider facts;
3. complete user configuration;
4. provider-specific normalization.

Keep the public models config IPC output complete and unchanged.

Avoid repeated storage reads by passing the current model through provider-list and runtime-list
mapping. Do not add memoization.

## 3. Remove provider-derived configuration writes

Delete `updateProviderManagedModelConfig` and `syncProviderModelConfig`. Remove the New API
post-discovery model-config loop and the remote-strategy synchronization call.

Ensure actual provider observations formerly synchronized are returned in `MODEL_META`; values
that the provider did not report remain absent and fall through to the catalog or safe fallback.
Keep `apiEndpoint` derived from type and endpoint at effective-resolution time. Do not preserve the
existing temperature self-write.

At the raw persistence boundary, strip materialized catalog capability and limit fields from
catalog-backed provider rows. Apply the same normalization to fresh lists and run a separately
guarded migration for legacy rows so an old catalog snapshot cannot outrank the current catalog.
Keep reads side-effect free, preserve custom-model facts and genuine remote observations, and
enforce the raw-fact rule at the physical table boundary so restore paths cannot bypass it.

Provider refresh continues to persist its returned model list through the existing
`replaceProviderModels` transaction and emits the existing single models-changed event.

## 4. Unify model projection

Replace the separate precedence logic in `ProviderModelHelper.applyResolvedModelConfig` and
`ModelManager.getModelList` with the ProviderSettings effective resolver.

Projection retains raw-only `MODEL_META` fields and applies resolved configuration fields without
another `isUserDefined` branch. Add parity tests for the stored catalog route and runtime-list
route.

## 5. Migrate to a user-only model-config store

Introduce one pure legacy-entry normalizer and use it at every ingestion boundary. The physical
SQLite write boundary rejects entries that cannot be normalized as user intent; in-memory imports
use the same function so rejected rows cannot remain cached. Bulk legacy readers additionally pass
the `__meta__.userConfigKeys` context to that same normalizer before reaching the physical guard.

Add an idempotent, transaction-safe migration that:

- reads the legacy `__meta__` user-key list when present;
- preserves and normalizes explicit or recognized legacy user entries;
- deletes provider, system, unknown, and metadata entries;
- records completion through the existing configuration-migration facility rather than app
  version.

Update retained rows in place so their `created_at` metadata is preserved. Log preserved and
removed counts at startup and restore boundaries without logging configuration contents.

Remove `ModelConfigHelper`'s derived-config version refresh, user-key metadata writes, and metadata
cache handling. Active model-config writes are user-only and require one store write.

Filter all entry points:

- typed model-config import;
- legacy backup/sync import;
- whole-SQLite overwrite and incremental restore;
- legacy Electron Store to SQLite migration.

Export only normalized user configuration. Keep legacy input contracts permissive enough to read
old backups while ignoring non-user entries.

## 6. Validation

Add focused tests for:

- OpenAI-owned New API `gpt-5.6-sol` with duplicated catalog IDs;
- initial load, reset, refresh, version change, user override, and reset;
- upstream limits present and absent;
- ambiguous unknown provider fallback;
- no provider-derived model-config writes or per-model config events;
- raw-helper dependency direction and legacy raw-store fallback;
- stored catalog/runtime projection parity;
- user-only migration with explicit source, legacy `isUserDefined`, legacy user keys, provider
  entries, system entries, unknown entries, and metadata;
- all typed, backup, and startup migration import paths;
- export excluding non-user legacy entries.
- side-effect-free provider-model reads and explicit raw-fact migration;
- provider-family fallbacks for unknown Anthropic, Bedrock, and ACP models;
- raw single-model existence checks that do not invoke effective list resolution;
- preservation of retained model-config creation timestamps.

Run the smallest focused suites first, then:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- relevant main, renderer, sync, migration, and contract suites
- the full test suite and production build when the environment permits

Before each commit, review the complete staged diff by severity for hidden side effects,
compatibility, boundary cases, performance, security, naming, test gaps, and maintenance cost.
Fix findings before committing. Do not push.
