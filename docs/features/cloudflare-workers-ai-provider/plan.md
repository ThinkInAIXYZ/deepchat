# Cloudflare Workers AI Provider — Plan

Spec: `spec.md`. Status: implemented; gates green; not yet smoke-tested against a live account.

## Slice 1 — Mixed-provider protocol

Objective: one provider that serves chat models and a judgment model, without forking either.

- [x] Reject the judgment-only shape from the first pass. Workers AI's catalog is mostly chat and
      embedding models, so a provider that only judged was the wrong product.
- [x] Add `WorkersAiProvider extends AiSdkProvider`: chat, streaming, embeddings, summarization and
      title generation come from the shared OpenAI-compatible transport.
- [x] Add `workers-ai` to `PROVIDER_API_TYPE_REGISTRY` with an OpenAI-compatible definition, and a
      `workers-ai` model-source case that throws, mirroring `apimart`: discovery is the provider's
      own because the `openai` catalog path would ask for a route the endpoint does not serve.
- [x] Branch on `provider.apiType === 'workers-ai'` in `createProviderInstance` before the AI SDK
      fallback.
- [x] Make the judgment capability guard structural (`runJudgment` present) instead of
      `instanceof JevProvider`, since one provider now has both capabilities. The runtime's clear
      failure for a provider without the capability is preserved, and a test pins both directions.
- [x] Export the System One answer parser so both transports parse the same shape.

Ownership: `src/main/provider/providers/workersAiProvider.ts`, `jevProvider.ts`, `providerRegistry.ts`.

## Slice 2 — Catalog discovery and typing

Objective: populate the pickers from the account.

- [x] Read the Workers AI model search (`{apiRoot}/models/search`), authenticated with the provider
      token, paging through `result_info.total_pages` up to a cap.
- [x] Type by the catalog task: `Text Generation` → chat, `Text Embeddings` → embedding; any
      `jev` model → judgment at 32k context; everything else skipped, because the OpenAI-compatible
      endpoints cannot serve it.
- [x] Fall back to the last-known catalog, then the bundled seed, so one transient failure cannot
      clear the per-provider store the pickers read.
- [x] Seed only the judgment model. Seeding chat models would pin stale ids; the chat catalog is the
      account's, and the picker refreshes it.

Ownership: `src/main/provider/providers/workersAiProvider.ts`, `defaults.ts`.

## Slice 3 — Judgment over the run API

Objective: the judgment capability on the same provider.

- [x] Post `{ model, input: { state, questions } }` to `{apiRoot}/run` and unwrap `result` into the
      shared answer parser; accept an already-unwrapped body.
- [x] Refuse without an API key and without at least one question, matching the TypeSafe transport.
- [x] Derive `apiRoot` from the configured OpenAI-compatible base by removing `/v1`, so one setting
      serves both capabilities.

Ownership: `src/main/provider/providers/workersAiProvider.ts`.

## Slice 4 — Base URL rules and connection check

Objective: make a misconfigured account fail loudly and cheaply.

- [x] Refuse empty, whitespace, placeholder, query/fragment-bearing and `/v1`-less base URLs with a
      typed message, before any request. The placeholder check precedes URL parsing: `new URL`
      percent-encodes `<` and `>`, so the path check alone let `<ACCOUNT_ID>` through. Caught by the
      base URL test.
- [x] Require the `/v1` suffix: the inherited transport derives the chat and embedding paths from the
      stored base URL, so accepting the run-API root would silently break chat.
- [x] Check through the authenticated model search — no neurons, and it validates the account id.
      HTTP failures report the status and Cloudflare's body; a configuration failure reports its own
      message, because that is the one the user has to act on. The AI SDK transport throws its own
      private `ProviderHttpError`, so the status is read structurally rather than by `instanceof`.

Ownership: `src/main/provider/providers/workersAiProvider.ts`.

## Slice 5 — Custom provider reachability, imports and mark

Objective: reach the protocol from the UI and keep imports honest.

- [x] Add the protocol option and the `/chat/completions` endpoint hint to `AddProviderFlow`.
- [x] Add `workers-ai` to the import allow-list, the deeplink allow-list, and the import dialog's api
      type label (the `workersAi` locale key, present in all 23 locales).
