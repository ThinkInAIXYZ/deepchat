# Provider Runtime Contract

Status: maintained contract.

## Ownership

Provider code lives in `src/main/provider/`:

- `defaults.ts` and provider database define display/config/model metadata;
- `providerRegistry.ts` maps a provider profile to a known runtime, model source, check strategy and
  auth kind;
- `index.ts` owns provider/model settings and runtime instances;
- `aiSdk/` maps supported HTTP transports;
- `providers/` contains behavior that exceeds a generic transport;
- `auth/` owns OAuth/device flows and encrypted credential storage;
- `routes.ts` exposes typed renderer operations.

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

Prefer an existing OpenAI-compatible/Anthropic/AI SDK transport when wire behavior matches. Add a
special adapter only when auth, request shape, discovery, streaming or error semantics differ. Do not infer
runtime behavior from package names and do not install arbitrary SDKs dynamically.

API-key profiles such as NVIDIA, Hugging Face, Moonshot, StepFun, Upstage, Alibaba, MiniMax, DaoXE,
Kimi For Coding and OpenCode Go remain catalog/registry mappings unless they need a real special adapter.

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
- AbortSignal, proxy, timeout and provider error mapping must survive every adapter layer.

## OpenAI Codex

`openai-codex` is separate from standard `openai`: distinct provider ID, runtime kind, credential store,
routes and request adapter. Current recommended catalog includes `gpt-5.5`, `gpt-5.6-sol`,
`gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark` and `gpt-image-2`
when provider-db metadata contains them; connection check uses `gpt-5.6-luna`.

Codex requests include required instructions and backend routing headers, preserve streaming/tool/reasoning
behavior, and surface entitlement failure without logging token or account identifiers. Image generation
uses the same OAuth credential path with `/images/generations`; Responses-only body normalization does not
apply to image requests. Background provider-db refresh skips its dedicated runtime catalog; manual refresh
remains available.

## Validation

Provider work must test registry mapping, defaults/import, auth redaction/refresh, request adapter, model
catalog/check and renderer configuration where affected. Existing providers must remain unchanged unless the
spec explicitly includes a migration.

Non-goals: runtime provider manifests, renderer-owned credentials, automatic SDK installation and provider
behavior inferred from external catalogs.
