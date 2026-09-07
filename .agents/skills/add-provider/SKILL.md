---
name: add-provider
description: Add a DeepChat LLM provider through explicit reviewed source changes. Use when a developer asks Codex to add a provider, provider profile, upstream provider config, model catalog mapping, provider auth behavior, or a special provider adapter in this repository.
---

# Add Provider

## Goal

Generate DeepChat provider integration changes against the current provider architecture. Keep
provider display data in `PublicProviderConf`, map runtime behavior to known transports, and use a
special provider implementation only when the API behavior requires one.

## Required Inputs

Collect or derive these before editing source:

- Provider ID in kebab case.
- Display name.
- API type or known transport family.
- Default base URL.
- Auth type: API key, no auth, OAuth, profile credentials, or provider-specific credential.
- Model metadata source: built-in config, provider-db, config-db, live model fetch, or custom only.
- Test model ID and check strategy.
- Official website, API key URL, docs URL, model list URL.
- Request quirks: headers, endpoint suffixes, route rewrites, streaming shape, tool-call support,
  reasoning support, image/audio/embedding endpoints, or proxy requirements.

## Supported Paths

### OpenAI-Compatible API

Use this when the provider supports OpenAI Chat Completions or Responses-compatible HTTP APIs.

Typical files:

- `src/main/provider/defaults.ts`
- `src/main/provider/providerId.ts`
- `src/main/provider/providerRegistry.ts`
- `src/shared/providerDbCatalog.ts` when models come from the public provider database
- `test/main/**` provider registry or creation tests

### Existing Native Transport

Use this when the provider maps to an existing DeepChat transport such as Anthropic, Gemini, Vertex,
Azure, Bedrock, Ollama, or ACP.

Typical files:

- `src/main/provider/defaults.ts`
- `src/main/provider/providerRegistry.ts`
- Settings components only when the existing generic form lacks required fields
- Focused tests for provider creation and connection checks

### Special Provider

Use this when auth, request shape, streaming, discovery, or error handling differs from existing
transports.

Typical files:

- `src/main/provider/providers/<providerName>Provider.ts`
- `src/main/provider/<providerName>Adapter.ts`
- `src/main/provider/managers/providerInstanceManager.ts`
- `src/shared/contracts/routes/*` and `src/renderer/api/*Client.ts` for interactive auth
- `src/renderer/settings/components/*` for provider-specific settings UI
- Main and renderer tests covering the new behavior

## Guardrails

- Do not introduce `ProviderRuntimeDefinition`, generated runtime manifests, or runtime package-name
  inference.
- Do not install provider SDK packages automatically.
- Do not execute provider logic in the renderer.
- Do not store new OAuth credentials in provider API-key fields.
- Do not add a special provider when a known transport and explicit config are sufficient.
- Reject the request when the required inputs cannot identify a safe path.

## Workflow

1. Read `docs/features/provider-runtime/spec.md` when the provider work touches the provider runtime
   scope. Also read `plan.md` if it exists for an active provider-runtime goal. Treat any legacy
   `tasks.md` as migration input rather than another execution tracker.
2. Inspect the current provider files before editing:
   - `src/main/provider/defaults.ts`
   - `src/main/provider/providerId.ts`
   - `src/main/provider/providerRegistry.ts`
   - `src/main/provider/aiSdk/providerFactory.ts`
   - `src/main/provider/managers/providerInstanceManager.ts`
   - `src/renderer/settings/components/ProviderApiConfig.vue`
3. Classify the request into one supported path.
4. Add the smallest explicit source changes for that path.
5. After implementation, assess provider creation, auth handling, and model discovery for durable
   regression coverage; add only the smallest contract-level tests warranted.
6. Update an active SDD `plan.md` as coherent implementation slices land, when one exists. For a
   legacy `tasks.md`, merge remaining work into the existing plan; without one, keep a single-slice
   complex bug checklist in `spec.md` and create `plan.md` for feature, architecture, or multi-slice
   bug work. Do not update or recreate the task file.
7. Run:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

Run focused main/renderer tests for any touched provider code.

## Output Checklist

Report:

- Provider ID and API type.
- Selected path.
- Files changed.
- Runtime transport or special provider class.
- Credential storage location.
- Model metadata source.
- Check strategy and test model.
- Validation commands run.
