# Browser Rich URL Paste Plan

## Approach

- Add a small renderer helper that extracts a URL only when clipboard text is a single `http` or `https` URL.
- Prefer `text/plain`; use `text/uri-list` only when plain text is absent.
- Ignore `text/html` content so browser rich metadata does not influence what gets inserted.
- Call the helper only from `ChatInputBox` after preserving the existing attachment paste path.

## Component Flow

1. `ChatInputBox` receives a paste event.
2. Existing `files.handlePaste(event, true)` runs as before.
3. If the clipboard contains files, URL handling stops.
4. If the clipboard contains one plain URL, stop the paste event, prevent TipTap's default paste, and insert the URL as plain text.
5. Otherwise, do not prevent default and let TipTap handle the paste.

## Compatibility

- Existing file/image paste behavior is unchanged.
- Other renderer inputs and settings views are not touched.
- The helper accepts only `http:` and `https:` to avoid swallowing custom protocols or app-specific payloads.

## Test Strategy

- Unit-test URL extraction for single URL, rich-browser payloads, `text/uri-list`, prose, multi-line text, multiple URLs, and unsupported schemes.
- Component-test `ChatInputBox` paste behavior for URL-only rich paste, normal text paste, and file paste.
