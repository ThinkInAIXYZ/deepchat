# TypeSafe Jev Provider

Status: implemented.

## Context

DeepChat's provider runtime is chat/stream-centric: `BaseLLMProvider` requires `completions`,
`generateText`, `coreStream`, `summaries` and `summaryTitles`, and the AI SDK transport layer is
built entirely on `@ai-sdk/*` factories. There is no hand-written `LanguageModelV2`/`doStream`
anywhere in `src/main`.

TypeSafe's Jev is not a chat model. Its entire documented HTTP surface is one decision endpoint:

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
{ "state": <string|object|array>, "model": "jev-latest", "questions": { <id>: <Question> } }
-> { "model": "jev-1.13.0", "answers": { <id>: <Answer> }, "usage": {...} }
```

It has no chat messages, no streaming, no tool calls, no temperature, and — by design — it returns
typed answers and probabilities rather than generating text. `Choice` returns `choice` +
`probabilities` + `confidence`; `Score` returns `score` + `legend` + `probabilities` + `confidence`;
`Noul` returns a single `noul` probability and no confidence.

This document covers the provider/protocol half of the work. The agent-facing half — the judgment
model slot and the Jev permission-review backend — is a separate goal in
`docs/features/agent-judgment-model/`.

## Goals

- Add `jev` as a provider protocol (`apiType`) so that a provider speaking the System One wire
  format can be selected and configured.
- Ship a built-in, disabled-by-default `typesafe` provider on that protocol.
- Let user-defined custom providers (自定义服务商) select the same `jev` protocol and supply only
  their own base URL and API key, for vendors that expose a compatible endpoint.
- Mark Jev-protocol models so they never appear in chat model pickers.
- Keep the provider-runtime contract intact: explicit reviewed source change, main-process only,
  typed boundaries, no dynamic SDK installation.

## Non-goals

- Making Jev usable as a chat, embedding, rerank, image, video, or speech model.
- Any generation, streaming, or tool-call surface for this protocol.
- Installing the `@typesafe-ai/sdk` package. The adapter uses the existing main-process fetch and
  proxy path; the SDK is rejected because it is a generation-shaped client and would add a
  dependency the contract does not need.
- Provider-db catalog integration for Jev models.
- Per-vendor protocol deviation for custom providers. Custom `jev` providers reuse the TypeSafe
  wire format exactly and may only change base URL and key.
- Deciding whether Jev is a good reviewer. That is an evaluation outcome, not a provider concern.

## Design

### Protocol identity

- `apiType` is `jev`.
- Built-in provider id `typesafe`, display name `TypeSafe`, base URL `https://api.typesafe.ai`,
  `enable: false`.
- Auth is an API key sent as `Authorization: Bearer <key>`. No OAuth, no device flow, no
  provider-specific credential store.
- A custom provider selects `apiType: 'jev'` and supplies its own base URL and key. The endpoint
  path is fixed at `/v1/systemone` for evaluation and `/v1/models` for discovery; it is not
  user-configurable, because a divergent path is a divergent protocol.

### Registration

The provider is selected by a dedicated branch in
`providerInstanceManager.createProviderInstance` matching `provider.apiType === 'jev'`, placed
before the AI SDK fallback and after the existing id-keyed branches.

The check is api-type-only on purpose. The built-in `typesafe` profile already declares
`apiType: 'jev'`, so an additional `id === 'typesafe'` condition adds nothing, and it would pin the
provider to `JevProvider` even if a user repointed that entry at a different api type — where it
would then refuse every chat call.

`jev` is deliberately **not** added to `PROVIDER_API_TYPE_REGISTRY`: that registry maps a protocol to
an `AiSdkProviderDefinition` and exists to construct an `AiSdkProvider`, which cannot express this
wire format. A registry entry without a matching branch would silently route Jev models to the AI SDK
transport; a branch without a registry entry is correct and self-contained.

`jev` is added to the import and deeplink allow-lists so an imported configuration keeps its api type
instead of degrading to `openai-completions`.

### Transport

A dedicated `JevProvider extends BaseLLMProvider` is required. The wire format cannot be expressed
through any existing `@ai-sdk/*` factory, and `AiSdkProviderKind` has no shape for a
request/response pair that is not a chat stream.

Every chat-shaped abstract member (`completions`, `generateText`, `coreStream`, `summaries`,
`summaryTitles`) refuses rather than attempting a request: the promise-returning members throw a
typed unsupported-capability error, and `coreStream` yields the same error as a stream error event,
which is how streaming surfaces report failure. This is deliberate — a silent fallback would let a
Jev model be selected as a chat model and fail at runtime instead of at selection time.

The renderer enforces the same boundary at selection time: `ModelSelect` excludes
`ModelType.Judgment` from any picker that does not explicitly request that type, so a chat-shaped
picker that passes no type filter never lists a Jev model.

### Model type

`ModelType` gains `Judgment = 'judgment'`. This is the vocabulary that keeps Jev models out of chat
pickers and lets the agent's judgment-model slot ask for exactly this type. Existing classification
helpers that enumerate non-chat types explicitly (`isExplicitNonChatNewApiModelType`) treat
`Judgment` as non-chat, so no existing model's classification changes.

