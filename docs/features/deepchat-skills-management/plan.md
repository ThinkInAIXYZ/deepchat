# DeepChat Skills Management Implementation Plan

## Architecture Fit

Use the existing split:

- Main runtime owner: `src/main/presenter/skillPresenter/index.ts`
- External scan/conversion owner: `src/main/presenter/skillSyncPresenter/index.ts`
- Shared types: `src/shared/types/*`
- Route contracts: `src/shared/contracts/routes/*`
- Route dispatch: `src/main/routes/index.ts`
- Renderer API clients: `src/renderer/api/*Client.ts`
- Settings UI: `src/renderer/settings/components/skills/*`

Do not create a new top-level Presenter for V1. Add small helper modules under the existing
presenter folders where code size requires it.

## Current Gaps

| Gap | Current state | Needed change |
| --- | --- | --- |
| Database state | Runtime extension settings currently live in per-skill files under `.deepchat-meta/<name>.json`. | Move skill management state into the application database and treat `.deepchat-meta` as legacy migration input. |
| Library disabled state | `getMetadataList()` and `getMetadataPrompt()` expose all visible skills. | Add a Library catalog that includes disabled skills, and filter disabled skills from runtime paths. |
| Agent ownership | `SkillSyncPresenter` scans external tools but does not classify links or ownership. | Add user-level folder-format agent management scan/classification. |
| Adoption | Existing import copies external skills into DeepChat, but does not move agent-owned folders or create links. | Add adopt preview/execute with private backups and link creation. |
| Link repair/remove | No DeepChat-owned link model. | Track created links in database state and only repair/remove those safely. |
| Git install | `installFromUrl` downloads ZIP only. | Add Git clone scan/install flow with provenance, opened from the top add menu. |
| Sync directory | Existing import/export targets registered tools, not a user-selected multi-skill repo directory. | Add native sync directory preview/execute APIs, labeled as sync directory instead of agent export. |
| Skill details | Long descriptions currently expand list/table rows. | Add one reusable detail dialog that renders manifest data and `SKILL.md` Markdown. |
| Settings UX | The first implementation over-split Library, Agents, Import / Export, Install, and Discover. | Collapse to Library, Agents, and Sync Directory. Folder/ZIP/URL/Git install lives under top Add Skill; install-to-agent lives on each Library row. |

## Data Model

Add `src/shared/types/skillManagement.ts`.

```ts
export type SkillSourceType =
  | 'builtin'
  | 'created'
  | 'folder-install'
  | 'zip-install'
  | 'url-install'
  | 'git-install'
  | 'adopted'
  | 'imported'

export type SkillRepoFormat = 'single-skill' | 'multi-skill'

export interface SkillManagementState {
  version: 1
  skills: Record<string, SkillManagementItem>
  sync?: SkillSyncDirectoryConfig
}

export interface SkillManagementItem {
  name: string
  canonicalPath: string
  deepchat: {
    disabled: boolean
  }
  extension: SkillExtensionConfig
  source: SkillSource
  agentLinks?: Record<string, AgentLinkInfo>
}

export interface SkillSource {
  type: SkillSourceType
  repoUrl?: string
  repoFormat?: SkillRepoFormat
  agentId?: string
  originalPath?: string
  importedFrom?: string
  installedAt?: string
  importedAt?: string
  adoptedAt?: string
}

export interface AgentLinkInfo {
  path: string
  state: 'linked' | 'missing' | 'broken' | 'conflict' | 'permission-denied'
  createdByDeepChat: boolean
  linkedAt?: string
}

export interface SkillSyncDirectoryConfig {
  skillsDirectory: string
  layout: 'multi-skill-repo'
  lastExportAt?: string | null
  lastImportAt?: string | null
}
```

Database state rules:

- Store only durable state that cannot be derived cheaply from files.
- Store V1 state in the existing application database, preferably through the DB-backed settings
  path (`app_settings`) unless implementation proves dedicated SQL tables are needed.
- Rebuild missing database entries from discovered DeepChat skills with `source.type = 'created'`
  only as a fallback. Keep current built-in install behavior, but mark bundled resources as
  `builtin` when source can be recognized.
- Migrate legacy runtime extension sidecars from `<skillsPath>/.deepchat-meta/<skill>.json` into
  database state on first load.
- After successful migration, remove the migrated legacy sidecar files. If migration fails, leave
  legacy files untouched for retry.
