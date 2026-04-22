# E2E Smoke Regression

## Status

Draft on `2026-04-22`.

## Goal

Add a manual desktop smoke regression suite for DeepChat using Playwright Electron.

The suite should validate the highest-risk user flows after large refactors in a real local usage
environment rather than a synthetic E2E-only runtime.

The primary target flows are:

- app launch
- main chat shell
- conversation creation
- message sending and generation completion
- restart persistence
- settings navigation

## Background

DeepChat already has Vitest coverage for main-process and renderer-process logic under `test/main` and
`test/renderer`, but it does not yet have a true desktop E2E layer that exercises:

- Electron main-process boot
- preload bridge wiring
- renderer startup
- real settings routing
- real chat UI interactions
- persistence behavior across restart

That gap becomes visible after architectural refactors where unit tests still pass but the desktop flow
breaks because of startup ordering, route initialization, or real UI interaction regressions.

## Current Decision

This spec adopts the following baseline approach:

1. Create a new `test/e2e` layer with Playwright Electron.
2. Run the E2E suite manually, not as mandatory CI coverage in v1.
3. Launch the built app, not the dev server, to match shipped desktop behavior.
4. Run the suite in the operator's real local app environment rather than a separate E2E-only profile.
5. Do not depend on dedicated E2E environment variables or `userData` redirection.
6. Assume the operator has already configured at least one working provider and chat-capable model.
7. Keep the entrypoint simple with a single `pnpm run e2e:smoke` command.
8. Assert on user-visible success signals instead of mock-specific or provider-specific exact output.
9. Deliver the suite in phases, with v1 smoke coverage including `P0-01` launch app,
   `P0-02` basic chat flow, `P0-03` restart persistence, and `P0-04` settings navigation.
   Later phases can add optional provider-integration checks and broader P1 scenarios.

## User Stories

- As a maintainer, I want one command to validate the core desktop path after a large refactor.
- As a maintainer, I want the E2E suite to exercise the real provider path I actually use locally.
- As a maintainer, I want the suite to stay close to the real user environment instead of adding test-only runtime forks.
- As a maintainer, I want failure artifacts like trace, video, and screenshots so regressions are debuggable.
- As a maintainer, I want the first version to stay small and stable instead of trying to automate every feature.

## In Scope

- Playwright Electron runner under `test/e2e`
- a single smoke entry script in `package.json`
- stable selectors for critical smoke anchors
- manual smoke specs for core desktop flows
- E2E README with run instructions and caveats for real-environment execution

## Acceptance Criteria

- `pnpm run e2e:smoke` is available and runs Playwright against the built Electron app.
- The E2E suite launches the desktop app through Playwright Electron rather than a browser-only runner.
- The suite does not require an alternate `userData` path or dedicated E2E app environment variables.
- The suite runs against the operator's current local DeepChat environment.
- The suite fails fast with an actionable error when no usable provider or model is configured.
- The smoke suite covers these flows end to end:
  - launch app
  - create a conversation
  - send a message
  - wait for generation to complete
  - verify that an assistant message is produced
  - restart the app and verify the created session still exists
  - open settings and verify basic navigation works
- Failed runs retain screenshot, video, and trace artifacts under `test-results/e2e`.
- The suite is documented as a manual regression tool for large refactors and core desktop changes.

## Non-Goals

- Full CI gating in v1
- Cross-platform certification for every OS in the first increment
- Exhaustive feature coverage across MCP, ACP, attachments, retry, fork, tabs, deeplinks, and advanced settings
- Deterministic response-content assertions across different providers
- Pixel-perfect visual regression baselines
- Automatic protection from changes made to the operator's current local profile
- Replacing existing Vitest coverage

## Preconditions

- Before running E2E, the operator must configure a valid provider and chat-capable model in DeepChat.
- The configured provider must have working credentials and network reachability.
- The suite runs in the current local environment, so it may create real conversations or touch real local state.
- The suite should avoid destructive actions and should only perform additive smoke interactions.

## Test Scope

### P0 Smoke Coverage (v1)

The target P0 smoke matrix is:

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| P0-01 | Launch app | Main shell becomes visible without fatal renderer errors |
| P0-02 | Basic chat flow | User message is sent and a non-empty assistant response is produced |
| P0-03 | Restart persistence | The newly created session remains visible after app restart |
| P0-04 | Settings navigation | Settings opens, basic tabs switch, and closing returns to chat |

### Deferred P1 Scenarios

These remain valid follow-up work, but are not required for the first implementation increment:

- stop generation
- retry or regenerate
- fork conversation
- file attachments
- MCP settings CRUD
- ACP agent navigation and selection
- multi-tab or multi-window isolation
- deeplink smoke

## Discussion Defaults

Unless we explicitly change direction during discussion, the implementation should assume:

1. The suite is manual-only in v1.
2. The suite runs against `pnpm run build` output.
3. The only official E2E script in v1 is `pnpm run e2e:smoke`.
4. The suite runs against the user's current local profile instead of an isolated E2E profile.
5. The v1 implementation slice includes `P0-01` through `P0-04`; later phases can add optional
   provider-integration checks and the deferred P1 scenarios listed above.
