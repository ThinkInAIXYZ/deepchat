# Provider Runtime Contract

Status: maintained contract.

## Ownership

DeepChat owns provider configuration, credentials, and catalog metadata in `src/main/provider/`:

- `defaults.ts` defines provider presets and PublicProviderConf supplies shared model metadata;
- `providerRegistry.ts` maps a provider profile to a known transport, model source, check strategy and
  auth kind;
- `index.ts` owns provider/model settings and provider management instances;
- `providerTransport.ts` selects the wire protocol, including per-model routing for aggregators;
- `providers/` implements discovery, connection checks, and other desktop provider management;
- `auth/` owns OAuth/device flows and encrypted credential storage;
- `routes.ts` exposes typed renderer operations.

For the built-in agent, `src/main/agent/dim/modelCatalog.ts` maps the selected protocol to a
native driver and applies the model configuration. Dim owns request construction, streaming and
retries. DeepChat uses the driver shipped with its pinned Dim runtime.

Renderer code selects and configures providers but never owns API keys, OAuth refresh tokens or provider
instances.

## Integration rules

Adding a provider is an explicit reviewed source change, not a runtime npm/plugin loader. The
`.agents/skills/add-provider/SKILL.md` workflow must map the requested provider to:

1. stable provider ID and display metadata;
2. known transport/runtime kind;
3. default base URL and auth kind;
4. model source, check strategy and check model;
5. request headers, endpoint rewrites or capability exceptions;
6. renderer icon/config and focused tests.

Use an existing Dim driver when wire behavior matches. A new DeepChat provider ID can reuse the
driver independently of Dim's provider catalog. Implement provider-specific discovery and auth in
DeepChat. A new wire protocol or unsupported feature requires driver support in Dim. Do not infer
runtime behavior from package names or install arbitrary SDKs dynamically.

API-key profiles such as NVIDIA, Hugging Face, Moonshot, StepFun, Upstage, Alibaba, MiniMax, DaoXE,
Kimi For Coding and OpenCode Go remain catalog/registry mappings unless they need a real special adapter.

Default reset URLs are derived from each profile's base URL, except explicit website overrides
(currently Vertex, Azure and MiniMax). Defaults never overwrite a saved user endpoint.
Catalog-backed profile membership is derived in the main registry from `provider-db`,
`kimi-for-coding` and `chatgpt` model-source strategies, not a separately maintained ID list.
The existing default-provider route projects `usesProviderDb` for renderer refresh hints; this
field is not a persisted provider setting. Model-fact cleanup remains profile-ID based and
preserves explicit custom-model facts rather than inferring ownership from a shared transport.

## Model capability identity

Provider service identity, transport identity, and provider-db capability identity are separate
contracts. A provider profile owns credentials and its service endpoint. A transport route owns the
wire protocol used by one model. A capability identity owns the single provider-db model record used
for reasoning, sampling, tools, modalities, search, and other model behavior.

Aggregator routes resolve in two phases. Model ID and owner metadata first provide only the coarse
Anthropic or Gemini family hint needed to choose an endpoint. The selected endpoint then participates
in complete capability resolution. A transport endpoint is a fallback signal and never overrides an
explicit, provider-local, owner, family, or catalog model match.

Capability identity is resolved in the main process and passed through the provider runtime.
Renderer code consumes typed capability snapshots and does not reproduce provider routing rules.
Per-model aggregator matches are derived request state and are not persisted in provider or model
configuration. Provider-level `capabilityProviderId` remains an explicit compatibility override.
Resolved identity keeps the request-facing model ID separate from the optional matched catalog
model ID. Recognized origin families may select their authoritative provider-db owner, but ambiguous
families never select a mirror by provider iteration order. Known provider profiles keep
provider-local model configuration defaults; cross-provider defaults are limited to explicit
overrides and profiles absent from provider-db, such as New API.

Generation controls use an effective request policy that can pass through, fix, or omit a
parameter. Stored model and Session values remain user intent; policy is applied at the UI and wire
boundaries without destructive normalization. Unknown catalog capabilities remain compatible by
passing through unless an explicit model request policy requires a different wire shape.

## Auth and secrets

- API keys and OAuth credentials are written and read in main process storage.
- Renderer status and route payloads are redacted; raw token, key and account identity are never emitted.
- Refresh is single-flight and persists rotated credentials before they replace the active instance.
- Browser OAuth uses `shell.openExternal` plus loopback callback when supported; paste/device fallback is
  provider-specific and must be explicit.
- The native model configuration carries opaque references for credentials and protected headers.
  Dim resolves them at request time through the DeepChat connection owner.

## Fireworks

Fireworks uses the existing OpenAI-compatible transport with API-key credentials and the
`fireworks-ai` provider-db catalog. Connection checks generate text with
`accounts/fireworks/models/gpt-oss-120b`; they do not assume the inference endpoint exposes a
model-discovery API. The default endpoint is `https://api.fireworks.ai/inference/v1`.

