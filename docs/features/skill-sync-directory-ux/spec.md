# Skill Sync Directory UX

## Context

The Settings > Skills > Sync Directory tab is the local multi-skill repository workflow backed by
`SkillImportExportTab.vue`, `SkillClient`, and `SkillPresenter` sync directory routes. It is often
used with a Git-tracked folder, but DeepChat does not own Git commit, pull, or push in this flow.

Current interaction problems:

- Export opens with enabled mutable skills already selected, but there is no select-all or clear-all
  control.
- Disabled skills are excluded by default and the `Include disabled skills` control sits below the
  export list.
- Import requires a manual preview refresh before any rows appear.
- Import conflict strategy defaults to rename, while the expected default is replacing the local
  item.
- Export cannot run until the user previews, even though `executeSyncDirectoryExport()` already
  recomputes the preview internally before writing.
- The Agents tab supports several vendor-specific user skill directories, but not the generic
  `~/.agents/skills` directory used by shared Agents skills.

## Goal

Make local skill sync directory import/export explicit, refreshable, and reversible enough that users
can operate on selected skills without a required preview step or hidden all-skill selection.

## Acceptance Criteria

- The Sync Directory tab keeps the existing directory config card and Export / Import sub-tabs.
- The sync directory card behaves like a setting row, not a free-text form.
- Users choose or change the sync directory through the folder picker.
- The selected directory path is displayed read-only after selection.
- When no directory is configured, Export / Import controls are hidden and the card prompts the user
  to choose a directory.
- When the configured directory no longer exists, Export / Import controls are hidden and the card
  shows a warning icon plus missing-directory copy.
- Export and Import use a top toolbar for filters and bulk selection actions.
- Disabled skills are included in export candidates by default.
- `Include disabled skills` is shown above the export list, next to the other filters.
- Export selection starts empty on first load instead of selecting every skill implicitly.
- Export provides visible `Select visible` and `Clear selection` actions.
- `Select visible` selects only currently filtered, mutable export candidates.
- `Clear selection` clears the full export selection, not only visible rows.
- Export is enabled when a sync directory is configured, at least one skill is selected, and export
  is not already running.
- The Export sub-tab does not show a persistent export preview panel.
- Clicking Export previews the current selected skills in a confirmation dialog before writing.
- Confirming the dialog executes export; canceling leaves files untouched.
- The export skill list scrolls internally so the Export action remains visible.
- Switching to the Import sub-tab automatically refreshes the import preview when a sync directory
  is configured.
- Import keeps a manual refresh action for explicit rescans.
- Import preview refresh is throttled and cached in the renderer to avoid duplicate directory scans
  from tab switching.
- Import preview cache is keyed by the configured sync directory.
- Manual refresh bypasses the cache.
- Saving a new sync directory, completing an export, and completing an import invalidates the import
  preview cache.
- Import selection starts empty after an automatic preview; users select rows explicitly.
- Import provides visible `Select visible` and `Clear selection` actions.
- `Select visible` does not select `invalid` or `same` import rows.
- Import is enabled when at least one import row is selected and import is not already running.
- The import skill list scrolls internally so the Import action remains visible.
- Import conflict strategy defaults to `overwrite` / replace local.
- User-facing strings are added through vue-i18n keys.
- Renderer tests cover default empty selection, bulk select/clear, export confirmation, automatic
  import preview on tab switch, cache invalidation, internal list scrolling, and default overwrite
  strategy.
- The Agents tab includes a generic `Agents` entry backed by `~/.agents/skills/`.
- The generic `Agents` entry uses the same `*/SKILL.md` folder format, scanning, detail view, adopt,
  and link-management flows as other folder-based user agents.
- Existing discovery, status, and install-to-agent UI surfaces show the generic `Agents` entry with
  a stable icon instead of falling back to the default unknown-tool icon.

## UX Shape

Before:

