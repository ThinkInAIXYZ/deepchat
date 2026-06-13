# PR 1765 Review Followups Plan

## Approach

Apply small, verifiable cleanup changes and leave the larger IPC-route migration suggestions as
documented follow-up work. The remaining direct IPC registrations are tied to window identity,
window chrome coordination, floating-widget control, or the splash unlock flow.

## Changes

- Remove a stale presenter comment that referenced `DEFAULT_RENDERER_EVENTS`.
- Remove unused main-process event constants that no longer have runtime consumers.
- Remove the unused floating-button `CONFIG_UPDATE` preload listener and exposed type.
- Export the remaining renderer API clients from the barrel module.
- Tighten the migrated raw-channel baseline by removing the obsolete `App.vue` allowance while
  documenting the remaining window presenter allowance.
- Document the singleton assumption behind the cached main-kernel route runtime.

## Deferred

- Floating button IPC route migration.
- Window identity and chrome IPC route migration.
- Splash database unlock route migration.
- Legacy presenter type extraction.
