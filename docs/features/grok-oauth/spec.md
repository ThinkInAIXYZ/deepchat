# Grok OAuth (xAI SuperGrok / Premium+)

## User Need

Grok already exists as an API-key provider (`id: grok`). SuperGrok and X Premium+
users want to sign in with xAI OAuth instead of creating a console API key, and
use subscription-backed models without storing keys in provider records.

## Goal

Add first-class xAI device-code OAuth to the existing Grok provider while keeping
the API-key path available as a fallback.

## Acceptance Criteria

- Settings → Grok shows an OAuth login panel for SuperGrok / X Premium+.
- Login uses OAuth 2.0 device-code against `https://auth.x.ai` (no localhost callback).
- Tokens are stored outside provider API-key fields (OS safeStorage when available).
- Access tokens refresh before expiry; concurrent refreshes are coordinated.
- Chat, model list, image routes, and connection checks use the OAuth bearer when signed in.
- OAuth bearer tokens are sent only to trusted HTTPS endpoints under `x.ai`.
- API-key path continues to work when OAuth is signed out or unavailable.
- Sign-out clears local credentials.
- Focused unit tests cover device-code exchange, refresh, and credential storage.
- User-facing strings are i18n keys.

## Constraints

- Reuse DeepChat Presenter + typed route + renderer client patterns (mirror Codex OAuth).
- Do not store OAuth refresh tokens in `provider.apiKey`.
- Do not invent a dynamic provider runtime.
- Public client id/scope follow the shared xAI Grok CLI OAuth client used by open-source clients.
- xAI may gate OAuth inference by subscription tier; surface errors without leaking tokens.

## Non-Goals

- Separate `xai-oauth` provider id (keep one Grok entry).
- PKCE loopback browser flow (device-code is the supported remote-friendly path).
- Billing / subscription management UI.
- Changing Grok chat transport away from existing OpenAI-compatible routes.

## Open Questions

None remaining for v1.
