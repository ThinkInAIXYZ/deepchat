# v1.0.4 Stable Release Plan

## Release Metadata

- Update `package.json` from `1.0.4-beta.8` to `1.0.4`.
- Add the official `v1.0.4` changelog section dated `2026-05-15`.

## Validation

- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.
- Run `pnpm run typecheck` before cutting the release branch.

## Publishing

- Commit the metadata on `dev`.
- Push `dev`.
- Cut `release/v1.0.4` from the release-ready `dev` commit.
- Fast-forward `main` and create `v1.0.4` when the release commit is ready to publish.
