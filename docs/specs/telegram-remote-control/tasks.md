# Telegram Remote Control Tasks

Feature: `telegram-remote-control`
Spec: [spec.md](./spec.md)
Plan: [plan.md](./plan.md)

These tasks document the remote presenter contract that follow-up work must preserve. They are
tracked as completed because the current codebase already ships this surface; future changes
should use them as a regression checklist.

## Readiness And Clarifications

- [x] `T0.1` Keep companion artifacts in `docs/specs/telegram-remote-control/`:
  `spec.md`, `plan.md`, and `tasks.md`.
  Owner: Remote control maintainer
  Effort: XS
- [x] `T0.2` Resolve the presenter-scope clarification: the feature now documents the shared
  multi-channel `remoteControlPresenter` contract instead of a Telegram-only IPC surface.
  Owner: Remote control maintainer
  Effort: XS
- [x] `T0.3` Resolve the pairing clarification: pair-code methods apply only to
  `telegram`, `feishu`, `qqbot`, and `discord`; Weixin iLink uses login-session methods.
  Owner: Remote control maintainer
  Effort: XS
- [x] `T0.4` Resolve the binding clarification: binding list, remove, and clear flows apply to
  every remote channel, including Weixin iLink account-scoped bindings.
  Owner: Remote control maintainer
  Effort: XS

## Epic E1 Shared Presenter Surface

- [x] `T1.1` Document `listRemoteChannels()` and the shipped channel set:
  `telegram`, `feishu`, `qqbot`, `discord`, `weixin-ilink`.
  Owner: Electron main + preload
  Effort: S
- [x] `T1.2` Document generic per-channel settings APIs:
  `getChannelSettings<T>()` and `saveChannelSettings<T>()`.
  Owner: Electron main + preload
  Effort: S
- [x] `T1.3` Document generic runtime and binding APIs:
  `getChannelStatus()`, `getChannelBindings()`, `removeChannelBinding()`,
  `clearChannelBindings()`.
  Owner: Electron main + renderer
  Effort: S
- [x] `T1.4` Document pairable-channel APIs:
  `removeChannelPrincipal()`, `getChannelPairingSnapshot()`, `createChannelPairCode()`,
  `clearChannelPairCode()`.
  Owner: Electron main + renderer
  Effort: S
- [x] `T1.5` Document Weixin iLink account APIs:
  `startWeixinIlinkLogin()`, `waitForWeixinIlinkLogin()`, `removeWeixinIlinkAccount()`,
  `restartWeixinIlinkAccount()`.
  Owner: Electron main + renderer
  Effort: S
- [x] `T1.6` Record Telegram compatibility methods as supported migration shims rather than the
  preferred long-term presenter surface.
  Owner: Electron main + renderer
  Effort: XS

## Epic E2 Channel Variations

- [x] `T2.1` Keep Telegram documentation explicit about settings, runtime status, pair-code
  flow, `allowedUserIds`, and original command/runtime behavior.
  Owner: Telegram runtime maintainer
  Effort: M
- [x] `T2.2` Keep QQBot documentation explicit about settings, runtime status, pair-code flow,
  `pairedUserIds`, and `pairedGroupIds`.
  Owner: QQBot runtime maintainer
  Effort: M
- [x] `T2.3` Keep Discord documentation explicit about settings, runtime status, pair-code
  flow, and `pairedChannelIds`.
  Owner: Discord runtime maintainer
  Effort: M
- [x] `T2.4` Keep Weixin iLink documentation explicit about settings, runtime status,
  account-login flow, and account lifecycle methods.
  Owner: Weixin iLink runtime maintainer
  Effort: M
- [x] `T2.5` Preserve Feishu/Lark on the shared presenter surface even though this feature
  folder remains Telegram-originated.
  Owner: Remote control maintainer
  Effort: S

## Epic E3 Renderer And Preload Adoption

- [x] `T3.1` Treat generic channel methods as the preferred path for new Remote settings work.
  Owner: Renderer
  Effort: S
- [x] `T3.2` Keep status cards, binding views, and follow-up IPC work aligned with generic
  channel reads instead of fresh Telegram-only branches.
  Owner: Renderer + preload
  Effort: S
- [x] `T3.3` Allow Telegram-only helpers to remain only for compatibility with existing callers.
  Owner: Renderer + preload
  Effort: XS

## Epic E4 QA And Acceptance

- [x] `T4.1` Verify the feature docs mirror
  `src/shared/types/presenters/remote-control.presenter.d.ts`.
  Owner: QA + Remote control maintainer
  Effort: XS
- [x] `T4.2` Verify acceptance criteria cover Telegram, QQBot, Discord, and Weixin iLink
  variations without dropping Feishu/Lark from the shared channel set.
  Owner: QA + Remote control maintainer
  Effort: S
- [x] `T4.3` Run repository quality gates after documentation updates:
  `pnpm run format`, `pnpm run i18n`, `pnpm run lint`.
  Owner: QA + Remote control maintainer
  Effort: XS
