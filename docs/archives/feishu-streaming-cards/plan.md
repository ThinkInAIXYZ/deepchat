# Feishu/Lark Streaming Cards Plan

## Existing flow

- `RemoteSettings.vue` edits `FeishuRemoteSettings`, then `RemoteControlPresenter.saveFeishuSettings()` persists normalized settings.
- `FeishuAdapter` creates `FeishuRuntime` with a `FeishuClient` and `FeishuCommandRouter`.
- `FeishuRuntime.deliverConversation()` polls `RemoteConversationExecution.getSnapshot()` and currently calls `syncDeliverySegments()` to send/update Feishu post messages.

## Data model and interfaces

1. Add `enableStreamingCards: boolean` to:
   - `FeishuRemoteSettings` shared type.
   - `FeishuRemoteRuntimeConfig` main runtime config.
   - Zod config normalization/defaults.
2. Include the flag in Feishu adapter signatures and pass it from `FeishuAdapter` into `FeishuRuntime` as `enableStreamingCards`.
3. Do not change IPC route names: channel settings use `z.custom<RemoteChannelSettings>()` and continue carrying the typed settings object.

## CardKit client additions

Add low-level methods to `FeishuClient`:

- `createStreamingCard(initialContent?: string): Promise<{ cardId: string; elementId: string }>`
  - Calls `POST /open-apis/cardkit/v1/cards` via `sdk.request`.
  - Sends `{ type: 'card_json', data: JSON.stringify(cardJson) }`.
  - Card JSON uses schema `2.0`, `config.streaming_mode = true`, `config.update_multi = true`, `streaming_config`, and a markdown element with `element_id: 'md_stream'`.
- `sendCardEntity(target, cardId): Promise<string | null>`
  - Sends `msg_type: 'interactive'` with content `{"type":"card","data":{"card_id":"..."}}`.
  - Uses reply or create path consistently with existing message send methods.
- `updateStreamingCardContent(cardId, elementId, content, sequence): Promise<void>`
  - Calls `PUT /open-apis/cardkit/v1/cards/:card_id/elements/:element_id/content` with full text.
- `closeStreamingCard(cardId, sequence): Promise<void>`
  - Calls `PATCH /open-apis/cardkit/v1/cards/:card_id/settings` with `settings` containing `config.streaming_mode: false`.

All CardKit helpers throw clear `Feishu CardKit ...` errors when API responses are non-zero or missing required IDs.

## Runtime delivery

When `enableStreamingCards` is false, keep existing `deliverConversation()` behavior.

When true:

1. Poll snapshots as before.
2. Build the full card text by joining delivery segments in order:
   - Live `statusText` is grouped under `**Status**` while the answer is active, so thinking/running state appears inside the streaming card.
   - Process segments are grouped under `**Process**`.
   - Answer/terminal segments are grouped under `**Answer**`.
   - Use `optimizeMarkdownForFeishu()` on the final full text, preserving fenced code blocks and table content for CardKit markdown rendering.
3. On first non-empty text, create a streaming card, send it, then update the markdown element with sequence `1`.
4. On later text changes, update the same markdown element with the new full text and the next sequence.
5. On completion or timeout, ensure final text is sent, then close streaming mode with the next sequence and clear remote delivery state.
6. If any streaming card operation fails, log a warning and fall back to the existing `syncDeliverySegments()` path for that conversation.

The runtime keeps streaming card state only in-memory within the active delivery call. This matches the current queue-based remote delivery lifecycle and avoids changing `RemoteBindingStore`'s generic message-id delivery state.

## UI and i18n

- Add a switch in the Feishu remote-control section after access rules and before default agent/workdir.
- Use i18n keys:
  - `settings.remote.feishu.streamingCards`
  - `settings.remote.feishu.streamingCardsDescription`
- Include the flag in `defaultFeishuSettings()`, field sync, and draft building.

## Tests

- `feishuClient.test.ts`: CardKit create/send/update/close serialization and error handling.
- `feishuRuntime.test.ts`: streaming-card mode creates/sends/updates/closes; disabled mode still uses markdown; CardKit failure falls back to markdown; status/process/answer text and Markdown code/table content are preserved in streaming updates.
- `RemoteSettings.test.ts`: switch renders from settings and persists changed flag.
- Existing tests may need fixture updates to include `enableStreamingCards`.

## Validation

Run targeted tests first, then required project checks:

1. `pnpm test -- --run test/main/presenter/remoteControlPresenter/feishuClient.test.ts test/main/presenter/remoteControlPresenter/feishuRuntime.test.ts test/renderer/components/RemoteSettings.test.ts`
2. `pnpm run format`
3. `pnpm run i18n`
4. `pnpm run lint`
