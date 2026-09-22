# Provider configuration convergence

Status: implemented and locally validated.

## Scope and ownership

Keep display/default configuration in `defaults.ts` and runtime strategies in
`providerRegistry.ts`. Remove independently maintained copies of their facts, not these
ownership boundaries. No new service, dependency, provider manifest or database migration.

## Contracts

- Built-in reset URLs derive from the initial base URL unless an existing explicit website
  override differs. Preserve Vertex, Azure and MiniMax overrides in this refactor.
- Existing default-provider DTOs continue exposing the resolved reset URL. Saved provider URLs
  are never rewritten. Ollama reset uses the built-in default, including custom Ollama profiles.
- Registry model-source strategies determine public catalog membership. Kimi and Codex are
  catalog-backed despite their specialized selection strategies. Codex remains excluded from
  background catalog refresh, but manual refresh remains available.
- Model-fact stripping keeps its built-in profile identity boundary and preserves custom-model
  facts. Do not broaden data cleanup through transport fallback or rerun historical migrations.
- Renderer receives derived catalog metadata through existing typed routes; it does not import
  the main registry or maintain provider-ID lists.
- Fireworks uses the existing OpenAI-compatible transport, API-key auth and `fireworks-ai`
  provider-db catalog; connection checks generate text rather than probing model discovery.
  Previously saved official default URLs remain usable without changing stored configuration.
  Custom endpoints must not be redirected to the official service.

## Acceptance

Default providers can be instantiated through the real manager entry point. Reset actions use
the same default source as creation, except documented overrides. Xiaomi catalog refresh and
background synchronization work; Codex/Kimi retain their selection and refresh rules. Catalog
failures surface without rebuilding stale catalogs. Upstream and custom model facts survive.

Each implementation slice is independently reviewed, simplified and verified before a local
commit. No push or remote PR creation is part of this task.
