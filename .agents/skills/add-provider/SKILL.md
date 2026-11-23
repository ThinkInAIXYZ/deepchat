---
name: add-provider
description: Add a DeepChat LLM provider through explicit reviewed source changes. Use when a developer asks Codex to add a provider, provider profile, upstream provider config, model catalog mapping, provider auth behavior, or a special provider adapter in this repository.
---

# Add Provider

## Goal

DeepChat owns provider presets, credentials, model discovery, and model capability metadata.
The built-in agent sends requests through Dim's native drivers. Keep shared model catalog data
in `PublicProviderConf` and verify the driver independently of the catalog entry.

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

### Existing Driver

For a user-configured endpoint, use the matching API type to verify compatibility. In Add Provider,
**OpenAI Completions** sends `/chat/completions` and **OpenAI** sends `/responses`.

For a built-in preset, inspect `defaults.ts`, `providerId.ts`, and `providerRegistry.ts`
under `src/main/provider/`. The registry resolves the provider ID first, then its API type.
`src/main/provider/providerTransport.ts` selects the wire protocol, including per-model routes
for aggregators. `src/main/agent/dim/modelCatalog.ts` maps this protocol to the native driver.
A compatible new brand can reuse that driver without a Dim catalog entry or a Dim upgrade.
Change settings fields only when the existing form cannot represent the required configuration.

### Special Provider

Choose the code owner based on the required behavior:

- Model discovery and connection checks live in `src/main/provider/`, including
  `providers/aiSdkProvider.ts` and `managers/providerInstanceManager.ts`.
- Interactive authentication lives in `src/main/provider/auth/` and the typed provider routes.
  Follow `src/main/agent/dim/providerCredentials.ts` and
  `native/dim-host/src/provider_connections.rs` to deliver credentials and protected headers
  through the existing connection owner.
- Request and stream compatibility must work with the driver shipped by this branch. Use a
  supported driver configuration when possible. A new wire protocol or unsupported feature
  needs driver support in Dim before DeepChat can expose it for the built-in agent.
  Verify availability against the release and source commit in `resources/dim-runtime-lock.json`.

## Guardrails

- Do not introduce `ProviderRuntimeDefinition`, generated runtime manifests, or runtime package-name
  inference.
- Do not install provider SDK packages automatically.
- Do not execute provider logic in the renderer.
- Do not store new OAuth credentials in provider API-key fields.
- Keep secrets out of Dim model configuration, provider catalogs, and logs. Pass opaque references
  for credentials and protected headers.
- Do not add a special provider when a known transport and explicit config are sufficient.
- Reject the request when the required inputs cannot identify a safe path.

## Workflow

1. Read `docs/features/provider-runtime/spec.md` when the provider work touches the provider runtime
   scope. Also read `plan.md` if it exists for an active provider-runtime goal. Treat any legacy
   `tasks.md` as migration input rather than another execution tracker.
2. Inspect the relevant files above and derive the effective endpoint, auth kind and native driver
   for the test model.
3. Add the smallest explicit source changes for the selected path.
4. Verify provider creation, auth handling, and model discovery as affected. For changes to
   request routing or driver behavior, send a built-in agent request through Dim. A successful
   model list or connection check does not exercise the native conversation path.
5. Update an active SDD `plan.md` as coherent implementation slices land, when one exists. For a
   legacy `tasks.md`, merge remaining work into the existing plan; without one, keep a single-slice
   complex bug checklist in `spec.md` and create `plan.md` for feature, architecture, or multi-slice
   bug work. Do not update or recreate the task file.
6. Run:

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
- Native driver and any DeepChat-specific discovery or auth logic.
- Credential storage location.
- Model metadata source.
- Check strategy and test model.
- Validation commands run.
