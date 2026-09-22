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

- [x] Branch on `provider.apiType === 'jev'` in
      `providerInstanceManager.createProviderInstance`, preserving `id -> apiType` order. Api-type
      only: the built-in already declares `apiType: 'jev'`, so an id check adds nothing and would
      pin the provider to `JevProvider` if a user repointed that entry.
- [x] Add the disabled built-in `typesafe` profile to `DEFAULT_PROVIDERS`, including the bundled
      catalog. It is the fallback when the live catalog is unavailable or empty, not a standalone
      seed for the picker — the renderer reads the persisted per-provider model store.
- [x] Deliberately do NOT register `jev` in `PROVIDER_API_TYPE_REGISTRY`. That registry maps to an
      `AiSdkProviderDefinition` and would route the protocol to a transport that cannot express it.
      The instance branch is the correct and self-contained extension point, mirroring `ollama`.
      The spec was corrected to record this.

Ownership: `defaults.ts`, `providerInstanceManager.ts`.

Completion condition: a draft `jev` provider resolves and validates end to end.

## Slice 4 — Custom provider reachability

Objective: let a user-defined provider select the protocol.

- [x] Add the `jev` option to `AddProviderFlow`'s api type select, labelled `System One` and with no
      endpoint hint: the configured base URL is the endpoint itself. The label is a hardcoded product
      name, matching every neighbouring option in that select; no i18n key is introduced because the
      surrounding options have none.
- [x] Add `jev` to the import allow-list and the deeplink allow-list so imported configurations do
      not degrade to `openai-completions`.
- [x] Add the provider mark: `assets/llm-icons/typesafe.png` (TypeSafe's official square favicon)
      plus the `typesafe` and `jev` keys in `modelIconRegistry.ts`. This was missed on the first
      pass; the format is asset + registry entry, not a `websites.icon` field. Verified that no
      existing provider's resolved icon changes.
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

## Slice 6 — Review fixes

Applied in response to the PR review.

- [x] Make the bundled catalog load-bearing: it is the fallback whenever the live catalog is
      unavailable or empty. The original spec claim — that the static entries populated the picker
      before the first refresh — was wrong, and the spec now records the real mechanism.
- [x] Select the provider by api type only, removing the redundant and foot-gun-prone id branch.
- [x] Add the ModelSelect test for both directions of the judgment exclusion.
- [x] Drop the unused `isJevScoreAnswer` guard and the redundant `JevQuestion` re-export.

## Slice 7 — Second review round

Applied in response to the second PR review.

- [x] Fix the fallback preference order. Seeding only from `this.provider.models` was wrong: the
      settings sidebar reorders by sending provider summaries, which omit `models`, and the reorder
      writes that array over the whole providers list — so the seed disappears after any drag or
      move. The last-known catalog (`this.models`, loaded from the per-provider store) is now
      preferred, with the bundled seed used only when nothing has been discovered. Spec and comments
      corrected.
- [x] Extend the judgment exclusion to `ModelChooser`, the MCP sampling picker's source. It was the
      remaining picker that could select a Jev model and reach
      `generateCompletionStandalone` before failing.
- [x] Tag imported models as `ModelType.Judgment` when the target api type is `jev`. Imported models
      carried no type, which the picker filters read as "not a judgment model".
- [x] Reject out-of-range probabilities. An oversized `noul` or `confidence` satisfied its `>=`
      gate, so invalid output could only push toward `auto_allow` — the one input in the composition
      that did not fail closed.
- [x] Teach the remaining surfaces about the type: the import dialog's api type label, the model
      manager's type filter order, and the model config dialog's type select.
- [x] Add the disclosure that a configured judgment model sends tool arguments and recent
      conversation to the configured service.
- [x] Delegate the request signal to `BaseLLMProvider.createModelRequestSignal` instead of
      re-implementing it, so a timeout aborts with `provider_request_timeout` and stays
      distinguishable from a caller cancel.
- [x] Pin the policy boundaries by literal value in a `composeJevReviewDecision` test, and make the
      threshold constants module-private.
- [x] Reconcile spec and plan with the code: status, the api-type-only branch, the action-binding
      wording, and the covered picker surfaces.

## Slice 8 — Endpoint URL as a full reference

Applied on review: vendors expose System One at different paths, so the base URL is the endpoint
itself rather than a host with a fixed route appended to it.

- [x] Post to the configured base URL verbatim instead of `{baseUrl}/v1/systemone`.
- [x] Derive the catalog from the endpoint's sibling path (last segment replaced by `models`) instead
      of a fixed `/v1/models`. A 404/405 there means "no live catalog" for discovery and "not
      contradicted" for the check, so a vendor without a catalog is still connectable.
- [x] Move the built-in profile's base URL to `https://api.typesafe.ai/v1/systemone` and label the
      custom-provider option `System One` with no endpoint hint.

## Deferred

- Surfacing TypeSafe's per-model `description` and `release_date` in the model manager UI.
- Any evaluation harness. Issue #2326 requires evaluation evidence before adoption, but that work
  is not part of this plan.
- A failed judgment review is invisible to the user. The reviewer returns a generic rationale for
  `ask_user` and the caller drops it, so a misconfigured judgment model silently turns every
  auto-approve into a prompt with no way for a user to find out why. Fail-safe, but it needs a
  surface. Not addressed in this change.
- `getProviderSummaries` drops `models`, `customModels`, `enabledModels` and `disabledModels`, so a
  provider reorder silently strips them from the stored provider list. Pre-existing and unrelated to
  this work; the Jev fallback was hardened against it rather than fixing the reorder path.
