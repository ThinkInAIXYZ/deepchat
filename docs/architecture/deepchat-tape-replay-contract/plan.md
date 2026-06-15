# DeepChat Tape Replay Contract - Plan

## Architecture Decision

Add a replay-slice export on top of `DeepChatTapeService`. The service already owns manifest lookup
and has access to the SQLite presenter, so it remains the single Tape boundary.

## Flow

```text
renderer SessionClient.exportMessageTapeReplaySlice(messageId, options)
  -> sessions.exportMessageTapeReplaySlice route
  -> AgentSessionPresenter.exportMessageTapeReplaySlice(messageId, options)
  -> AgentRuntimePresenter.exportMessageTapeReplaySlice(sessionId, messageId, options)
  -> DeepChatTapeService.exportReplaySlice(sessionId, messageId, options)
       -> select manifest by requestSeq or latest
       -> find matching message trace by requestSeq
       -> collect manifest/included/excluded/anchor tape entries
       -> return deterministic replay slice
```

## Module Changes

| Module | Change |
| --- | --- |
| `src/shared/types/tape-replay.ts` | Add replay slice, trace snapshot, entry snapshot, and options types. |
| `src/main/presenter/agentRuntimePresenter/tapeService.ts` | Add `exportReplaySlice()`. |
| `src/main/presenter/agentRuntimePresenter/index.ts` | Expose agent-level replay export method. |
| `src/main/presenter/agentSessionPresenter/index.ts` | Resolve `messageId -> sessionId -> agent`. |
| `src/shared/contracts/routes/sessions.routes.ts` | Add typed replay export route. |
| `src/main/routes/index.ts` | Wire the route. |
| `src/renderer/api/SessionClient.ts` | Add replay export client method. |
| `test/main/presenter/agentRuntimePresenter/tapeService.test.ts` | Cover replay export behavior. |

## Hashing

- `entry.payloadHash`: hash of raw `payload_json`.
- `entry.metaHash`: hash of raw `meta_json`.
- `trace.headersHash`: hash of raw `headers_json`.
- `trace.bodyHash`: hash of raw `body_json`.
- `sliceHash`: deterministic hash of the returned slice with `sliceHash` empty.

## Compatibility

- Missing tape table returns `null`.
- Missing manifest returns `null`.
- Missing matching trace returns a manifest-only slice.
- Old traces keep working through existing trace APIs.

## Verification

```bash
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeService.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```