For existing Fireworks configurations, normalize only the old official `/inference` endpoint
(with or without a trailing slash) in the request-time copy. Preserve saved configuration,
already-versioned endpoints and custom proxies. No special provider class or storage migration
is required.

Upstream references: [OpenAI compatibility](https://docs.fireworks.ai/tools-sdks/openai-compatibility)
and [GPT OSS 120B model ID](https://fireworks.ai/models/fireworks/gpt-oss-120b).

## APIMODELS

`apimodels` uses the OpenAI-compatible transport with API-key credentials. Live model discovery
keeps only records with `modality: 'chat'`; other catalog entries require unsupported routes.
The catalog is public, so connection checks generate text with `gpt-5.6-luna` and the shared
16-token output limit to validate credentials. Embeddings are disabled for this profile.

Upstream reference: [Language Models API](https://apimodels.app/docs/llm?p=openai).

## CloudGPU

`cloudgpu` uses the OpenAI-compatible transport with API-key credentials. Live model discovery
lists every chat model from the public `/v1/models` catalog. The catalog has no capability field,
so ids that are clearly not chat models (embedding, rerank, image, audio, speech, TTS and
transcription ids) are skipped by name. The catalog is public, so connection checks generate text
with `deepseek-v4.1-flash` and the shared 16-token output limit to validate credentials.
Embeddings are disabled for this profile.

Upstream reference: [API docs](https://cloudgpu.app/api/docs?utm_source=deepchat).

## Obscurify.ai

`obscurify` uses the OpenAI-compatible transport with API-key credentials. Live model discovery
reads the public `/v1/models` catalog, keeps each model's `context_length` and `tools` flag, and
skips entries that are not chat models: decision models (`decisions: true`, which include the
`typesafe/jev-*` judgment models) and ids that match the shared non-chat filter, such as image
models. The catalog is public, so connection checks generate text with
`meta-llama/llama-3.3-70b-instruct` and the shared 16-token output limit to validate credentials.
Embeddings are disabled for this profile.

Upstream reference: [API docs](https://obscurify.ai/api-docs).

## OpenLLM

`openllm` uses the OpenAI-compatible transport and defaults to the local daemon at
`http://127.0.0.1:8787/v1`. The API key is optional: the daemon reads only `Authorization: Bearer`,
and an empty or placeholder token runs as the signed-in OpenLLM account. A key can be set, together
with `https://www.openllm.sh/v1` as the base URL, to use the cloud origin instead. Live model
discovery reads `/v1/models` (authenticated by the daemon's saved login), keeps entries whose
`capabilities` include `chat`, and takes the context window, output limit, vision, tools and
reasoning flags from the card. Model ids are kept verbatim. The connection check lists models, so it
fails with a 401 `auth_error` when the daemon has no saved login and with a connection error when
the daemon is not running. Embeddings are disabled for this profile.

Upstream reference: [OpenLLM documentation](https://docs.openllm.sh).

## Wiro AI

`wiro` uses the OpenAI-compatible transport with API-key credentials and the default endpoint
`https://llm.wiro.ai/v1`. Live model discovery reads the `/v1/models` catalog, which lists chat
models only, and takes each model's context length (`context_length`), output limit (`max_tokens`),
image input (`capabilities.input_modalities`) and tool support (`capabilities.function_tools`)
from the record. A value the catalog leaves out is not guessed. Model ids are lowercase
`owner/model` and are kept verbatim. The catalog needs the key, so the connection check lists
models and does not generate text. Embeddings are disabled for this profile.

Upstream reference: [Completions API](https://wiro.ai/docs/completions-api).

## ChatGPT

`chatgpt` uses Sign in with ChatGPT so built-in agent requests run on the user's ChatGPT plan. The
main-process account owner in `src/main/provider/auth/chatgpt` holds registration, tokens, renewal
and revocation; the profile stores no credential. The catalog is the signed-in account's
`GET https://api.openai.com/v1/models` list (`visibility: "list"`, server order), with capabilities
filled from the OpenAI provider-db entry. Inference always targets `https://api.openai.com/v1`
through the native `openai-chatgpt` connection preset; profile base URLs and custom headers are not
applied. See [Sign in with ChatGPT](../sign-in-with-chatgpt/spec.md).

The former `openai-codex` provider and OpenAI's ChatGPT authentication mode are retired. Upgrades
remove both and delete the old Codex credentials locally.

## Validation

Verify registry mapping, defaults/import, auth redaction/refresh, model discovery and renderer
configuration where affected. For changes to request routing or driver behavior, verify a built-in
agent request through Dim in addition to any separate provider connection check.

Non-goals: runtime provider manifests, renderer-owned credentials, automatic SDK installation and provider
behavior inferred from external catalogs.
