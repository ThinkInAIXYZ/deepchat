# YoBrowser Activity Visualization Spec

## User Story

When an agent operates YoBrowser, users need a clear visual signal that the browser is under agent control, without noisy or fragile action-specific animations.

## Acceptance Criteria

- Agent-triggered YoBrowser tool actions show a transparent overlay above the embedded browser view.
- The overlay shows an active border halo while agent actions are pending and fades out after activity settles.
- The overlay uses only the border halo in V1; pointer, scroll, vision, keyboard, and navigation-specific animations are intentionally omitted.
- The overlay does not intercept mouse or keyboard input and does not modify the target page DOM.
- The overlay does not expose page text, Runtime expressions, screenshots, or user-entered text through activity events.
- Manual BrowserPanel toolbar actions do not trigger the agent halo.
- Motion is reduced when the renderer reports `prefers-reduced-motion`.

## Non-goals

- Adding new YoBrowser tool names or changing the existing tool contract.
- Mirroring third-party computer-use implementation details.
- Recording or replaying YoBrowser sessions.
- Adding a user-facing setting in V1.
- Rendering mouse cursor trails, scroll wheels, keyboard icons, or element boxes.

## Constraints

- Use DeepChat typed event contracts for app-wide activity notifications.
- Keep overlay rendering separate from the page DOM and the BrowserPanel DOM because YoBrowser is an Electron `WebContentsView`.
- Keep the implementation scoped to YoBrowser.
