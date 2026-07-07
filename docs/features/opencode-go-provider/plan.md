# Plan

## Provider Path

Use the existing AI SDK provider infrastructure with a small provider-specific registry definition:

- Runtime family: mixed OpenAI-compatible plus Anthropic route selection.
- Default route: OpenAI-compatible `/chat/completions`.
- Anthropic route: selected for documented `/messages` model IDs.
- Auth: existing API-key field, sent as bearer key by the selected AI SDK transport.
- Model metadata source: live OpenCode Go `/models` endpoint.

## Affected Files

- `src/main/presenter/configPresenter/providers.ts`
  - Add the built-in `opencode-go` provider entry.
- `src/main/presenter/llmProviderPresenter/providerRegistry.ts`
  - Add Go-specific model source and route strategy values.
  - Register `opencode-go` with `checkStrategy: generate-text` and `checkModelId: kimi-k2.7-code`.
- `src/main/presenter/llmProviderPresenter/providers/aiSdkProvider.ts`
  - Add OpenCode Go model endpoint mapping.
  - Route documented `/messages` model IDs to `providerKind: 'anthropic'`.
- Focused tests under `test/main/**`.

## Data Flow

1. User enables `opencode-go` and saves the OpenCode Go API key.
2. Model refresh calls `GET https://opencode.ai/zen/go/v1/models` with the provider API key.
3. Models documented for `/messages` receive `endpointType: 'anthropic'`; other Go chat models receive `endpointType: 'openai'`.
4. Runtime route selection patches Anthropic models to `apiType: 'anthropic'` with the same OpenCode Go base URL.
5. OpenAI-compatible models use the default OpenAI-compatible runtime against `/chat/completions`.

## Compatibility

- Existing OpenAI-compatible and Anthropic providers are unchanged.
- OpenCode Go does not depend on PublicProviderConf refresh availability.
- Users can unlock and edit the base URL through the existing built-in provider UI if needed.

## Test Strategy

- Unit test default provider metadata.
- Unit test registry definition and connection-check model.
- Unit test model mapping from mocked `/models` payload.
- Unit test route selection by invoking `check()` for OpenAI and Anthropic Go model IDs with the AI SDK generate-text runner mocked.
- Run focused tests, then `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
