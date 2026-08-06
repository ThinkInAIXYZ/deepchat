# MCP Generated Image Persistence And Reuse

## Issue

An MCP image-generation tool can return a temporary signed image URL inside ordinary text, for
example:

```text
Success. Image URL(s): https://cdn.example.com/generated/output.jpeg?Expires=...
```

DeepChat can persist that URL as tool text and let the model repeat it in final assistant Markdown.
The image works until the signature expires, but reopening the session later shows a broken image.
The affected session `CsgqML2Q3tzCVTn_0ZUvX` contained no persisted image block, no
`imagePreviews`, and no local cache asset; its signed URL expired after 24 hours and then returned
HTTP 403.

A persistence-only fix must not discard the model's image reference. Follow-up requests such as
"change the background" need a stable reference that the model can pass to an image-editing tool.

## Impact

- Generated images disappear after URL expiry or an application restart after expiry.
- A locally cached image and a repeated Markdown image can render twice.
- Rewriting persisted assistant Markdown after generation would change provider-visible history
  and can invalidate the stable prefix used by provider KV/prompt caching.
- Replacing the URL with a reference-free marker such as `[Image: image/jpeg]` prevents the model
  from identifying the source image in a later edit request.
- Tool output can incorrectly imply that an image was saved locally when no durable asset exists.
- A remote MCP server can make the main process download a loopback, link-local, or private-network
  URL by returning it as an image reference.
- An MCP result with many image references or large responses can consume unbounded time, memory,
  and disk space during automatic caching.
- A repeated `imgcache://` tool argument can expand a small model response into an excessively large
  MCP request.

## Root Cause

`extractToolCallImagePreviews` recognizes structured MCP image items, data URLs, whole-string image
URLs, and image references stored as JSON values. It does not inspect ordinary prose in either a
string result or an MCP `text` content item for embedded HTTP(S) image URLs.

The failure path is:

1. The MCP server returns a text item containing a signed image URL.
2. `McpService.callTool` extracts previews from the original MCP content array before formatting it.
3. The extractor ignores the text item, so `cacheImage` is never called.
4. No `imgcache://` preview is promoted to a durable assistant image block.
5. The original tool response exposes the signed URL to the next provider round.
6. The model can repeat the URL as final Markdown, and both the tool response and Markdown are
   persisted unchanged.

The renderer is behaving correctly: it reloads the persisted remote URL, which is no longer
authorized by its origin.

The original cache helper also assumes that callers already trust remote URLs and response
metadata. Automatic MCP text scanning crosses that trust boundary: it can pass MCP-controlled URLs
to Axios without restricting network destinations, redirects, response size, or response MIME
type. The extraction loop has no distinct-image cap, and aborting its caller stops waiting without
cancelling the active HTTP request.

Two additional normalization paths are insufficiently bounded. Global `replaceAll` can rewrite a
valid image URL when it appears as the prefix of a different URL, and execution-only argument
resolution has a per-file limit but no reference-count or aggregate serialized-size limit.

## Behavioral Contract

After a successful download, `imgcache://` is the stable image reference shared by the model-facing
tool result, persisted presentation blocks, and later model-generated tool arguments. It is an
opaque application URI, not an operating-system path.

The model does not need to read the URI itself. It only needs to preserve it when selecting the
source image. Immediately before an MCP tool is invoked, DeepChat resolves an exact
`imgcache://...` argument value to a `data:image/...;base64,...` value that a reference-capable image
tool can consume.

The canonical transcript remains stable:

- The temporary URL is replaced before the provider sees the tool result for the first time.
- The resulting `imgcache://` tool response is persisted exactly as submitted to the provider.
- The model-generated tool-call arguments retain `imgcache://`; only a cloned execution payload is
  resolved to image bytes.
- Assistant Markdown is never edited after generation.
- Presentation-only `image` blocks and Markdown deduplication do not participate in
  `recordToChatMessages`.
- Remote HTTP and SSE MCP servers may cache only public HTTP(S) image destinations. Every redirect
  target is checked under the same policy. Local stdio, in-memory, and managed plugin runtimes may
  use private-network image URLs for local generators.
- One tool result caches at most four distinct image references. Each image is limited to 8 MiB,
  and the caller's cancellation signal reaches the underlying HTTP request.
- Only supported image MIME types become durable cache entries. The saved extension and later data
  URL use the same MIME mapping.
- Content normalization replaces only complete extracted URL tokens, never prefix occurrences in a
  different URL.
- One MCP call resolves at most eight cached-image argument occurrences and rejects a serialized
  execution payload above 32 MiB. Repeated references reuse one disk read but still count toward the
  final payload limit.

These rules preserve the byte-identical provider prefix required by the
[cache-aware context runtime](../../architecture/cache-aware-context-runtime/spec.md).

## Fix Plan

### 1. Cache And Normalize MCP Image Output

