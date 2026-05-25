# Agent Loop Input And Exec Responsiveness

## User Stories

- As a user steering an active agent turn, I want my steering input to appear as a normal user
  message so the conversation transcript matches what the agent saw.
- As a user running long shell commands, I want `exec` to yield quickly and keep DeepChat's main
  process responsive while the command continues in a managed background session.

## Acceptance Criteria

- Active steer does not interrupt the current provider request; it records a priority steer input,
  lets the current loop iteration finish including tool results, then yields before the next
  provider loop so the steer payload is inserted as a normal visible user turn.
- Pending rows with `mode: "steer"` remain readable for compatibility, but drain before ordinary
  queued rows as visible user turns instead of hidden request injections.
- Pending input UI shows not-yet-entered steer rows in the waiting lane as locked items, and keeps
  ordinary queued follow-ups editable.
- Foreground `exec` returns a normal result if it finishes inside `yieldMs`; otherwise it returns a
  running `sessionId`.
- Shell process spawning, output decoding, output offload, timeout, and process-tree termination
  run in an Electron utility process rather than the main event loop.
- If the utility process exits unexpectedly, affected sessions surface an error snapshot instead of
  blocking the main process.

## Non-Goals

- Do not change the public `exec` tool schema or permission semantics.
- Do not add renderer settings for exec isolation.
- Do not refactor the full agent runtime or provider loop.
