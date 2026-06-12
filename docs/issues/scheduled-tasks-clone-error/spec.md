# Scheduled Tasks Clone Error

## Problem

Editing a scheduled task in Settings can fail with `Error: An object could not be cloned.` from `ScheduledTasksSettings.vue` when persisting a task.

## Cause

The settings page stores tasks in Vue reactive state. `persistTask` forwards `task.trigger` and `task.action` directly to the IPC client. Those nested objects can be Vue proxies, which are not structured-cloneable by Electron IPC.

## Expected Behavior

Persisting an edited scheduled task sends a plain serializable payload to the route and succeeds without clone errors.
