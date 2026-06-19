# Provider Runtime Tasks

## Phase 0 - Documentation

- [x] T001 Read current provider runtime architecture.
- [x] T002 Review the existing provider-runtime research report.
- [x] T003 Decide against full OpenCode parity for this round.
- [x] T004 Decide against `ProviderRuntimeDefinition` and generated runtime manifests.
- [x] T005 Rewrite provider-runtime SDD into `spec.md`, `plan.md`, and `tasks.md`.

## Phase 1 - Add Provider Skill

- [x] T101 Create `.agents/skills/add-provider/SKILL.md`.
- [x] T102 Document required provider inputs in the skill.
- [x] T103 Document the three supported provider-addition paths:
  OpenAI-compatible, existing native transport, and special provider.
- [x] T104 Document output files the skill may change.
- [x] T105 Add skill guardrails against runtime manifests, package-name inference, and dynamic SDK
  installation.
- [x] T106 Add a lightweight test or script check for skill front matter and required sections.

## Phase 2 - OpenAI Codex Auth

- [x] T201 Add the `openai-codex` default provider entry.
- [x] T202 Add an environment kill switch.
- [x] T203 Add Codex OAuth constants.
- [x] T204 Add PKCE utilities.
- [x] T205 Add browser callback URL validation.
- [x] T205a Open browser login in a DeepChat-owned authorization window.
- [x] T206 Add device-code login.
- [x] T207 Add encrypted Codex credential storage.
- [x] T208 Add refresh-token handling with single-flight coordination.
- [x] T209 Add logout cleanup.
- [x] T210 Add redacted auth status payloads.
- [x] T211 Keep Codex credentials under a dedicated storage namespace separate from OpenAI API-key
  provider records.

## Phase 3 - Routes and Renderer

- [x] T301 Add typed Codex OAuth routes.
- [x] T302 Add a typed Codex OAuth status event.
- [x] T303 Add renderer API client methods.
- [x] T304 Add a Codex-specific settings panel.
- [x] T305 Hide generic API-key input for `openai-codex`.
- [x] T306 Add browser login, device login, cancel, reconnect, test, and logout actions.
- [x] T307 Add i18n strings for Codex OAuth states and errors.
- [x] T308 Add a Models tab refresh entrypoint for provider model updates.

## Phase 4 - Codex Provider Adapter

- [x] T401 Add OpenAI Codex provider runtime registration through `AiSdkProvider`.
- [x] T402 Add request adapter endpoint rewrite.
- [x] T403 Add bearer auth and masked account status.
- [x] T404 Preserve streaming, abort signal, proxy, and tracing behavior.
- [x] T405 Remove incompatible API-key headers.
- [x] T406 Add one eligible 401 refresh replay before streaming starts.
- [x] T407 Normalize entitlement errors.
- [x] T408 Filter Codex model exposure through explicit data, not live entitlement inference.
- [x] T409 Keep Codex creation and request handling on `apiType: openai-codex` with a dedicated
  provider factory branch.
- [x] T410 Expose Codex recommended models from OpenAI provider-db metadata in current official
  priority order.
- [x] T411 Add Codex ChatGPT backend routing headers and readable 400 error normalization.
- [x] T412 Replace stale persisted Codex model snapshots with the dedicated runtime model catalog.
- [x] T413 Add Codex Responses `instructions` provider option mapping with a fallback instruction.
- [x] T414 Skip Codex during provider-db background refresh events while preserving manual refresh.

## Phase 5 - Tests

- [x] T501 Add PKCE tests.
- [x] T502 Add browser callback tests.
- [x] T503 Add device-flow tests.
- [x] T504 Add credential-store tests.
- [x] T505 Add token-refresh tests.
- [x] T506 Add Codex adapter mock streaming tests.
- [x] T507 Add 401 refresh-replay tests.
- [x] T508 Add kill-switch tests.
- [x] T509 Add renderer state tests.
- [x] T510 Add existing provider regression tests for OpenAI, GitHub Copilot, custom provider,
  Anthropic, Gemini, Azure, Vertex, and Bedrock creation paths.
- [x] T511 Add Codex/OpenAI separation tests for config, credential, route, factory, and adapter
  boundaries.
- [x] T512 Add Codex model catalog and backend auth header regression tests.
- [x] T513 Add Codex renderer model refresh and Models tab refresh-button regression tests.
- [x] T514 Add Codex Responses `instructions` regression tests.
- [x] T515 Add auto-refresh regression tests for provider-db events skipping Codex runtime models.

## Phase 6 - Validation

- [x] T601 Run `pnpm run format`.
- [x] T602 Run `pnpm run i18n`.
- [x] T603 Run `pnpm run lint`.
- [ ] T604 Run `pnpm run test:main` (blocked by unrelated existing CUA path assertion).
- [ ] T605 Run `pnpm run test:renderer` (blocked by unrelated existing CUA plugin settings test).
- [x] T606 Run focused Codex and model-store tests.
- [x] T607 Run `pnpm run typecheck:node`.
- [x] T608 Run `pnpm run typecheck:web`.
- [x] T609 Update task statuses after implementation.