- New writes go only to the database.
- The skills path must not be the canonical storage location for management metadata.
- Use database transactions for multi-skill state writes.

## Presenter Changes

### SkillPresenter

Add helpers:

- `managementState.ts`: load/save/migrate database-backed skill management state.
- `gitInstall.ts`: clone/scan/install Git repositories.
- `importExport.ts`: native sync directory import/export.

Add or extend methods on `ISkillPresenter`:

- `getUnifiedSkillCatalog(): Promise<UnifiedSkillItem[]>`
- `getSkillDetail(input: { name: string }): Promise<SkillDetail>`
- `setSkillDeepChatDisabled(name: string, disabled: boolean): Promise<void>`
- `getSkillManagementState(): Promise<SkillManagementState>`
- `scanGitSkillRepo(input): Promise<GitSkillRepoScanResult>`
- `installSkillsFromGit(input): Promise<SkillInstallResult[]>`
- `getSkillsSyncConfig(): Promise<SkillSyncDirectoryConfig | null>`
- `setSkillsSyncDirectory(input): Promise<SkillSyncDirectoryConfig>`
- `previewSyncDirectoryExport(input): Promise<SkillSyncDirectoryExportPreview>`
- `executeSyncDirectoryExport(input): Promise<SkillSyncDirectoryResult>`
- `previewSyncDirectoryImport(input): Promise<SkillSyncDirectoryImportPreview>`
- `executeSyncDirectoryImport(input): Promise<SkillSyncDirectoryResult>`

Runtime filtering:

- `getMetadataPrompt()` excludes disabled skills.
- `loadSkillContent(name)` returns `null` for disabled skills unless an explicit internal option is
  added later.
- `validateSkillNames()` excludes disabled skills.
- `getActiveSkillsAllowedTools()` inherits disabled filtering.
- `getUnifiedSkillCatalog()` includes disabled skills for Library.

Install provenance:

- `installFromFolder`, `installFromZip`, and `installFromUrl` should update database source type.
- Existing folder/ZIP/URL behavior must remain compatible.
- Existing overwrite backup under the skills directory should be removed from the target design.
  Normal install replacement and adoption backups both use private backup/temp locations outside
  the skills path.

### SkillSyncPresenter

Keep read-only agent scan/classification inside `SkillSyncPresenter` for the first pass. Extract an
`agentManagement.ts` helper only when adoption, repair, remove, and custom path actions make the
method set large enough to justify another module.

Methods to add to `ISkillSyncPresenter`:

- `scanSkillAgents(): Promise<InstalledSkillAgent[]>`
- `scanSkillAgent(input: { agentId: string }): Promise<InstalledSkillAgentDetail>`
- `getAgentSkillDetail(input: { agentId: string; name: string }): Promise<SkillDetail>`
- `previewAdoptAgentSkill(input): Promise<AdoptAgentSkillPreview>`
- `executeAdoptAgentSkill(input): Promise<AdoptAgentSkillResult>`
- `previewLinkDeepChatSkills(input): Promise<LinkDeepChatSkillsPreview>`
- `executeLinkDeepChatSkills(input): Promise<LinkDeepChatSkillsResult>`
- `repairAgentSkillLink(input): Promise<LinkDeepChatSkillResult>`
- `removeAgentSkillLink(input): Promise<LinkDeepChatSkillResult>`
- `addCustomSkillAgentPath(input): Promise<InstalledSkillAgent>`

Use `toolScanner.getAllTools()` as the registered tool source, but filter link/adopt targets to
user-level folder-format tools:

```ts
const canManageLinks =
  !tool.isProjectLevel &&
  tool.filePattern === '*/SKILL.md' &&
  tool.capabilities.supportsSubfolders
```

Classification should inspect each entry without writing:

```txt
symlink -> target missing             => broken-link
symlink -> target under skillsDir     => deepchat linked
symlink -> other target               => external-link
real dir + DeepChat same name + diff  => conflict
real dir + no DeepChat same name      => agent-owned
```

Use content hashes only for conflict detection after verifying both sides have `SKILL.md`.

## Route And Client Changes

Extend route contracts:

- `src/shared/contracts/routes/skills.routes.ts`
- `src/shared/contracts/routes/skillSync.routes.ts`

Extend Zod schemas in `src/shared/contracts/domainSchemas.ts` only for route payload validation.
Route dispatch remains in `src/main/routes/index.ts`.

