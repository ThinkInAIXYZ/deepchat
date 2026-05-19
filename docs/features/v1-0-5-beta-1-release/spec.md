# v1.0.5 Beta 1 Release Spec

## User Story

As a DeepChat maintainer, I want to publish `v1.0.5-beta.1` so beta users can try the accumulated changes after the `v1.0.4` stable release.

## Acceptance Criteria

- The root package version is `1.0.5-beta.1`.
- `CHANGELOG.md` contains a top-level `v1.0.5-beta.1 (2026-05-19)` section.
- Release notes summarize user-visible and release-relevant changes since `v1.0.4`.
- The release branch and tag use `release/v1.0.5-beta.1` and `v1.0.5-beta.1`.

## Non-Goals

- No product behavior changes are introduced as part of the release metadata update.
- No historical changelog sections are rewritten.

## Constraints

- Follow the repository release flow with `dev` as the integration branch and `main` updated by fast-forward.
- Keep changelog entries bilingual with English bullets before Chinese bullets.
