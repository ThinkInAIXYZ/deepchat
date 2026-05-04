# Windows Exec Output Encoding Plan

## Approach

- Normalize Windows shell sessions to UTF-8 before running user commands.
- Decode stdout and stderr from user-visible subprocesses as byte streams with a streaming
  decoder instead of per-chunk string conversion.
- Share the command wrapping and decoder helper across exec, background exec, and skill
  execution paths.

## Affected Paths

- `agent-filesystem.exec` detached and managed foreground execution.
- Background exec sessions.
- Skill script foreground execution.

## Compatibility

- Non-Windows commands are passed through unchanged.
- Existing output formatting stays the same: command output first, then `Exit Code`, timeout,
  and offload metadata.
