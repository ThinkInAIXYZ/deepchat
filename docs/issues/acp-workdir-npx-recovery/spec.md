# ACP Workdir Validation and npx Recovery

## User Story

When a project directory selected for a new thread no longer exists or cannot be read, users should see that state immediately instead of silently running in a different directory. ACP agents must not create draft sessions, warm up, or send messages against an invalid workdir.

When an npx ACP package launch fails because npm left a broken `_npx/<hash>` cache directory, DeepChat should repair only that broken cache directory and retry once.

## Acceptance Criteria

- The new thread project selector validates the selected project path with `FileClient.isDirectory`.
- An empty project selection is not treated as an invalid directory.
- Stale directory checks cannot overwrite newer project selections.
- Any selected agent shows a warning icon next to the project selector when the selected directory is missing or inaccessible.
- ACP agents disable sending and skip draft session creation while the selected workdir is missing, invalid, or still being checked.
- DeepChat agents show the same warning but keep sending enabled.
- Main process ACP launch throws when an explicit workdir/cwd does not exist or is not a directory.
- Empty ACP workdir continues using the existing fallback directory.
- npx repair only triggers for `distributionType === 'npx'` and `_npx/<hash>/package.json` ENOENT failures.
- npx repair moves only the named bad hash directory and retries once.

## Non-Goals

- Do not change DeepChat Agent send behavior for invalid project directories.
- Do not introduce a new IPC surface for directory checks.
- Do not clear the whole npm cache.
