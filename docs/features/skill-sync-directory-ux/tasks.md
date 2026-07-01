# Skill Sync Directory UX Tasks

## Documentation

- [x] Capture current UX issues and target behavior.
- [x] Add before/after ASCII layout for the sync directory tab.
- [x] Add before/after ASCII layout for the generic Agents directory entry.
- [x] Record non-goals around Git operations and older external-tool sync.

## Implementation

- [x] Replace editable directory input/save with a setting-style directory row.
- [x] Save the sync directory immediately after folder picker selection.
- [x] Check whether the configured sync directory exists.
- [x] Hide Export / Import controls when no directory is configured or the configured directory is
      missing.
- [x] Show a warning icon/message when the configured directory is missing.
- [x] Update export defaults: include disabled by default, empty selection, toolbar filters.
- [x] Add export `Select visible` and `Clear selection`.
- [x] Remove the persistent export preview panel.
- [x] Open an export confirmation dialog populated by export preview.
- [x] Execute export only after confirming the dialog.
- [x] Invalidate or clear stale export confirmation preview when selection/filter inputs change.
- [x] Make the export skill list scroll internally.
- [x] Auto-refresh import preview when switching to the Import tab.
- [x] Add component-local throttled import preview cache.
- [x] Invalidate import preview cache on directory save, export completion, and import completion.
- [x] Update import defaults: empty selection and `overwrite` conflict strategy.
- [x] Add import filters, `Select visible`, and `Clear selection`.
- [x] Make the import skill list scroll internally.
- [x] Keep invalid and same import rows unselectable.
- [x] Align `SkillPresenter.executeSyncDirectoryImport()` omitted-strategy fallback with `overwrite`.
- [x] Add or update vue-i18n strings in every locale.
- [x] Update renderer tests for selection, export confirmation, auto-refresh, cache, and default
      strategy.
- [x] Update presenter test for omitted import strategy fallback if implementation changes it.
- [x] Register generic `Agents` user skill directory at `~/.agents/skills/`.
- [x] Add `AgentsAdapter` and register it with the format adapter registry.
- [x] Add `agents` icon mapping to Agents, install-to-agent, status, prompt, and wizard surfaces.
- [x] Update skill sync tests for generic Agents registration and format conversion.

## Verification

- [x] Re-run `pnpm run format`.
- [x] Re-run `pnpm run i18n`.
- [x] Re-run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run targeted renderer tests for `SkillSyncSettings.test.ts`.
- [x] Run targeted presenter tests if the presenter fallback changes.
- [x] Run targeted skill sync tests for generic Agents registration and format conversion.