```txt
+--------------------------------------------------------------------------+
| Local multi-skill sync directory                                         |
| [/Users/me/skills_______________________________] [Browse] [Save]        |
+--------------------------------------------------------------------------+
| [ Export to directory ] [ Import from directory ]                        |
+--------------------------------------------------------------------------+
| [x] skill-a                                                Enabled       |
| [x] skill-b                                                Enabled       |
| [ ] disabled-skill                                         Disabled      |
+--------------------------------------------------------------------------+
| [ ] Include disabled skills                                              |
+--------------------------------------------------------------------------+
| Preview export to see target states.                                     |
+--------------------------------------------------------------------------+
|                                      [Preview Export] [Export Now off]   |
+--------------------------------------------------------------------------+
```

After:

```txt
+--------------------------------------------------------------------------+
| Local multi-skill sync directory                                         |
| [folder] /Users/me/skills                         [Change Directory]    |
+--------------------------------------------------------------------------+
| [ Export to directory ] [ Import from directory ]                        |
+--------------------------------------------------------------------------+
| Search [________________] [x] Include disabled   0 selected              |
|                                      [Select visible] [Clear selection]  |
+--------------------------------------------------------------------------+
| [ ] skill-a                                                Enabled       |
| [ ] skill-b                                                Enabled       |
| [ ] disabled-skill                                         Disabled      |
| ... list scrolls here ...                                                   |
+--------------------------------------------------------------------------+
|                                      [Export Selected]                    |
+--------------------------------------------------------------------------+
| Export confirmation dialog                                                |
| +----------------------------------------------------------------------+ |
| | Export 3 skills to /Users/me/skills                                  | |
| | skill-a        New                                                   | |
| | skill-b        Modified                                              | |
| | disabled-skill Same                                                  | |
| |                                             [Cancel] [Confirm Export] | |
| +----------------------------------------------------------------------+ |
+--------------------------------------------------------------------------+
```

Missing directory:

```txt
+--------------------------------------------------------------------------+
| Local multi-skill sync directory                                         |
| [!] /Users/me/deleted-skills                       [Change Directory]    |
| Directory not found. Choose an existing folder to continue.              |
+--------------------------------------------------------------------------+
```

Import after switching tabs:

```txt
+--------------------------------------------------------------------------+
| Search [________________] State [All v]       0 selected   [Refresh]     |
|                                      [Select visible] [Clear selection]  |
+--------------------------------------------------------------------------+
| [ ] skill-a             New        /sync/skills/skill-a                  |
| [ ] skill-b             Conflict   /sync/skills/skill-b                  |
| [ ] skill-c             Same       /sync/skills/skill-c                  |
| [ ] broken              Invalid    missing SKILL.md                      |
+--------------------------------------------------------------------------+
| Conflict strategy: (*) Replace local  ( ) Rename imported  ( ) Skip      |
|                                                        [Import Selected] |
+--------------------------------------------------------------------------+
```

Agents tab:

```txt
Before
+--------------------------------------------------------------------------+
| Agents                                                [Refresh]          |
| [Claude Code 0] [OpenAI Codex 3] [Cursor 0] [OpenCode 0]                |
| [Goose 0] [Kilo Code 0] [GitHub Copilot (User) 0]                       |
+--------------------------------------------------------------------------+

After
+--------------------------------------------------------------------------+
| Agents                                                [Refresh]          |
| [Agents 12] [Claude Code 0] [OpenAI Codex 3] [Cursor 0]                 |
| [OpenCode 0] [Goose 0] [Kilo Code 0] [GitHub Copilot (User) 0]          |
| Selected: Agents                                                         |
| /Users/me/.agents/skills/                                                |
+--------------------------------------------------------------------------+
```

## Constraints

- Keep the sync directory layout as `<syncDir>/skills/<name>/SKILL.md`.
- Do not change the existing route names.
- Do not add a new global store for this tab; component-local state is enough.
- Do not add a new dependency for throttling or caching.
- Reuse existing path-existence API instead of adding a new sync-directory validation route.
- Preserve existing invalid/same skip behavior in `SkillPresenter` execution.

## Non-Goals

- No automatic scheduled sync.
- No Git commit, pull, push, branch, or remote management.
- No changes to the older external-tool `SkillSyncDialog` import/export wizard.
- No changes to skill installation from Git repositories.
- No new sync directory file format.
- No configurable custom Agents root; the generic entry targets the conventional
  `~/.agents/skills/` path only.

## Open Questions

None.
