# Implementation Plan

## Architecture

- Shared presenter contracts extend `RemoteChannelId`, pairing snapshots, settings, and status unions with `discord`.
- Main-process config normalization extends `remoteControl` with:
  - `discord`
  - `feishu.brand`
- `RemoteBindingStore` remains the single source of truth for pair codes, paired principals, bindings, and delivery-state persistence.
- `RemoteConversationRunner` keeps the existing session/binding model and now resolves channel-specific ACP default workdirs for Telegram, Feishu/Lark, QQBot, Discord, and Weixin iLink.

## Discord Runtime Design

- Transport:
  - REST for bot identity, slash command registration, replies, edits, typing, and interaction responses
  - Gateway for `READY`, `RESUMED`, `MESSAGE_CREATE`, and `INTERACTION_CREATE`
- Flow:
  - `DiscordGatewaySession` manages heartbeat, reconnect, and resume
  - `DiscordParser` normalizes gateway payloads into DeepChat inbound messages
  - `DiscordAuthGuard` enforces paired-channel authorization
  - `DiscordCommandRouter` reuses the existing remote conversation runner and command surface
  - `DiscordRuntime` handles delivery, slash command responses, and throttled message edits

## Feishu / Lark Design

- Keep the channel id as `feishu`.
- Add `brand: 'feishu' | 'lark'`.
- Pass the resolved domain into both:
  - `Lark.Client`
  - `Lark.WSClient`

## Renderer Design

- `RemoteSettings.vue`
  - add a Discord tab
  - add Feishu/Lark brand selection in the Feishu tab
  - show per-channel default workdir fields where supported
  - keep Telegram settings self-contained in the remote page
  - keep Hooks controls out of the remote settings page
- `WindowSideBar.vue`
  - aggregate remote channel status through a channel map instead of hardcoded branches

## Data / Migration

- Feishu configs without `brand` normalize to `feishu`.
- Legacy Discord root-level config is normalized into `remoteControl.discord`.
- Existing Feishu bindings and pairing data stay under `feishu`.
- Discord endpoint keys use:
  - `discord:dm:<channelId>`
  - `discord:channel:<channelId>`

## Test Strategy

- Main:
  - config normalization and migration for Discord
  - Discord parser, auth guard, adapter
  - presenter separation between Discord remote settings and Hooks config
  - Feishu `brand = lark` domain mapping
  - remote conversation runner channel-specific workdir resolution
- Renderer:
  - Discord tab and controls
  - Feishu brand selector without separate Lark tab
  - sidebar remote status aggregation including Discord
