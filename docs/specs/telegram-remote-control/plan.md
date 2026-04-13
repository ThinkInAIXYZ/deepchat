# Telegram Remote Control Plan

Feature: `telegram-remote-control`
Spec: [spec.md](./spec.md)
Tasks: [tasks.md](./tasks.md)

## Summary

This plan updates the original Telegram-only implementation notes to match the shipped
multi-channel `remoteControlPresenter` surface. Telegram-specific runtime behavior still
matters, but all renderer and preload work now lands on a shared presenter contract that also
serves Feishu/Lark, QQBot, Discord, and Weixin iLink.

## Goals

- Keep the `telegram-remote-control` feature docs aligned with the current shared presenter
  surface.
- Document the generic per-channel settings, status, bindings, pairing, and account-login
  flows that renderer and preload callers must use.
- Preserve Telegram runtime behavior while preventing follow-up work from regressing the IPC
  contract back to a Telegram-only shape.
- Make channel-specific differences explicit for Telegram, QQBot, Discord, and Weixin iLink.

## Readiness

- Companion artifacts exist in `docs/specs/telegram-remote-control/`:
  - `spec.md`
  - `plan.md`
  - `tasks.md`
- No open `[NEEDS CLARIFICATION]` markers remain in [spec.md](./spec.md).
- The current source of truth for the contract is
  [remote-control.presenter.d.ts](../../../src/shared/types/presenters/remote-control.presenter.d.ts).

## Presenter And IPC Contract

The preferred renderer and preload surface is the shared `IRemoteControlPresenter` contract:

- Discovery
  - `listRemoteChannels()`
- Settings
  - `getChannelSettings<T extends RemoteChannel>(channel: T)`
  - `saveChannelSettings<T extends RemoteChannel>(channel: T, input: ChannelSettingsMap[T])`
- Runtime status
  - `getChannelStatus(channel: RemoteChannel)`
- Bindings
  - `getChannelBindings(channel: RemoteChannel)`
  - `removeChannelBinding(channel: RemoteChannel, endpointKey: string)`
  - `clearChannelBindings(channel: RemoteChannel)`
- Pairable-channel principal and pair-code flow
  - `removeChannelPrincipal(channel: PairableRemoteChannel, principalId: string)`
  - `getChannelPairingSnapshot(channel: PairableRemoteChannel)`
  - `createChannelPairCode(channel: PairableRemoteChannel)`
  - `clearChannelPairCode(channel: PairableRemoteChannel)`
- Weixin iLink account flow
  - `startWeixinIlinkLogin(input?: { force?: boolean })`
  - `waitForWeixinIlinkLogin({ sessionKey, timeoutMs? })`
  - `removeWeixinIlinkAccount(accountId)`
  - `restartWeixinIlinkAccount(accountId)`

Compatibility notes:

- Telegram compatibility helpers remain callable during migration.
- New multi-channel renderer or preload work should not add fresh Telegram-only methods when
  the generic presenter surface already covers the use case.

## Channel Flow Plan

### 1. Shared Read And Write Flow

- Renderer loads channel descriptors through `listRemoteChannels()`.
- Channel settings read and write go through `getChannelSettings()` and
  `saveChannelSettings()`.
- Status cards, sidebar aggregation, and per-tab runtime summaries use `getChannelStatus()`.
- Binding tables use `getChannelBindings()`, `removeChannelBinding()`, and
  `clearChannelBindings()`.

### 2. Telegram

- Settings remain `botToken`, `remoteEnabled`, and `defaultAgentId`.
- Status remains Telegram-specific:
  - `pollOffset`
  - `bindingCount`
  - `allowedUserCount`
  - `lastError`
  - `botUser`
- Pairing flow remains pair-code based with `allowedUserIds` in the pairing snapshot.
- The original Telegram runtime behavior stays intact:
  - detached sessions
  - `/stop`
  - `/sessions`
  - `/use`
  - `/model`
  - temporary status messages
  - plain-text delivery

### 3. QQBot

- Settings use `appId`, `clientSecret`, `remoteEnabled`, `defaultAgentId`, `defaultWorkdir`,
  and `pairedUserIds`.
- Status uses `bindingCount`, `pairedUserCount`, `lastError`, and `botUser`.
- Pairing flow remains pair-code based, but the snapshot must expose both `pairedUserIds` and
  `pairedGroupIds`.
- Group authorization stays separate from C2C pairing because QQ identity spaces differ.

### 4. Discord

- Settings use `botToken`, `remoteEnabled`, `defaultAgentId`, `defaultWorkdir`, and
  `pairedChannelIds`.
