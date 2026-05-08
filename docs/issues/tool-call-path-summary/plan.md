# Tool Call Path Summary Plan

## Approach

- Extend the shared tool call summary helper with optional tool context.
- Prefer tool-specific fields before falling back to the existing summary extraction.
- Pass the current tool name from the renderer tool call block and remote trace renderer.

## Affected Paths

- Collapsed tool call pill summaries in chat messages.
- Remote process trace lines generated from tool calls.

## Compatibility

- Existing helper callers remain valid because the context argument is optional.
- Missing or non-string `path` values fall back to the previous generic summary.
