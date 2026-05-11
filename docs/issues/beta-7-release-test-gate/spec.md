# Beta 7 Release Test Gate

## User Story

As a maintainer preparing `v1.0.4-beta.7`, I need the local release gate to pass so the beta branch is cut from a verified `dev` commit.

## Acceptance Criteria

- Release metadata reflects `v1.0.4-beta.7`.
- Required release checks pass locally.
- Test failures caused by stale mocks or platform-sensitive assertions are fixed before cutting the release branch.

## Non-goals

- No unrelated feature work.
- No changelog entries for test-only maintenance.

## Constraints

- Preserve the existing `dev` to `release/<version>` flow.
- Keep release branch contents identical to a commit on `dev`.
