# QQBot First, WeChat iLink Next Plan

## Public Contract

- Expand shared remote presenter types with:
  - `RemoteChannelId`
  - `RemoteChannelDescriptor`
  - `QQBotRemoteSettings`
  - `QQBotRemoteStatus`
  - `QQBotPairingSnapshot`
- Add `listRemoteChannels()` to the remote presenter bridge.
- Keep Telegram compatibility shims in place for one release cycle.

## Main Process

- Extend `RemoteControlPresenter` to:
  - register QQBot through the built-in adapter registry
  - rebuild Telegram / Feishu / QQBot independently
  - expose registry descriptors to renderer callers
- Extend `RemoteBindingStore` and remote config normalization with `remoteControl.qqbot`.
- Add QQBot runtime modules:
  - HTTP client
  - gateway session manager
  - parser
  - auth guard
  - command router
  - runtime
  - adapter

## QQBot Runtime

- Acquire access token from the official token endpoint.
- Resolve the official gateway URL and connect through WebSocket.
- Use official `GROUP_AND_C2C_EVENT (1 << 25)` intents.
- Maintain heartbeat, resume state, and reconnect backoff.
- Parse:
  - `C2C_MESSAGE_CREATE`
  - `GROUP_AT_MESSAGE_CREATE`
- Route text commands through the existing remote session pipeline.
- Use official passive reply semantics with `msg_id + msg_seq`.

## Renderer

- Drive Remote settings overview cards and tab headers from channel descriptors.
- Keep built-in panel components for:
  - Telegram
  - Feishu
  - QQBot
- Expose WeChat iLink as an unimplemented built-in descriptor only.
- Update the sidebar remote button to aggregate all implemented built-in channel states instead of a hardcoded Telegram / Feishu pair.

## Validation

- Keep Telegram and Feishu regression tests green.
- Add focused QQBot tests for:
  - parser
  - auth guard
  - command router
  - adapter
- Update presenter and renderer tests for descriptor-driven multi-channel behavior.
- Run:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - `pnpm run typecheck`
