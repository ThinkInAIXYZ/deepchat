# Model Config Source of Truth Tasks

## Specification

- [x] Confirm the duplicated `provider_models` and provider-derived `model_configs` facts.
- [x] Trace reset, refresh, app-version invalidation, and import reproduction paths.
- [x] Record source ownership, precedence, dependency, migration, and performance invariants.
- [x] Write `spec.md`, `plan.md`, and `tasks.md`.
- [x] Add an evolution note to the maintained capability-identity specification.

## Raw model boundary

- [x] Remove the effective-config callback from `ProviderModelHelper`.
- [x] Add raw provider/custom single-model lookup with a raw legacy-store fallback.
- [x] Make route metadata lookup consume raw facts only.
- [x] Move resolved provider-model projection to `ProviderSettings`.

## Effective configuration

- [x] Resolve capability identity from supplied or raw model facts.
- [x] Merge fallback, catalog, provider facts, user intent, and provider policy once.
- [x] Pass model facts through list paths to avoid N+1 reads.
- [x] Unify stored and runtime model projection semantics.

## Provider refresh

- [x] Remove `updateProviderManagedModelConfig`.
- [x] Remove `syncProviderModelConfig`.
- [x] Remove New API and remote-strategy provider-config writes.
- [x] Verify provider refresh persists facts once and emits one models-changed event.

## User-only storage

- [x] Add the shared legacy user-entry normalizer.
- [x] Enforce user-only entries at the physical SQLite write boundary.
- [x] Migrate existing entries and remove legacy model-config metadata.
- [x] Remove version-derived refresh and per-write user-key metadata updates.
- [x] Filter typed import, backup restore, and startup migration.
- [x] Export user configuration only.

## Validation

- [x] Add the complete `gpt-5.6-sol` lifecycle regression.
- [x] Add provider-fact precedence and ambiguity regressions.
- [x] Add dependency, projection parity, refresh-write, migration, import, and export regressions.
- [x] Run focused tests.
- [x] Run format, i18n validation, lint, and type checking.
- [x] Run the full test suite and production build when permitted.
- [x] Complete a severity-ordered pre-commit review and fix every finding.
- [x] Commit locally without pushing.

## Post-implementation hardening

- [x] Move legacy provider-fact cleanup out of read paths into a guarded migration.
- [x] Enforce raw provider facts at the physical provider-model write boundary.
- [x] Preserve Anthropic, Bedrock, and ACP compatibility fallbacks in the resolver.
- [x] Make fresh-cache misses perform a targeted provider-row lookup.
- [x] Keep sparse route resolution from erasing raw provider facts.
- [x] Make model-existence checks use raw facts and the catalog index.
- [x] Preserve `model_configs.created_at` during user-only migration.
- [x] Add runtime-independent tests for legacy user-intent normalization.
- [x] Run focused and full validation for the hardening changes.
- [x] Complete the severity-ordered pre-commit review for the hardening changes.
- [x] Commit the hardening changes locally without pushing.
