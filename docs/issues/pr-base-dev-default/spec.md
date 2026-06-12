# Default PR Base Branch

## User Need

Contributors and coding agents need a clear repository-level instruction that routine pull requests
target `dev` by default instead of accidentally targeting `main`.

## Problem

`docs/release-flow.md` defines `dev` as the integration branch and `main` as the release mirror, but
`AGENTS.md` did not state the default PR base branch in the commit and pull request guidelines.
Automation can therefore fall back to `main` when creating PRs.

## Acceptance Criteria

- `AGENTS.md` states that routine PRs default to `dev`.
- `AGENTS.md` states that `main` is only for `release/<version>` PRs following the release flow.
- The instruction is located in the section that coding agents read before creating commits and PRs.

## Non-goals

- Change the release flow.
- Change GitHub repository settings.
- Change CI branch filters.
