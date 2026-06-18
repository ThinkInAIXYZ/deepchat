# Tasks — Steer / Queue Rework

- [x] Archive `docs/issues/stop-pauses-pending-queue` → `docs/archives/`.
- [x] Main: `steerActiveTurn` aborts the active turn instead of enqueue-only.
- [x] Main: remove pause concept (`userPausedPendingQueues` + helpers + call sites).
- [x] Main: abort settlement consumes claimed item (no rollback) and triggers drain; mirror in
      `resumeAssistantMessage`.
- [x] Renderer: make the steer button visible (`ChatInputToolbar.vue`).
- [x] Renderer: remove "继续发送" UI (`ChatPage.vue`, `PendingInputLane.vue`).
- [x] Remove resume link: store, client, route contract + dispatcher, presenter, types, i18n key.
- [x] Update `chat.input.steer` / `chat.pendingInput.steer` zh-CN to "打断".
- [x] Update/remove tests (main steer/stop cases; resume assertions).
- [x] Queue-row interrupt-and-send: runtime `steerPendingInput` (convert to steer + abort active turn
      + drain), routed through contract/client/store to a `PendingInputLane` button
      (`chat.pendingInput.toSteer`); `convertPendingInputToSteer` stays the non-interrupting promote.
- [x] Verify: typecheck, test:main, test:renderer, format, i18n, lint.

## Review hardening (follow-up)

- [x] Main: make the stream handler the single abort-settlement owner; `cancelGeneration` only aborts +
      releases controllers/permissions (no terminal block / hooks / clearActiveGeneration). Add
      `writeCanceledTerminalBlock` helper used by `processMessage`/`resumeAssistantMessage` abort
      branches; harden `ensureSessionAbortController` against handing back an aborted controller.
- [x] Renderer: allow deleting a pending (locked) steer item (`PendingInputLane.vue` delete button).
- [x] Renderer: disable the queue-row interrupt button with a reason tooltip (`disableQueueSteerAction`)
      and toast on steer failure (`ChatPage.vue`).
- [x] i18n: fix `chat.pendingInput.toSteer` across all locales; add `remove` / `steerUnavailable` /
      `steerFailed` keys; align zh-HK/zh-TW `steer` to 打斷; regenerate `i18n.d.ts`.
- [x] Trim dead renderer `convertPendingInputToSteer` / `convertToSteer`; document the retained backend
      route/method as the low-level non-interrupting promote.
- [x] Gitignore `.deepchat/` runtime assets.
- [x] Tests: single-dispatch abort settlement; steer-row delete + disabled queue-row button; store
      steer-failure surfacing; drop removed-API mocks.

## Review hardening — round 2 (post-review corrections)

- [x] Make `cancelGeneration` truly abort-only (abort + release controllers/permissions); removed the
      `terminalSettledRuns` dedup. Settlement is owned by `processMessage`/`resumeAssistantMessage`:
      return-path via `applyProcessResultStatus` (hooks dispatched per-run, session status guarded by
      `isActiveRun`), throw-path via `settleAbortedTurn`. Harden `ensureSessionAbortController` to drop
      a just-aborted lingering run so a new turn never reuses an aborted controller.
- [x] Backend: `deletePendingInput` now allows removing a *pending* steer item (was rejected by
      `assertQueueInput`), so the steer-row delete escape hatch actually works.
- [x] `steerPendingInput`: await the immediate drain on the no-active path; on failure roll the
      promotion back to the queue (`restoreSteerInputToQueue` / store `convertSteerInputToQueue`) and
      throw so the UI surfaces it.
- [x] Renderer: queue-row interrupt button disabled when not generating (idle has nothing to interrupt).
- [x] Tests: coordinator deletes/restores pending steer items; stale aborted run reports its hook
      without clobbering the newer run's status (order-independent); `SessionClient.steerPendingInput`
      route/payload mapping.
- [x] Main/tests: guard throw-path abort settlement with the registered run id so a stale
      `AbortError` cannot mark a newer active run idle; add targeted regression coverage.

## Notes

- Steer only interrupts an actively-streaming turn (`activeGenerations`). During pre-stream setup
  (no tokens yet, user message not persisted) it does not abort — it lets that turn finish and then
  drains as the next visible turn, so the in-flight prompt is never lost.
- Aborting (stop or steer) consumes the claimed queue/steer item (keeps the partial turn) and
  auto-drains the next item. Genuine errors still roll back + halt at `status='error'` (recover by
  enqueuing/sending a new message, which drains from the error state).
- Two pre-existing, environment-specific test failures are unrelated to this change and reproduce on
  a clean tree: `pluginPresenter` CUA `/private/var` symlink path, and `cuaSettings` permission UI.

## Review hardening — round 3 (CodeRabbit launch semantics)

- [x] Main: make `drainPendingQueueIfPossible` report successful launch immediately while the claimed
      turn continues in the background; keep failure rollback for promoted steer items.
- [x] Main: guard abort throw-path idle settlement against replacement pre-stream controllers.
- [x] Renderer: add translated `aria-label` values to icon-only pending input controls and clear plan
      state only after queued steer succeeds.
- [x] Tests: replace fixed sleeps in reviewed tests with observable `vi.waitFor` conditions.
- [x] Verify: format, i18n, lint, typecheck, and targeted tests.
