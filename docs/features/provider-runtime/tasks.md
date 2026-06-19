# Provider Runtime Tasks

## Phase 0 - Documentation

- [x] T001 Read current provider runtime architecture.
- [x] T002 Review the existing provider-runtime research report.
- [x] T003 Decide against full OpenCode parity for this round.
- [x] T004 Decide against `ProviderRuntimeDefinition` and generated runtime manifests.
- [x] T005 Rewrite provider-runtime SDD into `spec.md`, `plan.md`, and `tasks.md`.

## Phase 1 - Add Provider Skill

- [ ] T101 Create `.agents/skills/add-provider/SKILL.md`.
- [ ] T102 Document required provider inputs in the skill.
- [ ] T103 Document the three supported provider-addition paths:
  OpenAI-compatible, existing native transport, and special provider.
- [ ] T104 Document output files the skill may change.
- [ ] T105 Add skill guardrails against runtime manifests, package-name inference, and dynamic SDK
  installation.
- [ ] T106 Add a lightweight test or script check for skill front matter and required sections.

## Phase 2 - OpenAI Codex Auth

- [ ] T201 Add the `openai-codex` default provider entry.
- [ ] T202 Add an experimental feature flag and environment kill switch.
- [ ] T203 Add Codex OAuth constants with implementation-time verification notes.
- [ ] T204 Add PKCE utilities.
- [ ] T205 Add loopback browser login.
- [ ] T206 Add device-code login.
- [ ] T207 Add encrypted Codex credential storage.
- [ ] T208 Add refresh-token handling with single-flight coordination.
- [ ] T209 Add logout cleanup.
- [ ] T210 Add redacted auth status payloads.
- [ ] T211 Keep Codex credentials under a dedicated storage namespace separate from OpenAI API-key
  provider records.

## Phase 3 - Routes and Renderer

- [ ] T301 Add typed Codex OAuth routes.
- [ ] T302 Add a typed Codex OAuth status event.
- [ ] T303 Add renderer API client methods.
- [ ] T304 Add a Codex-specific settings panel.
- [ ] T305 Hide generic API-key input for `openai-codex`.
- [ ] T306 Add browser login, device login, cancel, reconnect, test, and logout actions.
- [ ] T307 Add i18n strings for Codex OAuth states and errors.

## Phase 4 - Codex Provider Adapter

- [ ] T401 Add `OpenAICodexProvider`.
- [ ] T402 Add request adapter endpoint rewrite.
- [ ] T403 Add bearer auth and optional masked account routing.
- [ ] T404 Preserve streaming, abort signal, proxy, and tracing behavior.
- [ ] T405 Remove incompatible API-key headers.
- [ ] T406 Add one eligible 401 refresh replay before streaming starts.
- [ ] T407 Normalize auth and entitlement errors.
- [ ] T408 Filter Codex model exposure through explicit data, not live entitlement inference.
- [ ] T409 Keep Codex creation and request handling on `apiType: openai-codex` with a dedicated
  provider factory branch.

## Phase 5 - Tests

- [ ] T501 Add PKCE tests.
- [ ] T502 Add browser callback tests.
- [ ] T503 Add device-flow tests.
- [ ] T504 Add credential-store tests.
- [ ] T505 Add token-refresh tests.
- [ ] T506 Add Codex adapter mock streaming tests.
- [ ] T507 Add 401 refresh-replay tests.
- [ ] T508 Add kill-switch tests.
- [ ] T509 Add renderer state tests.
- [ ] T510 Add existing provider regression tests for OpenAI, GitHub Copilot, custom provider,
  Anthropic, Gemini, Azure, Vertex, and Bedrock creation paths.
- [ ] T511 Add Codex/OpenAI separation tests for config, credential, route, factory, and adapter
  boundaries.

## Phase 6 - Validation

- [ ] T601 Run `pnpm run format`.
- [ ] T602 Run `pnpm run i18n`.
- [ ] T603 Run `pnpm run lint`.
- [ ] T604 Run `pnpm run test:main`.
- [ ] T605 Run `pnpm run test:renderer`.
- [ ] T606 Update task statuses after implementation.
