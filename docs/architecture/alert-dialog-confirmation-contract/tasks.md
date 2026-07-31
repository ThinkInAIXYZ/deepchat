# Alert Dialog Confirmation Contract Tasks

## Specification

- [x] Reproduce the Reka close-before-click ordering with real primitives.
- [x] Audit all 20 Action and 18 Cancel call sites.
- [x] Define synchronous, asynchronous, target-lifetime, and Memory-result invariants.
- [x] Write `spec.md`, `plan.md`, and `tasks.md`.

## Shared wrapper contract

- [x] Declare and implement click-before-close for Action.
- [x] Apply the same contract to Cancel.
- [x] Preserve native attributes and explicit capture listener ordering.
- [x] Remove the ChatPage `.capture` workaround.
- [x] Add real-primitive contract tests.

## Asynchronous confirmations

- [x] Add a non-closing alert-dialog action primitive.
- [x] Migrate OCR cache cleanup.
- [x] Migrate browser sandbox cleanup and data reset.
- [x] Migrate provider rate-limit disable.
- [x] Migrate inline Memory deletion.
- [x] Add the forbidden click-modifier source guard.
- [x] Add pending, failure, retry, and success-close regression tests.

## Confirmation target state

- [x] Model Memory list deletion as a discriminated request state.
- [x] Model Skill conflict overwrite as a discriminated request state.
- [x] Add real-dialog deletion and overwrite regressions.

## Memory result contract

- [ ] Add the shared Memory command result and rejection reasons.
- [ ] Preserve structured outcomes in management, conflict, and persona services.
- [ ] Update routes, clients, renderer callers, and mocks.
- [ ] Cover rejected conflict and persona operations.
- [ ] Remove the dead `MemoryInlinePanel.changed` contract.

## Validation and delivery

- [x] Run focused wrapper and renderer tests after each UI slice.
- [ ] Run focused service, route, and Memory tests after the result-contract slice.
- [ ] Run formatter and i18n validation.
- [ ] Run lint and type checking.
- [ ] Run complete Memory and renderer suites.
- [ ] Complete a severity-ordered review before every commit and fix all findings.
- [ ] Commit locally with Conventional Commits.
- [ ] Confirm the branch was not pushed.
