# FFF Large Workspace Timeout

## User Story

When a user selects a large workspace, workspace file search and `@` file mentions should remain
usable even if the FFF native indexer cannot finish its initial scan quickly.

## Acceptance Criteria

- If FFF initial scan or glob search fails, workspace file search falls back to bounded filesystem
  scanning instead of returning an empty completed result.
- Repeated concurrent FFF failures for the same workspace search do not spam identical warning logs.
- Existing default and caller-provided exclude patterns continue to be respected.
- Focused workspace file search tests cover FFF fallback and warning dedupe behavior.

## Non-Goals

- Replacing FFF for normal fast-path search.
- Adding a user-visible search status banner.
