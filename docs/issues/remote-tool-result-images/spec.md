# Tool result images in conversation and remote delivery

## User need

Users expect visual tool results to appear as first-class images in the normal chat transcript and in remote-control channels. Today a tool such as `Page.captureScreenshot` can complete successfully and store the screenshot in `tool_call.imagePreviews`, but the assistant may only continue with text or no final content. The image remains hidden behind the tool-call details and remote channels may not receive it unless the result is converted separately.

## Goal

Promote suitable function/tool-call image results into assistant `image` blocks so they are visible in the desktop conversation without depending on the model to restate them. Remote delivery should then reuse the same image blocks and, as a compatibility fallback, still handle unpromoted `tool_call.imagePreviews`.

## Acceptance criteria

- Successful `tool_call` results with resolvable `imagePreviews` create assistant `image` blocks adjacent to the tool call.
- `Page.captureScreenshot`, MCP image outputs, file-read image previews, and other non-error tool result images can become visible conversation images.
- The tool-call detail panel may still show preview metadata only when an image cannot be promoted or when the tool result is an error.
- The model context can continue safely without requiring the assistant to output the image itself.
- Remote snapshots deliver promoted image blocks through the existing `generatedImages` path and can still deliver legacy/unpromoted tool result previews.
- Raw base64 is not leaked into normal text messages.

## Constraints

- Preserve existing image-generation promotion behavior and compatibility for saved conversations.
- Keep channel-specific remote code unchanged where possible.
- Avoid promoting error tool results as normal assistant images.
- Skip previews without usable image data.

## Non-goals

- Changing remote channel APIs or settings.
- Adding live streaming of images before tool completion.
- Sending images from tools that only expose remote HTTP URLs without cached/data payloads.
- Reworking renderer image components.

## Open questions

None.
