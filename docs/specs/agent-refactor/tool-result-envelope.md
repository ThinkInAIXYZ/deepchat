# Tool Result Envelope

This document defines the target tool-result protocol. The current implementation adds the envelope to Agent tool `rawData.toolResult` at the ToolPresenter boundary while keeping legacy `rawData.content` unchanged for provider-facing model context.

## Shape

```ts
type AgentToolResult = {
  ok: boolean
  summary: string
  data?: unknown
  meta?: {
    truncated?: boolean
    nextOffset?: number
    offloadPath?: string
    tokenEstimate?: number
    resultCount?: number
  }
  error?: {
    code: string
    message: string
    recoverable?: boolean
  }
}
```

## Success

Successful tools set `ok: true`, provide a short model-readable `summary`, and put structured payloads in `data`.

Examples:

```json
{
  "ok": true,
  "summary": "Found 12 matches in 3 files.",
  "data": {
    "matches": []
  },
  "meta": {
    "resultCount": 12,
    "truncated": false
  }
}
```

## Errors

Failed tools set `ok: false`, provide a short summary, and include a stable `error.code`.

```json
{
  "ok": false,
  "summary": "Invalid arguments for edit.",
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "oldText is required.",
    "recoverable": true
  }
}
```

## Truncation

Tools that return partial data set `meta.truncated: true`. If the same tool can continue from a position, it also sets `meta.nextOffset`.

Renderer display:

- Show the `summary` in compact cards.
- Show truncation and next-page affordances from `meta`.
- Keep `data` available for rich views, but do not require the renderer to parse provider-facing prose.

Model-readable behavior:

- Always include the `summary`.
- Include enough `data` for the next likely model step.
- Prefer pagination over returning huge blobs.

## Offload

Large outputs may be written to an offload file and represented by `meta.offloadPath`.

Rules:

- `summary` must explain what was offloaded.
- `data` may contain a preview.
- The offload path must be readable by the canonical `read` tool when the session has access.

## Batch Results

When multiple tool calls are executed in one model round:

- Preserve the model's original tool-call order in returned tool messages.
- Each tool message contains one envelope.
- Parallel execution must not reorder renderer updates or provider-facing tool result messages.

## Renderer Contract

The renderer should treat the envelope as the stable display protocol:

- `ok` controls success/error styling.
- `summary` powers the collapsed text.
- `data` feeds rich tool-specific rendering.
- `meta` handles pagination, truncation, and offload UI.
- `error` provides retry hints and diagnostics.

## Migration Notes

1. Canonical Agent tools now receive an envelope through `rawData.toolResult` unless a tool already provides a specialized `toolResult`.
2. Legacy raw tool output remains available through `rawData.content`.
3. Renderer cards can migrate to the envelope without changing provider-facing tool messages.
4. MCP passthrough tools and external servers can be extended after renderer support lands.
