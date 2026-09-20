# TypeSafe Jev Provider — Plan

Spec: `spec.md`. Status: implemented; gates green.

## Slice 1 — Model type vocabulary

Objective: make "this model is not a chat model" expressible.

- [x] Add `Judgment = 'judgment'` to `ModelType` in `src/shared/model.ts`.
- [x] Treat `Judgment` as non-chat in the classification helpers that enumerate non-chat types, so
      existing catalogs are classified exactly as before.
- [x] Update the one exhaustive `Record<ModelType, ...>` map the compiler flagged
      (`ProviderModelList.vue`), which is exactly the cross-cutting effect this slice expected.

Ownership: `src/shared/model.ts` and the helpers that consume `ModelType`.

Completion condition: `pnpm run typecheck` passes and no existing model's classification changes.

## Slice 2 — Jev provider protocol

Objective: a provider that speaks System One instead of chat.

- [x] Add `src/main/provider/providers/jevProvider.ts` extending `BaseLLMProvider`.
- [x] Implement discovery against `GET {baseUrl}/v1/models` and the `{ models: [...] }` shape.
- [x] Implement the connection check as the authenticated catalog fetch; no tokens spent.
- [x] Make every chat-shaped abstract member refuse: promise members throw a typed
      unsupported-capability error, `coreStream` yields it as a stream error event.
- [x] Honour `AbortSignal`, the configured proxy, a bounded timeout, and `401`/`422`/`429`/`529`
      error mapping via the shared provider failure helper.
- [x] Keep the API key in the main process and send it only to the configured base URL.

Ownership: `src/main/provider/providers/`.

Depends on: Slice 1 for the model type.

Completion condition: the provider can be constructed, checked, and refreshed in isolation.

## Slice 3 — Registration and built-in profile

Objective: reach the protocol by id and by api type.

- [x] Branch on `id === 'typesafe' || apiType === 'jev'` in
      `providerInstanceManager.createProviderInstance`, preserving `id -> apiType` order.
- [x] Add the disabled built-in `typesafe` profile to `DEFAULT_PROVIDERS`, including the static
      fallback catalog so the judgment picker is populated before the first refresh.
- [x] Deliberately do NOT register `jev` in `PROVIDER_API_TYPE_REGISTRY`. That registry maps to an
      `AiSdkProviderDefinition` and would route the protocol to a transport that cannot express it.
      The instance branch is the correct and self-contained extension point, mirroring `ollama`.
      The spec was corrected to record this.

Ownership: `defaults.ts`, `providerInstanceManager.ts`.

Completion condition: a draft `jev` provider resolves and validates end to end.

## Slice 4 — Custom provider reachability

Objective: let a user-defined provider select the protocol.

- [x] Add the `jev` option to `AddProviderFlow`'s api type select, plus the `/v1/systemone` endpoint
      hint. The option label is a hardcoded product name, matching every neighbouring option in that
      select; no i18n key is introduced because the surrounding options have none.
- [x] Add `jev` to the import allow-list and the deeplink allow-list so imported configurations do
      not degrade to `openai-completions`.
- [x] Exclude `ModelType.Judgment` from type-less `ModelSelect` pickers, closing the gap where a
      chat picker would otherwise have listed Jev models. This was not in the original slice and is
      required by the spec's non-chat invariant.

Ownership: renderer provider settings, `src/shared/providerImport.ts`, `src/shared/providerDeeplink.ts`.

Completion condition: `pnpm run i18n` passes and an imported `jev` configuration keeps its api type.

## Slice 5 — Review and validation

Objective: prove the change is safe and leaves existing providers alone.

- [x] Whole-change review against the spec for compatibility, failure behaviour, and secret handling.
- [x] Durable contract-level tests: catalog parsing, the non-chat guarantee, the System One request
      body, check behaviour, and the built-in profile.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and the focused
      main-process provider suite.
- [x] No temporary probe or scaffolding retained.

Completion condition: all gates pass; no existing provider test changes behaviour.

## Deferred

- Surfacing TypeSafe's per-model `description` and `release_date` in the model manager UI.
- Any evaluation harness. Issue #2326 requires evaluation evidence before adoption, but that work
  is not part of this plan.
