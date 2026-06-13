# Vite Presenter Dynamic Import Warning

## Problem

Starting the development build emits a Vite warning because
`src/main/presenter/devicePresenter/index.ts` dynamically imports
`src/main/presenter/index.ts`, while that same presenter registry is also statically imported by
the main process graph.

Vite cannot split the dynamically imported module into a separate chunk in this case, so the dynamic
import adds noise without changing the bundle shape.

## Requirements

- Remove the dynamic import from `DevicePresenter`.
- Keep `resetDataByType()` behavior unchanged for SQLite and Knowledge cleanup.
- Avoid introducing a static import from `DevicePresenter` back to the presenter registry.
- Verify the original Vite warning no longer appears during `electron-vite build`.

## Non-Goals

- Refactor the full presenter registry.
- Change reset UX or restart behavior.
- Address unrelated renderer chunk-size warnings.
