# Remote Adapter Framework + Plugin Seam Tasks

## Phase 1: Internal Contracts

- [x] Add `types/channel.ts` with adapter lifecycle, status, factory, attachment, and plugin manifest types.
- [x] Add plugin manifest validation helpers and ABI version constants.
- [x] Add `ChannelAdapter` base class with idempotent lifecycle management, status emission, logger integration, and shared download helpers.
- [x] Add `ChannelManager` and `AdapterRegistry` with built-in and future plugin source support.

## Phase 2: Built-In Adapter Migration

- [x] Implement `TelegramAdapter` as a wrapper around the existing Telegram runtime stack.
- [x] Implement `FeishuAdapter` as a wrapper around the existing Feishu runtime stack.
- [x] Preserve existing command routing, pairing, binding, callback, pending interaction, and streaming behavior.
- [x] Preserve fatal auto-disable by disabling persisted config and unregistering the active adapter.

## Phase 3: Presenter Refactor

- [x] Refactor `RemoteControlPresenter` to manage remote runtimes through `ChannelManager`.
- [x] Register built-in adapter factories for Telegram and Feishu.
- [x] Rebuild only the affected adapter when channel settings change.
- [x] Keep renderer-visible presenter methods and `RemoteChannel` compatibility unchanged.

## Phase 4: Plugin Seam

- [x] Reserve plugin manifest ABI fields for future third-party channel packages.
- [x] Keep plugin source support in the adapter registry without executing external bundles.
- [x] Document the future host-process boundary for third-party channel plugins.

## Phase 5: Validation

- [x] Add unit tests for `ChannelAdapter`, `ChannelManager`, plugin manifest validation, `TelegramAdapter`, and `FeishuAdapter`.
- [x] Update `RemoteControlPresenter` regression tests for manager-driven runtime rebuild behavior.
- [x] Verify main-process remote control suites still pass after the migration.
- [x] Verify renderer Remote settings and sidebar compatibility tests still pass.
- [ ] Run repository-wide format, i18n, lint, and full typecheck gates.
