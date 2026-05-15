# v1.0.4 Stable Release Spec

## User Story

As a DeepChat maintainer, I want to promote the stable v1.0.4 beta series to an official release so users can receive a non-prerelease update with the accumulated improvements from the 1.0.4 cycle.

## Acceptance Criteria

- The root package version is `1.0.4`.
- `CHANGELOG.md` contains a top-level `v1.0.4 (2026-05-15)` section.
- Release notes summarize user-visible and release-relevant changes since `v1.0.3`.
- The release branch and tag use `release/v1.0.4` and `v1.0.4`.

## Non-Goals

- No product behavior changes are introduced as part of the release metadata update.
- No historical changelog sections are rewritten.

## Constraints

- Follow the repository release flow with `dev` as the integration branch and `main` updated by fast-forward.
- Keep changelog entries bilingual with English bullets before Chinese bullets.
