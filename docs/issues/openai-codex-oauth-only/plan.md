# OpenAI Codex OAuth Only Plan

## Approach

Remove OpenAI Codex device-code login as a public capability instead of hiding only the settings
button. This keeps the renderer, route registry, presenter interface, and auth implementation in
sync around a single browser OAuth path.

## Affected Interfaces

- `src/shared/types/openai-codex.ts`: drop `pending-device` and the device-code status payload.
- `src/shared/contracts/routes/oauth.routes.ts`: remove the OpenAI Codex start-device-login route.
- `src/main/routes/index.ts`: stop dispatching the removed route.
- `src/main/presenter/oauthPresenter.ts` and presenter types: remove the OpenAI Codex device-login
  method.
- `src/main/presenter/openaiCodexAuth`: remove the device-code flow state, request, and polling
  implementation.
- `src/renderer/api/OAuthClient.ts`: remove the device-login client method.
- `src/renderer/settings/components/OpenAICodexOAuth.vue`: render browser OAuth only.
- Settings i18n files: remove device-code-only keys that are no longer referenced.

## UI Layout

Before:

```text
OpenAI Codex Auth
+------------------------------------------------+
| status                                         |
+------------------------------------------------+
| [Verify] [Sign in with ChatGPT] [Use device]  |
| [Cancel] [Sign out]                            |
+------------------------------------------------+
| device-code panel when pending-device          |
+------------------------------------------------+
| login tip                                      |
```

After:

```text
OpenAI Codex Auth
+------------------------------------------------+
| status                                         |
+------------------------------------------------+
| [Verify] [Sign in with ChatGPT] [Cancel]      |
| [Sign out]                                     |
+------------------------------------------------+
| login tip                                      |
```

## Data Flow

The renderer calls `oauth.openaiCodex.startBrowserLogin`, the main route dispatcher forwards to
`OAuthPresenter.startOpenAICodexBrowserLogin`, and `OpenAICodexAuth` opens the browser OAuth window.
Status updates continue through `oauth.openaiCodex.statusChanged`.

## Compatibility

Existing saved browser OAuth tokens continue to load and refresh. Any stale renderer state that used
`pending-device` cannot be generated after this change because the route and auth implementation are
removed.

## Test Strategy

- Update shared route contract tests to validate OAuth-only OpenAI Codex status payloads.
- Update main dispatcher tests to cover get-status, browser-login, cancel, and logout only.
- Update renderer API client tests to assert the remaining route calls.
- Update OpenAI Codex auth presenter tests to keep browser OAuth and refresh coverage while removing
  device-code polling expectations.
- Update OpenAI Codex settings component tests to assert no device-code login button is rendered.