Extend renderer clients:

- `src/renderer/api/SkillClient.ts` for Library, Git, and sync directory calls.
- `src/renderer/api/SkillSyncClient.ts` for agent management calls.

Add event contracts only where UI needs push refresh:

- `skills.catalog.changed`: add reason values for `disabled-updated`, `management-state-updated`,
  `git-installed`, and `sync-directory-updated`.
- Add `skillSync.agentLinks.changed` if link/adopt actions need passive refresh.

Keep scan/import/export progress events unchanged.

### Route API Shape

Library:

```ts
export interface UnifiedSkillItem {
  name: string
  description: string
  canonicalPath: string
  sourceType: SkillSourceType
  deepchatDisabled: boolean
  agentLinks: Record<string, AgentLinkInfo>
  ownerPluginId?: string
  mutable: boolean
}

export interface SkillDetail {
  name: string
  description: string
  sourcePath: string
  markdown: string
  mutable: boolean
}
```

Agents:

```ts
export type AgentSkillOwner = 'deepchat' | 'agent' | 'external-link' | 'broken-link' | 'unknown'

export type AgentSkillStatus =
  | 'linked'
  | 'agent-owned'
  | 'linked-out'
  | 'broken-link'
  | 'conflict'
  | 'empty'

export type AgentSkillAction =
  | 'adopt'
  | 'resolve-conflict'
  | 'repair-link'
  | 'remove-link'
  | 'open'

export interface InstalledSkillAgent {
  id: string
  name: string
  skillsDir: string
  isCustom: boolean
  supportsLinkManagement: boolean
  skillsCount: number
  linkedCount: number
  agentOwnedCount: number
  conflictCount: number
  brokenLinkCount: number
  status: 'ready' | 'detected-no-skills-dir' | 'permission-denied'
}

export interface AgentSkillItem {
  name: string
  description?: string
  path: string
  owner: AgentSkillOwner
  status: AgentSkillStatus
  action?: AgentSkillAction
  link?: {
    isSymlink: boolean
    targetPath?: string
    targetExists?: boolean
    targetInsideDeepChat?: boolean
    createdByDeepChat?: boolean
  }
  deepchat?: {
    exists: boolean
    path?: string
    disabled?: boolean
    sameContent?: boolean
  }
}
```

Git install:

```ts
export interface GitSkillRepoScanResult {
  repoUrl: string
  repoFormat: 'single-skill' | 'multi-skill'
  skills: Array<{
    name: string
    description: string
    relativePath: string
    conflict: boolean
    valid: boolean
    error?: string
  }>
}
```

Sync directory:

```ts
export type SyncDirectorySkillState = 'new' | 'same' | 'modified' | 'conflict' | 'invalid'

export interface SyncDirectorySkillPreview {
  name: string
  state: SyncDirectorySkillState
  sourcePath: string
  targetPath: string
  error?: string
}
```

## File Operations

Base directories:

```txt
<skillsPath>/<skill-name>/
application database: skill management state
~/.deepchat/backups/skill-adoptions/<agent-id>/<skill-name>/<timestamp>/
~/.deepchat/tmp/skill-adoptions/<operation-id>/
~/.deepchat/tmp/skill-installs/<operation-id>/
~/.deepchat/tmp/skill-imports/<operation-id>/
```

The configured skills path is a content root only. It must not contain `.deepchat-meta`, metadata
files, backup folders, temp folders, or rollback folders in the target design.

Adoption flow:

```txt
1. Resolve tool and skill row from a fresh scan.
2. Validate source is inside the selected agent skills directory.
3. Resolve symlink source when adopting external-link rows.
4. Validate `SKILL.md` and skill name.
5. Choose target name, defaulting to `<name>-<agentId>` on conflict.
6. Copy source content to private temp.
7. Validate copied `SKILL.md` and hash.
8. Move temp to `<skillsPath>/<targetName>`.
9. Move original agent path to private backup.
10. Create directory symlink; on Windows fallback to junction.
11. Write database source provenance and agentLinks.
12. Rediscover DeepChat skills and rescan the selected agent.
```

Agent directories must never receive:

```txt
*.backup
*.old
*.deepchat-backup-*
.deepchat-meta
tmp
```

## Git Install

Implementation:

- Use `child_process.execFile` or existing process utility with `git` directly. Do not add a Git
  dependency.
