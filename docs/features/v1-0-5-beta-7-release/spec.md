# v1.0.5-beta.7 Release

## Context

DeepChat v1.0.5-beta.6 has been published. The `dev` branch now contains a small set of
user-visible fixes and one agent session transfer feature that should be made available through the
next beta release.

## User Need

Beta users need a new prerelease build that includes the latest agent transfer flow, workspace input
fixes, model routing fixes, and UI stability improvements without waiting for the next stable
release.

## Goals

- Prepare release metadata for `v1.0.5-beta.7`.
- Keep release notes concise and bilingual, with English bullets first and Chinese bullets second.
- Cut a disposable `release/v1.0.5-beta.7` branch from the release-ready `dev` commit.
- Publish the tag after the release branch is prepared and validated.

## Non-goals

- No product behavior changes beyond release metadata.
- No release-only code changes outside `package.json`, `CHANGELOG.md`, and this SDD record.
- No replacement of existing tags that differ between local and remote history.

## Acceptance Criteria

1. `package.json` reports version `1.0.5-beta.7`.
2. `CHANGELOG.md` contains a top entry for `v1.0.5-beta.7` dated `2026-06-01`.
3. The changelog entry summarizes commits after `v1.0.5-beta.6`.
4. Required release checks pass: `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
5. `release/v1.0.5-beta.7` is created from the release-ready commit and pushed to `origin`.
6. `v1.0.5-beta.7` is created on the release commit and pushed to `origin` only if the tag does not
   already exist locally or remotely.

## Constraints

- Follow the repository release flow in `docs/release-flow.md`.
- Keep `dev` as the integration branch.
- Treat `release/v1.0.5-beta.7` as disposable and identical to a commit already on `dev`.
- Do not replace or delete existing mismatched historical tags without maintainer approval.

## Open Questions

None.
