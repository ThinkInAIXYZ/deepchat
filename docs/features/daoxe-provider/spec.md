# DaoXE Provider

## User Need

DeepChat users need a built-in profile for connecting to DaoXE without manually recreating an
OpenAI-compatible provider.

## Requirements

- Add a disabled built-in provider with ID `daoxe` and base URL `https://daoxe.com/v1`.
- Reuse the existing OpenAI-compatible transport and API-key storage.
- Discover models from the authenticated `/models` endpoint instead of shipping a static catalog.
- Check connectivity by fetching models so validation does not create a paid inference request.
- Link to the official site, token page, public integration guide, and live pricing page.
- Display the DaoXE logo in provider/model selection surfaces.

## Non-Goals

- No special provider class, SDK, OAuth flow, static model list, or renderer-side execution.
- No API key or paid model request in tests.

## Acceptance Criteria

- The provider is present, disabled by default, and uses `openai-completions`.
- Runtime resolution selects `openai-compatible`, API-key credentials, and model fetching.
- Focused main and renderer tests cover configuration, runtime selection, and icon resolution.
