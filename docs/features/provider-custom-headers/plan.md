# Provider Custom Request Headers Plan

## Objective

Implement the contract in `spec.md` with one provider-level `customHeaders` field, an existing-Monaco
JSON editor dialog, origin-scoped main-process request merging, trace-safe handling, and Advanced
positioned before Models. Preserve existing provider behavior when the field is absent.

## Ownership Boundary

- Shared types and route schemas own the persisted shape and authoritative validation.
- Provider settings/store code owns staging, persistence, provider-health invalidation, and atomic
  update propagation.
- Main provider HTTP code owns merge precedence and origin scoping.
- Renderer provider settings own only drafts, feedback, and save intent.
- `ProviderSettingsShell` owns section order; `ProviderModelList` keeps the outer settings scroll
  area as its existing page-mode virtualization owner.

## Implementation

- [x] Add the optional `customHeaders` provider type and one reusable validation/normalization
  contract. Complete when internal provider list, update, add, and draft-validation routes accept
  valid records and reject every invalid shape and limit from the spec without exposing the field on
  public CLI routes.

- [x] Add the main-process provider-header resolver and route AI SDK middleware plus relevant direct
  HTTP provider paths through it. Complete when supplemental headers use case-insensitive merge
  precedence, remain limited to the configured origin, are stripped on cross-origin redirects and
  media downloads, and transport-owned headers remain authoritative.

- [x] Make request traces treat every configured custom-header name as sensitive. Complete when
  traces may retain the names but persist no corresponding values, including unknown credential
  names such as `CF-Access-Client-Secret`.

- [x] Extend provider update staging and health fingerprints to include canonical custom headers.
  Complete when a configured provider validates candidate headers before persistence, a failed check
  preserves the old record, a successful save affects the next request, and stale health is cleared.

- [x] Add one reusable custom-header control to standard provider Advanced settings, the Ollama
  connection screen, and the custom-provider creation flow; omit it for profiles without a
  profile-owned HTTP(S) base URL. Its compact row opens an existing-primitives `Dialog` containing
  the installed Monaco JSON editor, formatting, highlighting, inline validation, Cancel, and Save.
  Complete when every open starts from the current record, invalid or pending input blocks Save,
  failed configured-provider validation stays open without persistence, Cancel/Escape discards the
  local text, focus returns to the trigger, custom-provider Save updates only its form draft, and no
  editor dependency is added.

- [x] Place Advanced before Models in the shared provider shell. Keep `ProviderModelList` at its
  natural height with its existing page-mode virtualization and outer settings scroll owner.
  Complete when Advanced is reachable before a large catalog without changing model filtering,
  sorting, rows, or scroll behavior.

## Whole-Change Review

- [x] Review all provider HTTP consumers for chat, Responses, model discovery, connection checks,
  embeddings, speech, image, video, OAuth, and special-provider fetches. Confirm that every eligible
  provider-origin request receives headers and every excluded origin remains clean.

- [x] Review compatibility, error paths, casing, redirects, proxy behavior, disabled/unconfigured
  providers, provider import, persisted legacy data, dialog/editor lifecycle, section order,
  keyboard flow, and trace redaction. Remove any abstraction or file that is not required by at
  least two real request paths.

## Validation Selection

- [x] Add the smallest durable shared/main tests for schema rejection, case-insensitive precedence,
  origin and redirect isolation, transport-header protection, atomic persistence, health
  invalidation, and trace masking. Prefer wire/contract assertions over private control-flow mocks.

- [x] Add focused renderer tests for dialog open/save/cancel, invalid JSON/object values, failed-save
  persistence isolation, custom-provider draft validation, Monaco draft synchronization, and
  formatting. Run the built Electron smoke against the real dialog to verify section order, editor
  focus entry/restoration, persisted reopen state, and invalid-save blocking. Theme and
  platform-specific resize exploration remain useful before a release but are not implementation
  blockers.

## Cleanup and Quality Gates

- [x] Remove temporary probes and redundant tests, update this plan's completion state, then run the
  focused provider and renderer suites followed by `pnpm run format`, `pnpm run i18n`,
  `pnpm run lint`, and `pnpm run typecheck`.

## Validation Evidence

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run architecture:renderer-baseline:check`
- `pnpm exec electron-vite build`
- Focused main tests: 128 passed; the 5 SQLite-native cases were skipped because the optional native
  binding was unavailable to the host Node test runner.
- Focused renderer tests: 14 passed.
- Built Electron smoke: 1 passed.
