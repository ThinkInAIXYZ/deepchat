# Chat and Markstream Rendering Pipeline

## Ownership

DeepChat pins `markstream-vue@2.0.6` and uses its built-in enhanced code-block path through
`stream-diffs`. `markdownWorkerLifecycle` lazily creates the `@pierre/diffs` worker pool and injects it
with `setStreamDiffsWorkerPool` so highlighting can execute outside the renderer main thread.

```text
provider events
  -> main accumulator
  -> renderer snapshot throttle (120 ms)
  -> chat.stream.updated schema and request/Session ordering gate
  -> stream store and persisted-message projection
  -> ordered display list and outer message window
  -> MessageBlockContent artifact projection
  -> MarkdownRenderer segments
  -> Markstream pacing, parse coalescing, node batching, and heavy-node deferral
  -> DOM measurement and scroll controller
```

Main owns snapshot coalescing and the 600 ms database flush schedule. Markstream owns visible text
pacing. Streaming content and the final snapshot bypass DeepChat's static-content debounce; stale
callbacks cannot overwrite final content. Non-streaming editable document/artifact surfaces retain
length-adaptive debounce.

## Rendering Segments

Short streams and streams without a safe split render as one streaming document. Longer streams may
render a committed static prefix and a live tail. The split advances at a blank-line boundary while
avoiding an open code fence. A long paragraph or fence can prevent advancement, so the tail target
is not a strict length bound. Completion resets the split and renders one final static document.

The committed prefix uses final/static flags and incremental mounting. The live tail uses
`final=false`, `codeBlockStream=true`, simple CSS typewriter behavior, and no live node window. The
same outer message row and MarkdownRenderer retain their product identity even when internal
NodeRenderer segments change. Splitting must preserve Markdown semantics, ordering, selection,
search, and capture access.

Completed content uses Markstream's node virtualization and viewport deferral. The outer message
window owns message-row geometry; Markstream owns Markdown-node work. Search, capture, and other
full-DOM consumers use `virtualizeNodes=false`, which must disable both virtual cropping and visible
node deferral for every applicable segment.

## Code, Links, and Heavy Nodes

- Ordinary fenced code uses the built-in `CodeBlockNode` path. Streaming nodes display its lightweight
  code surface; completed eligible nodes may mount the enhanced `stream-diffs` surface.
- Do not set the removed `codeRenderer` selector or force an application-level pre/enhanced remount.
  `codeBlockStream` and `final` communicate each segment's state.
- Do not override generic `code_block` through the global custom-component registry. Link/reference
  interaction uses renderer-level delegation, code previews use the public artifact-click event,
  and Mermaid remains strict.
- Instance and segment ids isolate Markstream measurement identity. Multiple text/artifact parts of
  one message cannot overwrite each other's renderer registration.
- Heavy code, Mermaid, and KaTeX work stays eligible for viewport deferral unless the consumer
  explicitly requests full DOM.
- The simple streaming cursor avoids precise-cursor layout reads on every visible text commit.

## Snapshot and Display Contracts

The stream store replaces whole snapshots through shallow state. Already-validated blocks prefill
the renderer parsed cache when the message record is updated, avoiding an immediate second JSON
parse. Stable assistant blocks and unaffected display conversions remain reusable.

Main retains JSON normalization and schema parsing in `cloneBlocksForRenderer`, including the
compatibility behavior of undefined values in extra payloads. Preload and renderer event validation
remain trust boundaries. Persisted messages retain their JSON format.

`chat.stream.updated` remains a full cumulative snapshot. Its repeated validation and cross-process
copying are potential long-output costs requiring measurement; this contract does not introduce a
delta transport or permit removing validation. The outer display list preserves `messageIds` order,
and the message window limits mounted rows independently of Markdown segmentation.

## Performance and Validation Boundaries

The main renderer throttle allows about 8.3 snapshots per second. Integration adds no extra streaming
content timer. Parse, mount, and live-node tuning belongs to the current renderer implementation;
constants are not independent evidence that a user latency budget has been met.

The [Chat Scroll Ownership](../chat-scroll-ownership/spec.md) requirements remain in force: at most
one viewport write per frame, at most 1 CSS pixel reading-anchor drift, and no added presentation
long task above its budget. Real Chromium/Electron observations are required for these claims.

Regression protection covers final-content handoff, code fallback/enhancement, strict Mermaid,
link/reference behavior, record parsing, ordering, and full-DOM consumers. Search/capture and long
single-block cases must retain their behavior under segmentation. No current full-suite pass or
physical-display performance result is implied by this specification.
