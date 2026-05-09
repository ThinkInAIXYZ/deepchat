# Background Exec Shell Fallback

## User Story

Users can run foreground and background shell commands even when the configured POSIX login shell
path, such as `/bin/zsh`, is unavailable in the current runtime environment.

## Acceptance Criteria

- POSIX shell execution does not blindly spawn a missing `process.env.SHELL` path.
- POSIX shell fallback skips existing but non-executable shell candidates.
- macOS falls back from zsh to bash and then sh; Linux falls back from bash to sh and then zsh.
- If no configured or platform fallback shell resolves, DeepChat uses `/bin/sh` instead of an
  unchecked rejected candidate.
- Background exec sessions use the resolved executable shell path.
- Shell environment bootstrap uses plain `sh -c` flags when the fallback is `sh`.
- Missing or inaccessible working directories are reported before spawn instead of surfacing as a
  misleading shell `ENOENT`.
- Windows shell selection is unchanged.

## Non-goals

- Do not add renderer settings or IPC for shell configuration.
- Do not persist a detected fallback shell.
- Do not change user command permission behavior or output formatting.
