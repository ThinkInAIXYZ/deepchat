# Plan — Floating Button Position Persistence

## Approach

Stop persisting live window bounds via `electron-window-state` for the floating button.
Instead persist the **logical resting position** — the snapped, fully-on-screen docked
rectangle plus its dock side — through `configPresenter` (electron-store), and restore it
on window creation, re-clamped to the current display.

The presenter already computes the correct resting rectangle on drag end
(`snapWidgetBoundsToEdge` → `snapped`), which is fully visible and edge-docked. That is
exactly the value we persist, so the off-screen-reset problem disappears.

## Data Model

New shared type (`src/shared/types/floating-widget.ts`):

```ts
export type FloatingWidgetDockSide = 'left' | 'right'

export interface FloatingButtonBounds {
  x: number
  y: number
  dockSide: FloatingWidgetDockSide
}
```

Stored under config key `floatingButtonBounds`. `x` is stored for completeness; on restore
`x` is recomputed from `dockSide` + current work area so the widget always docks to an edge
even after a resolution change. The meaningful restored values are `y` + `dockSide`.

## Components & Changes

- `src/shared/types/floating-widget.ts`: add `FloatingWidgetDockSide`, `FloatingButtonBounds`.
- `src/main/presenter/floatingButtonPresenter/layout.ts`: re-use shared `FloatingWidgetDockSide`
  (single source of truth; existing imports keep working via re-export).
- `src/main/presenter/configPresenter/index.ts`: add `getFloatingButtonBounds()` /
  `setFloatingButtonBounds(bounds)` using the generic `getSetting`/`setSetting`.
- `src/shared/types/presenters/legacy.presenters.d.ts`: declare both methods on `IConfigPresenter`.
- `src/main/presenter/floatingButtonPresenter/FloatingButtonWindow.ts`:
  - Remove `electron-window-state` usage.
  - Accept persisted bounds via constructor (`persistedBounds: FloatingButtonBounds | null`).
  - `resolveInitialBounds()` restores from persisted bounds: pick nearest display, re-dock
    `x` from `dockSide`, clamp `y` into work area; fall back to default placement otherwise.
  - Prefer persisted `dockSide` for the initial `dockSide`.
- `src/main/presenter/floatingButtonPresenter/index.ts`:
  - On `createFloatingWindow()` read `configPresenter.getFloatingButtonBounds()` and pass it in.
  - On `DRAG_END`, after computing `snapped`, persist
    `{ x: snapped.x, y: snapped.y, dockSide: snapped.dockSide }`.

## Event Flow

- Save: renderer drag → `DRAG_END` IPC → presenter snaps → `configPresenter.setFloatingButtonBounds`.
- Restore: app start → `createFloatingWindow` → `getFloatingButtonBounds` → `new FloatingButtonWindow(config, bounds)`
  → `resolveInitialBounds`.

## Compatibility

- Backward compatible: missing `floatingButtonBounds` → default placement (first run / upgrade).
- The stale `floating-button-window-state.json` file is simply no longer read; no migration needed.

## Test Strategy

- Unit (presenter, `test/main/presenter/floatingButtonPresenter/index.test.ts`):
  - Extend the mock `configPresenter` with `getFloatingButtonBounds`/`setFloatingButtonBounds`.
  - Assert `setFloatingButtonBounds` is called with the snapped docked bounds + dock side on `DRAG_END`.
  - Assert `getFloatingButtonBounds` is read during initialization.
- Existing layout/drag tests must continue to pass unchanged.

## Risks

- Low. Pure main-process change behind an existing persistence mechanism. No renderer/IPC
  surface change, no new dependency, no data migration.
