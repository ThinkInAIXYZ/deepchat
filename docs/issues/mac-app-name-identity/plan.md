# macOS App Name Identity Plan

## Implementation

- Update the main-process startup path in `src/main/appMain.ts` to set the Electron application name to
  `DeepChat` before the app creates windows or menus.
- Ensure the macOS process advertises itself as a regular foreground app and reveals its Dock identity
  before startup windows attempt to take focus.
- Keep the change scoped to startup identity only, avoiding any unrelated menu, dock, or window policy
  changes unless verification shows they are required.

## Validation

- Run a node-side typecheck or equivalent narrow validation for the touched startup file.
- Run repository-required format, i18n, and lint checks before handoff.