### Model discovery

`GET {baseUrl}/v1/models` returning `{ "models": [{ "name", "description", "release_date" }] }`.
This shape is not OpenAI-shaped, so discovery is implemented in the provider rather than delegated
to the tolerant OpenAI parser.

The built-in `typesafe` profile additionally ships a bundled catalog (`jev-1.13.0`, `jev-latest`).
It is the fallback whenever the live catalog is unavailable or empty — missing API key, transport or
status failure, or a successful response containing no models.

This fallback is load-bearing, not decorative: `BaseLLMProvider.fetchModels` persists whatever the
provider returns, so returning an empty list in those cases would clear a previously discovered
catalog. A bundled catalog that is never returned would also never reach a picker, because the
renderer reads the persisted per-provider model store and nothing seeds it from
`DEFAULT_PROVIDERS[].models`. The profile's static `models` reach the provider instance through the
stored provider config (`providerSettings`), which is where the fallback reads them from.

### Connection check

The check is the authenticated catalog fetch. It spends no tokens and needs no `checkModelId`,
which matters because TypeSafe bills input tokens per request and a "hello" generation probe is not
a meaningful check for a non-generative model.

### Credentials and transport safety

The API key is read and held in the main process only, never emitted to the renderer, matching the
existing provider contract. Requests honour the caller's `AbortSignal`, the configured proxy, and a
bounded timeout, and map TypeSafe's documented status codes (`401`, `422`, `429`, `529`) to
existing provider error shapes. `429`/`529` are retryable and must respect `retry-after` when
present.

### Renderer

The provider uses the existing generic provider configuration UI. `AddProviderFlow` gains one
`<SelectItem value="jev">` entry so the protocol is reachable for custom providers, and the
protocol joins the import and deeplink allow-lists so imported configurations do not silently
degrade to `openai-completions`. No Jev-specific settings form is introduced.

### Provider logo

Provider logos are not a `websites.icon` field — no code reads that. The convention is a static asset
plus a registry entry:

- the mark is stored under `src/renderer/src/assets/llm-icons/`;
- `modelIconRegistry.ts` imports it and maps one or more keys to it;
- `resolveModelIconKey` matches a key by substring of the provider id or api type, so the provider is
  reachable by id (`typesafe`) and its models by api type (`jev`, which also covers `jev-latest` and
  `jev-1.13.0`).

TypeSafe's mark is the official square favicon served by `typesafe.ai`, stored as a PNG. It is a
colour mark on its own background, so it is deliberately **not** added to `monoIconUrls`, which
drives dark-mode inversion for monochrome `currentColor` marks.

## Ownership

- `src/main/provider/providers/jevProvider.ts` owns the wire protocol.
- `src/main/provider/defaults.ts` owns display and default configuration.
- `src/main/provider/providerRegistry.ts` owns protocol-to-runtime mapping.
- `src/main/provider/managers/providerInstanceManager.ts` owns instance selection.
- `src/shared/model.ts` owns the model type vocabulary.
- `src/renderer/src/components/icons/modelIconRegistry.ts` and `assets/llm-icons/` own provider marks.
- Renderer selects and configures; it never holds keys or instances.

## Invariants

- A `jev` model is never offered by a chat, embedding, rerank, image, video, or speech surface. The
  two model pickers enforce this at selection time: `ModelSelect` and `ModelChooser` both exclude
  `ModelType.Judgment` from any picker that does not explicitly request that type. `ModelChooser` is
  the MCP sampling picker's source, which is the surface that would otherwise reach
  `generateCompletionStandalone` before failing.
- Lookup order stays `id -> apiType`.
- No Jev request is issued from the renderer.
- The adapter never sends the API key anywhere except the configured provider base URL.
- Adding the protocol must not change behaviour for any existing provider.

## Compatibility

- Existing provider ids, api types, and stored provider rows are unaffected.
- The new `ModelType` member must not be inferred for any existing model; classification of
  existing catalogs is unchanged.
- An upgraded installation receives the `typesafe` profile disabled, without mutating existing
  provider settings.

## Acceptance criteria

- A new and an upgraded installation both list a disabled `TypeSafe` provider whose api type is
  `jev`.
- A custom provider can be created with api type `jev`, and connecting it performs an authenticated
  `GET {baseUrl}/v1/models` and reports failure on `401` without persisting a broken provider.
- `jev-1.13.0` and `jev-latest` appear as judgment models and are absent from the chat model picker
  and the MCP sampling picker.
- Selecting a Jev model in a chat surface is impossible through the UI, and any direct attempt fails
  with a typed unsupported-capability error rather than a network request.
- A provider configuration imported with api type `jev` yields judgment-typed models, so an imported
  Jev model does not appear in a chat picker.
- Abort, proxy, timeout, and error mapping survive the adapter.
- The TypeSafe mark resolves for the `typesafe` provider and for `jev-*` model ids, and adding the
  registry keys changes no existing provider's resolved icon.
- Importing a provider configuration with api type `jev` preserves `jev` rather than falling back to
  `openai-completions`.

## Open questions

None blocking. Deferred: whether TypeSafe's per-model `description`/`release_date` should surface in
the model manager UI.
