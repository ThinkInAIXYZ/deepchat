# Markdown Smooth Streaming Control Plan

## Approach

- Add a `smoothStreaming` prop to `MarkdownRenderer`, defaulting to `false`.
- Forward that prop to `markstream-vue`'s `NodeRenderer`.
- In chat message text rendering, enable the prop only when the assistant content block status is `pending` or `loading`.
- Do not derive this from parsed part loading state, because that state reflects artifact/tag parsing rather than message generation.

## Compatibility

- Existing non-chat markdown surfaces inherit the default `false`.
- Existing `fade=false` behavior remains unchanged.

## Validation

- Cover the markdown renderer default and explicit prop behavior.
- Cover completed versus generating message block behavior.
- Run targeted renderer tests plus formatting, i18n, and lint checks.
