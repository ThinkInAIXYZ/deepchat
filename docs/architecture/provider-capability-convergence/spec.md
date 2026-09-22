# Provider capability convergence

## Scope

PR1 unified provider configuration sources. PR2 removes parallel media settings eligibility
decisions in renderer and agent generation settings. Extend the existing main-owned capability
snapshot rather than adding another service, cache, persistent field, or capability identity.

## Contracts

- Service identity, transport and catalog capability identity remain separate. Media settings
  describe the request adapter, not the catalog model's origin.
- OpenAI image model-name compatibility has one shared implementation. Its legacy aggregator
  aliases apply only within OpenAI image/New API routing, never as universal model capabilities.
- Explicit New API endpoint selection and explicit model metadata precede inference. APIMart
  retains its catalog-owned routes. Grok image and Codex image tools retain their adapters.
- The main process projects image/video settings eligibility through the existing capability
  route. Renderer loading/error states cannot enable controls from stale model metadata.
- Image and video eligibility remain independent. Chat reasoning policy is already canonical
  and is not redesigned. Provider-level configuration selectors are not media capabilities.
- Stored settings remain user intent; no migration or rewriting of saved provider/model data.

## Acceptance

Runtime-compatible image aliases receive consistent New API type and settings projection.
Native Gemini/Vertex and Grok image routes do not gain OpenAI image parameters. Draft endpoint
changes update settings controls through the capability query. ChatStatusBar and agent generation
defaults/updates consume the same projection. Existing route-specific request behavior remains
covered by provider tests. Changes can be reverted without data migration.

## Validation

Run focused provider, shared-model, agent-generation and renderer tests. Add regression coverage
only for cross-layer behavior and confirmed drift; remove each fix temporarily with its tests
retained to establish that the test detects the regression. Review P0–P3 findings before each
local commit. Run formatting, i18n, lint and both typechecks before final handoff. No push.
