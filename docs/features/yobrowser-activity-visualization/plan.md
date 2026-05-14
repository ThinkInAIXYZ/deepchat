# YoBrowser Activity Visualization Plan

## Architecture

- Add `browser.activity.changed` as a typed shared event carrying `sessionId`, optional `windowId`, action `id`, `kind`, `action`, `phase`, optional point/rect/direction metadata, and timestamp.
- Add a per-session transparent child `BrowserWindow` owned by `YoBrowserPresenter`; it follows the active YoBrowser bounds and receives activity payloads directly.
- Keep the overlay window pointer-transparent with `setIgnoreMouseEvents(true, { forward: true })`.
- Load a dedicated `browser-overlay` renderer entry that renders only the active border halo.

## Event Flow

- `YoBrowserToolHandler` marks only agent tool calls as activity sources.
- `YoBrowserPresenter.loadUrl(..., 'agent')` emits navigation activity.
- `YoBrowserPresenter.sendCdpCommand(..., 'agent')` maps CDP commands to pointer, scroll, vision, keyboard, or navigation activity.
- Presenter publishes the typed shared event and also forwards the payload to the active overlay window for that session.
- Overlay renderer maintains pending activity IDs, keeps the halo on while pending, and applies a short safety TTL for missing completion events.
- Overlay ignores action-specific metadata in V1; the metadata remains in the event for observability and future use.

## Compatibility

- Existing tool names and route contracts stay unchanged.
- BrowserPanel bounds sync remains the source of truth for YoBrowser and overlay placement.
- User-triggered BrowserPanel navigation remains visually unchanged in V1.

## Risks

- Native `WebContentsView` stacking can cover Vue DOM overlays, so the visual layer uses a transparent child `BrowserWindow`.
- Fast actions can complete before the overlay renderer is ready, so the overlay queues payloads until its web contents finishes loading.
