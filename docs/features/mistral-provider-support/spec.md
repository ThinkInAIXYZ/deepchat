# Mistral Provider Support Spec

## User Story

Users can enable Mistral AI from the built-in Model Providers list, enter a Mistral API key, refresh models, verify the provider, and use Mistral chat and vision-capable models without editing provider files or creating a custom OpenAI-compatible provider.

## Acceptance Criteria

- A disabled built-in provider with id `mistral` appears in default provider settings.
- The provider uses `https://api.mistral.ai/v1` as its default base URL and Bearer API key authentication.
- Mistral uses the existing OpenAI-compatible runtime with no new SDK dependency.
- Refreshing models maps existing provider DB metadata for Mistral, including vision, tool call, reasoning, context, and output limits.
- Provider verification sends a small generate-text request to `mistral-small-latest`.
- Provider install deeplinks support built-in `id: "mistral"` and custom `type: "mistral"`.

## Non-Goals

- Add a dedicated Mistral SDK package.
- Add new IPC routes or renderer APIs.
- Change existing custom provider behavior beyond allowing `mistral` as a supported type.
