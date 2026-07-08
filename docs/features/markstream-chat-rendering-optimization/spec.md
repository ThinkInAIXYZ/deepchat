# MarkStream Chat Rendering Optimization Spec

## User need

DeepChat's assistant messages can stream long Markdown responses with code blocks, Mermaid diagrams, tables, references, artifacts, and search highlights. Rendering must feel smooth while content is generating and stay fast when browsing completed long conversations.

## Goal

Build a high-performance, high-experience Markdown rendering path using `markstream-vue` for both streaming and completed chat content while preserving DeepChat's current behavior.

The optimized path remains:

`ChatPage` → `MessageList` / `MessageListRow` → `MessageItemAssistant` → `MessageBlockContent` → `MarkdownRenderer` → `markstream-vue` `NodeRenderer`

## Acceptance criteria

- Streaming assistant text blocks pass explicit live state to `markstream-vue` (`mode="chat"`, `final=false`) and use MarkStream's streaming-friendly features.
- Completed assistant text blocks pass `final=true` and use MarkStream's completed-content virtualization/deferral features for long Markdown.
- Streaming Markdown uses incremental rendering settings that prioritize frame budget and smooth typing cadence instead of large per-token DOM commits.
- Static/completed Markdown uses a virtualized node window for long documents to preserve scrollback responsiveness and memory usage.
- Code blocks remain Monaco/custom-renderer backed and support DeepChat artifact preview behavior.
- Mermaid, references, links, artifact previews, tool calls, message capture, spotlight jump, scroll anchoring, and inline chat search remain compatible.
- Chat search and search-result messages keep Markdown DOM available by disabling node virtualization where DOM search/highlighting needs it.
- Session changes reset message height measurements so old session row heights cannot affect new session windowing.
- The implementation is explicit, documented, and covered by focused renderer/list/page tests.
- The PR description clearly explains the concrete performance/UX behavior, non-goals, and validation.

## Constraints

- Use `markstream-vue`; do not replace it with another renderer.
- Prefer focused changes in the existing render chain and avoid broad unrelated refactors.
- Do not replace the outer `MessageList` with `MarkstreamVirtualTimeline` in this slice; DeepChat's row-level tool/action/artifact/search/capture/jump/anchor behaviors need separate design before an outer virtual timeline can safely own them.
- Keep `fade=false` to avoid opacity restart flicker during high-frequency streaming.
- Preserve Monaco-backed code block rendering and artifact preview behavior.
- Do not claim benchmark numbers unless measured in this task.

## Non-goals

- Full outer chat-list virtualization.
- Redesign of DOM-based chat search/highlight.
- New performance instrumentation UI.
- Replacing DeepChat's custom code block/artifact preview components.

## Open questions

None for this implementation slice.
