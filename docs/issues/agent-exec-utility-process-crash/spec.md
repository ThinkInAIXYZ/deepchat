# Agent Exec Utility Process Crash

## Summary

`agent-filesystem.exec` must run simple shell commands after the background exec manager moved
behind an Electron `utilityProcess` host. In `v1.0.5-beta.5`, every exec request can fail before
the shell command starts because the utility host exits instead of serving RPC requests.

## User Story

As an agent user, I can ask the built-in filesystem tool to run `true`, `echo hello`, `ls`, or a
long-running foreground command and get either normal output or a yielded background session.

## Acceptance Criteria

- The utility host starts without running the main app bootstrap.
- The utility host entrypoint has no static dependency on Electron main-process-only exports such as
  `app` or `BrowserWindow`.
- The host accepts Electron `process.parentPort` message events and handles the contained RPC
  payload.
- A foreground exec command that completes quickly returns the command result instead of a utility
  process exit error.
- Existing crashed-session behavior remains intact when the utility process exits unexpectedly.

## Non-Goals

- Changing shell selection, command permissions, or session cleanup semantics.
- Replacing the `utilityProcess` architecture.
- Changing renderer tool-call UI.

## Constraints

- Keep the fix inside the main-process agent runtime/bootstrap path.
- Preserve packaged and development entrypoint resolution.
