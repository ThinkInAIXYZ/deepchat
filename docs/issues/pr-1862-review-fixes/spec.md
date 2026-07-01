# PR 1862 Review Fixes Spec

## User Need

Address still-valid review comments on PR #1862 without changing the feature scope.

## Scope

- Route command-running agent tools through `auto_approve` review.
- Fail high-risk auto-review results closed to user confirmation.
- Normalize persisted `permission_mode` values on read.
- Re-check read-only state before confirming message deletion.
- Align feature docs and i18n typing/locale values with the implementation.

## Non-Goals

- No new permission mode.
- No new reviewer architecture.
- No database migration unless a focused read-time normalization is insufficient.

## Acceptance Criteria

- Plain `exec` calls with `command`/`cmd`/`script` args are reviewed in `auto_approve`.
- `riskLevel: "high"` never returns `auto_allow`.
- Invalid persisted permission modes resolve to `full_access`.
- Delete confirmation no-ops if the session becomes read-only while the dialog is open.
- Relevant focused tests pass.
