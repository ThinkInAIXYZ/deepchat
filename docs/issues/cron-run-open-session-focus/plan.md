# Implementation Plan

- Reuse existing `focusMainWindow()` before resolving the target window.
- Resolve `windowPresenter.mainWindow` after focusing, because that getter follows focus.
- Keep the existing `activateSession(webContentsId, sessionId)` path.
- Add a dispatcher regression test where Settings is focused before opening the run session.
