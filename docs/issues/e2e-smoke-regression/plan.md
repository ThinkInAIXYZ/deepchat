# E2E Smoke Regression Plan

## Planning Summary

This plan adds a small but real desktop smoke layer on top of the existing test pyramid.

The recommended architecture is:

1. Playwright Electron launches the built app.
2. The suite runs against the operator's existing local DeepChat environment.
3. The suite does not introduce an alternate `userData` path, mock backend, or E2E-only bootstrap mode.
4. Smoke tests assert on user-visible success signals rather than exact provider output.

## Current Repository Constraints

The local codebase already shows a few important constraints that shape the plan:

1. Electron boot starts in `src/main/index.ts`.
2. The app already has persistent local state and provider configuration managed by `ConfigPresenter`.
3. The app already uses `data-testid` in some places, so adding a focused set of E2E anchors fits the current codebase style.
4. Because this suite intentionally runs against the current local environment, it must avoid destructive or profile-reset behavior.

## Proposed Architecture

### 1. Runner and Script

Add Playwright Electron under `test/e2e` with a single smoke script:

```json
{
  "scripts": {
    "e2e:smoke": "playwright test -c test/e2e/playwright.config.ts --workers=1"
  }
}
```

Configuration defaults:

- `workers: 1`
- `retries: 0` locally
- generous startup and generation timeout
- `screenshot: 'only-on-failure'`
- `video: 'retain-on-failure'`
- `trace: 'retain-on-failure'`
- `outputDir: 'test-results/e2e'`

### 2. Launch Model

Use Playwright `_electron.launch()` against the built app after `pnpm run build`.

Recommended launch strategy:

- working directory: repository root
- launch args: `['.']`
- rely on `package.json` `main: "./out/main/index.js"`

This keeps the execution model close to the real desktop app and avoids a parallel dev-server lifecycle.

### 3. Real-Environment Execution Model

Do not create a dedicated E2E runtime branch.

In particular, do not:

- redirect `userData`
- inject app-specific E2E environment variables
- start a mock LLM backend
- bootstrap a synthetic provider
- wipe or reseed current user state

Instead, the suite should assume:

- the operator has already configured a working provider and model
- the app is launched as-is
- tests interact with the same UI and same local state shape the operator normally uses

Implication:

- the suite is closer to real usage
- but it is also more stateful and less deterministic than a synthetic E2E sandbox

### 4. Provider and Model Assumptions

For v1, do not try to manage provider configuration in test code.

Instead:

- require at least one usable chat model to already be configured
- prefer the currently selected model if chat is ready
- if the UI requires an explicit model choice, select the first available chat-capable model in a stable way
- fail fast with an actionable setup error when no usable model can be found

This keeps the suite aligned with the operator's real environment and avoids hidden bootstrap logic.

### 5. Real-Provider Assertion Strategy

Because the suite uses a real provider path, assertions should stay at the behavior level:

- app launches
- input is editable
- send action triggers generation state
- assistant message appears
- assistant message is non-empty
- generation state returns to idle
- created session remains accessible after restart

Do not depend on:

- exact response text
- token usage numbers
- provider-specific toast copy
- provider-specific latency assumptions
- markdown-specific rendering contracts in v1

### 6. State Safety Strategy

Since the suite runs in the operator's real local environment, tests must be conservative.

Rules:

- prefer additive actions only
- create a new conversation for smoke runs rather than mutating existing important threads
- avoid deleting sessions, providers, or settings
- avoid changing global settings in v1 unless the test immediately restores them and the risk is low
- use a unique smoke prompt prefix so created conversations are easy to recognize

Recommended smoke prompt shape:

```txt
[E2E_SMOKE <timestamp>] Please reply with a short confirmation sentence.
```

### 7. Selectors and E2E Anchors

Selector policy:

1. Prefer `getByRole`, `getByLabel`, and other accessible locators when they are stable.
2. Add `data-testid` only for structural anchors and async-state anchors that would otherwise be brittle.
3. Avoid asserting on translated copy for core success states when a stable UI state is available.

Recommended anchor groups:

- app shell
  - `app-root`
  - `app-sidebar`
  - `app-settings-button`
  - `app-new-chat-button`
- chat
  - `chat-page`
  - `chat-message-list`
  - `chat-message-user`
  - `chat-message-assistant`
  - `chat-input-editor`
  - `chat-send-button`
  - `chat-stop-button`
  - `chat-generation-status`