1. Extend tool image preparation to inspect both string results and every MCP `text` content item.
   Tokenize embedded HTTP(S) URLs, parse them with `URL`, and accept only paths ending in a supported
   image extension. Query strings and fragments must not affect extension detection.
2. Deduplicate source references before downloading them. Keep the original match internally so
   the same extraction pass can return both cached previews and normalized provider content without
   adding a new persisted asset entity.
3. Treat an image as durable only when caching returns an `imgcache://` reference different from the
   source URL. Replace each successfully cached source URL in provider-facing content with that
   local reference. Do not replace anything when caching fails.
4. In `McpService.callTool`, return normalized content through both the top-level `content` field and
   `rawData.content`. DeepChat dispatch and deferred execution stage `rawData.content`, not the
   top-level field.
5. Preserve `toolCallResult.mcpResult` unchanged. It remains the bounded raw MCP protocol record for
   diagnostics and MCP App behavior; normal provider history uses the normalized
   `tool_call.response`.

### 2. Resolve Local References For Follow-Up Tool Calls

1. Extend the centralized MCP argument-preparation path before `client.callTool`.
2. Walk arrays and objects in a cloned arguments value. Resolve only string values whose entire
   trimmed value is an `imgcache://` URI; never rewrite an occurrence embedded in a prompt or other
   prose.
3. Resolve the URI only inside DeepChat's `userData/images` directory, reject traversal, missing
   files, unsupported image types, and payloads above the existing MCP image transport limits.
4. Convert a valid cached image to a MIME-correct data URL and place it only in the execution clone.
   Keep the model-produced `imgcache://` arguments in the assistant block and persisted transcript.
5. Abort the tool call with a specific, recoverable error if the local asset is unavailable or the
   target tool rejects data URLs. Do not silently fall back to the expired source URL.

This guarantees continued reuse for image tools that accept data URLs. Tools that require a public
HTTPS URL would need a separate upload adapter; this issue does not add an upload service.

### 3. Render One Durable Image

Reuse the existing image-preview promotion path so a successful cache creates a durable assistant
`image` block backed by the same `imgcache://` reference.

The model may also include that reference in final Markdown. At the
[display-model boundary](../../architecture/chat-display-model-boundary/spec.md), collect promoted
image references for the message and pass them to the existing Markdown parser hook. Suppress only
Markdown image nodes whose source exactly matches a promoted local image. Do not modify the source
Markdown string or ordinary links.

```text
BEFORE

Assistant response
├── generated image block: [local image]
└── Markdown image:         [same image again]

AFTER

Assistant response
└── generated image block: [local image]
```

If Markdown contains no matching image node, the promoted image block remains visible. If no
promoted block exists, Markdown rendering is unchanged.

### 4. Bound Automatic Downloads And Follow-Up Expansion

1. Pass the originating MCP transport class into image caching. Treat stdio, in-memory, and managed
   plugin runtimes as local; treat HTTP, SSE, and unknown sources as remote.
2. For remote sources, reject loopback, link-local, private, reserved, multicast, and unspecified
   IPv4 or IPv6 targets. Disable automatic redirects, validate each redirect explicitly, and pin the
   validated DNS result used by the connection.
3. Limit automatic caching to four distinct images per tool result. Apply one 10-second budget and
   an 8 MiB response limit to each image, pass cancellation to Axios, and preserve the original URL
   whenever caching safely fails.
4. Accept only the supported image MIME map when writing URL or data-URL cache files. Never default
   unknown content to JPEG.
5. Normalize text with the same HTTP tokenization used for extraction. Replace a token only when its
   complete normalized value has a successful cache mapping.
6. Memoize exact cached-image argument resolution per MCP call. Reject more than eight occurrences
   or an execution payload above 32 MiB before invoking the client.

## End-To-End Data Flow

```text
MCP result
  temporary HTTPS URL
          |
          v
DeepChat cache
  imgcache://img_123.jpg
       |                 \
       |                  +--> persisted image block --> renderer
       v
provider tool result
  imgcache://img_123.jpg
       |
       v
model follow-up tool call
  { "image": "imgcache://img_123.jpg" }
       |
       | execution-only resolution
       v
MCP image-edit tool
  { "image": "data:image/jpeg;base64,..." }
```

The raw MCP result can retain the original HTTPS URL, but the provider transcript and presentation
use the stable local reference from their first persisted form onward.

## Constraints And Non-Goals

- Do not post-process, replace, or remove URLs from already-generated assistant Markdown.
- Do not send image base64 through normal provider history; only tool execution receives it.
- Do not expose an operating-system path or allow `imgcache://` to escape the image-cache root.
- Do not rewrite partial URI occurrences inside arbitrary tool argument strings.
- Do not scan arbitrary HTTP(S) links as images or add provider-specific output parsing.
- Do not add a database table, migration, dependency, setting, or user-facing copy.
- Do not expose private-network fetching to remote MCP servers or add a user-configurable SSRF
  bypass.
