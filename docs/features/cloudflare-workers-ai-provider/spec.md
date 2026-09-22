# Cloudflare Workers AI Provider

Status: implemented; not yet smoke-tested against a live Cloudflare account.

## Context

Cloudflare Workers AI is a model marketplace behind one account, reached with one API token. It
serves two kinds of model that DeepChat treats differently:

- text generation and embedding models through the OpenAI-compatible endpoints
  (`{baseUrl}/chat/completions`, `{baseUrl}/embeddings`), which the shared AI SDK transport already
  speaks — these are ordinary chat and embedding models;
- TypeSafe's `typesafe/jev`, which is not a chat model at all. It is served through the Workers AI
  run API (`POST {apiRoot}/run` with `{ model, input: { state, questions } }`) and returns typed
  answers, so it is a judgment model.

A user has one Cloudflare account and one token, so this must be one provider. The `jev` protocol
cannot carry it: `docs/features/typesafe-jev-provider/spec.md` defines that api type as the System One
wire format exactly: `POST` to the configured base URL with `{ state, model, questions }`, and a
catalog at the endpoint's sibling `models` path.

## Goals

- Add `workers-ai` as a provider protocol served by `WorkersAiProvider`, an AI SDK provider with the
  judgment capability added.
- Serve the account's chat and embedding models through the shared OpenAI-compatible transport, with
  no bespoke request code.
- Serve `typesafe/jev` through the run API, parsed by the same answer parser the TypeSafe transport
  uses, so the two cannot drift.
- Discover and type the account's catalog, so both the chat pickers and the judgment-model picker are
  populated from the account rather than from a hand-written list.
- Keep it to one configured base URL: the account id is a path segment, so no new settings field is
  introduced.

## Non-goals

- Image, speech, classification, rerank and translation models. The catalog reports them, but the
  OpenAI-compatible endpoints do not serve them, so they are not offered rather than listed as chat
  models that fail on first use.
- The Responses API for GPT-OSS models. It is non-streaming and only those two models support it;
  Chat Completions covers them and keeps one code path.
- A `vision` flag on discovered models. Whether the OpenAI-compatible endpoint accepts image parts
  for the vision-capable models is unverified, and a wrong flag offers an attachment path that fails.
- AI Gateway routing, account-scoped OAuth, and plan or neuron-quota handling.

## Design

### Protocol identity

- `apiType` is `workers-ai`; built-in provider id `cloudflare`, display name `Cloudflare`,
  `baseUrl: ''`, `enable: false`.
- The base URL is the documented OpenAI-compatible base,
  `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`, and it is editable for this
  provider id because the account id is part of it. `websites.defaultBaseUrl` renders that format as
  the field hint.
- The registry maps `workers-ai` to an OpenAI-compatible definition (`modelSource: 'workers-ai'`,
  `credentialStrategy: 'api-key'`), so chat, streaming, embeddings, summarization and title
  generation come from the shared transport. The `workers-ai` model-source case throws, mirroring
  `apimart`: discovery is the provider's own, because the `openai` catalog path would ask for a
  `/models` route the OpenAI-compatible endpoint does not serve.
- Instance selection branches on `provider.apiType === 'workers-ai'` before the AI SDK fallback.
- `apiType` is a rebuild-required field: a provider operation that flips an existing provider to
  `workers-ai` drops the live instance instead of reusing it, because an AI SDK provider cannot become
  a Workers AI provider. Rebuilding on a protocol change keeps the current provider selection, which
  only an actual disable or removal clears.

### Chat and embeddings

Unchanged shared behaviour: `{baseUrl}/chat/completions` for chat and `{baseUrl}/embeddings` for
embeddings. No route rewriting and no request-shape override, which is the point of storing the
OpenAI-compatible base.

### Judgment

- `POST {apiRoot}/run` with `{ model, input: { state, questions } }`, where `apiRoot` is the
  configured base URL with `/v1` removed (`.../accounts/<ACCOUNT_ID>/ai`).
- The answer payload is unwrapped from the Workers AI `result` envelope and parsed by the exported
  System One answer parser. An already-unwrapped body is accepted too, so a proxy that forwards the
  System One payload keeps working.
- `runJudgment` refuses without an API key and without at least one question, matching the TypeSafe
  transport.
