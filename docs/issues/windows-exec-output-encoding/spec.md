# Windows Exec Output Encoding

## User Story

Windows users can run `agent-filesystem.exec` and skill scripts against files with Chinese
names and read the command output without mojibake.

## Acceptance Criteria

- `agent-filesystem.exec` preserves Chinese output from PowerShell and cmd on Windows.
- Foreground and background exec paths decode output with streaming UTF-8 semantics.
- Skill script foreground output preserves Chinese text on Windows.
- Existing exit code, timeout, and output offload messages are unchanged.

## Non-goals

- Do not change tool call rendering in the renderer.
- Do not change plugin, hook notification, or RTK internal command output handling.
- Do not support commands that intentionally switch the console back to a non-UTF-8 code page.

## Constraints

- Do not add third-party dependencies.
- Keep user-facing command output behavior compatible outside of encoding fixes.
