# Sheet Close Button Drag Region

## User Need

Sheet close buttons must remain clickable inside draggable Electron windows. The MCP server detail
sheet and nested MCP tool sheet both use the shared sheet close button, so fixing the shared button
should restore both close actions.

## Acceptance Criteria

- The shared sheet close button opts out of Electron window dragging.
- MCP detail and tool sheet close buttons remain in the same visual position.
- The fix does not change sheet open/close state ownership.
