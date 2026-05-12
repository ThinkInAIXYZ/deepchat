# Feishu Post Message Payload Plan

## Approach

- Add a focused Feishu client test that asserts `sendMarkdown()` serializes `msg_type: 'post'` content using the Feishu i18n object directly, without an extra `post` wrapper.
- Update the Feishu markdown payload builder to match the Feishu API content schema.
- Re-run the focused Feishu client tests to confirm the regression is fixed.

## Validation

- Run the Feishu client unit test file.
- If the focused suite passes, the command reply path will stop failing on Feishu API code `230001 invalid message content` for normal markdown replies.
