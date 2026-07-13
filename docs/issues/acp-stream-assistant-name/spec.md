# ACP Stream Assistant Name

## Issue Description

In ACP mode, a newly returning assistant message can briefly render as `Assistant` instead of the
selected ACP agent name such as `DimCode`.

## Impact

The first visible assistant header is generic during the stream start window, then corrects after
session/message hydration catches up. This makes ACP conversations look like they are using the
default assistant instead of the selected agent.

## UI Sketch

Before:

```txt
[icon] Assistant  11:56
      ...
```

After:

```txt
[icon] DimCode    11:56
      ...
```

## Root Cause

`MessageItemAssistant` renders `model_name`. During the first response window there are two live
paths:

- the pending placeholder before any stream block arrives;
- the hydrated local assistant record after stream snapshots arrive.

Both paths fall back to `sessionStore.activeSession.modelId` when message metadata is not available.
After `selectSession()` on an ACP draft session, the active session can temporarily be a lightweight
fallback with empty `providerId` and `modelId`, so `resolveAssistantModelName('')` returns
`Assistant`. The same missing `providerId`/`modelId` also makes `ChatStatusBar` show the wrong bottom
state.

The stream update event already has a stable `sessionId` and `messageId`, but it does not include the
runtime provider/model for the current turn.

## Fix Plan

- Add optional `providerId` and `modelId` to `chat.stream.updated` payloads.
- Populate those fields from the agent runtime stream IO context.
- Preserve them as assistant message metadata when renderer stream hydration creates or updates a
  local pending assistant record.
- Hydrate the selected active session summary after `selectSession()` activates a session and before
  routing to the chat page, so pending placeholders and the bottom status bar see the ACP provider and
  model immediately.
- Use the same hydrate-before-route behavior for current-window `sessions.updated/activated` events,
  because that IPC event can arrive before the `selectSession()` caller continues after `activate()`.
- Preserve an already hydrated summary for duplicate activation events on the same session until the
  refresh completes, avoiding a one-frame fallback to empty provider/model.
- Keep rate-limit ephemeral stream records out of message hydration as today.

## Task Checklist

- [x] Update SDD issue spec.
- [x] Sync GitHub issue when available.
- [x] Update typed stream event contract.
- [x] Publish provider/model on stream snapshots.
- [x] Persist provider/model into renderer hydrated pending assistant metadata.
- [x] Hydrate active session summary after selecting a session.
- [x] Hydrate active session summary on current-window activation events.
- [x] Preserve existing same-session summary while duplicate activation rehydrates.
- [x] Add focused tests.
- [x] Run format, i18n, and lint.

## Validation

- Focused renderer store test proves a stream update with `providerId: 'acp'` and `modelId:
  'dimcode'` creates a pending assistant record with matching metadata.
- Focused session store test proves selecting an ACP session hydrates `activeSession.providerId` and
  `activeSession.modelId` before routing to chat.
- Focused session store test proves the current-window activation event also hydrates before routing.
- Focused session store test proves duplicate activation does not clear existing ACP provider/model
  while rehydration is pending.
- Focused main tests prove stream snapshots carry provider/model.
- Existing contract validation accepts the new optional event fields.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and focused main/renderer
  tests pass.

## GitHub Issue

[#1880](https://github.com/ThinkInAIXYZ/deepchat/issues/1880)
