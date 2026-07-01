# Assistant Loading Placeholder Delay

Status: proposed
Date: 2026-07-01

## User Need

After the user submits a message, the conversation should immediately show the next assistant row in
a loading state. The user should not wait for pre-stream preparation or the first provider chunk
before seeing that DeepChat accepted the turn.

## Current Behavior

`ChatPage.onSubmit()` sends the payload through `chatClient.sendMessage()` and only clears the
composer after that promise resolves. On the main-process path, `chat.sendMessage` calls
`AgentRuntimePresenter.processMessage()`, which performs generation-settings loading, skill/tool
resolution, system prompt construction, optional compaction, memory injection, context build, and
then creates the assistant message before starting `runStreamForMessage()`.

The renderer only renders an assistant loading row in two cases:

- a persisted assistant record is present in `messageStore.messages` with empty content and
  `status: pending`
- `messageStore.isStreaming` is true and `streamingBlocks.length > 0`, causing `ChatPage` to append
  `toStreamingMessage(...)`

Normal send does not emit a refresh after the assistant record is created unless
`emitRefreshBeforeStream` is set. Even if that flag were enabled, the assistant row would still only
appear after pre-stream work finishes because the assistant record is currently created after context
build.

## UX Target

Before:

```txt
[User submits]

User: hello

...blank wait while pre-stream work/provider first chunk happens...

Assistant: [content or tool activity appears]
```

After:

```txt
[User submits]

User: hello
Assistant: [spinner]

...later...

Assistant: first streamed content/tool activity
```

## Root Cause

The visual loading state is coupled to backend stream state. There is no renderer-owned pending
assistant placeholder for the gap between submit and the first `chat.stream.updated` event.

## Acceptance Criteria

- A non-queued user submit immediately adds an assistant row with the existing empty-pending spinner.
- The placeholder appears after the submitted user row, not as a detached global loader.
- The placeholder is replaced or hidden as soon as the real assistant stream row or persisted
  assistant record becomes available.
- If sending fails before streaming starts, the placeholder is removed and no stale spinner remains.
- Queued input while another generation is active does not create an immediate assistant row for the
  queued turn.
- Switching sessions clears any local placeholder for the previous session.
- The implementation does not add a new IPC event or persist fake assistant messages.
- Existing streaming row reuse behavior remains intact: no completion flash and no duplicate
  assistant rows once streaming begins.

## Non-goals

- Moving assistant DB row creation earlier in `AgentRuntimePresenter.processMessage()`.
- Renaming `chat.stream.completed` even though it is currently also used as a message refresh event.
- Reworking `chat.sendMessage` route lifetime or making it return before generation completes.
- Changing provider streaming behavior or pre-stream preparation order.

## Open Questions

None.
