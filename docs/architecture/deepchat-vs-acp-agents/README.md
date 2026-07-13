# DeepChat Agent vs ACP Agent

Status: reviewed on 2026-07-06.

This note compares the live DeepChat agent runtime with the ACP provider path. It keeps only
findings backed by current code. Earlier draft items that assumed non-existent multi-writer or
rollback behavior were removed.

## Files

- [spec.md](./spec.md): current architecture comparison and verified conclusions.
- [issues/P0-1-acp-permission-timeout.md](./issues/P0-1-acp-permission-timeout.md):
  implemented ACP permission timeout and cancellation fix.

## Removed Findings

The following review items are not retained:

- P0-2 Tape write ordering: current tape writes run through synchronous `better-sqlite3` in the
  Electron main process. There is no current multi-writer path that justifies adding a session lock.
- P0-3 Pending input deadlock: pending input drain already uses single-flight cleanup and claimed-row
  recovery. A watchdog would duplicate existing recovery logic.
- P1-5 ACP config rollback: `setSessionConfigOption()` waits for the ACP response before updating
  local config state. There is no optimistic local write to roll back.
- P1-6 Tool output retry: retrying a smaller tool batch would rerun already executed tools and can
  duplicate side effects. The existing guard truncates, downgrades, or returns a terminal error.

## Current Fix

ACP permission requests now settle when the user cancels/stops a session or when no decision arrives
within the timeout window. See [GitHub issue #1881](https://github.com/ThinkInAIXYZ/deepchat/issues/1881).
