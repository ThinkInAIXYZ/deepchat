# Remote Multi-Channel Foundation Plan

Feature: `remote-multi-channel`
Spec: [spec.md](./spec.md)

## Summary

This plan captures the implementation and rollout shape for the `remote-multi-channel`
foundation described in [spec.md](./spec.md). The feature keeps Telegram, Discord, and
Feishu/Lark on the shared remote adapter boundary while shipping QQBot and WeChat iLink as
built-in channels registered through the same `ChannelManager` path.

## Goals

- Expose a registry-driven multi-channel remote presenter contract that includes `qqbot` and
  `weixin-ilink`.
- Keep existing Telegram, Discord, and Feishu/Lark behavior compatible while moving renderer
  callers to descriptor-driven UI.
- Ship official-only QQBot and WeChat iLink transports for the first release scope in the spec.
- Preserve `RemoteBindingStore`, `RemoteConversationRunner`, and `remoteBlockRenderer` as the
  source-of-truth pipeline for bindings, session orchestration, and rendered delivery text.

## Readiness

- Companion artifacts exist in `docs/specs/remote-multi-channel/`:
  - `spec.md`
  - `plan.md`
  - `tasks.md`
- No open `[NEEDS CLARIFICATION]` markers remain in [spec.md](./spec.md).
- Discord-specific runtime details continue to live in `docs/specs/remote-discord-lark/`.

## Official Constraints To Preserve

- QQ official C2C `user_openid` and group `member_openid` stay separate identity spaces.
- QQ group authorization remains separate from C2C pairing and only reacts to
  `GROUP_AT_MESSAGE_CREATE` after explicit `/pair`.
- QQBot uses official transport primitives only:
  - `POST https://bots.qq.com/app/getAppAccessToken`
  - `GET https://api.sgroup.qq.com/gateway`
  - official gateway `identify` / `resume` / heartbeat flow
  - official C2C and group send endpoints
- WeChat iLink stays on the official QR-login plus long-poll flow only.
- The first WeChat iLink delivery remains owner-account-only and does not add a collaborator
  allowlist UI.

## Implementation Decisions

### 1. Shared Presenter Contract

- Extend shared presenter types with:
  - `RemoteChannelId`
  - `RemoteChannelDescriptor`
  - per-channel generic settings / status methods
  - QQBot and WeChat iLink settings, status, and pairing/login types
- Add `listRemoteChannels()` to `IRemoteControlPresenter` and the preload bridge.
- Keep Telegram compatibility methods available during the registry migration so existing
  renderer callers keep working.

### 2. Channel Registration And Runtime Ownership

- `ChannelManager` remains the single registration point for built-in channels.
- Register:
  - `telegram`
  - `discord`
  - `feishu`
  - `qqbot`
  - `weixin-ilink`
- `RemoteControlPresenter` rebuilds channel runtimes through descriptors and registered
  adapters instead of adding new presenter-owned branches for QQBot or WeChat iLink.

### 3. Shared Persistence, Session, And Rendering Pipeline

- `RemoteBindingStore` remains the source of truth for:
  - pair codes
  - paired principals
  - endpoint bindings
  - delivery state
  - WeChat iLink per-account runtime credentials and bindings
- QQBot settings persist under `remoteControl.qqbot`.
- WeChat iLink settings persist under `remoteControl.weixinIlink` with per-account runtime data
  instead of flattening everything into a generic `channels` map.
- `RemoteConversationRunner` remains the only path that creates, reuses, and binds remote
  sessions for QQBot and WeChat iLink.
- `remoteBlockRenderer` remains the only renderer for draft, final, trace, status, and block
  text that outbound adapters deliver.

### 4. QQBot Runtime Delivery

- Implement `QQBotAdapter` on top of the shared adapter surface.
- Add official QQBot modules for:
  - access-token acquisition
  - gateway session management
  - parser
  - auth guard
  - command router
  - runtime
- First-release scope stays limited to:
  - C2C direct messages
  - group `@bot` messages
  - text-only passive replies
- Group authorization is stored separately from paired C2C identities because the two QQ
  identity spaces are not interchangeable.

### 5. WeChat iLink Runtime Delivery

- Implement `WeixinIlinkAdapter` on top of the shared adapter surface.
- Add official iLink modules for:
  - QR-login initiation
  - QR status polling with redirect-host handling
  - `getupdates` long polling
  - `sendmessage`
  - `getconfig`
  - `sendtyping`
- Run one adapter per connected account from day one.
- Persist `bot_token`, `baseUrl`, owner user id, and bindings per connected account.
- Enforce owner-account-only authorization in the first release.

### 6. Renderer Migration

- Remote settings overview cards and tab headers are driven from channel descriptors.
- Sidebar remote-status aggregation reads implemented built-in channel descriptors instead of a
  hardcoded Telegram / Feishu pair.
- Built-in channel panels remain explicit for usability:
  - Telegram
  - Feishu/Lark
  - QQBot
  - WeChat iLink
- The shared registry contract also covers the shipped Discord runtime from
  `remote-discord-lark`.

## Milestones

