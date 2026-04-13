# Telegram Remote Control

Feature: `telegram-remote-control`
Plan: [plan.md](./plan.md)
Tasks: [tasks.md](./tasks.md)

## Summary

Telegram remote control is no longer a Telegram-only IPC contract. The shipped implementation
uses a shared `remoteControlPresenter` surface that serves Telegram, Feishu/Lark, QQBot,
Discord, and Weixin iLink from the same presenter and preload boundary.

This spec keeps Telegram runtime behavior in scope, but the renderer and preload contract must
be documented as a multi-channel API so follow-up work does not regress non-Telegram channels
back to a Telegram-only shape.

## User Stories

- As a DeepChat desktop user, I can configure Telegram, QQBot, Discord, and Weixin iLink from
  one Remote settings flow, while Feishu/Lark compatibility remains on the same presenter
  surface.
- As a renderer maintainer, I can call one typed presenter API for reading and saving
  per-channel settings, status, bindings, pairing state, and login state.
- As a Telegram user, I can pair numeric user ids and continue detached DeepChat sessions from
  bot DMs.
- As a QQBot user, I can keep C2C user pairing separate from authorized groups so group
  control does not disappear from the presenter state.
- As a Discord user, I can pair DMs or guild channels and inspect runtime state from the same
  Remote settings surface.
- As a Weixin iLink user, I can connect accounts through a login session instead of a pair
  code and manage account-scoped runtimes.

## Multi-Channel Presenter Surface

The expected shared presenter contract mirrors `IRemoteControlPresenter`:

```ts
type RemoteChannel = 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink'
type PairableRemoteChannel = 'telegram' | 'feishu' | 'qqbot' | 'discord'

interface IRemoteControlPresenter {
  listRemoteChannels(): Promise<RemoteChannelDescriptor[]>

  getChannelSettings<T extends RemoteChannel>(channel: T): Promise<ChannelSettingsMap[T]>
  saveChannelSettings<T extends RemoteChannel>(
    channel: T,
    input: ChannelSettingsMap[T]
  ): Promise<ChannelSettingsMap[T]>

  getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus>

  getChannelBindings(channel: RemoteChannel): Promise<RemoteBindingSummary[]>
  removeChannelBinding(channel: RemoteChannel, endpointKey: string): Promise<void>
  clearChannelBindings(channel: RemoteChannel): Promise<number>

  removeChannelPrincipal(channel: PairableRemoteChannel, principalId: string): Promise<void>
  getChannelPairingSnapshot(channel: PairableRemoteChannel): Promise<RemotePairingSnapshot>
  createChannelPairCode(
    channel: PairableRemoteChannel
  ): Promise<{ code: string; expiresAt: number }>
  clearChannelPairCode(channel: PairableRemoteChannel): Promise<void>

  startWeixinIlinkLogin(input?: { force?: boolean }): Promise<WeixinIlinkLoginSession>
  waitForWeixinIlinkLogin(input: {
    sessionKey: string
    timeoutMs?: number
  }): Promise<WeixinIlinkLoginResult>
  removeWeixinIlinkAccount(accountId: string): Promise<void>
  restartWeixinIlinkAccount(accountId: string): Promise<void>
}
```

Notes:

- Telegram compatibility helpers remain callable during migration, but new renderer work should
  prefer the generic channel methods above.
- Pair-code methods do not apply to Weixin iLink because that channel uses an account-login
  flow instead of a pairing code.

## Channel Variations

- Telegram
  - Settings: `botToken`, `remoteEnabled`, `defaultAgentId`
  - Status: `pollOffset`, `bindingCount`, `allowedUserCount`, `lastError`, `botUser`
  - Pairing snapshot: `allowedUserIds`
- QQBot
  - Settings: `appId`, `clientSecret`, `remoteEnabled`, `defaultAgentId`, `defaultWorkdir`,
    `pairedUserIds`
  - Status: `bindingCount`, `pairedUserCount`, `lastError`, `botUser`
  - Pairing snapshot: `pairedUserIds` and `pairedGroupIds`