- [x] Type imported models per model instead of per api type: a `jev` name is a judgment model, and
      the rest stay untyped so they remain chat models in the pickers. Caught by the import test.
- [x] Keep the id rule in the shared vocabulary (`isJevJudgmentModelId` in `@shared/jevProtocol`)
      rather than importing the provider module from the import service: that import dragged
      `providerDbLoader` — which reads `app.getPath` at module load — into the route dispatcher's
      import chain and broke its test suite.
- [x] Make the base URL editable for the `cloudflare` provider id, and ship the account-URL format as
      `websites.defaultBaseUrl`, matching how `azure-openai` ships a tenant-specific endpoint.
- [x] Register the Cloudflare mark: the existing `cloudflare-color.svg` asset plus the `cloudflare`
      and `workers-ai` keys. Brand colour mark, so not in `monoIconUrls`.
- [x] Verified that no existing provider id, api type or model id contains `cloudflare`, so adding
      the key changes no existing resolution.

Ownership: renderer provider settings, `src/shared/providerImport.ts`, `src/shared/providerDeeplink.ts`,
`providerImportService.ts`, `modelIconRegistry.ts`, i18n locales.

## Slice 6 — Review fixes

Applied in response to an independent review of the rework.

- [x] The Cloudflare mark moved behind `glm` in `modelIconRegistry.ts`. A provider-db model id
      (`cloudflare-glm-5.2`) contains both names, and resolution is first-substring-wins in key order,
      so the vendor key at the top of the map silently restyled that model. A test now pins it.
- [x] Keep the seeded judgment model when a successful discovery omits it. The fallback only covered
      a failed search, so a catalog without the third-party model emptied the judgment-model picker on
      the first refresh, with nothing to restore it.
- [x] Treat an envelope-level failure (`success: false`) as a failure even on a 2xx status; otherwise
      it read as an account with no models and the check reported connected.
- [x] Refuse a judgment model on every chat-shaped path. The pickers already filter it out, but a
      stale or programmatic caller would otherwise send `typesafe/jev` to the chat endpoint and get
      prose back. One `resolveRouteDecision` override covers the promise-shaped paths and a
      `coreStream` override keeps the streaming shape the judgment-only provider uses.
- [x] Read a hyphenated task id as well as a task name, and normalize case, hyphens and underscores.
- [x] Dedupe discovered records by model id, so a repeated page cannot duplicate the persisted catalog.

- [x] Merge the judgment model from its fixed id rather than only from the bundled seed. The live
      catalog turned out to cover Cloudflare-hosted models only — `typesafe/jev` is a third-party
      model in the unified AI catalog, and its Workers AI path does not exist — so discovery never
      yields it, and a custom `workers-ai` provider has no seed to fall back on either.

## Slice 7 — Review and validation

Objective: prove the change is safe and leaves existing providers alone.

- [x] Durable contract tests: task-to-type mapping, catalog parsing, paging and dedupe, the fallback
      and seed-merge order, the run envelope and unwrapping, base URL refusals, the check outcomes
      (including a 2xx envelope failure), both directions of the judgment guard, the chat-path
      refusal, the built-in profile, the imported-model typing, and the mark.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and the full
      main and renderer suites.
- [x] No temporary probe or scaffolding retained.

Completion condition: all gates pass; no existing provider test changes behaviour.

## Open items

- Live smoke test against a Cloudflare account: confirm the search element fields (`name`, `task`,
  `description`), the pagination envelope, and the `result` envelope on the run response. The parsers
  are tolerant, so a mismatch degrades to the bundled catalog and an ok check rather than to a hard
  failure.
- Whether every `Text Generation` model is served by the OpenAI-compatible endpoint. Models that are
  not would fail on first use rather than being filtered out of the list.
- Whether the OpenAI-compatible endpoint accepts image parts for the vision-capable models. Until
  that is known, no `vision` flag is set, so those models are usable as text-only chat models.
- `apiType` is not a rebuild-required field, so a direct (CLI/admin) update that flips a provider to
  `workers-ai` keeps the live instance and its catalog refresh throws until a rebuild. Same
  pre-existing shape as `apimart`; not reachable from the settings UI.
