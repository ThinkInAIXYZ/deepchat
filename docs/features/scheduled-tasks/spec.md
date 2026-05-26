# Scheduled Tasks

## Problem

Closes [#1567](https://github.com/ThinkInAIXYZ/deepchat/issues/1567).

Users want to schedule "reminders" and "planned tasks" inside DeepChat —
either a plain notification ("drink water at 4pm every day") or a scheduled
chat prompt ("every morning at 9 ask the deepchat agent for today's plan").
No equivalent feature exists today; the only time-aware paths are
`hooksNotifications` (event-driven, not time-driven) and the deeplink
"start" flow (which has `autoSend` security-disabled, so it can only
prefill a chat draft).

## User Story

As a DeepChat user, I want to create a scheduled task with a trigger time
(once at a specific datetime, daily, or weekly on a chosen day) and an
action (raise a system notification, prefill a new chat thread with a
preset prompt, or auto-send a preset prompt to a chosen agent/model). I
want my tasks to persist across app restarts; one-shot tasks that I missed
because the app was closed should still fire on next launch.

## Acceptance Criteria

- A "定时任务" entry exists in Settings → Tools (between Notifications &
  Hooks and Plugins). It lists, creates, edits, toggles, deletes, and
  manually fires user-defined scheduled tasks.
- Each task has:
  - A name and an enabled toggle.
  - A trigger of one of three kinds: `once` (a specific datetime),
    `daily` (hour + minute), or `weekly` (day-of-week + hour + minute).
  - An action of one of two kinds: `notify` (title + body for the system
    notification) or `prompt` (notification title + chat message + optional
    agent / provider / model / system prompt + `autoSend` toggle).
- When a task fires:
  - `notify`: a system notification appears via `notificationPresenter`,
    subject to the existing `notificationsEnabled` config.
  - `prompt` with `autoSend = false`: a system notification appears and the
    main window's new-thread page receives the deeplink-start payload,
    prefilling the chat input.
  - `prompt` with `autoSend = true`: `sessionService.createSession` is
    invoked directly using the configured agent/provider/model, so the LLM
    actually responds without user interaction. A notification is raised
    when the session is created.
- One-shot tasks whose `firesAt` was in the past at launch and that have no
  `lastFiredAt` recorded are fired once on startup (backfill). Recurring
  tasks are not backfilled — they simply jump to the next slot.
- Task records survive app restart (persisted through `ConfigPresenter`'s
  ElectronStore as the `scheduledTasks` key).

## Non-goals

- Cron-expression input. Daily / weekly / once is sufficient for the
  feature ask; a future iteration may add `cron` and `interval` trigger
  kinds.
- Per-task timezone handling. Triggers use the OS's local time.
- Letting the LLM schedule tasks via an MCP tool. Possible follow-up.
- Calendar / iCal export.
