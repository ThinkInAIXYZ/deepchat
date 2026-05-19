# v1.0.5 Beta 1 Release Plan

## Release Metadata

- Update `package.json` from `1.0.4` to `1.0.5-beta.1`.
- Add the `v1.0.5-beta.1` changelog section dated `2026-05-19`.
- Derive release notes from commits after `v1.0.4`.

## Validation

- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.
- Run `pnpm run typecheck` before cutting the release branch.

## Publishing

- Commit the metadata on `dev`.
- Push `dev`.
- Cut `release/v1.0.5-beta.1` from the release-ready `dev` commit.
- Open the release PR to `main` for review and CI.
- Fast-forward `main`, tag `v1.0.5-beta.1`, and clean up the release branch after PR approval.
