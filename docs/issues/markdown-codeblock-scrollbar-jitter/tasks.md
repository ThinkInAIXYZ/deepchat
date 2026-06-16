# Markdown Codeblock Scrollbar Jitter Tasks

## Investigation

- [x] Read GitHub issue 1763 and current comments.
- [x] Download and inspect the attached issue video.
- [x] Confirm the visible jitter is inside a Markdown code block, not the outer chat viewport.
- [x] Check local chat container styling and confirm the outer viewport already uses
  `scrollbar-gutter: stable both-edges`.
- [x] Check `MarkdownRenderer.vue` and `markstream-vue` code block output for inner
  `overflow: auto` scrollports.
- [x] Assess the comment recommendation and document the scope correction.

## Implementation

- [x] Make Markdown code block Monaco word wrapping explicit.
- [x] Add scoped CSS stabilization for Markdown code block scrollports.
- [x] Keep normal Markdown paragraphs and non-scrollable blocks unaffected.
- [x] Avoid forcing permanent horizontal scrollbars in default wrapped code blocks.
- [ ] Validate whether `scrollbar-gutter: stable` is enough for the Windows issue video scenario.
- [x] Add or update a focused renderer/browser regression check where practical.

## Verification

- [ ] Run the original issue-style Markdown fixture on Windows 11.
- [ ] Verify chat message code blocks during streaming and after completion.
- [ ] Verify Markdown artifacts.
- [ ] Verify workspace Markdown preview.
- [ ] Verify light and dark themes.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run targeted renderer tests for `MarkdownRenderer`.
