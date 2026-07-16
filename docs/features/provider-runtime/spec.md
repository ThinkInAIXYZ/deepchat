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
`gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.4`, `gpt-5.4-mini` and `gpt-5.3-codex-spark` when provider-db
metadata contains them; connection check uses `gpt-5.6-luna`.

Codex requests include required instructions and backend routing headers, preserve streaming/tool/reasoning
behavior, and surface entitlement failure without logging token or account identifiers. Background
provider-db refresh skips its dedicated runtime catalog; manual refresh remains available.

## Validation

Provider work must test registry mapping, defaults/import, auth redaction/refresh, request adapter, model
catalog/check and renderer configuration where affected. Existing providers must remain unchanged unless the
spec explicitly includes a migration.

Non-goals: runtime provider manifests, renderer-owned credentials, automatic SDK installation and provider
behavior inferred from external catalogs.
