# Kimi For Coding Provider

## User Need

DeepChat should expose Kimi Code benefits as a built-in provider so developers can configure the
Kimi Code API key once and use the coding-focused model catalog from PublicProviderConf.

## Goal

Add `kimi-for-coding` as a standard Anthropic-compatible provider backed by PublicProviderConf model
metadata and existing API-key authentication.

## Source References

- Kimi Code third-party coding agent docs:
  `https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html`
- PublicProviderConf Kimi For Coding provider:
  `https://raw.githubusercontent.com/ThinkInAIXYZ/PublicProviderConf/refs/heads/dev/dist/kimi-for-coding.json`

## Requirements

- Add a disabled built-in provider with:
  - id: `kimi-for-coding`
  - name: `Kimi For Coding`
  - API type: `anthropic`
  - base URL: `https://api.kimi.com/coding/`
  - API key URL: `https://www.kimi.com/code/console`
- Use the existing Anthropic AI SDK transport because Kimi's OpenAI-compatible path can reject
  generic app requests with a coding-agent eligibility error.
- Use PublicProviderConf provider-db metadata from `kimi-for-coding`.
- Expose `kimi-for-coding` as the stable model ID from the provider DB catalog.
- Use `kimi-for-coding` as the connection-check model and runtime request model.
- Use a small generate-text connection check instead of model-list probing.
- Keep credentials in the existing provider API-key field.
- Do not fall back to ambient `ANTHROPIC_API_KEY` for Kimi For Coding requests.
- Treat `kimi-for-coding` as provider-db backed so manual model refresh updates the catalog first.
- Map Kimi Coding import/deeplink detection from both `https://api.kimi.com/coding/` and
  `https://api.kimi.com/coding/v1` to
  `kimi-for-coding`.
- Use `kimi-color.svg` for the Kimi For Coding provider icon.
- Apply the existing Kimi fixed-thinking temperature policy to Kimi Code fixed-thinking model IDs:
  `kimi-for-coding`, `kimi-k2.7-code`, and `kimi-k2.7-code-highspeed`.

## Acceptance Criteria

- Provider Center lists `Kimi For Coding` as a disabled built-in provider.
- Enabling it shows the stable `kimi-for-coding` model from the PublicProviderConf
  `kimi-for-coding` entry.
- Connection check uses `kimi-for-coding` and fails locally when the API key is empty.
- Manual model refresh updates the provider-db catalog before refreshing Kimi For Coding models.
- Requests through stale Kimi Code aliases still send `kimi-for-coding` to the upstream Anthropic
  endpoint.
- Kimi Code fixed-thinking models send the existing `thinking` provider option and fixed
  temperature values.
- Provider import recognizes Kimi Code's coding base URL as the built-in `kimi-for-coding`
  provider.
- Existing Moonshot provider behavior remains compatible.

## Non-Goals

- Add a Kimi-specific SDK or special transport.
- Add OAuth or membership login for Kimi Code.
- Add a new provider runtime manifest.
- Replace the existing Moonshot provider.
- Change global derived max-token caps.

## Open Questions

None.
