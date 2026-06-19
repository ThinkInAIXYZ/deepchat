# Provider Runtime Plan

## Current Architecture Baseline

DeepChat already has the surfaces needed for this scoped change:

- Provider catalog: `src/main/presenter/configPresenter/providerDbLoader.ts`
- Provider IDs and aliases: `src/main/presenter/configPresenter/providerId.ts`
- Built-in providers: `src/main/presenter/configPresenter/providers.ts`
- Runtime selection: `src/main/presenter/llmProviderPresenter/providerRegistry.ts`
- AI SDK factory: `src/main/presenter/llmProviderPresenter/aiSdk/providerFactory.ts`
- Special providers: `src/main/presenter/llmProviderPresenter/providers/*`
- OAuth entrypoint: `src/main/presenter/oauthPresenter.ts`
- Typed routes: `src/shared/contracts/routes/*`
- Renderer clients: `src/renderer/api/*Client.ts`
- Provider settings UI: `src/renderer/settings/components/*`

The plan keeps these surfaces and adds narrow extensions.

## Architecture Direction

```text
PublicProviderConf
  -> display, model metadata, icons, pricing, capabilities

Existing provider files
  -> reviewed static provider additions

.agents/skills/add-provider
  -> developer workflow that generates explicit code changes

openai-codex special provider
  -> OAuth + dedicated request adapter
```

There is no runtime provider manifest and no package-name inference layer.

## Add Provider Workflow

The `add-provider` skill is the developer-facing entrypoint for future provider additions.

The skill writes or updates the existing integration surfaces:

- `src/main/presenter/configPresenter/providers.ts`
- `src/main/presenter/configPresenter/providerId.ts`
- `src/main/presenter/llmProviderPresenter/providerRegistry.ts`
- `src/main/presenter/llmProviderPresenter/aiSdk/providerFactory.ts` only when a known transport
  needs an explicit branch
- `src/shared/providerDbCatalog.ts` when the provider should read models from `PublicProviderConf`
- provider-specific settings components only when existing generic fields are insufficient
- tests under the current `test/main` and `test/renderer` conventions

The skill must classify a request into one of three paths:

```text
Known OpenAI-compatible API
  -> add provider config + registry mapping

Known existing native transport
  -> add provider config + registry mapping + check strategy

Special behavior
  -> require explicit provider class/adapter and tests
```

The skill must reject an addition request when the developer cannot provide enough information to
select a safe path.

## OpenAI Codex OAuth Design

### Provider Identity

Add a new provider profile:

```text
id: openai-codex
name: OpenAI Codex
apiType: openai-codex
baseUrl: empty or compatibility endpoint owned by adapter
auth: OAuth status route, not API-key input
```

`openai` remains the API-key provider. `openai-codex` uses ChatGPT/Codex account access and
subscription availability.

### OpenAI Separation Boundary

Keep Codex-owned branches for every provider boundary:

```text
Provider ID       openai-codex
API type          openai-codex
Auth module       openaiCodexAuth
Routes            oauth.openaiCodex.*
Credential store  dedicated Codex storage namespace
Settings panel    Codex-specific OAuth panel
Runtime class     OpenAICodexProvider
Adapter           openaiCodexAdapter
```

The Codex adapter may build Responses-compatible payloads internally. It resolves authorization from
Codex OAuth credentials only and uses the `openai-codex` runtime path for provider creation,
connection checks, request tracing, and errors.

Allowed sharing is limited to protocol DTOs, pure request serialization helpers, and generic
transport utilities after an explicit import audit. Standard OpenAI API-key provider lifecycle code
stays isolated.

### Main Process Auth

Add a dedicated Codex auth module instead of a generic provider auth manager.

Suggested files:

```text
src/main/presenter/openaiCodexAuth/
  constants.ts
  credentialStore.ts
  pkce.ts
  loopbackServer.ts
  deviceFlow.ts
  tokenRefresh.ts
```

