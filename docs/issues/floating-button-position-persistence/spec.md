# Floating Button Position Persistence

## User Need

Users drag the floating button/widget to a comfortable spot on screen. After
restarting DeepChat, the button should reappear where they last left it. Today it
jumps back to the top-left corner of the primary display on every restart, which
feels broken.

## Goal

Persist the floating button's resting position (vertical offset + docked edge) and
restore it on the next launch, re-clamped to the current display's work area.

## Root Cause

The floating button previously relied on `electron-window-state` (`windowState.manage`)
to persist its position from live window bounds. This fails for an edge-docked widget:

- When idle/collapsed the widget rests in a **peeked** position with half of itself
  off the screen edge (`getPeekedCollapsedBounds`). `electron-window-state` records this
  off-screen rectangle.
- On the next launch `electron-window-state.validateState()` →
  `ensureWindowVisibleOnSomeDisplay()` sees `x + width > display.right`, treats the saved
  bounds as "not visible on any display", and **resets state to `{ x: 0, y: 0 }`**. The
  widget therefore snaps to the top-left corner.
- Secondary: the floating window is removed with `BrowserWindow.destroy()` (it is
  `closable: false`), which emits `closed` but not `close`. `electron-window-state`'s
  `closedHandler` cancels the pending debounced state update and writes stale state, so
  the final position before quit is unreliable even when it is on-screen.

## Acceptance Criteria

- After dragging the floating button and restarting the app, the button reappears on the
  same docked edge (left/right) and at the same vertical position (within work-area
  clamping).
- The restored position is always fully visible on a connected display; it never resets
  to the top-left corner.
- If the saved display/resolution changed, the button re-docks to the saved edge of the
  nearest current display and the vertical offset is clamped into the visible work area.
- First run (no saved position) keeps the existing default placement (bottom-right with
  configured offset).
- Existing drag, hover-peek, expand/collapse, and snapping behavior is unchanged.

## Constraints

- Persist via the existing `configPresenter` settings store (electron-store), consistent
  with other persisted settings; do not add a new dependency.
- Position persistence is a main-process concern only — no renderer route/IPC changes.
- Keep the stored shape minimal and forward-compatible.

## Non-goals

- Remembering the expanded panel size (it is derived from session count).
- Multi-monitor "remember which exact monitor" beyond nearest-display restoration.
- Changing the visual peek/snap/dock behavior.
