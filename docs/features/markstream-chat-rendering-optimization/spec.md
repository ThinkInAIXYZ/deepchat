# MarkStream Chat Rendering Optimization Spec

## User need

DeepChat's assistant messages can stream long Markdown responses with code blocks, Mermaid diagrams, tables, references, and search highlights. The chat UI should stay responsive during streaming and remain stable after completion, while preserving existing artifact preview, reference navigation, search, capture, jump, and scroll behavior.

## Goal

Apply MarkStream's chat/streaming guidance to the existing per-message Markdown rendering path with the smallest safe combination of optimizations:

- make streaming/final state explicit when rendering Markdown;
- use MarkStream's chat mode and streaming-friendly props for live assistant content;
- enable conservative node-level rendering/virtualization helpers for completed Markdown;
- keep Markdown nodes fully mounted while chat search is active or a message is a search result;
- clear stale row height measurements across session switches;
- avoid changing the outer `MessageList` virtualization or chat scroll model in this slice.

## Acceptance criteria

- Streaming assistant text blocks pass `final=false` and completed text blocks pass `final=true` to `markstream-vue`.
- Streaming blocks use MarkStream chat streaming defaults (`mode="chat"`, smooth streaming auto, typewriter, batching, code-block streaming) without reintroducing completion flicker.
- Completed Markdown can opt into MarkStream node-level deferral/virtualization without changing DeepChat's outer message list semantics.
- Chat search keeps all Markdown nodes mounted so DOM highlight/search behavior remains reliable.
- Session changes reset message height measurements so jump/anchor estimates cannot reuse stale row heights.
- Existing Markdown custom components for links, references, Mermaid, code blocks, and artifact preview remain wired.
- Existing tests for `MarkdownRenderer`, `MessageBlockContent`, `MessageList`, and `ChatPage` are updated or continue to pass.

## Constraints

- Prefer local changes in the existing render chain and avoid broad refactors.
- Do not replace `MessageList` with `MarkstreamVirtualTimeline` in this slice; DeepChat has row-level behaviors (tool calls, artifacts, search, jump, capture, scroll anchoring) that need a separate design.
- Keep `fade=false` initially to avoid visible row repaint/flicker at stream completion.
- Preserve Monaco-backed code block rendering and artifact preview behavior.

## Non-goals

- Full outer chat-list virtualization.
- Redesign of DOM-based chat search/highlight.
- New performance instrumentation UI.
- CSS layer reordering for MarkStream styles.

## Open questions

None for this implementation slice.
