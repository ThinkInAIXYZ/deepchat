# DeepChat Skills Management Tasks

Status: Phase 1 through Phase 8 are implemented for the supported V1.1 paths. V1.1 keeps the
working backend paths, removes the over-split Install/Discover UI, moves install-to-agent into
Library rows, and keeps sync directory as a separate local repository workflow. Adoption still
defaults conflicts to safe rename; destructive overwrite and custom agent path management remain
deferred until the agent registry has a durable custom-target model.
The standalone draft has been absorbed into this SDD folder and removed.

## Phase 0: Design Contract Check

- [x] Keep the `settings-skills` route as one tabbed settings surface.
- [x] Match the ASCII layouts in `spec.md` before implementing UI.
- [x] Use existing shadcn settings controls and lucide/Iconify icons.
- [x] Use compact row/table layouts; do not add hero panels or nested cards.
- [x] Add loading, empty, permission-error, conflict, broken-link, and invalid-skill states.
- [x] Ensure every status uses text, not color alone.
- [x] Truncate long paths and descriptions with tooltips.
- [x] Keep all user-facing labels in i18n files.

## Phase 1: Database State And Library Disable

- [x] Add `src/shared/types/skillManagement.ts`.
- [x] Add database-backed management state helper under `src/main/presenter/skillPresenter/`.
- [x] Store source provenance, disabled state, runtime extension settings, sync config, and agent
      links in the application database.
- [x] Migrate legacy `<skillsPath>/.deepchat-meta/<skill>.json` runtime configs into database state.
- [x] Remove migrated legacy `.deepchat-meta` files after successful database write.
- [x] Stop writing new `.deepchat-meta` files under the skills path.
- [x] Add a test that the configured skills path remains a pure skill content directory.
- [x] Add `getUnifiedSkillCatalog()` to `ISkillPresenter`.
- [x] Add `setSkillDeepChatDisabled()` to `ISkillPresenter`.
- [x] Add typed routes and `SkillClient` methods for unified catalog and disabled toggle.
- [x] Filter disabled skills from `getMetadataPrompt()`.
- [x] Filter disabled skills from `loadSkillContent()`.
- [x] Filter disabled skills from `validateSkillNames()`.
- [x] Keep disabled skills visible in the Library catalog.
- [x] Add Library disabled toggle UI and i18n strings.
- [x] Add unit tests for database migration, persistence, disabled filtering, and restart behavior.

## Phase 2: Agents Scan And Classification

- [x] Add shared agent-management types for installed agents, skill rows, owners, statuses, and
      actions.
- [x] Add route contracts for agent scan/list/detail.
- [x] Keep read-only classification helpers inside `SkillSyncPresenter`; defer a separate
      `agentManagement.ts` until adoption/repair/remove logic needs it.
- [x] Reuse `toolScanner.getAllTools()` and filter link/adopt support to user-level
      `*/SKILL.md` tools.
- [x] Implement read-only installed-agent detection.
- [x] Implement read-only skill row classification.
- [x] Exclude project-level and single-file tools from link/adopt actions.
- [x] Add `SkillSyncClient` methods for agent scan/list/detail.
- [x] Add `SkillAgentsTab.vue` and `AgentSkillTable.vue`.
- [x] Match the read-only Agents tab ASCII layout, row states, and action placement from `spec.md`;
      keep write actions disabled until Phase 3.
- [x] Add tests for linked, agent-owned, external-link, broken-link, and conflict classification.

## Phase 3: Adoption And Agent Links

- [x] Add adopt preview route and presenter method.
- [x] Add adopt execute route and presenter method.
- [x] Copy adoption sources through `~/.deepchat/tmp/skill-adoptions/<operation-id>`.
- [x] Move original agent content to `~/.deepchat/backups/skill-adoptions/...`.
- [x] Replace adopted agent path with a symlink or Windows junction.
- [x] Record database source provenance and `agentLinks`.
- [x] Add default conflict strategy: adopt as `<skill-name>-<agent-id>`.
- [x] Add sync-to-agent preview route and presenter method.
- [x] Add sync-to-agent execute route and presenter method.
- [x] Add repair DeepChat-owned link route and presenter method.
- [x] Add remove DeepChat-owned link route and presenter method.
- [x] Add `AdoptSkillDialog.vue` and wire adopt/resolve-conflict rows to the existing adoption
      backend.
- [x] Match the adopt confirmation ASCII layout from `spec.md`.
- [ ] Add destructive overwrite/keep adoption conflict strategies after the custom agent ownership
      model is durable enough to support them safely.
- [x] Add batch sync-to-agent backend; the original dialog was superseded by the Phase 8 Library
      row flow.
- [x] Match sync-to-agent dialog ASCII layout from `spec.md` for the first V1 slice.
- [ ] Match custom-path dialog ASCII layout when custom agent targets are implemented.
- [x] Add tests that agent directories never receive backup/temp/meta folders.
- [x] Add renderer tests for the adopt preview/execute confirmation flow.
- [x] Add tests for repair/remove refusing links not created by DeepChat.

## Phase 4: Git Install

