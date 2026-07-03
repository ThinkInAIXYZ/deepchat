# Cron Run Open Session Focus

## User Need

Opening a scheduled run session from Settings should switch to the real main chat window and show
that session.

## Goal

Fix `cronJobs.openRunSession` so it does not treat the focused Settings window as the main chat
window.

## Acceptance Criteria

- Clicking the run history open button activates the run's `sessionId` in the main chat window.
- The main chat window is shown and focused.
- Settings remains otherwise unchanged.

## Non-Goals

- No new run detail UI.
- No new navigation API.

## Open Questions

None.