### M0 Readiness And Spec Hygiene

- Confirm `spec.md`, `plan.md`, and `tasks.md` all exist under `remote-multi-channel`.
- Confirm no `[NEEDS CLARIFICATION]` markers remain in [spec.md](./spec.md).
- Align terminology across the feature to:
  - `qqbot`
  - `weixin-ilink`
  - `remoteControl.qqbot`
  - `remoteControl.weixinIlink`

### M1 Shared Contract And Registry

- Extend shared remote-control types and presenter methods.
- Add `listRemoteChannels()` and descriptor exposure.
- Register QQBot and WeChat iLink through `ChannelManager`.
- Preserve Telegram-only compatibility shims during migration.

Exit criteria:

- `IRemoteControlPresenter` exposes generic multi-channel APIs.
- `RemoteChannelId` includes `telegram`, `discord`, `feishu`, `qqbot`, and `weixin-ilink`.

### M2 QQBot Runtime

- Ship `QQBotAdapter` plus official HTTP/gateway/runtime modules.
- Persist QQBot config and pairing/group-authorization state under `remoteControl.qqbot`.
- Route QQBot replies through the shared session and rendering pipeline.

Exit criteria:

- C2C and group `@bot` messages can trigger text-only passive replies.
- QQ group authorization is independent from C2C pairing.

### M3 WeChat iLink Runtime

- Ship `WeixinIlinkAdapter` plus official QR-login and long-poll modules.
- Persist per-account WeChat iLink runtime credentials, bindings, and owner identity under
  `remoteControl.weixinIlink`.
- Start one runtime per connected account.

Exit criteria:

- QR login works through the official flow.
- Owner-account-only direct replies work for connected accounts.

### M4 Renderer And UX Migration

- Convert overview cards, tab headers, and sidebar status aggregation to channel descriptors.
- Keep explicit built-in panels for QQBot and WeChat iLink settings.
- Preserve existing Telegram / Discord / Feishu UX and compatibility behavior.

Exit criteria:

- Renderer no longer depends on hardcoded Telegram / Feishu-only branching for overview and
  sidebar status.
- New channels are configurable from the existing Remote settings page.

### M5 QA, Compatibility, And Rollout

- Run focused main-process and renderer regression suites.
- Verify config compatibility and saved-setting normalization.
- Validate official-constraint behavior for QQBot and WeChat iLink.

Exit criteria:

- Acceptance criteria in [spec.md](./spec.md) are covered by tests or targeted manual QA.
- Compatibility guarantees remain intact for legacy Telegram / Discord / Feishu callers.

## Rollout Steps

1. Land shared presenter and descriptor contracts first while keeping Telegram compatibility
   methods callable.
2. Register QQBot and WeChat iLink through `ChannelManager` before switching renderer status
   aggregation to the descriptor path.
3. Bring up QQBot runtime support with official token, gateway, auth, and passive-reply flows.
4. Bring up WeChat iLink QR login and multi-account runtime support with owner-only
   authorization.
5. Switch Remote settings overview cards, tab headers, and sidebar aggregation to the
   descriptor-driven implementation.
6. Run compatibility and regression validation before treating the feature as the preferred
   multi-channel path.

## QA And Compatibility Checks

- Shared-contract checks
  - `listRemoteChannels()` is exposed through the shared presenter bridge.
  - `RemoteChannelId` includes `qqbot` and `weixin-ilink`.
- Compatibility checks
  - Existing Telegram and Feishu saved settings still load without migration breakage.
  - Existing Telegram hook test API remains valid.
  - Existing renderer callers that still use Telegram-only compatibility methods continue to
    work.
  - Discord continues to participate in the shared registry surface without regressing the
    dedicated runtime behavior tracked in `remote-discord-lark`.
- QQBot checks
  - C2C pairing and group authorization are stored and tested separately.
  - Only `GROUP_AT_MESSAGE_CREATE` group control is accepted.
  - Passive replies stay text-only and use official send semantics.
- WeChat iLink checks
  - QR login, QR status polling, and redirect-host handling follow the official flow.
  - Owner-account-only authorization is enforced.
  - Multi-account runtime separation keeps credentials and bindings isolated.
- Shared pipeline checks
  - `RemoteBindingStore` reloads and persists QQBot and WeChat iLink data correctly.
  - `RemoteConversationRunner` remains the only session-binding path.
  - `remoteBlockRenderer` output stays the delivery source of truth for remote adapters.
- Quality gates
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - `pnpm run typecheck`

## Risks And Mitigations

- QQ identity-space mismatch can cause incorrect authorization assumptions.
  - Mitigation: keep separate persisted state and separate router checks for C2C vs group
    control.
- WeChat iLink multi-account state can leak across accounts if runtime ownership is not isolated.
  - Mitigation: keep per-account credentials, bindings, and runtime instances under
    `remoteControl.weixinIlink`.
- Renderer migration can accidentally regress legacy Telegram / Feishu / Discord surfaces.
  - Mitigation: keep compatibility shims during rollout and verify descriptor-driven UI with
    focused renderer regression tests.
