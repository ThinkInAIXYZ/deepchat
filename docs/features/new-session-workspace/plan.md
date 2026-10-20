# Implementation plan

- [x] Add renderer-owned hidden draft allocation, adoption, and safe disposal through typed IPC.
- [x] Connect the new-session button, shortcut, selected project, and file-reference insertion to
      the existing panel; preserve ACP behavior and first-message submission semantics.
- [x] Review draft isolation, navigation races, initialization failure, attachment recovery, and
      native browser cleanup/focus; add the smallest durable regression coverage.
- [x] Run format, i18n, lint, typecheck, focused main/renderer tests, and Electron smoke checks.

## Validation

- `pnpm run build`, format, i18n, lint, and typecheck passed.
- Focused main suites: 396 tests passed. Focused renderer suites: 218 tests passed.
- Electron smoke: browser routes, workspace routes, and the new-session workflow passed (3 tests).
- The workflow covers the closed initial state, typed shortcut command, manual opening, file
  reference insertion, file preview, browser page identity and edited page state across submission,
  and returning to a new conversation with the panel closed.
- Native shortcut registration is covered by the main shortcut suite. Smoke injects its typed IPC
  event to avoid host-window focus races. Physical keys and Windows/Linux were not manually tested.
