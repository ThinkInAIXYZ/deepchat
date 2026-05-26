# Plan

## Implementation Approach
- Inspect `RemoteControlPresenter.saveFeishuSettings` and binding store ownership of Feishu paired users.
- Update Feishu settings save to persist editable settings while preserving `config.pairedUserOpenIds`.
- Keep runtime rebuild behavior unchanged after saving credentials or enabled state.

## Affected Interfaces
- `saveFeishuSettings(input: FeishuRemoteSettings)` behavior changes to ignore `input.pairedUserOpenIds` for persistence.
- Returned settings remain `FeishuRemoteSettings` and include the current paired users from storage.

## Data Flow
- Frontend sends normalized Feishu settings, possibly from stale form state.
- Main process updates editable Feishu config fields.
- Existing `pairedUserOpenIds` is copied from the current config, so pairing state created by command handling is preserved.

## Compatibility
- No IPC or renderer contract changes.
- Old frontend payloads with `pairedUserOpenIds` continue to be accepted but cannot mutate authorization state.

## Test Strategy
- Add a main presenter unit test that seeds a paired Feishu user, saves settings with `pairedUserOpenIds: []`, and expects the paired user to remain.
- Run focused remote control presenter tests, then required format/i18n/lint commands if feasible.
