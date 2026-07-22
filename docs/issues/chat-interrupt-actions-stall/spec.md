# Chat Interrupt Actions Can Stall Silently

## Issue

The chat composer can show Stop or Steer as available while clicking the control produces no
visible result. The symptom is intermittent because it depends on session-restore timing, transient
composer gates, or a failed main-process action.

## Impact

- A stale `working` session snapshot can leave Stop/Steer visible after the active turn has ended.
- Composer Steer looks enabled while session preparation, a missing ACP workdir, or a pending tool
  interaction causes the submit path to return without feedback.
- Stop ignores the main-process `{ stopped: false }` result, and composer Steer does not catch a
  rejected request, so users cannot distinguish a pending action from a failed action.
- Repeated clicks can dispatch duplicate operations because neither action exposes an in-flight
  state.

## Root Cause

1. `sessions.status.changed` includes a version, but `sessionIpc` drops it before applying status to
   the session store.
2. Session restore reads the session snapshot before reading messages. A status event can arrive
   between those reads, after which the older restore snapshot unconditionally replaces
   `activeSessionSummary.status`.
3. `disableQueueSteerAction` is wired to queued-item Steer but not to the composer toolbar Steer
   button. The handler repeats those gates as silent early returns.
4. Stop discards the `stopped` response, while Stop and composer Steer only log failures (or leave an
   unhandled rejection) and have no pending state.

## Fix Plan

- Track the newest observed status event per session, including its version and mapped UI status.
- Reject older status events and merge the newest observed status into asynchronous list, hydrate,
  and restore snapshots so stale reads cannot roll the UI backward.
- Pass the existing Steer availability state into `ChatInputToolbar`; disable the button and expose
  the existing unavailable tooltip when the action cannot run.
- Add session-scoped pending state for composer Steer and Stop, render the existing shadcn spinner,
  prevent duplicate dispatch, retain the draft on failure, and surface destructive toasts.
- Treat `{ stopped: false }` as a user-visible failure and only rebaseline the plan after composer
  Steer is accepted.

## Constraints

- Do not change the Stop/Steer IPC route schemas or queue ordering semantics.
- Do not optimistically mark a session idle; runtime status events remain authoritative.
- Do not clear a draft when Steer fails or when its completion belongs to a superseded session view.
- Preserve the existing automatic queue drain after Stop/Steer.
- Use existing i18n keys and shadcn primitives; no new custom loading control.

## UI Change

BEFORE

```text
Generating + draft: [Steer (always enabled)] [Queue]
Generating, no draft:                       [Stop]
Request in flight:    no visible pending state or failure feedback
```

AFTER

```text
Generating + draft: [Steer disabled | spinner] [Queue disabled while steering]
Generating, no draft:                         [Stop spinner]
Request failure:     destructive toast; Steer draft remains available
```

## Task Checklist

- [x] Preserve monotonic status events across asynchronous session snapshots.
- [x] Wire composer Steer availability and pending state through the toolbar.
- [x] Surface Stop/Steer failures and prevent duplicate requests.
- [x] Add renderer store and component regression tests.
- [x] Run format, i18n, lint, typecheck, and focused tests.
- [x] Commit and push the fix to PR #2000.

## Validation

- An `idle` status event cannot be overwritten by an older `generating` restore snapshot, and the
  inverse transition is equally protected.
- Status events older than the last applied version are ignored.
- Composer Steer is visibly disabled whenever its handler would reject the action.
- Pending Stop/Steer renders progress and accepts only one click.
- Rejected Steer retains the draft and shows an error toast.
- Stop returning `{ stopped: false }` shows an error toast.
- Existing queue/steer runtime tests remain green.

### Results

- `pnpm exec vitest run` for the affected session store, toolbar, ChatPage, and composer suites:
  169 tests passed.
- `pnpm exec vitest run test/renderer/components/MemorySettings.test.ts`: 11 tests passed
  when rerunning the unrelated full-suite timeout in isolation.
- `pnpm run typecheck`, `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`: passed on
  Node 24.14.1.

## GitHub

- Target PR: https://github.com/ThinkInAIXYZ/deepchat/pull/2000
- No separate GitHub issue was requested or created.
