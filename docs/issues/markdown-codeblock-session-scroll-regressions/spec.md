# Markdown Codeblock Session Scroll Regressions

## User Need

Chat markdown rendering should keep code blocks visually readable, and switching sessions should land
at the actual bottom of the restored conversation. Two regressions currently make the chat view feel
unfinished:

- Fenced code block chrome, especially the toolbar, renders too compact because the expected
  `markstream-vue` Tailwind utility classes are not generated.
- Switching conversations often scrolls close to the bottom but stops slightly short after message
  content finishes laying out.

## Goals

- Restore the intended `markstream-vue` code block toolbar spacing, background, border, and action
  button styles.
- Make session restore scroll to the final settled bottom of the message list when no message
  spotlight jump is requested.
- Preserve existing streaming auto-follow behavior, scroll-away behavior, and message rendering
  performance optimizations.

## Acceptance Criteria

- Generated renderer CSS includes representative `markstream-vue` code block utility candidates,
  including `py-[var(--ms-inset-panel-y)]`, `px-[var(--ms-inset-panel-x)]`,
  `p-[var(--ms-action-btn-padding)]`, `bg-[var(--code-header-bg)]`, and
  `text-[var(--code-action-fg)]`.
- Code block headers, language labels, copy buttons, and overflow controls render with the intended
  spacing in light and dark themes.
- Switching to an existing session without a spotlight target scrolls to the real bottom after
  markdown, code blocks, images, status rows, and input-area layout settle.
- Switching sessions does not reintroduce bottom shaking or overscroll during streaming updates.
- Sending a new message forces the conversation back to the bottom even if the previous bottom
  proximity metric was stale.
- If a spotlight target is requested, the message jump remains the winning scroll behavior.
- User-initiated scroll-away from the bottom is respected after the initial session restore has
  completed.

## Constraints

- Keep the fix scoped to renderer markdown styling and chat scroll restoration.
- Keep `markstream-vue` as a package dependency; do not fork or patch the package unless the package
  path fix proves insufficient.
- Keep the message row `content-visibility` performance optimization unless a later benchmark shows
  it is the actual blocker.
- Use bounded scroll settling so the renderer does not keep observers or animation-frame loops alive
  after session restore.
- Do not introduce new runtime dependencies.

## Non-goals

- Redesign the markdown renderer or code block component.
- Rewrite chat virtualization, message storage, or streaming message flow.
- Change the composer layout, sticky input behavior, or session loading UX.
- Add a new user-facing setting for scroll behavior.

## Discussion Points

- The recommended scroll-settling approach is a short `ResizeObserver` window plus bounded animation
  frame retries. A smaller bounded-rAF-only fix is possible, but it is less robust when late content
  changes arrive outside the first few frames.
