# OpenCode Go Provider

Linked GitHub issue: #1896

## User Need

DeepChat users with an OpenCode Go subscription need to configure their Go API key and use the Go model catalog from DeepChat as a built-in provider.

## Goal

Add OpenCode Go as a built-in DeepChat provider using the documented OpenCode Go endpoints at `https://opencode.ai/zen/go/v1`.

## Requirements

- Add a disabled built-in provider with:
  - provider ID: `opencode-go`
  - display name: `OpenCode Go`
  - auth: API key copied from OpenCode Zen
  - default base URL: `https://opencode.ai/zen/go/v1`
- Use the official documentation URLs:
  - official/API key console: `https://opencode.ai/auth`
  - docs: `https://opencode.ai/docs/zh-cn/go/`
  - models endpoint: `https://opencode.ai/zen/go/v1/models`
- Fetch available models from `GET /models` and map OpenCode Go model IDs into DeepChat `MODEL_META` records.
- Route models documented for `https://opencode.ai/zen/go/v1/chat/completions` through the OpenAI-compatible runtime.
- Route models documented for `https://opencode.ai/zen/go/v1/messages` through the existing Anthropic runtime.
- Use `kimi-k2.7-code` as the connection-check model because it is a documented OpenAI-compatible Go coding model.
- Keep credentials in the existing provider API-key field; do not add OAuth or renderer-side credential storage.
- Preserve proxy support and existing AiSdkProvider behaviors.

## Acceptance Criteria

- `DEFAULT_PROVIDERS` includes `opencode-go` as disabled with the documented base URL and websites.
- `resolveAiSdkProviderDefinition` resolves `opencode-go` to an AI SDK provider definition with a Go-specific model source and route strategy.
- Fetching models maps OpenCode Go `/models` payloads to DeepChat models and marks documented `/messages` models for Anthropic routing.
- OpenCode Go Anthropic-routed model IDs build runtime context with `providerKind: 'anthropic'` and OpenCode Go base URL.
- OpenCode Go OpenAI-compatible model IDs build runtime context with `providerKind: 'openai-compatible'`.
- Focused tests cover provider registration, model mapping, route selection, and check-model configuration.
- SDD files contain no unresolved clarification markers.

## Non-Goals

- No new SDK dependency.
- No special OAuth flow.
- No PublicProviderConf/provider-db metadata dependency for OpenCode Go in this change.
- No support for endpoints outside the documented chat/completions, messages, and models routes.

## Open Questions

None.