- Every chat-shaped path refuses a judgment model. The pickers already filter judgment models out of
  chat surfaces, but a stale stored selection or a programmatic caller would otherwise send
  `typesafe/jev` to the chat endpoint and get prose back where a summary or a decision was expected.
  One `resolveRouteDecision` override covers the promise-shaped paths; `coreStream` overrides it too
  so streaming reports the failure as a stream event, the shape the judgment-only provider uses.
- The judgment capability guard (`supportsJevJudgment`) is now structural — "has `runJudgment`" —
  rather than `instanceof JevProvider`, because one provider now serves judgments *and* ordinary chat
  models. The runtime's behaviour is unchanged: a provider without the capability still fails with a
  clear message instead of a missing-method crash.

### Model discovery

- `GET {apiRoot}/models/search?per_page=100&page=N`, authenticated with the same bearer token. It
  spends no neurons and it proves the token and the account id in one call.
- Pagination follows Cloudflare's `result_info.total_pages` when present, and stops after one page
  when it is absent, capped at five pages. Records are deduped by model id, so a repeated page cannot
  duplicate the persisted catalog.
- An envelope that reports `success: false` is a failure even when it arrives with a 2xx status;
  otherwise it would read as an account with no models.
- Typing by the catalog's `task`, normalized across the string, `{ name }` and hyphenated `{ id }`
  forms: `Text Generation` → `ModelType.Chat`, `Text Embeddings` → `ModelType.Embedding`. Any model
  whose id is in the Jev family → `ModelType.Judgment` (32k context), whatever task the catalog
  reports. Everything else is skipped.
- Fallback order: the last-known catalog, then the bundled seed. This is load-bearing —
  `BaseLLMProvider.fetchModels` persists whatever the provider returns, so returning an empty list on
  one transient failure would clear the per-provider store the pickers read.
- The judgment model is merged into the result from its fixed id. The Workers AI catalog covers
  Cloudflare-hosted models only — `typesafe/jev` is a third-party model in the unified AI catalog, and
  its Workers AI path does not exist — so the catalog never lists it. The merge also covers a failed
  refresh and a custom `workers-ai` provider, which has no bundled seed at all: none of those may
  empty the judgment-model slot. Chat models are deliberately not merged: that would pin stale ids,
  and the chat catalog is the account's.

### Connection check

- Fails without an API key and issues no request.
- Otherwise the authenticated model search is the check. It spends no neurons, and unlike the shared
  `fetch-models` check it validates the account id as well.
- HTTP failures report the status and Cloudflare's response body; a configuration failure (an
  unconfigured or malformed base URL) reports its own message unchanged, because that is the message
  the user has to act on.

### Base URL validation

Empty, whitespace, placeholder (`<`, `>`), query/fragment-bearing and non-`/accounts/<id>/ai/v1` base
URLs are refused with a typed message before any request. Two details matter:

- the placeholder check must precede parsing, because `new URL` percent-encodes angle brackets and
  would otherwise let a leftover `<ACCOUNT_ID>` through the path check;
- the `/v1` suffix is required, because the inherited transport derives the chat and embedding paths
  from the stored base URL. Accepting the run-API root would silently break chat.

The host is not restricted — a base URL is user-controlled for every provider — so the guarantee is
that an *unconfigured* base URL never resolves to another vendor's host, not that a configured one
cannot point elsewhere.

### Renderer

- The protocol is not offered in `AddProviderFlow`: it is Cloudflare's own transport (account id in
  the path, Workers AI catalog and run API), so it is a built-in vendor rather than a protocol a
  custom provider can be pointed at. It stays in the import and deeplink allow-lists so an imported
  configuration keeps its api type instead of degrading to `openai-completions`.
- The import and deeplink allow-lists include `workers-ai`. Imported models are typed per model
  rather than per api type: a model id in the Jev family (the shared `isJevJudgmentModelId` rule) is a
  judgment model, and everything else is skipped rather than imported untyped — those models reach the
  pickers through the catalog refresh instead.
