# Skill Sync Directory UX Plan

## Implementation Approach

Keep the fix in the existing sync directory path. The shortest useful change is mostly renderer
state and layout in `SkillImportExportTab.vue`; route contracts can stay as-is because execute
methods already accept the selected names and recompute their own preview.

## Affected Files

- `src/renderer/settings/components/skills/SkillImportExportTab.vue`
- `src/renderer/settings/components/skills/SkillAgentsTab.vue`
- `src/renderer/settings/components/skills/InstallSkillToAgentDialog.vue`
- `src/renderer/settings/components/skills/SyncPromptDialog.vue`
- `src/renderer/settings/components/skills/SyncStatusCard.vue`
- `src/renderer/settings/components/skills/SkillSyncDialog/ExportWizard.vue`
- `src/renderer/settings/components/skills/SkillSyncDialog/ToolSelector.vue`
- `src/main/presenter/skillSyncPresenter/toolScanner.ts`
- `src/main/presenter/skillSyncPresenter/adapters/agentsAdapter.ts`
- `src/main/presenter/skillSyncPresenter/adapters/index.ts`
- `src/renderer/src/i18n/*/settings.json`
- `src/main/presenter/skillPresenter/index.ts`
- `test/renderer/components/SkillSyncSettings.test.ts`
- `test/main/presenter/skillPresenter/skillPresenter.test.ts` if the presenter fallback default is
  changed
- `test/main/presenter/skillSyncPresenter/toolScanner.test.ts`
- `test/main/presenter/skillSyncPresenter/adapters/index.test.ts`
- `test/main/presenter/skillSyncPresenter/formatConverter.test.ts`
- `test/main/presenter/skillSyncPresenter/security.test.ts`
- `test/main/presenter/skillSyncPresenter/index.test.ts`

## Renderer Flow

Directory:

- Replace the editable directory input and save button with a read-only setting row.
- Use the existing folder picker to choose or change the directory.
- Save immediately after choosing a folder.
- Check the saved directory with the existing project path-existence client.
- Hide the Export / Import tabs when no directory is configured or the configured directory is
  missing.
- Show a warning icon and message when the saved directory path no longer exists.

Export:

- Initialize `includeDisabled` to `true`.
- Initialize `selectedExportNames` to an empty `Set`.
- Add export toolbar state for text filtering and selected count.
- Compute export candidates from mutable skills, disabled inclusion, and text filter.
- Add `selectVisibleExport()` and `clearExportSelection()`.
- Enable export from `selectedExportNames.size > 0`, config presence, and non-exporting state.
- Put the export candidate list in a bounded internal scroll container.
- Remove the persistent export preview panel and standalone preview button.
- `requestExportConfirmation()` calls `previewSyncDirectoryExport()` for the selected names and opens
  a confirmation dialog.
- `executeExport()` runs only from the confirmation dialog.
- Clear the dialog preview whenever selection or `includeDisabled` changes.

Import:

- Initialize `importStrategy` to `overwrite`.
- Initialize `selectedImportNames` to an empty `Set`.
- Add import toolbar state for text filtering, optional state filtering, selected count, refresh,
  `Select visible`, and `Clear selection`.
- Put the import preview list in a bounded internal scroll container.
- Watch `activeTab`; when it becomes `import`, call a cached preview refresh if config exists.
- Do not auto-select rows after automatic preview.
- `selectVisibleImport()` selects only visible rows where state is neither `invalid` nor `same`.
- Enable import from `selectedImportNames.size > 0` and non-importing state.

## Preview Cache

Use component-local cache:

- Key: configured `skillsDirectory`.
- Value: latest `SkillSyncDirectoryImportPreview` and timestamp.
- TTL: short, around 2 seconds, only to dedupe repeated tab switching.
- In-flight request: reuse the same promise while a preview is already loading.
- Manual refresh: bypass cache.
- Invalidate when directory config changes, export completes, or import completes.

This avoids a store or backend cache. If directory scans later become expensive, move caching behind
`SkillClient`; do not do that first.

## Presenter Flow

- Keep route input/output contracts unchanged.
- Change the internal `executeSyncDirectoryImport()` fallback from `rename` to `overwrite` so callers
  that omit strategy match the UI default.
- Preserve explicit `rename`, `overwrite`, and `skip` handling.

## Generic Agents Directory Flow

- Register a user-level `Agents` tool with id `agents`, directory `~/.agents/skills/`, and
  `*/SKILL.md` folder scanning.
- Use the existing folder-based capabilities so the Agents tab can manage links and adoptions
  without a special case.
- Add a thin `AgentsAdapter` that reuses the Claude/Codex `SKILL.md` parser and serializer while
  recording source tool id `agents`.
- Add the `agents` icon mapping to existing skill sync surfaces that render tool icons.
- Do not add a directory picker or custom path setting for this entry.

## Tests

Renderer tests should assert:

- No directory or a missing directory hides export/import operation controls.
- Choosing a directory saves it immediately and reveals operation controls.
- Export does not select all skills on mount.
- Disabled mutable skills are visible by default.
- `Select visible` selects filtered export rows.
- `Clear selection` clears export rows.
- Export button opens a confirmation dialog populated by `previewSyncDirectoryExport()`.
- Canceling the confirmation dialog does not call `executeSyncDirectoryExport()`.
- Switching to Import triggers one automatic preview.
- Repeated quick switches reuse cache or in-flight request.
- Manual refresh calls preview again.
- Import default strategy passed to execution is `overwrite`.
- Import `Select visible` excludes `same` and `invalid`.
- Export and import list containers render as internally scrollable areas.

Presenter tests should assert:

- Calling `executeSyncDirectoryImport()` without `strategy` overwrites by default.

Skill sync presenter tests should assert:

- `EXTERNAL_TOOLS` includes the generic `Agents` tool at `~/.agents/skills/`.
- The adapter registry exposes `agents`.
- `FormatConverter` can parse and serialize the generic Agents format.

## Validation

After implementation:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- Targeted renderer test for `SkillSyncSettings.test.ts`
- Targeted presenter test only if `SkillPresenter` fallback changes

## Compatibility

Existing saved sync directory config remains valid. Existing sync directories keep the same layout.
Existing explicit import strategies remain honored.