- Status uses `bindingCount`, `pairedChannelCount`, `lastError`, and `botUser`.
- Pairing flow remains pair-code based with `pairedChannelIds` in the snapshot.

### 5. Weixin iLink

- Settings use `remoteEnabled`, `defaultAgentId`, `defaultWorkdir`, and connected `accounts`.
- Status uses `accountCount`, `connectedAccountCount`, `accounts`, `bindingCount`, and
  `lastError`.
- Weixin iLink does not use pair-code APIs.
- Login and runtime ownership use:
  - `startWeixinIlinkLogin()`
  - `waitForWeixinIlinkLogin()`
  - `removeWeixinIlinkAccount()`
  - `restartWeixinIlinkAccount()`

### 6. Feishu/Lark Compatibility

- Feishu/Lark stays on the same presenter contract and remains pair-code based.
- This feature folder does not redefine Feishu-specific behavior, but follow-up work must not
  remove Feishu from the shared remote presenter surface.

## Milestones

### M0 Spec Hygiene

- Align `spec.md`, `plan.md`, and `tasks.md` with the shipped presenter contract.
- Record resolved clarification items so follow-up work does not re-open Telegram-only
  assumptions.

### M1 Shared Presenter Surface

- Keep the documented remote presenter centered on `listRemoteChannels()`, generic per-channel
  settings, generic per-channel status, generic bindings, and pairable-channel pairing APIs.
- Preserve Telegram compatibility helpers as migration shims only.

Exit criteria:

- This feature folder no longer documents a Telegram-only IPC surface.
- The expected method list matches `IRemoteControlPresenter`.

### M2 Pairable Channel Variations

- Document Telegram, QQBot, Discord, and Feishu/Lark pair-code flows with the correct channel
  snapshots and principal-removal semantics.
- Keep QQBot group authorization explicit in the plan.

Exit criteria:

- Telegram, QQBot, and Discord pairing snapshots are documented with their channel-specific
  fields.
- Pair-code APIs are clearly limited to `PairableRemoteChannel`.

### M3 Weixin iLink Account Flow

- Document Weixin iLink as an account-login flow instead of a pair-code flow.
- Keep account lifecycle methods and binding cleanup on the shared presenter surface.

Exit criteria:

- The feature docs describe Weixin iLink login and account restart/removal paths explicitly.
- The plan does not imply that Weixin iLink participates in pair-code APIs.

### M4 Renderer And Preload Usage

- Keep new Remote settings, status aggregation, and binding views aligned with the generic
  presenter surface.
- Block new Telegram-only branching in follow-up renderer or preload work unless it is a true
  compatibility shim.

Exit criteria:

- Shared methods are the preferred path for new UI work.
- Channel-specific differences are documented without changing the IPC shape.

### M5 QA And Compatibility

- Verify the feature docs mirror the current shared types.
- Verify Telegram runtime expectations remain documented.
- Keep compatibility guarantees explicit for Telegram compatibility methods and existing
  non-Telegram channels.

Exit criteria:

- Acceptance criteria in [spec.md](./spec.md) line up with the current presenter type and
  channel behavior.

## Rollout Steps

1. Treat the shared presenter type as the documentation baseline for this feature.
2. Route new renderer or preload work through generic channel methods first.
3. Use channel-specific sections only for payload or lifecycle differences:
   Telegram allowlist pairing, QQBot group authorization, Discord paired channels, and Weixin
   iLink account login.
4. Keep Telegram compatibility helpers only while existing callers still need them.
5. Verify docs and code stay aligned whenever the remote presenter surface changes.

## QA And Compatibility Checks

- Contract checks
  - `spec.md`, `plan.md`, and `tasks.md` name the same channel set:
    `telegram`, `feishu`, `qqbot`, `discord`, `weixin-ilink`
  - The documented methods match the shared presenter type.
- Channel checks
  - Telegram documents `allowedUserIds` pairing snapshots.
  - QQBot documents `pairedUserIds` and `pairedGroupIds`.
  - Discord documents `pairedChannelIds`.
  - Weixin iLink documents login-session and account-management methods instead of pair-code
    methods.
- Compatibility checks
  - Telegram runtime behavior from the original feature remains documented.
  - Telegram compatibility methods are still called out as supported shims.
  - Feishu/Lark stays represented on the shared presenter surface.
- Quality gates
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`

## Resolved Clarifications

- Pair-code methods apply only to `telegram`, `feishu`, `qqbot`, and `discord`.
- Weixin iLink uses login-session methods and account lifecycle methods instead of pair codes.
- Binding APIs apply to all channels, including Weixin iLink account-scoped bindings.
- Telegram compatibility methods remain supported, but they are not the preferred long-term
  contract for new work.
