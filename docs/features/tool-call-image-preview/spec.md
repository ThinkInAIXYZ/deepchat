# Tool Call Image Preview

## Summary

Tool calls can return image output through structured MCP content, screenshot payloads, file reads, or explicit image URLs. The chat UI should keep existing params and response sections intact, then show a dedicated preview area below them when image output is available.

## Acceptance Criteria

- Existing params and response rendering stays in the same order and keeps current copy actions, diff rendering, terminal styling, and text output behavior.
- Tool call blocks may persist `tool_call.imagePreviews`, where each item includes `id`, `data`, `mimeType`, optional `title`, and a source value.
- Expanded tool blocks render image previews below the response section.
- Collapsed tool blocks show a compact image count badge when previews exist.
- Text-only tool output keeps the current UI.

## Data Flow

- Main process extracts image previews from tool output before response normalization.
- MCP structured image items use source `mcp_image`.
- `cdp_send` `Page.captureScreenshot` results use source `screenshot`.
- Agent `read` image results keep vision analysis in `response` and attach the original image as `file_read`.
- Image data is cached as `imgcache://` when an image cache function is available, with data URL and web URL fallbacks.

## Test Coverage

- Renderer tests cover collapsed image count, expanded preview placement, and image rendering.
- Main dispatch tests cover ordinary tool results with structured image output.
- Deferred tool execution tests cover image previews returned through `rawData`.
