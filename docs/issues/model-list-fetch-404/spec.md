# Model List Fetch 404 Handling

## User need

When a provider model-list endpoint returns HTTP 404 (for example a provider/base URL that does not expose `/models`), the app should not surface an unhandled `deepchat:route:invoke` error for routine model-list refreshes.

## Goal

Keep runtime model-list route behavior resilient: default model fetches should honor the existing `suppressErrors` behavior and return an empty/cached-safe list instead of rejecting the IPC route.

## Acceptance criteria

- A rejected asynchronous provider model fetch is caught by `BaseLLMProvider.fetchModels()` when `suppressErrors` is true.
- `refreshModels()` / explicit non-suppressed fetches still propagate provider HTTP errors.
- The fix does not change provider authentication, request headers, or endpoint construction.
- A regression test covers asynchronous rejection from `fetchProviderModels()`.

## Constraints

- Do not log or expose provider API keys or credentials.
- Keep the change minimal and aligned with existing presenter/provider boundaries.

## Non-goals

- Changing provider base URLs or model endpoint formats.
- Masking errors for explicit force refresh paths that intentionally request non-suppressed behavior.

## Open questions

None.
