# Hooks Settings Clone Error

## User Need

Users can open and edit the notifications hooks settings page without Electron IPC failing with `an object could not be cloned`.

## Problem

The hooks settings page stores the editable configuration in Vue reactive state. Save operations pass that reactive object directly into `config.setHooksNotifications`. Electron IPC uses the structured clone algorithm and cannot clone Vue reactive proxies, causing the settings page to fail when adding, toggling, editing, or testing hooks.

## Goal

Ensure hooks notification settings sent over IPC are plain structured-cloneable data.

## Acceptance Criteria

- Adding a hook saves without `an object could not be cloned`.
- Toggling enabled state, changing events, editing name, and editing command save without clone errors.
- Testing a hook still persists pending edits before running the test.
- The fix does not change the persisted hooks schema or user-visible settings behavior.

## Constraints

- Keep the change minimal and localized to the hooks settings flow unless a shared utility is already established nearby.
- Preserve route contract validation in preload/main.
- Do not weaken validation or accept unsupported hook events.

## Non-Goals

- Redesigning the hooks settings UI.
- Changing hook execution behavior.
- Migrating stored configuration format.

## Open Questions

None.
