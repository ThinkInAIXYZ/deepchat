# Grok OAuth Plan

## Approach

Mirror OpenAI Codex credential isolation and GitHub Copilot device-code UX:

1. Main-process `xaiGrokAuth` module:
   - OIDC discovery against `https://auth.x.ai`
   - Device-code request + poll + refresh
   - Encrypted credential store under userData
2. Typed routes / events / `OAuthPresenter` methods.
3. Renderer `GrokOAuth.vue` + `OAuthClient` methods; show on Grok provider settings
   alongside the existing API-key form.
4. Runtime auth resolution for `provider.id === 'grok'`:
   - Prefer refreshed OAuth access token
   - Fall back to `provider.apiKey`
   - Inject OAuth credentials only when the resolved API endpoint is a trusted `x.ai` HTTPS URL

## Auth Constants

| Item | Value |
| --- | --- |
| Issuer | `https://auth.x.ai` |
| Discovery | `/.well-known/openid-configuration` |
| Client ID | public Grok CLI client `b1a00492-073a-47ea-816f-4c329264a828` |
| Scope | `openid profile email offline_access grok-cli:access api:access` |
| API base | `https://api.x.ai/v1` |

## Data Flow

```
Settings UI
  → oauth.xaiGrok.startDeviceLogin
  → request device code
  → open verification URL + show user code
  → poll token endpoint
  → credential store (safeStorage/file)
  → statusChanged event

Chat / models
  → ensureAccessToken()
  → Authorization: Bearer <access>
  → api.x.ai
```

## Compatibility

- Existing Grok API-key users unchanged.
- OAuth sign-in does not wipe API key fields.
- When both exist, OAuth wins until sign-out.

## Test Strategy

- Unit tests for discovery trust checks, device-code poll, refresh, store envelope.
- Route/presenter wiring covered indirectly via auth module tests.
- Manual: sign-in with eligible SuperGrok account, list models, chat once, sign-out.