- chat selectors
  - `app-agent-switcher`
  - `app-model-switcher`
  - `sidebar-session-item`
  - `sidebar-current-session`
- settings
  - `settings-page`
  - `settings-tab-general`
  - `settings-tab-model-providers`
  - `settings-tab-mcp`
  - `settings-tab-acp-agents`
  - `settings-tab-appearance`
  - `settings-close-button`

### 8. Fixture and Helper Layout

Recommended test structure:

```txt
test/e2e/
  playwright.config.ts
  fixtures/
    electronApp.ts
    testData.ts
  helpers/
    chat.ts
    settings.ts
    wait.ts
  specs/
    01-launch.smoke.spec.ts
    02-chat.smoke.spec.ts
    03-persistence.smoke.spec.ts
    04-settings.smoke.spec.ts
```

Helper responsibilities:

- `chat.ts`
  - create new chat
  - resolve a usable current or first available model
  - send message
  - wait for generation completion
  - read user and assistant messages
- `settings.ts`
  - open and close settings
  - switch settings tabs
- `wait.ts`
  - wait for app-ready shell
  - detect fatal renderer errors

### 9. P0 Smoke Flow

Main chat smoke target:

```txt
┌──────────────────────────────────────────────────────────┐
│ AppBar                                                   │
├───────────────┬──────────────────────────────────────────┤
│ Sidebar       │ ChatPage                                 │
│ + New Chat    │ Agent: [current]  Model: [usable]        │
│ Smoke Thread  │                                          │
│               │ User: [E2E_SMOKE ...]                    │
│               │ AI:   non-empty response                 │
│               │                                          │
│               │ [ input editor                         ] │
└───────────────┴──────────────────────────────────────────┘
```

Settings smoke target:

```txt
┌──────────────────────────────────────────────────────────┐
│ Settings                                                 │
├─────────────────┬────────────────────────────────────────┤
│ General         │ basic settings content visible         │
│ Model Providers │ provider page reachable                │
│ Appearance      │ appearance page reachable              │
│ MCP             │                                        │
│ ACP Agents      │                                        │
└─────────────────┴────────────────────────────────────────┘
```

## Increment Plan

### Increment 1 (v1)

Target:

- `P0-01` launch app
- `P0-02` basic chat flow
- `P0-03` restart persistence
- `P0-04` settings navigation

Why:

- this is the shortest path to a useful regression line
- it validates boot, selector strategy, real provider requests, end-to-end message flow,
  restart persistence, and settings routing

### Later Phases

Add optional or broader coverage:

- explicit provider connectivity checks behind an opt-in environment flag
- the deferred P1 scenarios from [spec.md](./spec.md)

## Validation Plan

After implementation, run:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run e2e:smoke
```

## Risks and Mitigations

### Risk 1: tests touch the operator's real local state

Impact:

- smoke runs may create conversations or affect visible recent history

Mitigation:

- keep tests additive only
- create dedicated smoke conversations with a recognizable prefix
- avoid destructive actions and avoid mutating global settings in v1

### Risk 2: no usable provider or model is configured

Impact:

- the suite cannot reach the chat generation flow

Mitigation:

- fail fast with a clear setup error
- document the required local setup in the E2E README

### Risk 3: tests become brittle because they depend on translated copy

Impact:

- harmless i18n changes break smoke tests

Mitigation:

- prefer role-based selectors
- add `data-testid` for structural and async-state anchors
- assert stable UI states instead of translated copy where practical

### Risk 4: provider latency and rate limits cause flaky assertions

Impact:

- random failures on slower machines or under quota pressure

Mitigation:

- use web-first assertions
- wait on explicit generation-done state
- keep smoke prompts short
- keep `workers=1` for smoke runs

### Risk 5: real provider responses are non-deterministic

Impact:

- exact response-text assertions may become flaky or invalid

Mitigation:

- assert on non-empty assistant output and stable UI states instead of exact content
- avoid provider-specific response-text expectations in smoke specs

### Risk 6: existing local state changes the starting UI

Impact:

- startup may land on different pages or selected sessions

Mitigation:

- helpers should normalize the UI into a known path before asserting
- smoke specs should explicitly create a new conversation before the main chat assertions

## Rollout Recommendation

Use one PR for the spec and discussion, then implement in this order:

1. infrastructure: Playwright config and basic fixtures
2. selectors: minimal anchor set for launch and main chat
3. smoke specs: `P0-01` through `P0-04`
4. follow-up PRs for optional provider integration and deferred P1 scenarios
