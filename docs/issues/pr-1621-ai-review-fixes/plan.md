# Implementation Plan

## Change

- Update shared onboarding step resolution fallback ordering.
- Add guarded step selection when `startGuidedOnboarding` receives a terminal requested step.
- Tighten renderer onboarding step finalization condition for nullish `currentStepId`.
- Sync provider settings tab selection from onboarding step in one shared helper used by both watchers.
- Add runtime response parsing in onboarding client using existing route schema.
- Update onboarding locale strings for the reviewed non-English locale files.
- Extend tests for onboarding route behavior and onboarding client response validation.

## Validation

- Run format, i18n, lint, and focused onboarding-related tests for touched modules.
