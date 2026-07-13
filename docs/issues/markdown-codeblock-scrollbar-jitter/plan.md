# Markdown Codeblock Scrollbar Jitter Plan

## Current Layout

```text
Before

Chat viewport
  - message-list-container
  - stable vertical gutter already exists
  |
  +-- assistant message
      |
      +-- MarkdownRenderer .prose
          |
          +-- markstream-vue code block
              |
              +-- code-editor-container / code-pre-fallback / pre
                  - overflow: auto
                  - wrapping may be implicit
                  - internal scrollbar can appear/disappear while settling
                  - code content area shifts on Windows
```

```text
After

Chat viewport
  - unchanged
  |
  +-- assistant message
      |
      +-- MarkdownRenderer .prose
          |
          +-- markstream-vue code block
              |
              +-- stable internal scrollport
                  - scrollbar space is reserved or otherwise kept stable
                  - code wrapping is explicit for Monaco rendering
                  - fallback/enhanced renderer swaps do not move content
```

## Design

Implement the first fix as a scoped renderer code block stabilization in the app-owned Markdown
renderer.

Recommended target file:

- `src/renderer/src/components/markdown/MarkdownRenderer.vue`

Candidate targets:

- `.markstream-vue [data-markstream-code-block='1']`
- `.markstream-vue [data-markstream-code-block='1'] .code-editor-container`
- `.markstream-vue [data-markstream-code-block='1'] .code-pre-fallback`
- `.markstream-vue pre[class^='language-']`
- `.markstream-vue pre[class*=' language-']`

Preferred first increment:

1. Pass `wordWrap: 'on'` explicitly to Markdown code block Monaco rendering so the app does not
   rely on an implicit dependency default.
2. Add `scrollbar-gutter: stable;` to the inner code block scrollports that can create vertical
   classic scrollbars.
3. Keep `overflow: auto` so scrollbars are still demand-driven.
4. Do not force `overflow-x: scroll`; default code blocks should wrap.
5. Validate the issue video scenario on Windows.
6. If a horizontal scrollbar still appears in default wrapped mode, identify which renderer path is
   bypassing wrap before adding any scrollbar fallback.

Avoid these first:

- Do not add another outer `scrollbar-gutter` to `ChatPage.vue`; it already exists.
- Do not set global `overflow-y: scroll`.
- Do not force permanent horizontal scrollbars in default wrapped code blocks.
- Do not apply broad scrollbar rules to all `.prose` content.

## Compatibility

- The reported runtime is Electron/Chromium on Windows. Modern Chromium supports
  `scrollbar-gutter`.
- macOS overlay scrollbars should not show meaningful visual changes because overlay scrollbars do
  not consume layout gutter space.
- Linux classic scrollbar behavior should benefit from the same scoped stabilization.

## Risk Areas

- Horizontal scrollbar appearance in default wrapped mode would indicate a renderer path bypassing
  wrapping; it must be verified on Windows with classic scrollbars.
- `markstream-vue` uses scoped compiled CSS, so app overrides need enough selector specificity.
- Code block fallback and enhanced editor layers overlap during streaming; a fix must avoid clipping
  either layer.
- Permanent horizontal scrollbars would be noisy and conflict with the expected default wrapping
  behavior.

## Test Strategy

Automated checks:

- Add or update a renderer test around `MarkdownRenderer` if implementation introduces a stable app
  class or data attribute that can be asserted in jsdom.
- Add a browser-level regression check when practical:
  - mount a Markdown response with a streaming code block;
  - append content until the code block crosses the overflow threshold;
  - measure the code block rect and first code line rect before and after the scrollbar transition;
  - fail if position changes by more than 1 px.

Manual Windows validation:

1. Run the app on Windows 11.
2. Open a chat and stream a response containing a long fenced code block with enough lines to make
   the block overflow.
3. Watch the code block during streaming and completion.
4. Confirm normal long code wraps by default and does not show a permanent horizontal scrollbar.
5. Confirm the outer chat scrollbar, sticky input, and auto-follow behavior are unchanged.
6. Repeat once in dark theme.

Quality gates after implementation:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- Targeted renderer test, for example `pnpm test:renderer -- MarkdownRenderer`

## Validation Fixture

Use Markdown content shaped like the issue video:

````markdown
### Comparison

```java
String sql = "SELECT * FROM users WHERE id = ?";
PreparedStatement ps = conn.prepareStatement(sql);
ps.setInt(1, 1);
ResultSet rs = ps.executeQuery();
while (rs.next()) {
    String name = rs.getString("name");
    int age = rs.getInt("age");
}

// Repeat enough long lines to exercise wrapping and code block overflow on Windows classic scrollbars.
String veryLongLine = "SELECT first_name, last_name, email, created_at FROM users WHERE account_status = 'active' ORDER BY created_at DESC";
```
````

Expected behavior: the long code line wraps by default. If a real scrollbar is needed for vertical
overflow, the code content and block geometry should not jump while the scrollbar state changes.
