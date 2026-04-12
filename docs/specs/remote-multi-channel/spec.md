# QQBot and WeChat iLink

## Summary

DeepChat remote control now has a built-in adapter framework and a registry-driven renderer contract. This iteration ships two new official built-in channels on top of Telegram and Feishu: QQ Bot Open Platform and WeChat iLink.

The design basis for QQBot follows Tencent official documentation only:

- access token and HTTP auth
- WebSocket gateway and intents
- official `C2C_MESSAGE_CREATE` and `GROUP_AT_MESSAGE_CREATE` events
- official `/v2/users/{openid}/messages` and `/v2/groups/{group_openid}/messages` send APIs

The WeChat iLink design basis follows Tencent official package behavior only:

- fixed QR base URL and official QR login flow
- `get_bot_qrcode` / `get_qrcode_status` polling with redirect-host handling
- `getupdates` long polling
- `sendmessage`, `getconfig`, and `sendtyping`
- multi-account runtime separation from day one

## User Stories

- As a desktop user, I can configure Telegram, Feishu, QQBot, and WeChat iLink remote control from one Remote settings page.
- As a maintainer, I can add future built-in channels by registering descriptors and adapters instead of hardcoding presenter branches.
- As a maintainer, I can keep Telegram and Feishu behavior stable while adding QQBot and WeChat iLink through the same adapter boundary.
- As a WeChat iLink user, I can connect an official bot account by QR login and manage multiple connected accounts from the built-in settings page.

## Acceptance Criteria

- `IRemoteControlPresenter` exposes `listRemoteChannels()` and generic per-channel settings / status methods that include `qqbot` and `weixin-ilink`.
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
- A built-in `WeixinIlinkAdapter` exists and is registered through `ChannelManager`.
- QQBot uses official transport primitives only:
  - `POST https://bots.qq.com/app/getAppAccessToken`
  - `GET https://api.sgroup.qq.com/gateway`
  - official WebSocket `identify` / `resume` / heartbeat flow
  - official C2C and group message send endpoints
- QQBot first-release scope is:
  - C2C direct messages
  - group `@bot` messages
  - text-only passive replies
- WeChat iLink first-release scope is:
  - official QR login
  - multi-account management in settings
  - owner-account-only remote control
  - text-only direct replies
- `RemoteBindingStore`, `RemoteConversationRunner`, and `RemoteBlockRenderer` stay the source of truth for bindings, sessions, and rendered delivery text.
- Remote settings persist QQBot data under `remoteControl.qqbot` without flattening everything into a generic `channels` map.
- Remote settings persist WeChat iLink data under `remoteControl.weixinIlink`, including per-account runtime credentials and bindings.

## Official Constraints

- QQ official C2C `user_openid` and group `member_openid` are different identity spaces, so a direct-message-paired user cannot be inferred from a group event.
- Because of that constraint, QQBot group authorization is handled separately from C2C user pairing.
- This iteration stores:
  - paired C2C user ids
  - internally authorized group ids
- Group control only reacts to `GROUP_AT_MESSAGE_CREATE` and only after explicit group authorization with `/pair`.
- WeChat iLink login and runtime follow the official QR + long-poll flow only; no personal WeChat bridge or unofficial protocol is used.
- This first WeChat iLink delivery authorizes only the owner account returned by QR login; it does not implement a secondary allowlist UI yet.

## Non-Goals

- No OneBot, go-cqhttp, unofficial QQ bridges, or personal-WeChat bridges.
- No Discord or Slack runtime in this iteration.
- No secondary WeChat collaborator allowlist or shared-account UI in this iteration.
- No third-party plugin execution or installation UI in this iteration.

## Compatibility

- Existing Telegram and Feishu saved settings remain valid.
- New WeChat iLink saved settings live beside existing remote settings without changing Telegram / Feishu / QQBot schema shapes.
- Existing Telegram hook test API remains valid.
- Existing renderer callers that use Telegram-only compatibility methods continue to work.
- New generic remote presenter methods become the preferred path for renderer code.
