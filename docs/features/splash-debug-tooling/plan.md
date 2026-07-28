# Splash Debug Tooling Plan

## Module Decomposition

| Module | Responsibility | Inputs | Outputs |
| --- | --- | --- | --- |
| Shared route/event contracts | Define validated preview commands and the one-way Splash mode event | preview enum | typed bridge route names and `splash:debug-mode` payload |
| Debug client/page | Present development controls and request show/close operations | user click | typed route invocation and unavailable feedback |
| Main debug routes | Reject production/package calls and delegate permitted commands | validated route input | `{ shown }` / `{ closed }` |
| SplashWindow | Create/reuse, load, show, replay mode to renderer, and close debug preview | debug mode | splash BrowserWindow and preload event |
| Splash preload/renderers | Receive mode and select visual state safely | `SplashDebugMode` | Vue or inline fallback presentation |

## Integration Tasks

1. Add `debug.showSplashScenario` and `debug.closeSplashScenario` to shared typed route contracts,
   renderer debug client, and the route registry.
2. Keep the `SplashWindow` instance available after startup through the application composition so the
   debug route can create/reuse it without coupling Settings code to Electron windows.
3. Implement `SplashWindow` preview state replay and a main-to-splash `splash:debug-mode` event. The
   current raw `SPLASH_START_ANIMATION_CHANNEL` draft is removed because it has no defined behavior.
4. Expose only an `onDebugMode` listener in the context-isolated splash preload. Implement the same
   state selection in the Vue splash renderer and inline fallback.
5. Add the Debug-page preview controls, including close and busy/unavailable handling.
6. Add focused contract and integration tests, then run repository validation.

## Required Main-Process Gate

Every typed debug route must check `!import.meta.env.DEV || app.isPackaged` before delegating. The
route output uses `false` rather than throwing for a denied debug operation, matching existing Debug
controls. Unknown modes are rejected by Zod route input validation.

## Verification

- Shared route / dispatcher tests prove invalid modes are rejected and production/package requests do
  not reach SplashWindow.
- SplashWindow tests prove a requested mode is held until the splash renderer loads, replays after a
  reload, and that close clears debug state without interfering with real unlock state.
- Preload boundary tests prove only the scoped `splash:debug-mode` subscription is exposed.
- Renderer tests prove each preview visual mode and the disabled manual-unlock form.
- Debug Settings tests prove all actions call the typed Debug client and correctly disable while busy.
- Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, relevant typechecks, and focused suites.
