# Implementation Plan - v1.0.5-beta.8 Release

## Current State

- Current branch: `dev`.
- Current version: `1.0.5-beta.7`.
- Target version: `1.0.5-beta.8`.
- No local or remote `release/v1.0.5-beta.8` branch exists.
- No local or remote `v1.0.5-beta.8` tag exists.
- `git fetch --tags --prune` reports historical tag mismatches for `v1.0.0-beta.7` and
  `v1.0.5-beta.3`; these are unrelated to the target release and must not be replaced.

## Release Notes Source

Summarize first-parent commits after `v1.0.5-beta.7`:

- Collapsible workspace file tree sidebar.
- Animated theme toggle button in the app sidebar.
- ACP v1 protocol reliability improvements.
- Automatic completed turn activity collapsing.
- Model capability handling for temperature controls.
- Provider database budget sentinel handling.

## Steps

1. Update `package.json` to `1.0.5-beta.8`.
2. Add `CHANGELOG.md` notes for `v1.0.5-beta.8`.
3. Run release checks.
4. Commit release metadata on `dev`.
5. Push `dev`.
6. Create and push `release/v1.0.5-beta.8`.
7. Open a PR from `release/v1.0.5-beta.8` to `main`.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`

## Rollback

If validation fails before pushing, keep the branch on `dev` and fix the metadata or report the
blocking check. If the release branch is pushed but review rejects the release, delete only the
disposable `release/v1.0.5-beta.8` branch and keep any agreed metadata fixes on `dev`.
