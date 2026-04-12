# QQBot and WeChat iLink Plan

## Public Contract

- Expand shared remote presenter types with:
  - `RemoteChannelId`
  - `RemoteChannelDescriptor`
  - `QQBotRemoteSettings`
  - `QQBotRemoteStatus`
  - `QQBotPairingSnapshot`
  - `WeixinIlinkRemoteSettings`
  - `WeixinIlinkRemoteStatus`
  - `WeixinIlinkLoginSession`
  - `WeixinIlinkLoginResult`
- Add `listRemoteChannels()` to the remote presenter bridge.
- Keep Telegram compatibility shims in place for one release cycle.

## Main Process

- Extend `RemoteControlPresenter` to:
  - register QQBot through the built-in adapter registry
  - register WeChat iLink per account through the same registry
  - rebuild Telegram / Feishu / QQBot / WeChat iLink independently
  - expose registry descriptors to renderer callers
- Extend `RemoteBindingStore` and remote config normalization with:
  - `remoteControl.qqbot`
  - `remoteControl.weixinIlink`
- Add QQBot runtime modules:
  - HTTP client
  - gateway session manager
  - parser
  - auth guard
  - command router
  - runtime
  - adapter
- Add WeChat iLink runtime modules:
  - official QR / long-poll HTTP client
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

## WeChat iLink Runtime

- Start official QR login from the fixed iLink base URL.
- Poll QR status until confirmed, including redirect-host handling.
- Persist per-account `bot_token`, `baseUrl`, owner user id, and bindings.
- Run one adapter per connected account with official `getupdates` long polling.
- Use official `sendmessage`, `getconfig`, and `sendtyping` endpoints only.
- Keep first-release authorization owner-only.

## Renderer

- Drive Remote settings overview cards and tab headers from channel descriptors.
- Keep built-in panel components for:
  - Telegram
  - Feishu
  - QQBot
  - WeChat iLink
- Add WeChat iLink QR login, account list, restart, remove, and shared default-agent/workdir controls.
- Update the sidebar remote button to aggregate all implemented built-in channel states instead of a hardcoded Telegram / Feishu pair.

## Validation

- Keep Telegram and Feishu regression tests green.
- Add focused QQBot tests for:
  - parser
  - auth guard
  - command router
  - adapter
- Add focused WeChat iLink tests for:
  - presenter login flow
  - renderer QR-login UI
  - multi-account status rendering
- Update presenter and renderer tests for descriptor-driven multi-channel behavior.
- Run:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - `pnpm run typecheck`
