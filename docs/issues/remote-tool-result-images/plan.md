# Plan

## Current behavior

Tool execution can attach visual previews to `tool_call.imagePreviews`. The desktop renderer shows those previews only inside the expanded tool-call details, not as normal assistant image messages. `prepareToolImagePreviewPresentation()` currently promotes only successful built-in `image_generate` previews into assistant `image` blocks. Other tool result images, including screenshots, remain embedded in the tool-call metadata.

Remote snapshots historically persisted only assistant `image` blocks. The first fix added a fallback that also persists `tool_call.imagePreviews`, but the broader issue is conversation-level visibility: the assistant transcript itself should contain the image result.

## Implementation approach

1. Generalize `prepareToolImagePreviewPresentation()` so successful, non-error tool result previews with usable `data` are promoted into assistant `image` blocks for any tool source.
2. Keep the existing special-case behavior for built-in `image_generate`: its previews are promoted and removed from the tool-call detail panel.
3. For other tools, promote usable previews while preserving metadata-only/unusable previews on `tool_call.imagePreviews` so the detail panel can still show what is available.
4. Add stable image block metadata linking promoted images back to the tool call and preview source/title.
5. Keep the remote snapshot fallback for legacy conversations where previews are already stored only in `tool_call.imagePreviews`.
6. Update tests to cover screenshot/tool-output promotion in the normal runtime path and the remote fallback path.

## Affected interfaces

- `AssistantMessageBlock` remains unchanged; promoted images use existing `type: 'image'` and `image_data` fields.
- `AssistantMessageExtra` gains optional metadata keys through its existing index signature, such as `toolCallId`, `toolImagePreviewId`, `toolImagePreviewSource`, and `toolImagePreviewTitle`.
- `RemoteConversationSnapshot.generatedImages` remains unchanged.

## Data flow

1. Tool execution returns `imagePreviews`.
2. Runtime normalizes the tool result and calls `prepareToolImagePreviewPresentation()`.
3. Usable previews become assistant `image` blocks inserted after the tool-call block.
4. Desktop conversation renders those images as normal assistant images.
5. Remote snapshot persists those image blocks into `generatedImages`; legacy unpromoted previews are also persisted as fallback.

## Compatibility

- Existing generated-image behavior remains compatible: built-in `image_generate` still hides promoted previews from the tool detail panel.
- Saved conversations with only `tool_call.imagePreviews` continue remote delivery via the fallback persistence path.
- Error tool results are not promoted into normal image blocks.

## Test strategy

- Update `agentRuntimePresenter/dispatch` tests to assert generic successful tool image previews are promoted into assistant image blocks.
- Keep tests for built-in `image_generate`, MCP same-name tool, and error results aligned with the new promotion rules.
- Keep `RemoteConversationRunner` tests covering fallback persistence from `tool_call.imagePreviews`.
- Run focused tests, typecheck, format, i18n, and lint.