- Clone into `~/.deepchat/tmp/skill-installs/<operation-id>`.
- Detect:
  - root `SKILL.md` => `single-skill`
  - `skills/<name>/SKILL.md` => `multi-skill`
- Reuse existing skill validation and copy logic where possible.
- Support strategies: `rename`, `overwrite`, `skip`.
- Record `repoUrl`, `repoFormat`, and `installedAt`.
- Always remove temp clone after install/scan completion.

## Sync Directory

This is separate from existing external tool import/export.

Export:

```txt
<syncDir>/
  README.md
  skills/
    <name>/
      SKILL.md
      assets/
      references/
      scripts/
```

Import:

- Scan only `<syncDir>/skills/*/SKILL.md`.
- Validate each skill before preview.
- Show state: `new`, `same`, `modified`, `conflict`, `invalid`.
- Apply `rename`, `overwrite`, or `skip`.
- Record `source.type = 'imported'`, `importedFrom`, and `importedAt`.

## Renderer Plan

Convert `SkillsSettings.vue` into three tabs and one top add menu:

```txt
SettingsPageShell
  Actions: search where relevant, Add Skill menu
  Tabs
    Library
    Agents
    Sync Directory
```

Reuse or adapt:

- Existing `SkillCard` for Library rows.
- Existing `SkillInstallDialog` folder/ZIP/URL UI from the top Add Skill menu.
- Existing Git install dialog logic from the top Add Skill menu.
- Existing link/sync-to-agent backend from a single-skill Library row action.

New components:

- `SkillAgentsTab.vue`
- `AgentSkillTable.vue`
- `AdoptSkillDialog.vue`
- `ResolveSkillConflictDialog.vue`
- `InstallSkillToAgentDialog.vue`
- `SkillDetailDialog.vue`
- `SkillImportExportTab.vue`
- `InstallFromGitDialog.vue`

Keep user-facing strings in `src/renderer/src/i18n/*/settings.json`.

### Renderer Style Contract

Use current settings UI patterns instead of a new design system:

- Shell: `SettingsPageShell`.
- Tabs: existing shadcn tabs.
- Tables/lists: plain bordered row groups with compact spacing.
- Actions: `Button` with lucide/Iconify icons; destructive actions stay in menus or confirm dialogs.
- Toggles: `Switch` for DeepChat-only enabled/disabled.
- Selection: `Checkbox` for skill multi-select.
- Conflict strategies: `RadioGroup`.
- Paths: monospace text, truncated with tooltip.
- Status: badge text plus semantic color.

Recommended tab component shape:

```txt
SkillsSettings.vue
  Add Skill menu
    SkillInstallDialog.vue
    InstallFromGitDialog.vue
  SkillCard.vue
    SkillDetailDialog.vue
    InstallSkillToAgentDialog.vue
  SkillAgentsTab.vue
    AgentSkillTable.vue
    SkillDetailDialog.vue
    AdoptSkillDialog.vue
    ResolveSkillConflictDialog.vue
    CustomAgentPathDialog.vue
  SkillImportExportTab.vue as Sync Directory
```

Description handling:

```txt
List/table row: one-line clamp or no description.
Detail dialog: full manifest description plus rendered Markdown from SKILL.md.
```

Library row interaction:

```txt
SkillCard.vue
  non-control area click -> SkillDetailDialog.vue
  exposed controls:
    [Install to Agent] InstallSkillToAgentDialog.vue
    [switch] DeepChat enable/disable

SkillDetailDialog.vue
  preview mode: rendered SKILL.md body
  edit mode: name (read-only), description, allowedTools, Markdown content
  actions: Install to Agent, enable/disable, Edit/Preview, Delete with confirm, Save/Cancel
```

Loading, empty, and error states:

```txt
Loading:
[spinner] Scanning installed agents...

Empty:
No supported agents found.
[Refresh]

Permission error:
Cannot read ~/.claude/skills
[Open Folder] [Refresh]

Broken link:
Target missing: ~/.deepchat/skills/foo
[Repair] [...]
```

Do not add nested cards. A tab may have one top toolbar and one primary list/table area; dialogs are
the only framed surfaces that may contain form sections.

### File Change Range

Expected source files across the full feature. Phase 2 keeps read-only agent classification in
`SkillSyncPresenter.index.ts`; do not add a dedicated agent-management module until write actions
make that separation useful.

