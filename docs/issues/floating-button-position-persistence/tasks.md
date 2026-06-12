# Tasks — Floating Button Position Persistence

1. [x] Add shared types `FloatingWidgetDockSide` + `FloatingButtonBounds`
       (`src/shared/types/floating-widget.ts`); re-use them in `layout.ts`.
2. [x] Add `getFloatingButtonBounds` / `setFloatingButtonBounds` to `configPresenter`
       and declare them on `IConfigPresenter`.
3. [x] `FloatingButtonWindow`: drop `electron-window-state`, accept persisted bounds,
       restore in `resolveInitialBounds` with work-area clamping.
4. [x] `FloatingButtonPresenter`: read persisted bounds on create and pass them in;
       persist snapped bounds on `DRAG_END`.
5. [x] Update `index.test.ts` mock config; add a persistence test for `DRAG_END`.
6. [x] Quality gates: `pnpm run format`, `pnpm run i18n`, `pnpm run lint`,
       `pnpm run typecheck`, `pnpm test` (floating button suites).