The module owns:

- PKCE verifier/challenge generation.
- Browser callback server.
- Device-code polling.
- Token exchange and refresh.
- Encrypted credential persistence.
- Logout cleanup.
- Redaction helpers.

The existing `OAuthPresenter` may delegate to this module or expose thin methods for typed routes.

### Routes and Events

Add typed routes:

```text
oauth.openaiCodex.getStatus
oauth.openaiCodex.startBrowserLogin
oauth.openaiCodex.startDeviceLogin
oauth.openaiCodex.cancelLogin
oauth.openaiCodex.logout
```

Add one typed event:

```text
oauth.openaiCodex.statusChanged
```

Renderer payloads contain status, masked account label, expiry, device code state, and errors.
Renderer payloads never contain raw OAuth tokens.

### Provider Adapter

Add a dedicated provider implementation with a Codex-owned lifecycle.

Suggested files:

```text
src/main/presenter/llmProviderPresenter/providers/openAICodexProvider.ts
src/main/presenter/llmProviderPresenter/openaiCodexAdapter.ts
```

Responsibilities:

- Resolve a valid access token before a request.
- Rewrite supported OpenAI Responses requests to the Codex compatibility endpoint.
- Add account routing headers only when available.
- Remove API-key authorization headers.
- Apply one refresh-and-replay cycle on eligible 401 responses before streaming starts.
- Preserve abort signal, streaming, proxy, and request tracing behavior.
- Normalize auth and entitlement failures.

### Renderer UI

Add a Codex-specific connection panel under the existing provider settings shell.

```text
┌ OpenAI Codex ─────────────────────────────────────┐
│ Status: Signed out                                │
│                                                    │
│ [Sign in with browser] [Use device code]           │
│                                                    │
│ Experimental ChatGPT/Codex account access          │
└────────────────────────────────────────────────────┘
```

```text
┌ OpenAI Codex ─────────────────────────────────────┐
│ Status: Connected                                 │
│ Account: org_••••7a                               │
│ Credential: OS encrypted                          │
│                                                    │
│ [Test connection] [Reconnect] [Sign out]           │
└────────────────────────────────────────────────────┘
```

```text
┌ Complete Sign-In ─────────────────────────────────┐
│ Open: auth.openai.com/codex/device                │
│ Code: ABCD-EFGH                         [Copy]    │
│                                                    │
│ Waiting for authorization                          │
│ [Cancel]                                          │
└────────────────────────────────────────────────────┘
```

The existing generic API-key field remains for ordinary providers. `openai-codex` hides the generic
API-key input and uses status routes.

## Compatibility

- Existing `LLM_PROVIDER` records continue to load.
- Existing API-key providers continue to store credentials as they do today.
- Existing GitHub Copilot OAuth remains on its current path.
- Custom OpenAI-compatible providers remain unchanged.
- Existing provider import/deeplink flows remain unchanged.

## Test Strategy

Unit tests:

- PKCE challenge generation.
- OAuth callback state validation.
- Device polling success, pending, timeout, and cancellation.
- Credential encryption, decryption, logout, and safe-storage unavailable handling.
- Token refresh single-flight behavior.
- Adapter endpoint rewrite and header redaction.

Main/provider tests:

- `openai-codex` provider instance creation.
- Codex mock request streaming.
- 401 refresh and one replay.
- Kill switch behavior.
- Existing provider instance creation regression.

Renderer tests:

- Codex signed-out, pending, connected, error, and logout UI states.
- No raw token stored in Pinia state.
- Existing generic provider form still renders API URL/API key fields.

Skill tests:

- The skill exists and has valid front matter.
- The skill instructions mention required inputs and output files.
- The skill explicitly rejects runtime manifest generation and dynamic SDK installation.

## Validation

Documentation-only work requires:

```bash
git diff --check
```

Implementation work must run:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run test:main
pnpm run test:renderer
```
