# Implementation Plan - v1.0.5-beta.7 Release

## Current State

- Current branch: `dev`.
- Current version: `1.0.5-beta.7`.
- Target version: `1.0.5-beta.7`.
- Remote `v1.0.5-beta.7` exists on `894110a4a`.
- Latest `origin/dev` includes additional commits after `894110a4a`.
- No local or remote `release/v1.0.5-beta.7` branch exists.
- `git fetch --tags --prune` reports historical tag mismatches for `v1.0.0-beta.7` and
  `v1.0.5-beta.3`; these are unrelated to the target release and must not be replaced.

## Release Notes Source

Summarize first-parent commits after `v1.0.5-beta.6`:

- Agent session transfer flow.
- NewAPI routing and capability overlay fixes.
- AI SDK system prompt request handling.
- Workspace file reference insertion fix.
- Floating button position persistence.
- Image-capable model chat switching fix.
- Collapsed sidebar agent click expansion fix.
- Workspace Git diff panel rendering improvements.
- Plan model styling fix.

## Steps

1. Keep `package.json` on `1.0.5-beta.7`.
2. Update the `v1.0.5-beta.7` changelog entry for the latest merged commits.
3. Run release checks.
4. Commit release metadata on `dev`.
5. Push `dev`.
6. Fast-forward `main` to the latest release-ready commit.
7. Move the local `v1.0.5-beta.7` tag to the latest release-ready commit.
8. Do not push the moved tag until the maintainer wants to rerun the release action.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`

## Rollback

If validation fails before pushing, keep the branch on `dev` and fix the metadata or report the
blocking check. If the retargeted tag must be abandoned before triggering the action, reset only the
local tag back to the remote tag commit and leave the remote tag unchanged.