- Discord
  - Settings: `botToken`, `remoteEnabled`, `defaultAgentId`, `defaultWorkdir`,
    `pairedChannelIds`
  - Status: `bindingCount`, `pairedChannelCount`, `lastError`, `botUser`
  - Pairing snapshot: `pairedChannelIds`
- Weixin iLink
  - Settings: `remoteEnabled`, `defaultAgentId`, `defaultWorkdir`, `accounts`
  - Status: `accountCount`, `connectedAccountCount`, `accounts`, `bindingCount`, `lastError`
  - Login flow: `startWeixinIlinkLogin`, `waitForWeixinIlinkLogin`,
    `removeWeixinIlinkAccount`, `restartWeixinIlinkAccount`
- Feishu/Lark compatibility
  - Remains on the same presenter contract with pair codes and paired open ids, even though
    this feature folder focuses on Telegram-originated Remote UX.

## Acceptance Criteria

- This feature folder documents the shipped multi-channel presenter contract instead of a
  Telegram-only IPC subset.
- The documented channel set includes `telegram`, `feishu`, `qqbot`, `discord`, and
  `weixin-ilink`.
- Renderer and preload callers use generic `getChannelSettings` and `saveChannelSettings`,
  `getChannelStatus`, `getChannelBindings`, `removeChannelBinding`, and `clearChannelBindings`
  for all shipped channels.
- Pairable channels (`telegram`, `feishu`, `qqbot`, `discord`) use
  `getChannelPairingSnapshot`, `createChannelPairCode`, `clearChannelPairCode`, and
  `removeChannelPrincipal`.
- Telegram pairing snapshots expose `allowedUserIds`.
- QQBot pairing snapshots expose both `pairedUserIds` and `pairedGroupIds`.
- Discord pairing snapshots expose `pairedChannelIds`.
- Weixin iLink documents account-login and account-lifecycle methods instead of pair-code
  methods.
- Remote settings follow per-channel Telegram, QQBot, Discord, and Weixin iLink flows rather
  than reusing Telegram-only assumptions.
- Telegram runtime behavior from the original feature remains unchanged:
  - detached-session creation from the remote flow
  - `/stop`, `/sessions`, `/use`, and `/model`
  - temporary status message handling
  - plain-text-only remote delivery

## Constraints

- The shared presenter lives in Electron main and crosses renderer through the existing
  presenter IPC path.
- Per-channel settings stay in their existing config roots:
  - `remoteControl.telegram`
  - `remoteControl.feishu`
  - `remoteControl.qqbot`
  - `remoteControl.discord`
  - `remoteControl.weixinIlink`
- `RemoteBindingStore`, `RemoteConversationRunner`, and `remoteBlockRenderer` remain the
  source of truth for bindings, session orchestration, and rendered delivery text.
- Pair-code APIs are limited to pairable channels; Weixin iLink uses login-session APIs.
- Existing Telegram compatibility methods remain callable during migration, but new renderer
  work should prefer generic channel methods.

## Non-Goals

- Reverting to a Telegram-only presenter or reintroducing Telegram-specific IPC branches for
  shared settings flows.
- Collapsing Weixin iLink account management into the pair-code flow.
- Removing Feishu/Lark compatibility from the shared presenter surface.
- Changing Telegram runtime transport rules that are already implemented outside this
  documentation fix.

## Compatibility

- Existing Telegram runtime behavior and saved settings remain valid.
- Existing Feishu/Lark, QQBot, Discord, and Weixin iLink settings stay under their current
  config shapes.
- Existing Telegram compatibility methods continue to work while generic multi-channel methods
  remain the preferred path.
- Follow-up work may refine channel-specific UI, but it must not narrow the shared presenter
  surface back to Telegram-only.

## Resolved Clarifications

- `PairableRemoteChannel` is `telegram | feishu | qqbot | discord`; Weixin iLink is excluded
  because it uses login sessions, not pair codes.
- `getChannelBindings`, `removeChannelBinding`, and `clearChannelBindings` apply to all
  channels, including Weixin iLink account-scoped bindings.
- Telegram compatibility methods are retained as migration shims, not as the preferred
  long-term renderer contract.
- No open `[NEEDS CLARIFICATION]` markers remain in this feature folder.
