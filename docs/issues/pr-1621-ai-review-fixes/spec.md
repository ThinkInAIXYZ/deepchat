# PR #1621 AI Review Fixes

## Problem

AI review on PR #1621 reported onboarding flow edge cases and missing onboarding localization in several locale files. These issues can leave onboarding on an invalid step, hide the intended settings tab during onboarding, or show untranslated onboarding copy.

## Acceptance Criteria

- Resuming current onboarding step prefers an `in_progress` step before `pending` when `currentStepId` is empty.
- Starting onboarding with a requested completed/skipped step falls back to the next pending step instead of pinning `currentStepId` to a terminal step.
- Guided onboarding finalization treats both `null` and `undefined` `currentStepId` as no active step.
- Provider settings tab selection remains aligned with onboarding steps during provider changes.
- Onboarding renderer client validates bridge responses and throws clear errors when response shape is invalid.
- Reviewed locale files in this scope no longer show English onboarding copy.

## Non-goals

- No unrelated onboarding UX redesign.
- No broad localization rewrite beyond the reviewed onboarding strings.
