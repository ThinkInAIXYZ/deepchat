# Remote Adapter Framework + Plugin Seam Plan

## Main Process

- Add internal channel contracts in `src/main/presenter/remoteControlPresenter/types/channel.ts`:
  - adapter lifecycle
  - status snapshots
  - factory interface
  - plugin manifest ABI
- Add `ChannelAdapter` base class for:
  - connect / disconnect idempotency
  - status emission
  - logger integration
  - shared attachment download helpers
- Add `ChannelManager` + `AdapterRegistry` for:
  - factory registration
  - adapter registration
  - lifecycle fan-out
  - status caching
  - future event / stream dispatch seams
- Implement built-in `TelegramAdapter` and `FeishuAdapter` as wrappers around existing Telegram / Feishu runtimes.
- Refactor `RemoteControlPresenter` to:
  - register built-in factories
  - rebuild per-channel adapters
  - read runtime status from `ChannelManager`
  - keep current presenter API unchanged

## Behavior Preservation

- Keep `RemoteBindingStore`, `RemoteConversationRunner`, and `RemoteBlockRenderer` as the existing source of truth.
- Keep Telegram command registration and Telegram / Feishu routing logic intact by reusing:
  - `RemoteCommandRouter`
  - `FeishuCommandRouter`
  - `TelegramPoller`
  - `FeishuRuntime`
- Preserve current fatal-error behavior by disabling the persisted channel config and unregistering the active adapter.

## Plugin Seam

- Define a validated manifest ABI for future channel plugins.
- Keep plugin source support in the factory registry so built-in and future plugin factories share the same lookup path.
- Do not execute third-party plugin bundles yet.
- Document that future plugins must run behind a dedicated host process instead of direct Electron main / renderer imports.

## Testing

- Add unit tests for:
  - `ChannelAdapter`
  - `ChannelManager`
  - plugin manifest parsing
  - `TelegramAdapter`
  - `FeishuAdapter`
- Update `RemoteControlPresenter` tests to verify manager-driven runtime rebuild behavior still preserves:
  - serialized startup
  - in-flight startup status
  - fatal auto-disable
  - binding / pairing presenter contract
  - default-agent sanitization

## Validation

- Run node typecheck first to catch main-process interface mismatches.
- Run focused Vitest coverage for the new channel framework and presenter regression tests.
- Finish with repository quality gates:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - `pnpm run typecheck`
