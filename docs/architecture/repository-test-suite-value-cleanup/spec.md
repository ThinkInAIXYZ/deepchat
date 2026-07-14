# Repository Test Suite Value Cleanup

> Status: complete
> Baseline: `codex/agent-runtime-presenter-thinning@9fcba6e54`, 2026-07-14

## Problem

DeepChat has 583 automated test files across main, renderer, shared, Memory performance, and Electron
smoke suites.
Passing the suites proves only that the current assertions hold; it does not prove that every test
protects a distinct user-visible capability or maintained contract. Repeated refactors have left
duplicate integration cases, private-helper tests, large mocked fixtures, environment-gated suites,
and boundary tests whose relative value has not been reviewed together.

## Goal

Audit the complete repository test inventory and remove or consolidate tests that are dead,
vacuous, fully redundant, or weaker than retained coverage at a more meaningful boundary. Preserve
tests that protect distinct behavior, security, persistence, compatibility, recovery, provider,
runtime, plugin, desktop, or platform contracts.

## Acceptance Criteria

- Every repository test file is assigned to a coherent capability group and inspected for its
  boundary, protected behavior, maintenance cost, and stronger overlapping coverage.
- Every deleted test has named retained coverage for the same realistic regression.
- Skipped or environment-gated tests are deleted only when obsolete, not merely because the local
  environment cannot run them.
- Private-helper and exact-interaction assertions are retained when they enforce authorization,
  persistence, protocol, idempotency, or transaction contracts; otherwise they are moved, merged,
  rewritten, or deleted.
- No production behavior or public contract changes solely to support the cleanup.
- Main and renderer suites, typecheck, formatting, i18n, lint, and architecture guards pass after
  the cleanup.
- E2E and native-only suites are statically audited; commands requiring external credentials,
  platform-specific runtimes, or mutation of the user's desktop profile are not run without a
  separate need.

## Constraints

- Use existing Vitest and Playwright infrastructure; add no dependency or new test abstraction.
- Prefer deletion and merging over fixture or helper expansion.
- Do not weaken security, data-integrity, migration, recovery, cancellation, concurrency, or
  compatibility coverage to reduce counts or runtime.
- Do not fabricate test-value scores. Use high, medium, or low evidence-backed ratings.
- Keep the change reviewable by separating high-confidence deletion from unproven recommendations.

## Non-Goals

- Raising coverage percentages for their own sake.
- Rewriting production architecture.
- Replacing all mocks with live services.
- Running credentialed provider smoke tests or destructive local-profile E2E flows.
- Deleting active native-platform coverage because it is skipped on the current machine.

## Audit Results

The baseline contains 5,639 declared cases: 4,324 main-process cases, 1,266 renderer cases, 12
Memory performance cases, 30 Playwright smoke cases, and 7 shared cases that no configured Vitest
project executes. Every file was included in the inventory and screened for duplicate titles and
bodies, production imports, local-only implementations, assertion presence, skips, snapshots,
private access, mock density, and measured portable-suite runtime. Flagged files were then read
against their production boundary and overlapping tests.

| Capability group | Baseline files | Decision |
| --- | ---: | --- |
| Main agent backends and runtime | 46 | Keep distinct ACP, DeepChat, process, storage, and workspace contracts |
| Main presenters | 278 | Delete mock-only coverage; merge duplicate runtime outcomes; keep provider, persistence, security, Remote, Memory, and native contracts |
| Main typed routes | 15 | Keep route authorization, validation, and transport contracts |
| Main scripts and architecture guards | 10 | Remove duplicate CLI execution; batch semantic fixtures into one guard scan |
| Memory performance | 6 | Delete the test-helper baseline file; keep five product scale suites |
| Main build, contracts, evals, event bus, libraries, and shared data | 29 | Keep build, type, migration, utility, and resource contracts |
| Main root deeplink test | 1 | Keep user-visible provider import routing |
| Renderer components | 105 | Keep behavior at distinct UI surfaces; do not collapse same-titled tests for different components |
| Renderer stores | 22 | Keep state, persistence, event, and reactivity contracts |
| Renderer API, composables, libraries, pages, and utilities | 31 | Keep bridge and reusable behavior contracts |
| Renderer assets, message contracts, performance, plugins, and shell | 9 | Delete three self-testing message files and one mock-only shell file; keep real asset, plugin, startup, and performance boundaries |
| Playwright Electron smoke | 30 | Keep distinct desktop route and lifecycle boundaries; preserve credential and platform skips |
| Shared utility | 1 | Delete because no configured suite executes it and Echo behavior covers throttling at the consumer boundary |

### Applied Decisions

- Delete 57 renderer message tests and their snapshots because they exercise mapper, transition,
  and recovery functions implemented inside the test files rather than production code. Real
  ChatPage and message component suites retain renderer behavior coverage.
- Delete eight renderer shell tests and four default-model tests because they only assert locally
  created mocks, literals, or installed framework exports. Startup/component suites and session
  assignment tests retain the real boundaries.
- Delete seven excluded throttle tests. `agentRuntimePresenter/echo.test.ts` retains scheduling,
  coalescing, immediate flush, cancellation, and rescheduling behavior through the production
  consumer.
- Replace 12 Cursor adapter tests with one subclass contract. The Claude Code adapter suite retains
  all inherited parsing, detection, capability, and serialization behavior; the Cursor test keeps
  identity and source-metadata override coverage.
- Merge five duplicate process outcomes into the stronger fixed-lifecycle cases, retaining provider
  metadata, event publication, abort, tool execution, terminal error, and commit-order assertions.
- Delete one duplicate Kimi missing-key case. Registry assertions plus the retained Mistral
  `api-key` check cover the shared strategy; the Kimi health-check case retains provider-specific
  wiring.
- Delete four tests of Memory performance fixtures and observers. The remaining product scale
  suites execute those helpers while asserting bounded database, provider, and repository work.
- Delete the architecture-guard CLI success test because repository lint executes the CLI. Fold
  seven startup-hook scans into the existing full guard scan while preserving every semantic form.
- Make the Spotlight overlay component test install its own Pinia instance. The full renderer run
  exposed that it previously depended on another file leaving global Pinia state behind.
- Keep 198 environment-gated native main tests and four conditional E2E skips; absence of the local
  runtime, provider credentials, or Git is not evidence that their contracts are obsolete.

The resulting inventory has 576 files and 5,541 cases, a reduction of seven files and 98 cases.

## Validation

- Focused modified main targets: 161 passed.
- Main portable suite: 4,104 passed, 198 environment-gated cases skipped, 0 failed.
- Renderer suite: 1,201 passed, 0 failed. A first full rerun exposed the Spotlight Pinia isolation
  defect; the focused test and a second full run passed after the test-local fix.
- Memory performance suite: 3 portable cases passed and 5 native SQLite cases were preserved and
  skipped on the current runtime.
- `pnpm run typecheck`, `pnpm run format`, `pnpm run format:check`, `pnpm run i18n`, and
  `pnpm run lint` passed.
- Playwright and credentialed/native-only paths were statically audited but not executed because
  they launch Electron, mutate a desktop profile, require provider credentials, or require native
  SQLite support.

## Open Questions

None.
