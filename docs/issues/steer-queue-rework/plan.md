# Plan — Steer / Queue Rework

## Core idea

The generating turn is independent of the queue. An abort (stop or steer) keeps the turn's partial
output and never returns it to the queue; after the abort settles, the queue auto-drains — stop
picks the next queued item, steer picks the freshly enqueued, highest-priority steer item.
The pause/resume mechanism is removed.

## Main process — `src/main/presenter/agentRuntimePresenter/index.ts`

1. `steerActiveTurn`: when a generation/pre-stream controller exists, `queueVisibleSteerInput`
   (unchanged enqueue + merge), then `await cancelGeneration(sessionId)`. The settlement drain picks
   the steer item first (steer sorts before queue in SQL). No active generation → unchanged direct
   `processMessage`.
2. Remove pause: delete `userPausedPendingQueues`, `shouldPausePendingQueueOnStop`,
   `isPendingQueuePausedByUser`, `clearPendingQueuePauseIfEmpty` and their call sites; drop the
   pause-add in `cancelGeneration`; drop pause checks in `drainPendingQueueIfPossible` and
   `shouldStartQueuedInputImmediately`.
3. Abort settlement (`processMessage`): on abort, a claimed queue/steer item is **consumed**
   (`consumeClaimedPendingInput`, keeping the user message + partial assistant), not rolled back.
   After setting `idle`, trigger `drainPendingQueueIfPossible(sessionId, 'completed')`. Genuine
   errors keep `rollbackClaimedPendingInputTurn` + `status='error'` (queue halts naturally). Mirror
   the drain trigger in `resumeAssistantMessage`'s abort branch. Both return-path and throw-path
   abort settlement pass the registered run id through an `isActiveRun` guard before mutating session
   status, so late stale aborts cannot clobber a newer active run.

Concurrency: queue-launched turns continue via the existing `drainPendingQueueIfPossible` `finally`
recursion; plain sends continue via the new settlement drain; `drainingPendingQueues` guards
re-entry; `cancelGeneration` clears the active generation so the next turn gets a fresh abort
controller.

## Renderer

1. `ChatInputToolbar.vue`: steer becomes a visible `outline` button (compass + `t('chat.input.steer')`
   label), keeping testid/emit/visibility. Primary button stays queue.
2. Remove "继续发送": `ChatPage.vue` (`showResumePendingQueue`, `onResumePendingQueue`, template
   bindings) and `PendingInputLane.vue` (button, `showResumeQueue` prop, `resume-queue` emit).
3. Remove the resume link end-to-end: `stores/ui/pendingInput.ts`, `api/SessionClient.ts`,
   `shared/contracts/routes/sessions.routes.ts` + `routes.ts`, `main/routes/index.ts`,
   `agentSessionPresenter/index.ts`, the `.d.ts` types, and the `resumeQueue` i18n key.
4. Update `chat.input.steer` zh-CN to "打断".

## Tests

- `agentRuntimePresenter.test.ts`: steer now aborts + runs as next turn; stop auto-continues without
  pause/rollback; remove resume cases.
- Remove resume assertions in `pendingInputStore.test.ts`, `PendingInputLane.test.ts`,
  `agentSessionPresenter/integration.test.ts`, `routes/contracts.test.ts`, `api/clients.test.ts`.

## Verification

`pnpm run typecheck`, `pnpm test:main`, `pnpm test:renderer`, then manual `pnpm run dev`, then
`pnpm run format` / `pnpm run i18n` / `pnpm run lint`.
