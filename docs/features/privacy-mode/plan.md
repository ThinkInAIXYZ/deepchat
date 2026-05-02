# Privacy Mode Plan

## Settings Flow

- Add `privacyModeEnabled` to the persisted app settings defaults.
- Expose typed getter/setter access through `ConfigPresenter`, `UiSettingsHelper`, settings route contracts, route adapter, and renderer `uiSettingsStore`.
- Publish typed settings change payloads so the renderer reacts immediately.

## Automatic Request Gating

- `UpgradePresenter`: skip the app-focus auto-check path while Privacy Mode is on.
- `ProviderDbLoader`: skip automatic startup/background refresh while keeping cached or built-in snapshots active.
- `AcpRegistryService`: skip automatic manifest refresh and icon sync while keeping cached or built-in snapshots active.
- `McpPresenter` and `ServerManager`: skip automatic npm registry probing and delayed background refresh while keeping cached/custom registry state active.

## UI

- Add `PrivacySettingsSection` to Data settings.
- Show a switch, a short explanation, and an inline audit list of the covered automatic outbound paths.
- Keep the copy explicit about manual actions and configured integrations staying available.

## Validation

- Update typed settings route tests and renderer store tests.
- Add presenter/service tests for automatic skip and manual refresh behavior.
- Add Common settings UI coverage for the new section.
