# Startup Warning Cleanup Spec

## Goal

Startup should not print misleading warning noise when development lifecycle settings are omitted
or when expected early main-process events fire before any renderer window exists.

## Acceptance Criteria

- Missing, empty, invalid, non-finite, and negative `VITE_APP_LIFECYCLE_HOOK_DELAY` values produce a
  `0` millisecond hook delay and never trigger `TimeoutNaNWarning`.
- `EventBus.send(...)` still emits to main-process listeners when no `WindowPresenter` is registered.
- `EventBus.send(...)` does not warn when renderer delivery is unavailable during startup.
- Direct `EventBus.sendToRenderer(...)` keeps warning when called without a `WindowPresenter`.
- Startup ACP/session-list notifications use the quiet renderer path when renderer delivery is optional.

## Non-Goals

- No IPC, preload, renderer UI, database, or migration changes.
- No changes to event payload shapes.