```txt
src/main/presenter/skillPresenter/
  index.ts
  managementState.ts
  gitInstall.ts
  importExport.ts

src/main/presenter/skillSyncPresenter/
  index.ts
  toolScanner.ts

src/shared/types/
  skill.ts
  skillManagement.ts
  skillSync.ts

src/main/presenter/sqlitePresenter/tables/
  configTables.ts

src/shared/contracts/routes/
  skills.routes.ts
  skillSync.routes.ts

src/shared/contracts/events/
  skills.events.ts
  skillSync.events.ts

src/renderer/api/
  SkillClient.ts
  SkillSyncClient.ts

src/renderer/settings/components/skills/
  SkillsSettings.vue
  SkillAgentsTab.vue
  AgentSkillTable.vue
  AdoptSkillDialog.vue
  ResolveSkillConflictDialog.vue
  InstallSkillToAgentDialog.vue
  SkillDetailDialog.vue
  CustomAgentPathDialog.vue
  SkillImportExportTab.vue
  InstallFromGitDialog.vue
```

## Security And Compatibility

- Reuse `skillSyncPresenter/security.ts` path safety helpers where possible.
- Add symlink-aware containment checks for existing and not-yet-existing paths.
- Never follow recursive symlink loops during scan or copy.
- Skip symlinks during copied skill content unless adopting an external-link target explicitly.
- Enforce current skill name rules: `^[a-z0-9][a-z0-9._-]*$`.
- Enforce current file/ZIP/folder size ceilings or stricter ceilings for new flows.
- Keep `skillsPath` compatibility. All "DeepChat skills path" operations use
  `configPresenter.getSkillsPath()`, not hard-coded `~/.deepchat/skills`.
- Migrate legacy `<skillsPath>/.deepchat-meta/*.json` sidecars into database state, then stop writing
  new sidecar files.
- Scans must ignore legacy `.deepchat-meta` until migration cleanup is implemented.
- Plugin-contributed skills are read-only catalog entries and are excluded from mutable actions.
- Detail routes must read only from the selected DeepChat skill path or the freshly scanned supported
  agent skill path.

## Test Strategy

Main unit tests:

- Database-backed management state load/save/migration.
- Legacy `.deepchat-meta/<skill>.json` sidecar import into database state.
- Assertion that new runtime extension writes do not create files under the skills path.
- Disabled filtering in metadata prompt, `loadSkillContent`, `validateSkillNames`, and Library
  catalog inclusion.
- Agent scan classification for linked, agent-owned, external-link, broken-link, and conflict.
- Adoption success, conflict rename, backup location, and no backup residue in agent directory.
- Link create/repair/remove, including Windows junction fallback mocked path.
- Git single-skill and multi-skill scan/install with temp cleanup.
- Sync directory import/export preview and conflict strategies.
- Skill detail route path safety for DeepChat and agent-owned skills.

Renderer tests:

- Skills tabs render as Library, Agents, and Sync Directory only.
- Top Add Skill menu exposes folder, ZIP, URL, and Git install choices.
- Disabled toggle calls typed client and updates UI.
- Library row Install to Agent opens detected local agents and calls the link client for one skill.
- Library Install to Agent shows Disconnect and calls the remove-link client when the selected agent
  is already linked.
- Skill card body click opens detail while exposed install/toggle controls do not trigger detail.
- Skill detail dialog renders long `SKILL.md` content without expanding list/table rows.
- Skill detail dialog owns edit/save and delete-with-confirm controls for mutable DeepChat skills.
- Agents table row actions map to the right client methods.
- Agents tab uses icon-leading agent tab buttons and has no bulk "Sync to Agent" button.
- Git install dialog scan/select/install states from the top add menu.
- Sync Directory preview states.
- Discover tab and `find-skills` resource are absent.

Smoke tests:

- Extend existing skills read-only route smoke for new Library routes.
- Extend skill sync smoke for agent scan routes without mutating user files.

Manual checks:

- macOS/Linux symlink creation.
- Windows junction fallback.
- Agent directory remains clean after adoption.

## Delivery Order

1. Database state and Library disabled state.
2. Agents scan/classification UI with no mutations.
3. Adoption, link, repair, and remove.
4. Git install through the top add menu.
5. Sync directory import/export.
6. UX consolidation: remove Install and Discover tabs, remove `find-skills`, move install-to-agent
   to Library rows, and add reusable skill details.

This order produces a useful first slice after step 3: users can take over existing local
folder-format agent skills without polluting agent directories.
