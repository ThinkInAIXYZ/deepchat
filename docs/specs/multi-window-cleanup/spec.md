# Multi-Window Cleanup Spec

## Goal

Remove the last shell and multi-tab browser architecture remnants and converge on a clean
multi-window model:

- app windows render the chat UI directly
- browser windows render dedicated browser chrome directly
- each browser window owns exactly one page `WebContentsView`
- tooltip overlay is removed completely

## Decisions

### Window model

- `WindowPresenter` exposes explicit app-window and browser-window creation APIs.
- `createShellWindow` remains only as a deprecated compatibility wrapper.
- Browser windows load `src/renderer/browser/index.html`.
- Chat windows load `src/renderer/index.html#/chat`.

### YoBrowser model

- `YoBrowserPresenter` manages multiple browser windows.
- Each browser window has one browser chrome renderer and one page view.
- There is no tab list, no tab activation, no tab reordering, and no tab shortcuts.
- Browser APIs use `windowId` for addressing.

### Renderer model

- The old `src/renderer/shell` entry is renamed to `src/renderer/browser`.
- Browser chrome keeps only:
  - window controls
  - address bar
  - navigation controls
  - create-new-browser-window action
- Tooltip overlay entry/runtime is deleted.

### Legacy handling

- `conversationSearchServer` and `meetingServer` are intentionally disabled until they are rebuilt
  against the window-native architecture.
- Deprecated browser tool names remain as thin aliases only in the handler.

## Non-Goals

- Rebuilding every legacy session/thread abstraction in this pass.
- Introducing new UI entities beyond the required browser-window state.
