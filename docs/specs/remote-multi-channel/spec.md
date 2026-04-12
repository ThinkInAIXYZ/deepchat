# QQBot First, WeChat iLink Next

## Summary

DeepChat remote control now has a built-in adapter framework, but the renderer contract and built-in channel set still need to scale past Telegram and Feishu. This iteration promotes the public remote contract to a registry-driven model and ships the first new official built-in channel: QQ Bot Open Platform.

The design basis for QQBot follows Tencent official documentation only:

- access token and HTTP auth
- WebSocket gateway and intents
- official `C2C_MESSAGE_CREATE` and `GROUP_AT_MESSAGE_CREATE` events
- official `/v2/users/{openid}/messages` and `/v2/groups/{group_openid}/messages` send APIs

WeChat iLink remains the next phase. Its channel id and descriptor are reserved now, but no runtime or auth flow ships in this iteration.

## User Stories

- As a desktop user, I can configure Telegram, Feishu, and QQBot remote control from one Remote settings page.
- As a maintainer, I can add future built-in channels by registering descriptors and adapters instead of hardcoding presenter branches.
- As a maintainer, I can keep Telegram and Feishu behavior stable while adding QQBot through the same adapter boundary.
- As a future WeChat iLink user, I can already see that the channel exists in the registry even though the runtime is not implemented yet.

## Acceptance Criteria

- `IRemoteControlPresenter` exposes `listRemoteChannels()` and generic per-channel settings / status / pairing methods that include `qqbot`.
- `RemoteChannelId` includes:
  - `telegram`
  - `feishu`
  - `qqbot`
  - `weixin-ilink`
- Renderer remote UI is registry-driven for:
  - overview cards
  - tab headers
  - sidebar remote status aggregation
- Existing Telegram and Feishu runtime behavior remains unchanged.
- A built-in `QQBotAdapter` exists and is registered through `ChannelManager`.
- QQBot uses official transport primitives only:
  - `POST https://bots.qq.com/app/getAppAccessToken`
  - `GET https://api.sgroup.qq.com/gateway`
  - official WebSocket `identify` / `resume` / heartbeat flow
  - official C2C and group message send endpoints
- QQBot first-release scope is:
  - C2C direct messages
  - group `@bot` messages
  - text-only passive replies
- `RemoteBindingStore`, `RemoteConversationRunner`, and `RemoteBlockRenderer` stay the source of truth for bindings, sessions, and rendered delivery text.
- Remote settings persist QQBot data under `remoteControl.qqbot` without flattening everything into a generic `channels` map.

## Official Constraints

- QQ official C2C `user_openid` and group `member_openid` are different identity spaces, so a direct-message-paired user cannot be inferred from a group event.
- Because of that constraint, QQBot group authorization is handled separately from C2C user pairing.
- This iteration stores:
  - paired C2C user ids
  - internally authorized group ids
- Group control only reacts to `GROUP_AT_MESSAGE_CREATE` and only after explicit group authorization with `/pair`.

## Non-Goals

- No OneBot, go-cqhttp, unofficial QQ bridges, or personal-WeChat bridges.
- No Discord or Slack runtime in this iteration.
- No WeChat iLink login flow, QR polling, account switching UI, or runtime delivery yet.
- No third-party plugin execution or installation UI in this iteration.

## Compatibility

- Existing Telegram and Feishu saved settings remain valid.
- Existing Telegram hook test API remains valid.
- Existing renderer callers that use Telegram-only compatibility methods continue to work.
- New generic remote presenter methods become the preferred path for renderer code.