- Do not introduce a general-purpose download-policy framework; keep these limits at the image-cache
  and MCP execution boundaries that own the data.
- Do not add a public-image upload service for tools that accept only HTTPS references.
- Do not backfill existing sessions. If the source URL expired before it was cached, the image bytes
  are unavailable and regeneration is required.
- No GitHub issue is created or synchronized for this local specification.

## Acceptance Criteria

1. A signed image URL embedded in a string result or MCP text item is detected when its pathname has
   a supported image extension, including when it has a query string or fragment.
2. A successful cache produces one deduplicated `imgcache://` preview and one promoted image block
   that still loads after DeepChat restarts and the remote URL expires.
3. The provider-facing tool response contains the stable `imgcache://` reference instead of the
   temporary URL from its first submission onward; persisted `tool_call.response` is identical.
4. The raw `mcpResult` retains the original MCP content within existing persistence limits.
5. A follow-up MCP tool call can pass the local reference in a nested argument. The outbound
   execution payload contains the corresponding data URL while persisted tool-call arguments retain
   `imgcache://`.
6. Missing, invalid, traversing, oversized, or unsupported cached references fail without invoking
   the MCP tool.
7. A matching Markdown image and promoted image block render as one image without changing the
   stored Markdown; unrelated Markdown images and links remain visible.
8. `recordToChatMessages` returns byte-identical live and restart history after presentation
   deduplication and tool-argument resolution.
9. Cache failure preserves the original tool result and creates no false durable image reference.
10. Existing structured MCP images, JSON image references, whole-string URLs, data URLs, CDP
    screenshots, cancellation, tool permissions, and result-size handling remain unchanged.
11. A remote MCP image URL resolving to loopback, link-local, or private address space is not fetched,
    including when a public URL redirects to that destination; local MCP transports retain local URL
    support.
12. Automatic caching processes at most four distinct references, rejects responses and data URLs
    above 8 MiB, and aborts the active network request when the tool turn is cancelled.
13. Supported response MIME types retain matching extensions, while HTML, JSON, octet-stream, and
    unknown responses remain uncached.
14. A cached `https://host/a.png` token does not alter a distinct
    `https://host/a.png.json` occurrence.
15. Repeated cached-image arguments perform one disk resolution and fail before MCP dispatch when
    reference-count or 32 MiB serialized-payload limits are exceeded.

## Task Checklist

- [x] Extract embedded image URLs from string and MCP text-item output.
- [x] Return cached previews and normalized provider content from one pass.
- [x] Persist `imgcache://` through both `McpService.callTool` result fields while preserving raw
      `mcpResult`.
- [x] Resolve exact local-image arguments in an execution-only MCP argument clone.
- [x] Add safe cache-root, MIME, size, missing-file, and cancellation handling.
- [x] Suppress matching Markdown image nodes at the display-model boundary without changing source
      content.
- [x] Add focused extraction, MCP-service, argument-resolution, presentation, and context tests.
- [x] Verify restart-equivalent context replay and follow-up edit argument resolution without the
      source URL.
- [x] Run formatting, i18n, lint, type checking, and focused tests.
- [x] Enforce transport-aware network destination and redirect validation for MCP image downloads.
- [x] Bound automatic image count, response size, total request time, and underlying cancellation.
- [x] Preserve supported MIME types and reject non-image responses.
- [x] Replace only complete extracted HTTP URL tokens.
- [x] Memoize cached-image argument resolution and enforce reference-count and aggregate-size limits.
- [x] Add focused security, resource, normalization, and argument-expansion regression tests.
- [x] Re-run formatting, i18n, lint, type checking, and focused tests after hardening.

## Validation

```bash
pnpm exec vitest run --config vitest.config.ts \
  test/main/lib/toolCallImagePreviews.test.ts \
  test/main/mcp/mcpService.test.ts \
  test/main/mcp/toolManager.test.ts \
  test/main/platform/imageCache.test.ts \
  test/main/agent/deepchat/runtime/dispatch.test.ts \
  test/main/agent/deepchat/runtime/contextBuilder.test.ts \
  test/renderer/components/MarkdownRenderer.test.ts \
  test/renderer/components/message/MessageBlockContent.test.ts \
  test/renderer/components/message/MessageItemAssistant.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

Validation completed on 2026-08-06:

- The nine focused test files pass with 301 tests, including persisted context reconstruction,
  transport-aware SSRF rejection, bounded caching, exact URL replacement, and execution-only
  local-image resolution limits.
- Formatting, i18n validation, linting, and node/renderer type checking pass.

A release smoke test should generate an image through an MCP text response, record the local cache
file, restart DeepChat, make the source URL unavailable, and confirm that exactly one image still
renders. A follow-up edit should reuse the displayed `imgcache://` reference while the actual MCP
request receives image data rather than a local URI.
