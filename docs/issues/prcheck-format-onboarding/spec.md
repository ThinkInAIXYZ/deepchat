# PR Check Format Failure

## User Story

As a contributor, I want the PR Check workflow to pass for onboarding route changes so review is not blocked by formatting drift.

## Acceptance Criteria

- `pnpm run format:check` passes locally.
- The workflow-equivalent checks continue past formatting without introducing behavior changes.
- The fix does not alter guided onboarding state semantics.

## Non-Goals

- No onboarding UX or storage behavior changes.
- No CI workflow changes unless the reproduced failure requires them.

## Constraints

- Keep the change minimal and compatible with existing formatter rules.
- Preserve existing user work in the branch.
