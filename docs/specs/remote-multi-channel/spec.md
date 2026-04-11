# Remote Adapter Framework + Plugin Seam

## Summary

Refactor DeepChat remote control from presenter-owned Telegram / Feishu runtimes into a unified adapter framework. Telegram and Feishu remain the only user-visible remote channels in this iteration, but the main-process runtime must expose a stable adapter / factory boundary so future built-in channels and locally installed third-party IM integrations can plug in without rewriting `RemoteControlPresenter`.

This iteration does not ship a runnable third-party plugin system. It only reserves the ABI, manifest format, and process-boundary constraints that future channel plugins must follow.

## User Stories

- As a maintainer, I can add a new built-in remote channel without adding another presenter-owned runtime branch beside Telegram and Feishu.
- As a maintainer, I can migrate Telegram and Feishu onto the same adapter lifecycle without changing their existing command, pairing, binding, or streaming behavior.
- As a future plugin author, I can target a documented channel-plugin ABI instead of patching DeepChat internals.
- As a desktop user, my existing Remote settings page and sidebar status indicator continue to work exactly as before for Telegram and Feishu.

## Acceptance Criteria

- `RemoteControlPresenter` manages remote channels through `ChannelManager` and built-in adapter factories instead of holding `TelegramPoller` / `FeishuRuntime` instances directly.
- A shared internal contract exists for:
  - channel adapter lifecycle
  - channel status snapshots
  - channel factories / registry
  - future plugin manifest parsing
- Telegram remote control behavior remains unchanged:
  - commands
  - callback menus
  - pending interaction flow
  - binding / pairing rules
  - fatal auto-disable
  - streamed delivery behavior
- Feishu remote control behavior remains unchanged:
  - direct-message pairing
  - mention gating in groups / topics
  - command handling
  - pending interaction flow
  - fatal auto-disable
  - streamed delivery behavior
- Renderer-visible contracts stay compatible:
  - `RemoteChannel` remains `'telegram' | 'feishu'`
  - existing Remote settings tabs remain Telegram + Feishu only
  - existing sidebar polling remains compatible
- A channel plugin manifest ABI exists and is validated in tests.

## Constraints

- Do not load third-party channel JavaScript directly inside Electron main or renderer.
- Third-party channels are future work and must eventually run behind a dedicated plugin host boundary.
- This iteration does not add Discord / Slack runtime code, configuration schema, or settings UI.
- This iteration does not add plugin installation UI, plugin directory scanning, or plugin-host process management.
- Existing `remoteControl` persisted data, Telegram hook test API, and renderer IPC contract must remain backward compatible.

## Non-Goals

- Shipping a complete third-party channel marketplace or installer.
- Shipping Discord / Slack / QQ as user-configurable remote channels in this iteration.
- Reworking Remote settings UI structure beyond compatibility-preserving changes.
- Replacing current Telegram / Feishu command routers with a fully generic cross-platform command layer.

## Plugin ABI Guardrails

- Future channel plugins use `manifest.json + bundle.js + index.d.ts + optional config.schema.json`.
- The manifest must declare:
  - `schemaVersion`
  - `pluginId`
  - `apiVersion`
  - `entry`
  - `types`
  - `channelType`
- The JS bundle exports `createChannelPlugin()`.
- Future plugin configuration UI must be schema-driven; plugins do not inject renderer code.

## Compatibility

- Existing Telegram and Feishu settings continue to load from the current `remoteControl` config structure.
- Existing renderer code keeps using the same presenter methods.
- Existing Telegram / Feishu runtime tests remain valid, and new adapter-layer tests cover the new boundaries.
