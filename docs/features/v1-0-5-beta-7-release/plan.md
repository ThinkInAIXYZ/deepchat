# Implementation Plan - v1.0.5-beta.7 Release

## Current State

- Current branch: `dev`.
- Current version: `1.0.5-beta.6`.
- Target version: `1.0.5-beta.7`.
- No local or remote `v1.0.5-beta.7` tag exists.
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

## Steps

1. Update `package.json` to `1.0.5-beta.7`.
2. Add the `v1.0.5-beta.7` changelog entry.
3. Run release checks.
4. Commit release metadata on `dev`.
5. Push `dev`.
6. Create and push `release/v1.0.5-beta.7`.
7. Publish the beta tag from the release commit if repository policy allows immediate beta tagging.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`

## Rollback

If validation fails before pushing, keep the branch on `dev` and fix the metadata or report the
blocking check. If a remote branch is pushed but the tag is not created, move or delete only the
disposable `release/v1.0.5-beta.7` branch according to the release flow.
