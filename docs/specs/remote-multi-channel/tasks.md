# Remote Multi-Channel Foundation Tasks

Feature: `remote-multi-channel`
Spec: [spec.md](./spec.md)
Plan: [plan.md](./plan.md)

## Readiness

- [x] `T0.1` Confirm `spec.md`, `plan.md`, and `tasks.md` exist in
  `docs/specs/remote-multi-channel/`.
  Owner: Remote control maintainer
  Effort: XS
- [x] `T0.2` Confirm no `[NEEDS CLARIFICATION]` markers remain in [spec.md](./spec.md).
  Owner: Remote control maintainer
  Effort: XS

## Epic E1 Shared Contract And Registry

- [x] `T1.1` Extend shared presenter types with `RemoteChannelId`, channel descriptors, and
  generic per-channel settings / status methods that include `qqbot` and `weixin-ilink`.
  Owner: Electron main
  Effort: M
- [x] `T1.2` Add `listRemoteChannels()` to the remote presenter and preload/shared bridge
  surface.
  Owner: Electron main + preload
  Effort: S
- [x] `T1.3` Register `telegram`, `discord`, `feishu`, `qqbot`, and `weixin-ilink` through
  `ChannelManager` instead of adding hardcoded presenter-owned runtime branches.
  Owner: Electron main
  Effort: M
- [x] `T1.4` Keep Telegram-only compatibility methods callable during the registry migration.
  Owner: Electron main + renderer
  Effort: S

## Epic E2 QQBot Runtime

- [x] `T2.1` Implement `QQBotAdapter` and the official QQBot transport modules:
  access-token client, gateway session manager, parser, auth guard, command router, and
  runtime.
  Owner: Electron main
  Effort: L
- [x] `T2.2` Restrict the first-release QQBot scope to C2C direct messages, group `@bot`
  messages, and text-only passive replies.
  Owner: Electron main
  Effort: M
- [x] `T2.3` Persist QQBot runtime data under `remoteControl.qqbot` and keep C2C pairing
  separate from group authorization because QQ identity spaces differ.
  Owner: Electron main
  Effort: M

## Epic E3 WeChat iLink Runtime

- [x] `T3.1` Implement `WeixinIlinkAdapter` and the official QR-login plus long-poll runtime
  modules.
  Owner: Electron main
  Effort: L
- [x] `T3.2` Persist WeChat iLink per-account `bot_token`, `baseUrl`, owner user id,
  bindings, and runtime credentials under `remoteControl.weixinIlink`.
  Owner: Electron main
  Effort: M
- [x] `T3.3` Enforce owner-account-only remote control for the first WeChat iLink release while
  keeping multi-account runtime separation from day one.
  Owner: Electron main
  Effort: M

## Epic E4 Shared Persistence, Session, And Rendering Pipeline

- [x] `T4.1` Keep `RemoteBindingStore` as the source of truth for QQBot and WeChat iLink pair
  state, endpoint bindings, delivery state, and account-scoped persistence.
  Owner: Electron main
  Effort: M
- [x] `T4.2` Keep `RemoteConversationRunner` as the only session-creation and session-binding
  path used by QQBot and WeChat iLink command routers.
  Owner: Electron main
  Effort: M
- [x] `T4.3` Keep `remoteBlockRenderer` as the source of truth for rendered delivery text,
  including draft, final, trace, status, and block rendering consumed by new adapters.
  Owner: Electron main
  Effort: S
- [x] `T4.4` Ensure QQBot and WeChat iLink settings remain additive and do not collapse into a
  generic `channels` map.
  Owner: Electron main
  Effort: S

## Epic E5 Renderer And Settings

- [x] `T5.1` Drive Remote settings overview cards and tab headers from channel descriptors.
  Owner: Renderer
  Effort: M
- [x] `T5.2` Update sidebar remote-status aggregation to use implemented built-in channel
  descriptors instead of a hardcoded Telegram / Feishu pair.
  Owner: Renderer
  Effort: S
- [x] `T5.3` Add or maintain built-in settings panels for QQBot and WeChat iLink, including QR
  login and account-management controls for WeChat iLink.
  Owner: Renderer
  Effort: L
- [x] `T5.4` Preserve existing Telegram, Discord, and Feishu/Lark behavior while the renderer
  migrates to the descriptor-driven contract.
  Owner: Renderer + Electron main
  Effort: S

## Epic E6 QA, Compatibility, And Rollout

- [x] `T6.1` Add or maintain focused QQBot tests for parser, auth guard, command router,
  adapter, and presenter registration.
  Owner: QA + Remote control maintainer
  Effort: M
- [x] `T6.2` Add or maintain focused WeChat iLink tests for QR login flow, per-account status
  rendering, adapter behavior, and presenter persistence.
  Owner: QA + Remote control maintainer
  Effort: M
- [x] `T6.3` Update presenter and renderer regression coverage for descriptor-driven
  multi-channel behavior, including sidebar aggregation and compatibility shims.
  Owner: QA + Remote control maintainer
  Effort: M
- [x] `T6.4` Verify compatibility promises from [spec.md](./spec.md):
  Telegram and Feishu saved settings remain valid, the Telegram hook test API remains valid,
  and legacy Telegram-only compatibility methods still work.
  Owner: QA + Remote control maintainer
  Effort: S
- [x] `T6.5` Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and
  `pnpm run typecheck`, plus focused main-process and renderer Vitest suites.
  Owner: QA + Remote control maintainer
  Effort: S
