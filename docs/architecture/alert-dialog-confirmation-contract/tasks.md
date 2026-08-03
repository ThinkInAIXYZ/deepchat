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

- [x] Add the shared Memory command result and rejection reasons.
- [x] Preserve structured outcomes in management, conflict, and persona services.
- [x] Update routes, clients, renderer callers, and mocks.
- [x] Cover rejected conflict and persona operations.
- [x] Remove the dead `MemoryInlinePanel.changed` contract.

## Validation and delivery

- [x] Run focused wrapper and renderer tests after each UI slice.
- [x] Run focused service, route, and Memory tests after the result-contract slice.
- [x] Run formatter and i18n validation.
- [x] Run lint and type checking.
- [x] Run complete Memory and renderer suites.
- [x] Complete a severity-ordered review before every commit and fix all findings.
- [x] Commit locally with Conventional Commits.
- [x] Confirm the branch was not pushed.

## Follow-up hardening

- [x] Align OCR confirmation disabled state with every handler precondition.
- [x] Migrate directive deletion, clear-all, persona rollback, and built-in config removal.
- [x] Reject async and uninspectable regular close-action handlers in the source guard.
- [x] Keep Skill overwrite's regular action handler synchronously complete.
- [x] Separate page/panel feedback from delete-confirmation feedback.
- [x] Localize Memory command rejection reasons and reconcile stale projections.
- [x] Keep pending confirmations mounted and preserve feedback across reconciliation.
- [x] Migrate directive deletion to a structured result and share rejection vocabulary.
- [x] Sanitize `memory_forget` model-visible output.
- [x] Make the real-primitive async harness structurally valid and clarify `.stop`.
- [x] Run focused and full validation.
- [x] Complete the severity-ordered pre-commit review and commit without pushing.
