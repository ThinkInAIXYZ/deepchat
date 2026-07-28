# Splash Debug Tooling

## User Need

Developers need a discoverable, development-only way to open and inspect startup splash states after
application startup, without changing production behavior or using real database credentials.

## Goals

- Add Splash preview controls to the development-only Settings > Debug page.
- Support `loading`, `system-unlock`, and `unlock` preview modes.
- Keep the command path typed and explicit:

  ```text
  Settings Debug page -> typed renderer bridge route -> main dev gate -> SplashWindow -> splash preload event -> splash renderer
  ```

- Let developers close an open preview from the Debug page.
- Preserve real startup and database-unlock ownership, validation, and sender restrictions.
- Keep the existing dev URL, file, and inline fallback splash renderers able to display every preview
  state.

## Scope and Safety Constraints

- The Debug menu and route controls remain visible only in development builds.
- The main-process typed routes are the authoritative gate: they return `{ shown: false }` or
  `{ closed: false }` whenever `!import.meta.env.DEV || app.isPackaged`.
- Preview requests use only the enum `loading | system-unlock | unlock`; unknown modes fail route
  validation before reaching `SplashWindow`.
- Preview modes do not create a database unlock request, access safeStorage, mutate database-security
  state, or send password data.
- The manual-unlock preview is visually representative but non-submittable: its password field and
  actions are disabled and it explains that it is a development preview.
- Preview-only main-to-splash communication uses a distinct `splash:debug-mode` event. The event is
  main-to-splash only; it is not exposed as a renderer-to-main raw IPC command.
- There is no `splash:start-animation` contract: CSS animation begins with the splash mode render and
  reduced-motion behavior remains controlled by renderer media queries.

## Debug Settings Layout

```text
Settings > Debug (development only)
┌─────────────────────────────────────────────────────────────────────┐
│ Debug tools                                                          │
│ Existing onboarding / mock-chat / mock-update controls              │
├─────────────────────────────────────────────────────────────────────┤
│ Splash previews                                                      │
│ [Loading] [System credential unlock] [Manual password unlock]       │
│ [Close preview]                                                      │
│ Opening a preview disables all Splash preview buttons until its      │
│ route resolves. Close preview is disabled while no preview is open. │
└─────────────────────────────────────────────────────────────────────┘
```

## Interaction Contract

| Input | Scope | Behavior |
| --- | --- | --- |
| Loading | Settings > Debug | Opens/reuses SplashWindow, selects `loading`, and shows it as soon as its renderer is ready. |
| System credential unlock | Settings > Debug | Opens/reuses SplashWindow and selects the safe `system-unlock` visual state. |
| Manual password unlock | Settings > Debug | Opens/reuses SplashWindow and selects a non-submittable `unlock` visual preview. |
| Close preview | Settings > Debug | Closes a debug-opened SplashWindow immediately; it never changes normal startup sequencing. |

## State and Fallback Behavior

- `SplashWindow` retains the latest requested debug mode until its renderer finishes loading, then
  emits it through the preload boundary. It re-emits the latest mode after a renderer reload. The splash
  preload retains the latest received mode and synchronously replays it when either renderer subscribes,
  so the event remains safe when renderer initialization follows document load.
- Selecting a new mode while the preview is open updates the existing window in place.
- Closing a preview clears only debug-preview state; it does not resolve or modify a real unlock
  request.
- The Vue splash renderer receives the mode through its preload subscription. It sets the visible
  branch directly and marks only manual-unlock debug mode as preview-only.
- The inline fallback renderer receives the same event and can render loading, system-unlock, and the
  disabled manual-unlock preview. It must retain existing real unlock IPC behavior.
- The splash BrowserWindow canvas and document root are transparent for loading and system credential
  unlock states, so their visual effects do not appear inside an opaque rectangular backdrop. Manual
  password unlock intentionally retains an opaque readable background behind its form.

## Typed Route Contract

- `debug.showSplashScenario({ mode }) -> { shown: boolean }`
- `debug.closeSplashScenario({}) -> { closed: boolean }`

Both routes use the existing DeepChat typed bridge and must be main-process development-gated. The
renderer treats `false` as unavailable and shows the existing Debug-page error feedback.

## Acceptance Criteria

- Development Settings > Debug presents all three Splash preview controls and a close control.
- Production and packaged apps neither expose the controls nor perform preview operations when routes
  are invoked directly.
- A selected preview is visible after SplashWindow loading and works on Vue and inline fallback
  renderers.
- Debug manual-unlock preview accepts no password submission and does not affect real unlock state.
- Existing real loading, system credential unlock, and manual password unlock flows keep their
  behavior.
- Focused tests cover route input/gating, SplashWindow dispatch/loading replay, preload subscription,
  renderer modes, and Debug-page controls.
