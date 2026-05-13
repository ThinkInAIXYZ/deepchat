# ACP Initialization Logging

## Problem

Claude Code over ACP can remain in a loading state with too little diagnostic information from the normal chat path. Existing logs show some high-level initialization results, but they do not consistently expose early subprocess exits, initialization-time stderr, stream closure before an initialize response, or the request/response stages for session setup.

## Goals

- Log ACP subprocess startup, initialization request/response timing, initialization failure, early process exit, and stream closure.
- Add protocol-level JSON-RPC frame summaries without consuming stdout separately from the ACP stream.
- Log normal chat-path `newSession`, `loadSession`, and `prompt` request/response/error stages.
- Keep logged protocol payloads summarized so prompts, file contents, and environment details are not dumped by default.

## Acceptance Criteria

- When an ACP process starts, logs include agent id, workdir, pid, command summary, and initialization start.
- If the ACP process exits, emits stderr, or the protocol stream closes during initialization, the failure is logged and initialization rejects with a concrete message instead of waiting only for the long timeout.
- ACP debug event history includes lifecycle/request/response/error entries for initialization and session setup.
- Protocol frame logging does not add an extra `stdout` data listener that could steal bytes from the ACP SDK stream.
- No `[NEEDS CLARIFICATION]` markers remain.

## Non-Goals

- No ACP protocol redesign.
- No renderer UI redesign for the ACP inspector.
- No full raw prompt/content logging by default.