- `ProviderApiConfig` makes the base URL editable for the `cloudflare` provider id.
- The mark is the existing `assets/llm-icons/cloudflare-color.svg` plus the `cloudflare` and
  `workers-ai` keys in `modelIconRegistry.ts`. It is a brand-colour mark, so it is deliberately not
  added to `monoIconUrls`, which drives dark-mode inversion. The keys sit after the model-family keys
  on purpose: resolution is first-substring-wins in key order, and a provider-db model id such as
  `cloudflare-glm-5.2` must keep resolving to the model family rather than to the vendor hosting it.

## Ownership

- `src/main/provider/providers/workersAiProvider.ts` owns the Workers AI catalog, the run-API
  judgment call, and the base URL rules.
- `src/main/provider/providers/jevProvider.ts` owns the judgment answer parser and the capability
  guard.
- `src/main/provider/providerRegistry.ts` owns the protocol-to-transport mapping.
- `src/main/provider/defaults.ts` owns display and default configuration.
- `src/main/provider/managers/providerInstanceManager.ts` owns instance selection.
- `src/shared/providerImport.ts` and `src/shared/providerDeeplink.ts` own the allow-lists.
- Renderer settings and the icon registry own presentation; they never hold keys or instances.

## Invariants

- A judgment model is never offered by a chat, embedding, rerank, image, video or speech surface, and
  every chat-shaped path refuses it rather than answering as prose; a chat model is never offered by
  the judgment-model slot.
- Models this transport cannot serve are not listed at all.
- No request is issued from the renderer.
- The token is sent only to the configured base URL, and an unconfigured base URL never resolves to
  another vendor's host.
- Adding the protocol changes no existing provider's behaviour, api type or resolved icon.

## Compatibility

- Existing provider ids, api types and stored rows are unaffected; the new profile arrives disabled
  and does not mutate existing provider settings.
- `jev` keeps meaning the System One wire format exactly. Its only changes are the exported answer
  parser and the structural capability guard.

## Acceptance criteria

- A new and an upgraded installation both list a disabled `Cloudflare` provider whose api type is
  `workers-ai`.
- A provider configuration with api type `workers-ai` can be brought in through the import dialog or a
  deeplink with a valid account base URL; connecting it performs the authenticated model search,
  reports `401` for a bad token, and keeps the api type instead of degrading to `openai-completions`.
- The account's text generation models appear as chat models, its embedding models as embedding
  models, and `typesafe/jev` as a judgment model that is absent from the chat pickers.
- A judgment call posts the `input` envelope to `{apiRoot}/run` and returns the answers unwrapped
  from `result`.
- An unset, blank, placeholder, query-bearing or `/v1`-less base URL fails with the documented
  message and issues no request.
- Importing a provider configuration with api type `workers-ai` keeps the api type and imports only
  its Jev judgment model, skipping the models it cannot classify.
- The Cloudflare mark resolves for the `cloudflare` provider and is not inverted in dark mode.

## Open questions

- The search response's element fields (`name`, `task`, `description`) and its pagination envelope
  (`result_info.total_pages`) are written from Cloudflare's published API and its usage in the wild,
  not from a live account. The parser is tolerant: an unreadable shape yields no records, so the
  provider keeps the last-known catalog and the check still reports the account status. If
  `total_pages` is absent, discovery stops after the first page, which degrades to the seed rather
  than failing.
- Confirmed against the live API: the catalog does **not** list the third-party judgment model, so
  discovery alone never yields it. Handled by always merging the fixed `typesafe/jev` id — from the
  bundled seed when there is one, otherwise from the built definition — so a Jev *variant* the catalog
  lists (for example `jev-latest`) is kept but does not stand in for the id `runJudgment` sends.
- Whether every `Text Generation` model is served by the OpenAI-compatible endpoint. The docs say
  most are; a model that is not would fail on first use rather than being filtered out.
- Whether the OpenAI-compatible endpoint accepts image parts for the vision-capable models, which is
  why no `vision` flag is set.
- A base URL for Cloudflare's AI Gateway (`gateway.ai.cloudflare.com/.../workers-ai`) is refused by
  the `/accounts/<id>/ai/v1` rule, consistent with the AI Gateway non-goal, but the error text talks
  about the account-URL format rather than about gateways not being supported.
- With an unconfigured base URL, a chat call fails with the OpenAI SDK's own `Invalid URL` rather than
  this provider's typed message. It cannot send the token anywhere else, and the add flow requires a
  non-empty base URL, so it is a message-quality gap rather than a safety one.