- [x] Add Git scan route and `SkillClient` method.
- [x] Add Git install route and `SkillClient` method.
- [x] Clone repos to `~/.deepchat/tmp/skill-installs/<operation-id>`.
- [x] Detect root `SKILL.md` as `single-skill`.
- [x] Detect `skills/<name>/SKILL.md` entries as `multi-skill`.
- [x] Reuse existing skill validation before copy.
- [x] Support `rename`, `overwrite`, and `skip` conflict strategies.
- [x] Record `git-install` provenance in database state.
- [x] Clean temp clones on success and failure.
- [x] Add `InstallFromGitDialog.vue` and wire it into the Install tab.
- [x] Match the Install tab Git scan/select/conflict ASCII layout from `spec.md`.
- [x] Add tests for single-skill, multi-skill, conflict strategy, and temp cleanup.

## Phase 5: Sync Directory Import / Export

- [x] Add sync directory config types and routes.
- [x] Add `getSkillsSyncConfig()` and `setSkillsSyncDirectory()`.
- [x] Add export preview and execute routes.
- [x] Export selected skills to `<syncDir>/skills/<name>`.
- [x] Write `README.md` when missing.
- [x] Exclude disabled skills by default and allow explicit inclusion.
- [x] Add import preview and execute routes.
- [x] Scan `<syncDir>/skills/*/SKILL.md` only.
- [x] Preview `new`, `same`, `modified`, `conflict`, and `invalid`.
- [x] Apply `rename`, `overwrite`, and `skip`.
- [x] Record `imported` provenance and import/export timestamps.
- [x] Add `SkillImportExportTab.vue`.
- [x] Match export and import preview ASCII layouts from `spec.md`.
- [x] Add tests for export layout and import conflict states.

## Phase 6: Discover

- [x] Add `resources/skills/find-skills/SKILL.md`.
- [x] Confirm built-in installation picks up the new skill on first run.
- [x] Add `SkillDiscoverTab.vue`.
- [x] Match the Discover tab ASCII layout from `spec.md`.
- [x] Show local `find-skills` status and command-oriented actions.
- [x] Add i18n strings.
- [x] Add a renderer test that the Discover tab renders through the five-tab surface coverage.

## Phase 7: Settings Surface And Smoke Coverage

- [x] Convert `SkillsSettings.vue` into Library, Agents, Import / Export, Install, and Discover tabs.
- [x] Keep existing folder/ZIP/URL install behavior reachable.
- [x] Keep existing external tool import/export behavior reachable.
- [x] Keep existing first-launch sync prompt behavior or explicitly remove it from the UX if the new
      tabs replace it.
- [x] Extend `test/renderer/api/clients.test.ts` for new typed routes.
- [x] Extend skills route smoke tests for new read-only routes.
- [x] Extend skill sync smoke tests for read-only agent scan routes.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run targeted main and renderer tests for touched skills modules.

## Phase 8: V1.1 UX Consolidation

- [x] Reduce `SkillsSettings.vue` tabs to Library, Agents, and Sync Directory.
- [x] Remove the separate Install tab and `SkillInstallTab.vue`.
- [x] Remove the Discover tab, `SkillDiscoverTab.vue`, `resources/skills/find-skills/`, and related
      i18n/tests.
- [x] Keep folder, ZIP, URL, and Git installs reachable from the top Add Skill menu.
- [x] Move Git repo install entry into the Add Skill menu and reuse the existing Git scan/install
      backend.
- [x] Remove the top Export action; replace that flow with per-skill Library Install to Agent.
- [x] Remove the old external-tool import grid from the Library tab.
- [x] Add Library row action: Install to Agent.
- [x] Let Install to Agent choose from detected local user-level folder-format agents only.
- [x] Reuse existing link/sync-to-agent backend for the one-skill Library row flow.
- [x] Let Install to Agent disconnect an already linked Agent via the existing remove-link backend.
- [x] Remove the bulk Sync to Agent button from the Agents tab.
- [x] Change Agents selector buttons to icon-leading tab buttons with count badges.
- [x] Clamp or omit long descriptions in the Agents skill table.
- [x] Add reusable `SkillDetailDialog.vue` for Library and Agents rows.
- [x] Render the selected `SKILL.md` body as Markdown inside the detail dialog.
- [x] Make Library row non-control area open the detail dialog directly.
- [x] Keep Library row Install to Agent and DeepChat enable/disable as exposed controls.
- [x] Move mutable skill edit/save into `SkillDetailDialog.vue`.
- [x] Remove the standalone `SkillEditorSheet.vue` path after merging edit into detail.
- [x] Move mutable skill delete into `SkillDetailDialog.vue` with second confirmation.
- [x] Keep Install to Agent and DeepChat enable/disable available inside the detail dialog.
- [x] Add detail route/client methods for DeepChat skills and scanned agent skills.
- [x] Rename the manual import/export UI copy to Sync Directory to separate it from agent install.
- [x] Keep sync directory import/export backend intact for local multi-skill repository backup and
      migration.
- [x] Update all user-facing strings in every locale with local-language translations.
- [x] Update renderer tests for three tabs, Add Skill Git install, Library Install to Agent, agent
      icon tabs, detail dialog, and absence of Discover/Install tabs.
- [x] Update main/contract tests for skill detail routes.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run targeted main and renderer tests for touched skills modules.

## Deferred

- [ ] Built-in Git commit/pull/push for the sync directory.
- [ ] Automatic scheduled sync.
- [ ] Custom agent path registry and UI.
- [ ] Destructive overwrite/keep adoption conflict strategies.
- [ ] Project-level agent adoption.
- [ ] Single-file prompt adoption into folder-format skills.
- [ ] Deep external marketplace search integration.
