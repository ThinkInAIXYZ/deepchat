# Cron Agent Jobs List Sticky Actions

## User Need

The Scheduled settings page should keep the main task action reachable while users scroll through long task lists, and newly created jobs should appear after the existing jobs instead of jumping to the top.

## Goal

- Keep the Scheduled page header actions sticky while scrolling.
- Display cron jobs in stable creation order so new jobs are added at the bottom.

## Acceptance Criteria

- Clicking New Task on the cron jobs settings page appends the new job after existing jobs.
- Editing an existing job does not reorder the visible list.
- The top action area remains visible above the task list while the page scrolls.
- The sticky behavior is opt-in for the Scheduled page and does not change every settings page by default.

## Constraints

- Keep the implementation in the renderer settings ownership layer.
- Reuse the existing `SettingsPageShell` and page-local state.
- Do not add new user-facing strings for this layout change.

## Non-Goals

- Persisting a custom drag-and-drop order.
- Changing cron job scheduler behavior or IPC contracts.
