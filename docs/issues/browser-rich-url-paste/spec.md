# Browser Rich URL Paste

## User Story

When a user copies a URL from Chrome or Edge and pastes it into the chat input, DeepChat should insert only the URL text, even if the clipboard also contains rich HTML metadata such as a page title or description.

## Acceptance Criteria

- A clipboard payload whose plain text is exactly one `http` or `https` URL inserts only that URL into the chat input.
- Browser-provided rich HTML, titles, or descriptions do not get pasted when the plain text is a single URL.
- File and image paste behavior remains unchanged.
- Normal text, rich text, Markdown, code, multiple URLs, or text that merely contains a URL keeps the existing paste behavior.

## Non-Goals

- No global paste behavior changes outside `ChatInputBox`.
- No new user setting or IPC/API surface.
- No custom handling for non-HTTP URL schemes in this increment.

## Constraints

- The detection must be narrow enough to avoid changing user-authored prose.
- The URL extraction logic must be testable without mounting the editor.
