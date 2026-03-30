# Remote Multi-Channel Plan

## Main Process

- Expand `remoteControl` config normalization to include `telegram` and `feishu`.
- Keep the existing Telegram runtime, but add Feishu runtime management beside it.
- Reuse `RemoteConversationRunner` for both channels by passing endpoint binding metadata.
- Add a Feishu WebSocket runtime with:
  - bot identity probe
  - inbound message parsing
  - endpoint-scoped serial queue
  - text command routing
  - temporary status delivery plus streamed answer updates

## Shared Contracts

- Add `RemoteChannel = 'telegram' | 'feishu'`.
- Add channel-aware presenter methods:
  - `getChannelSettings`
  - `saveChannelSettings`
  - `getChannelStatus`
  - `getChannelBindings`
  - `removeChannelBinding`
  - `getChannelPairingSnapshot`
  - `createChannelPairCode`
  - `clearChannelPairCode`
  - `clearChannelBindings`
  - `getRemoteOverview`
- Keep Telegram hook test API separate.

## Renderer

- Rebuild `RemoteSettings.vue` into:
  - shared overview header
  - Telegram tab
  - Feishu tab
- Telegram tab keeps hooks UI.
- Feishu tab only shows remote-control related sections.
- Binding rows display endpoint badges (`DM`, `Group`, `Topic`) instead of raw endpoint keys only.

## Compact Delivery

- Reuse `RemoteConversationRunner` snapshot data to derive `statusText`, streamed answer `text`, and `finalText`.
- Telegram keeps one temporary status message plus one streamed answer message per assistant turn.
- Feishu keeps one temporary status message plus one streamed answer message per assistant turn.
- Pending interaction prompts/cards remain separate so approvals/questions stay actionable.

## Testing

- Extend config normalization tests for legacy Telegram-only data plus new Feishu config.
- Add presenter/runtime tests for Feishu settings, bindings, pairing, and runtime enable/disable.
- Add Telegram and Feishu regression tests proving intermediate reasoning/tool/search states stay inside the single status-message lifecycle.
- Update renderer tests for tab layout, overview, and per-channel dialogs.
