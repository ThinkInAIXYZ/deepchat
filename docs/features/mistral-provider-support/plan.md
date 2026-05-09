# Mistral Provider Support Plan

## Runtime

- Add `mistral` to `DEFAULT_PROVIDERS` with `apiType: "mistral"`, default base URL `https://api.mistral.ai/v1`, Mistral website links, and disabled default state.
- Register `mistral` in `providerRegistry` as an OpenAI-compatible AI SDK provider.
- Use provider DB model metadata for model list refreshes and use `generate-text` verification with `mistral-small-latest`.

## Renderer And Deeplinks

- Add `mistral` to provider DB-backed refresh hints.
- Add `mistral` to provider install custom types and the manual deeplink playground.
- Wire `ModelIcon.vue` to the existing Mistral color SVG.
- Expose Mistral AI in the custom provider API type select.

## Compatibility

- Existing users keep their stored provider settings. The provider helper appends the new default if it is missing.
- Existing custom providers with id `mistral` are not overwritten by migration code.
