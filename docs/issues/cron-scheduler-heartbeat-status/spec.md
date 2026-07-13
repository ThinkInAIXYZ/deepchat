# Cron Scheduler Heartbeat Status

## Problem

The Scheduled settings page can show the scheduler as running while the heartbeat remains `none`.

The scheduler utility emits `READY` and periodic `HEARTBEAT` events, and the main process stores
`lastHeartbeatAt`. The settings page only loads scheduler status during list/save/toggle/run/restart
actions, so it can keep displaying the initial pre-heartbeat status snapshot.

## Requirements

- Refresh the scheduler status indicator while the Scheduled settings page is open.
- Do not reload or overwrite the editable job list during heartbeat refreshes.
- Stop the refresh timer when the settings page unmounts.
