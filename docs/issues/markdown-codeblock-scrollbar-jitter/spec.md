# Markdown Codeblock Scrollbar Jitter

## Source

- GitHub issue: https://github.com/ThinkInAIXYZ/deepchat/issues/1763
- Reported environment: Windows 11 Home Chinese, DeepChat v1.0.6-beta.5.
- Symptom: assistant Markdown rendering shows visible scrollbar jitter while generated content settles.
- Attached video: `20260612_174024.mp4`, linked from the issue body.
- Related comments:
  - https://github.com/ThinkInAIXYZ/deepchat/issues/1763#issuecomment-4706327016
  - https://github.com/ThinkInAIXYZ/deepchat/issues/1763#issuecomment-4714279781

## Problem Determination

The issue is most likely not caused by the outer chat viewport scrollbar.

Evidence:

- The issue video shows the visible jump inside a rendered Markdown code block. A horizontal
  scrollbar is visible during settling, but default code block rendering is expected to wrap, so the
  scrollbar should not be treated as the desired steady state.
- The outer chat container already reserves vertical scrollbar space in `ChatPage.vue` via
  `.message-list-container { scrollbar-gutter: stable both-edges; }`.
- `MarkdownRenderer.vue` wraps `markstream-vue`'s `NodeRenderer` in a `.prose` container, but does
  not add any scrollbar stability rule for inner Markdown scrollports.
- `markstream-vue@1.0.1-beta.4` renders code blocks through `CodeBlockNode`, including
  `.code-block-container`, `.code-editor-container`, `.code-pre-fallback`, and
  `pre[class^=language-]` nodes that use `overflow: auto`.
- `markstream-vue` defaults code block word wrapping to enabled when `monacoOptions.wordWrap` is not
  set to `off`, and its fallback `.code-pre-fallback.is-wrap` CSS uses wrapping rules.
- On Windows classic scrollbars consume layout space. When an inner code block switches between
  fallback and enhanced rendering, or crosses an overflow threshold during streaming, those
  internal scrollbars can change the code block's available content area and cause visible jitter.

## Comment Assessment

The comment suggesting `scrollbar-gutter: stable` is directionally reasonable, but it must be
applied to the scrollable Markdown/code block nodes that actually jitter. Applying it only to the
outer chat page would likely be ineffective because the outer container already has a stable gutter.

`overflow-y: scroll` is a weaker fit for this report:

- The captured symptom is inside a Markdown code block, and the most visible scrollbar in the video
  is horizontal.
- Forcing vertical scrollbars globally would add permanent scrollbar chrome to many non-problem
  containers.
- Forcing a horizontal scrollbar would normalize an unreasonable default state; the first fix should
  preserve automatic wrapping and only stabilize real scroll containers.

MDN documents `scrollbar-gutter` as a way to reserve classic scrollbar space for scroll containers,
with `both-edges` mirroring the gutter on inline edges. This supports using it for vertical
scrollbar reflow, but horizontal scrollbar behavior still needs explicit Windows validation.

## User Need

As a Windows user reading a streaming assistant response, I need Markdown code blocks to remain
visually stable while content is rendered, so the response does not look like it is shaking or
reflowing around scrollbars.

## Goals

- Stabilize Markdown code block scrollports on Windows classic scrollbar environments.
- Preserve default automatic wrapping for Markdown code blocks.
- Keep the existing outer chat scroll behavior unchanged.
- Avoid introducing permanent horizontal scrollbars for normal wrapped code.
- Preserve code block rendering in chat messages, artifacts, and workspace Markdown preview.
- Keep the fix scoped to renderer styling unless validation proves the issue is in
  `markstream-vue` behavior.

## Acceptance Criteria

- A streaming Markdown response containing a long code block does not visibly jitter when the code
  block crosses an overflow threshold.
- The code block container width, block height, and first rendered code line position remain stable
  within 1 px while fallback/enhanced code rendering settles.
- Long code lines wrap by default and do not gain a permanent horizontal scrollbar in normal chat
  rendering.
- Normal Markdown paragraphs do not gain unwanted permanent scrollbars or extra spacing.
- Chat auto-follow, manual scroll-away, and session restore behavior remain unchanged.
- Markdown artifacts and workspace Markdown previews render without clipped code blocks.
- Light and dark themes keep the current code block visual style.

## Non-goals

- Redesign the Markdown renderer.
- Replace `markstream-vue`.
- Rewrite chat scrolling or virtualization.
- Add a user-facing setting.
- Hide scrollbars with `scrollbar-width: none`, because that weakens discoverability and
  accessibility.

## Constraints

- Keep the implementation local to renderer Markdown/code block styling if possible.
- Do not patch files under `node_modules`.
- Prefer CSS overrides in app-owned files over dependency forks.
- Do not force permanent horizontal scrollbars as a default-mode fallback.
- No new runtime dependencies.
