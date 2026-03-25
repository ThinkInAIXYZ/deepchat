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
  - final-text response delivery

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

## Telegram Fix

- Restrict draft-stream text extraction to stable visible content blocks.
- When no visible draft-safe text exists, do not send draft updates; keep typing/final-message behavior only.

## Testing

- Extend config normalization tests for legacy Telegram-only data plus new Feishu config.
- Add presenter/runtime tests for Feishu settings, bindings, pairing, and runtime enable/disable.
- Add Telegram regression tests proving reasoning/tool-call/pending-action states do not call `sendMessageDraft`.
- Update renderer tests for tab layout, overview, and per-channel dialogs.
