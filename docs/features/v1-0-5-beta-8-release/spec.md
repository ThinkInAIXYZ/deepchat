# v1.0.5-beta.8 Release

## Context

DeepChat v1.0.5-beta.7 was published on 2026-06-01. The `dev` branch now contains
workspace navigation, sidebar theme switching, chat activity compaction, ACP v1 reliability, and
model settings fixes that should be reviewed through a new beta release PR.

## User Need

Beta users need a prerelease build that includes the latest usability and reliability improvements
without waiting for the next stable release.

## Goals

- Prepare release metadata for `v1.0.5-beta.8`.
- Keep release notes concise and bilingual, with English bullets first and Chinese bullets second.
- Cut a disposable `release/v1.0.5-beta.8` branch from the release-ready `dev` commit.
- Open a PR from `release/v1.0.5-beta.8` to `main` for maintainer review.

## Non-goals

- No product behavior changes beyond release metadata.
- No publishing step, `main` fast-forward, or release tag creation before maintainer review.
- No replacement of mismatched historical tags unrelated to `v1.0.5-beta.8`.

## Acceptance Criteria

1. `package.json` reports version `1.0.5-beta.8`.
2. `CHANGELOG.md` contains a top entry for `v1.0.5-beta.8` dated `2026-06-02`.
3. The changelog entry summarizes first-parent commits after `v1.0.5-beta.7`.
4. Required release checks pass: `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
5. `pnpm run typecheck` passes before cutting the release branch.
6. `dev` contains the release metadata commit.
7. `release/v1.0.5-beta.8` is pushed and points at the same commit as `dev`.
8. A PR from `release/v1.0.5-beta.8` to `main` is open for review.

## Constraints

- Follow the repository release flow in `docs/release-flow.md`.
- Keep `dev` as the integration branch.
- Treat `release/v1.0.5-beta.8` as disposable and identical to a commit already on `dev`.
- Do not replace or delete existing mismatched historical tags without maintainer approval.

## Open Questions

None.
