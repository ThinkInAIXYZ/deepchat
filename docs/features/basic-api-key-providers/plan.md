# Basic API Key Providers Plan

## Provider Mapping

| Provider ID | Runtime | Model Source | Provider DB Source | Check Model |
| --- | --- | --- | --- | --- |
| `nvidia` | OpenAI-compatible | provider-db | `nvidia` | `microsoft/phi-4-mini-instruct` |
| `huggingface` | OpenAI-compatible | provider-db | `huggingface` | `Qwen/Qwen3-Coder-Next` |
| `moonshot-ai` | OpenAI-compatible | provider-db | `moonshot-ai` | `kimi-k2-0905-preview` |
| `stepfun` | OpenAI-compatible | provider-db | `stepfun` | `step-3.5-flash` |
| `upstage` | OpenAI-compatible | provider-db | `upstage` | `solar-mini` |
| `alibaba-token-plan` | OpenAI-compatible | provider-db | `alibaba-token-plan` | `deepseek-v4-flash` |
| `alibaba-token-plan-cn` | OpenAI-compatible | provider-db | `alibaba-token-plan-cn` | `deepseek-v4-flash` |
| `minimax-global` | Anthropic-compatible | provider-db | `minimax` | `MiniMax-M2.1` |

## Implementation

- Add built-in entries in `src/main/presenter/configPresenter/providers.ts`.
- Add provider-db alias only when the built-in provider ID differs from provider-db source ID.
- Add provider registry definitions for runtime, model source, credential strategy, and check model.
- Add new provider IDs to the provider-db backed allowlist.
- Extend `ModelIcon.vue` with icon imports and mappings for providers not currently represented.
- Add focused tests for provider registry mapping, provider-db backed detection, provider-db model
  mapping, and icon resolution.

## Compatibility

- Existing `minimax` remains unchanged for current users.
- New `minimax-global` points at `https://api.minimax.io/anthropic` and reads model metadata from
  provider-db source `minimax`.
- Alibaba token plan entries are separate from existing DashScope.

## Validation

- Run focused tests for provider registry/model mapping and icons.
- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.
