# DeepChat Skills Management

## Current-State Corrections

The source draft describes the right product direction, but several parts need to be corrected for
the current codebase before implementation:

- This is not a greenfield skills system. `SkillPresenter` already owns local skill discovery,
  install/uninstall, hot reload, built-in skill installation, legacy sidecar runtime config, and
  session activation.
- This is not a generic "all agents are sync targets" feature. V1 link/adopt operations are only
  valid for user-level folder-format tools that use `<skillsDir>/<name>/SKILL.md`. Project-level
  and single-file tools remain import/export conversion targets only.
- Git install is not the same as current `installFromUrl`. The existing URL path downloads ZIP
  files; Git install needs clone/scan/select/install provenance.
- The settings UX should stay in the existing `settings-skills` route, but V1.1 must remove the
  over-split five-tab surface. Library owns add/install-to-agent actions, Agents owns inspection and
  adoption, and sync directory remains a separate local repository workflow.
- A command-copy Discover tab is not useful enough to keep. Remove it and do not bundle
  `find-skills` as a built-in skill.

## User Need

Users need DeepChat to act as the local control center for skills: see local DeepChat skills, disable
them for DeepChat without deleting files, install new skills from the top add menu, install a
specific DeepChat skill to a detected local agent from that skill row, inspect existing
folder-format skills from installed agents, adopt those skills into DeepChat safely, and move skills
in or out of a user-selected sync directory.

## Goals

- Keep DeepChat runtime skills canonical under the configured skills path, defaulting to
  `~/.deepchat/skills`.
- Store source provenance, DeepChat-only disabled state, runtime extension settings, sync directory
  settings, and DeepChat-created agent links in the application database.
- Keep the configured DeepChat skills path as a pure content directory: only skill folders and their
  files belong under it.
- Preserve the existing `SkillPresenter` runtime behavior while adding a Library catalog that can
  show disabled skills.
- Add an Agents tab that scans detected user-level folder-format tools and classifies each skill as
  DeepChat-linked, agent-owned, external-link, broken-link, or conflict.
- Adopt agent-owned folder-format skills by copying the skill into DeepChat, backing up the original
  under `~/.deepchat/backups`, and replacing the agent path with a link to the DeepChat canonical
  skill.
- Link a selected DeepChat skill to a supported local agent from the Library row action by creating a
  symlink or Windows junction.
- Add Git repository installation for single-skill repos with root `SKILL.md` and multi-skill repos
  with `skills/<name>/SKILL.md` through the top add menu.
- Add manual import/export to a user-selected multi-skill sync directory.
- Add a reusable skill detail dialog that clamps list/table descriptions and renders the selected
  `SKILL.md` body as Markdown.
- Remove the top-level Install and Discover tabs; remove the old external-tool import block from the
  Library tab.

## Existing Capabilities To Preserve

- `SkillPresenter` discovers `SKILL.md` files under the configured skills path.
- `SkillPresenter` installs from folder, ZIP, and ZIP URL.
- `SkillPresenter` installs built-in skills from `resources/skills`.
- `SkillPresenter` currently stores per-skill runtime extension config under `.deepchat-meta`; the
  target design migrates this state into the database and treats `.deepchat-meta` as legacy input.
- `SkillPresenter` watches skill file changes and publishes `skills.catalog.changed`.
- `SkillSyncPresenter` scans registered external tools, imports external skills into DeepChat, and
  exports DeepChat skills to external tool formats.
- Renderer-main communication uses typed route contracts and renderer API clients.
- Skills settings currently live at `settings-skills` in `SkillsSettings.vue`.

## Directory Layout

DeepChat-managed skills use the configured skills path. When the user has not changed it, the path
is:

```txt
~/.deepchat/
  skills/
    skill-a/
      SKILL.md
      assets/
      references/
      scripts/
    skill-b/
      SKILL.md
  backups/
    skill-adoptions/
      claude-code/
        old-review/
          20260626-153000/
            original/
              SKILL.md
            adoption.json
  tmp/
    skill-adoptions/
    skill-installs/
    skill-imports/
```

Database-backed management state:

```txt
application database
  skill metadata/provenance
  DeepChat-only disabled flags
  runtime extension settings
  agent link ownership
  sync directory config and timestamps
```

After adoption or Library install-to-agent, supported agent directories should contain final skills
or links only:

```txt
~/.claude/skills/
  old-review -> ~/.deepchat/skills/old-review
  guizang-ppt -> ~/.deepchat/skills/guizang-ppt
```

Manual sync directory layout:

```txt
~/Documents/deepchat-skills/
  README.md
  skills/
    old-review/
      SKILL.md
      assets/
      references/
      scripts/
    guizang-ppt/
      SKILL.md
```

## Ownership Rules

| Location | Owner |
| --- | --- |
| Real directory under configured DeepChat skills path | DeepChat |
| Real directory under a supported agent skills path | Agent |
| Agent path is a symlink/junction to DeepChat skills path | DeepChat |
| Agent path is a symlink to another location | External link |
| Agent path is a symlink/junction whose target is missing | Broken link |

DeepChat runtime reads only managed DeepChat skills and plugin-contributed runtime skills. It must
not require any metadata directory inside the skills path. Legacy `.deepchat-meta`, backups, temp
directories, and agent backup residue must be ignored during migration/scanning.

## Supported Agent Management Targets

V1 link/adopt supports only user-level folder-format tools:

- `claude-code`
- `codex`
- `cursor`
- `opencode`
- `goose`
- `kilocode`
- `copilot-user`

V1 does not link/adopt project-level or single-file tools:

- `cursor-project`
- `windsurf`
- `copilot`
- `kiro`
- `antigravity`

Those tools remain available through the existing import/export conversion flow.

## Functional Requirements

### Library

- Users can view all DeepChat-managed skills, including disabled skills.
- Users can toggle a DeepChat-only disabled state.
- Users can open a reusable skill detail dialog from each row.
- Users can install a single DeepChat skill to a detected local agent from that skill row.
- Users can add skills from folder, ZIP, URL, or Git repository from the top add menu.
- The Library tab must not show the old external-tool import grid.
- Disabled skills remain on disk and remain eligible for agent links and manual export when the user
  explicitly includes them.
- Disabled skills are excluded from DeepChat runtime prompt injection, automatic validation, and
  active skill tool permissions.

### Agents

- Users can see detected supported agents as icon tab buttons matching the Library/external tool
  button style.
- Users can select an agent and see the agent's skills directory, counts, and skill rows.
- Agent rows classify ownership and status without mutating files during scan.
- Agent rows clamp descriptions to a short preview and expose full content through the reusable
  skill detail dialog.
- Agent-owned folder skills can be adopted into DeepChat after a preview and confirmation.
- DeepChat-linked skills show link details and do not offer a primary mutation button.
- Broken DeepChat-created links can be repaired when the canonical DeepChat skill still exists.
- DeepChat-created links can be removed without deleting the canonical DeepChat skill.
- Agents tab must not show a bulk "Sync to Agent" action; installing DeepChat skills to agents is a
  Library row action.

### Add Skill

- Users can install selected skills from a Git repository.
- Folder, ZIP, URL, and Git installation share the top add menu instead of a separate Install tab.
- Git scan detects root `SKILL.md` as `single-skill`.
- Git scan detects `skills/<name>/SKILL.md` entries as `multi-skill`.
- Git install records source provenance in database state.

### Sync Directory

- Users can set a sync directory.
- Export writes selected skills to `<syncDir>/skills/<name>`.
- Import reads selected skills from `<syncDir>/skills/<name>`.
- Import/export previews show new, same, modified, conflict, skipped, and failed items.
- Import/export updates database sync timestamps.
- This workflow is for local multi-skill repository backup/migration, not for installing a skill to
  an agent.

## UX Shape

The existing `settings-skills` route becomes a smaller tabbed work surface:

```txt
+--------------------------------------------------------------------------+
| Skills                                      [Search_______] [+ Add Skill] |
| Manage DeepChat skills and local agent links.                            |
+--------------------------------------------------------------------------+
| [ Library ] [ Agents ] [ Sync Directory ]                                |
+--------------------------------------------------------------------------+
| active tab content                                                       |
+--------------------------------------------------------------------------+
```

Style contract:

- Use the existing settings shell, shadcn controls, Iconify/lucide icons, and Tailwind utilities.
- Keep the page dense and operational. No hero, marketing panel, gradient background, or nested
  cards.
- Use compact rows, 8px or smaller radius, semantic badges, and icon buttons with tooltips for
  refresh/open/remove actions.
- Agent selector buttons use the same icon-leading button style as the Library external tool tiles:
  icon, name, count badge, selected border.
- Use semantic color only as a secondary signal:
  - Enabled/linked/success: green semantic badge.
  - Disabled/skipped/neutral: muted badge.
  - Conflict/warning: amber badge.
  - Broken/failed/destructive: destructive badge.
- Every status must also have text; color alone is not enough.
- Long paths and descriptions truncate or clamp instead of wrapping over action controls.
- Primary action per row goes in the right column; secondary actions go in a row menu.

Top add menu:

```txt
+----------------------------------+
| + Add Skill                      |
+----------------------------------+
| Folder...                        |
| ZIP...                           |
| URL...                           |
| Git repository...                |
+----------------------------------+
```

Git repository install opens from the top add menu, not from a tab:

```txt
+--------------------------------------------------------------------------+
| Install from Git                                                         |
+--------------------------------------------------------------------------+
| Repository URL                                                           |
| [https://github.com/op7418/guizang-ppt-skill______________] [Scan]       |
|                                                                          |
| Detected format: single-skill                                            |
| [x] guizang-ppt-skill        No conflict                                 |
|                                                                          |
| Conflict strategy                                                        |
| (*) Rename new skill   ( ) Replace existing   ( ) Skip existing          |
|                                                                          |
| [Cancel]                                           [Install to DeepChat] |
+--------------------------------------------------------------------------+
```

Library tab:

```txt
+--------------------------------------------------------------------------+
| Library                                                    [Open Folder] |
+--------------------------------------------------------------------------+
| Summary: 18 skills - 15 enabled - 3 disabled - 4 agent links             |
|                                                                          |
| [wand] guizang-ppt                                                       |
|        Create PowerPoint decks from structured plans.                    |
|        Git install  Enabled  Claude             [Install to Agent] [on] |
|                                                                          |
| [wand] frontend-design                                                   |
|        UI and UX implementation guidance.                                |
|        Built-in     Enabled  -                  [Install to Agent] [on] |
|                                                                          |
| [wand] old-review                                                        |
|        Review legacy code paths.                                         |
|        Adopted      Disabled Codex              [Install to Agent] [off]|
|                                                                          |
| Empty: No skills installed. Use Add Skill to add folder, ZIP, URL, Git.  |
+--------------------------------------------------------------------------+
```

Library row interaction:

```txt
Click a non-control area of a Library row -> open Skill Detail.
The exposed hot controls are:

[Install to Agent] Install to Agent
[on/off] Enable or disable in DeepChat
```

Skill detail:

```txt
+--------------------------------------------------------------------------+
| G  guizang-ppt                                       [Install to Agent]   |
|    Create PowerPoint decks from structured plans.              Enabled [] |
| /Users/.../.deepchat/skills/guizang-ppt/SKILL.md       [Edit] [Delete]   |
|                                                                          |
| +----------------------------------------------------------------------+ |
| | Rendered Markdown preview of SKILL.md without YAML frontmatter        | |
| +----------------------------------------------------------------------+ |
+--------------------------------------------------------------------------+

Edit mode keeps the same dialog:

+--------------------------------------------------------------------------+
| G  guizang-ppt                                       [Install to Agent]   |
| /Users/.../.deepchat/skills/guizang-ppt/SKILL.md     [Preview] [Delete]  |
|                                                                          |
| Name: guizang-ppt (read-only)                                            |
| Description: [.........................................................] |
| Allowed tools: [Read, Bash]                                              |
| Content:                                                                 |
| +----------------------------------------------------------------------+ |
| | # guizang-ppt                                                        | |
| | ...                                                                  | |
| +----------------------------------------------------------------------+ |
|                                                    [Cancel] [Save]       |
+--------------------------------------------------------------------------+
```

Install one skill to a detected local agent:

```txt
+--------------------------------------------------+
| Install guizang-ppt to Agent                     |
+--------------------------------------------------+
| Target agent                                     |
| [ Claude Code  ] [ OpenAI Codex ] [ Cursor ]     |
| [ OpenCode     ] [ Goose        ] [ Kilo Code ]  |
|                                                  |
| Result                                           |
| ~/.codex/skills/guizang-ppt -> DeepChat skill    |
|                                                  |
| Conflict strategy                                |
| (*) Rename link   ( ) Replace DeepChat-owned link |
| ( ) Skip                                               |
|                                                  |
| [Cancel]                              [Install]  |
+--------------------------------------------------+
```

Library row behavior:

- Enabled/disabled toggle changes only DeepChat runtime state.
- Disabled rows remain visible and editable, but their badge is muted and activation controls are
  disabled where runtime selection appears.
- Built-in or plugin-owned rows do not show destructive actions unless the existing system already
  supports that action.
- The old external-tool import grid is removed from this tab.

Agents tab:

```txt
+--------------------------------------------------------------------------+
| Agents                                                    [Refresh]      |
+--------------------------------------------------------------------------+
| [ icon Claude Code 0 ] [ icon OpenAI Codex 2 ] [ icon Cursor 0 ]         |
| [ icon OpenCode 0    ] [ icon Goose 0        ] [ icon Kilo Code 0 ]      |
+--------------------------------------------------------------------------+
| OpenAI Codex                                      Available              |
| /Users/me/.codex/skills                                                  |
| 2 skills - 0 linked - 2 agent owned - 0 conflict - 0 broken              |
+------------------+--------------+--------------+----------+------------+
| Skill            | Owner        | Status       | Preview  | Action     |
+------------------+--------------+--------------+----------+------------+
| hatch-pet        | Codex        | Agent owned  | View     | Adopt      |
| native-feel      | Codex        | Agent owned  | View     | Adopt      |
+------------------+--------------+--------------+----------+------------+
```

Agent row rules:

- Description stays clamped to one line or is omitted from the table.
- Full description and `SKILL.md` body are shown through the reusable detail dialog.
- The tab does not show "Sync to Agent"; linking DeepChat skills to agents starts from Library.

Agent row states:

```txt
Agent owned:
+------------------+--------------+--------------+----------+------------+
| old-review       | Claude Code  | Agent owned  | View     | Adopt      |
+------------------+--------------+--------------+----------+------------+

DeepChat linked:
+------------------+--------------+--------------+----------+------------+
| guizang-ppt      | DeepChat     | Linked       | View     | ...        |
+------------------+--------------+--------------+----------+------------+
menu: Open in Finder, Remove link

External link:
+------------------+--------------+--------------+----------+------------+
| docs-writer      | External     | Linked out   | View     | Adopt      |
+------------------+--------------+--------------+----------+------------+

Conflict:
+------------------+--------------+--------------+----------+------------+
| frontend-helper  | Claude Code  | Conflict     | View     | Resolve    |
+------------------+--------------+--------------+----------+------------+

Broken link:
+------------------+--------------+--------------+----------+------------+
| broken-ppt       | DeepChat     | Broken link  | View     | Repair     |
+------------------+--------------+--------------+----------+------------+
```

Adopt confirmation:

```txt
+--------------------------------------------------+
| Adopt Skill                                      |
+--------------------------------------------------+
| old-review                                       |
|                                                  |
| Current location                                 |
| ~/.claude/skills/old-review                      |
|                                                  |
| After adoption                                   |
| ~/.deepchat/skills/old-review                    |
| ~/.claude/skills/old-review -> DeepChat skill    |
|                                                  |
| Backup                                           |
| ~/.deepchat/backups/skill-adoptions/...          |
|                                                  |
| [Cancel]                              [Adopt]    |
+--------------------------------------------------+
```

Conflict resolver:

```txt
+--------------------------------------------------+
| Resolve Conflict                                 |
+--------------------------------------------------+
| frontend-helper                                  |
|                                                  |
| Agent                                            |
| ~/.claude/skills/frontend-helper                 |
|                                                  |
| DeepChat                                         |
| ~/.deepchat/skills/frontend-helper               |
|                                                  |
| Choose action                                    |
| (*) Adopt as frontend-helper-claude              |
| ( ) Replace DeepChat frontend-helper             |
| ( ) Keep current state                           |
|                                                  |
| [Cancel]                              [Apply]    |
+--------------------------------------------------+
```

Custom path:

```txt
+--------------------------------------------------+
| Add Custom Agent Path                            |
+--------------------------------------------------+
| Display name                                     |
| [My Agent                                      ] |
|                                                  |
| Skills directory                                 |
| [/Users/me/.my-agent/skills                    ] |
|                                                  |
| Format                                           |
| (*) SKILL.md folder format                       |
|                                                  |
| [Cancel]                           [Scan path]   |
+--------------------------------------------------+
```

Reusable skill detail:

```txt
+----------------------------------------------------------+
| C                                                        |
| ComputerUse skill                           [Switch] [...]|
| Drive the user's desktop GUI through ...                 |
|                                                          |
| +------------------------------------------------------+ |
| | Computer Use                                         | |
| | Rendered Markdown from SKILL.md                      | |
| | ...                                                  | |
| +------------------------------------------------------+ |
|                                                          |
|                                      [Try in Chat]      |
+----------------------------------------------------------+
```

The same dialog is used from Library rows and Agents rows. It receives a source descriptor and
renders the manifest summary plus sanitized Markdown body.

Sync Directory tab:

```txt
+--------------------------------------------------------------------------+
| Sync Directory                                                           |
+--------------------------------------------------------------------------+
| Local multi-skill repository                                             |
| [~/Documents/deepchat-skills____________________________] [Browse] [Save] |
+--------------------------------------------------------------------------+
| [ Export to directory ] [ Import from directory ]                        |
+--------------------------------------------------------------------------+
| Export selected skills                                                   |
| [x] guizang-ppt        Enabled    Git install                            |
| [x] frontend-design    Enabled    Built-in                               |
| [ ] old-review         Disabled   Adopted                                |
|                                                                          |
| [Preview Export]                                           [Export Now]  |
+--------------------------------------------------------------------------+
```

Import preview:

```txt
+--------------------------------------------------------------------------+
| Import from ~/Documents/deepchat-skills                                  |
+----------------------+-------------+---------------+---------------------+
| Skill                | State       | Source        | Action              |
+----------------------+-------------+---------------+---------------------+
| guizang-ppt          | Same        | sync dir      | Skip                |
| frontend-design      | New         | sync dir      | Import              |
| skill-x              | Conflict    | sync dir      | Rename              |
| broken-skill         | Invalid     | sync dir      | View error          |
+----------------------+-------------+---------------+---------------------+
| Conflict strategy: (*) Rename imported  ( ) Replace local  ( ) Skip      |
| [Cancel]                                             [Import Selected]   |
+--------------------------------------------------------------------------+
```

## Non-Goals

- No automatic scheduled sync.
- No built-in Git commit, pull, or push.
- No marketplace search or command-copy Discover tab.
- No project-level agent link/adopt.
- No conversion of single-file prompt formats into linked folder-format skills during adoption.
- No cloud sync.
- No separate Install tab; install flows start from the top add menu.
- No new dependency unless an existing standard library or installed dependency is insufficient.

## Acceptance Criteria

- Database state is created or migrated without deleting existing skills or legacy sidecar runtime
  configs.
- Disabling a skill persists across restart, remains visible in Library, and excludes that skill
  from DeepChat runtime metadata prompt and active-skill validation.
- The configured DeepChat skills path contains only skill content directories. It must not contain
  `.deepchat-meta`, metadata files, backups, temp files, or other management metadata after
  migration.
- Legacy `.deepchat-meta` runtime config files are migrated into the database and removed only after
  the database write succeeds.
- Supported agents are shown only when detected locally.
- Supported agents use icon-leading tab buttons with counts.
- Project-level and single-file tools are not offered link/adopt actions.
- Scanning an agent never creates, deletes, or moves files.
- Agents table descriptions are clamped or omitted, and full skill content is available through the
  reusable skill detail dialog with Markdown rendering.
- Adopting an agent-owned skill creates `~/.deepchat/skills/<name>/SKILL.md`, stores the original
  under `~/.deepchat/backups/skill-adoptions/...`, and replaces the agent path with a link to the
  canonical DeepChat skill.
- Agent skills directories do not receive backup, temp, rollback, or metadata folders.
- Same-name conflicts default to creating a unique adopted skill name instead of overwriting the
  existing DeepChat skill.
- Installing one Library skill to an agent creates or repairs only DeepChat-owned links and does not
  delete agent-owned skill directories unless the user explicitly chooses a conflict strategy.
- The top add menu exposes folder, ZIP, URL, and Git install paths.
- Git single-skill and multi-skill repositories install selected skills into DeepChat and write
  `git-install` provenance.
- Manual export creates a valid multi-skill repository layout.
- Manual import handles new, same, modified, and conflict states before writing.
- The old external-tool import grid, separate Install tab, Discover tab, and `find-skills` bundled
  skill are removed from the settings surface.

## Critical Acceptance Scenarios

### Agent-Owned Adoption

```txt
Given ~/.claude/skills/old-review/SKILL.md exists
And ~/.deepchat/skills/old-review does not exist
When the user adopts old-review from Claude Code
Then ~/.deepchat/skills/old-review/SKILL.md exists
And ~/.claude/skills/old-review links to ~/.deepchat/skills/old-review
And the original is backed up under ~/.deepchat/backups/skill-adoptions
And database state source.type is adopted
```

### Clean Agent Directory

```txt
Given a user adopts ~/.claude/skills/old-review
Then ~/.claude/skills contains old-review as a link
And ~/.claude/skills does not contain old-review.deepchat-backup-*
And scan shows one old-review row
```

### DeepChat Linked Display

```txt
Given ~/.claude/skills/guizang-ppt links to ~/.deepchat/skills/guizang-ppt
Then the Agents table shows:
Skill = guizang-ppt
Owner = DeepChat
Status = Linked
Action = row menu only
```

### Conflict Adoption

```txt
Given ~/.claude/skills/frontend-helper exists
And ~/.deepchat/skills/frontend-helper exists
And their content hashes differ
When the user chooses "Adopt as frontend-helper-claude"
Then ~/.deepchat/skills/frontend-helper remains unchanged
And ~/.deepchat/skills/frontend-helper-claude is created
And ~/.claude/skills/frontend-helper links to the renamed DeepChat skill
```

### Git Installation

```txt
Given a repo root contains SKILL.md
When the user opens Add Skill -> Git repository, scans, and installs it
Then the selected skill is copied to the DeepChat skills path
And database state source.type is git-install
And database state source.repoFormat is single-skill

Example: `https://github.com/op7418/guizang-ppt-skill` is a root `SKILL.md` repository whose
frontmatter skill name is `guizang-ppt-skill`.

Given a repo contains skills/a/SKILL.md and skills/b/SKILL.md
When the user selects a and b
Then both skills are installed
And database state source.repoFormat is multi-skill
```

### Library Install To Agent

```txt
Given ~/.deepchat/skills/guizang-ppt/SKILL.md exists
And ~/.codex/skills is detected
When the user chooses Install to Agent from the guizang-ppt Library row
Then ~/.codex/skills/guizang-ppt links to ~/.deepchat/skills/guizang-ppt
And database state records the Codex agent link
And the Agents tab later shows guizang-ppt as DeepChat linked

Given guizang-ppt is already linked to ~/.codex/skills/guizang-ppt
When the user opens Install to Agent and selects Codex
Then the dialog shows a Disconnect action
And Disconnect removes the DeepChat-owned Agent link
And database state removes the Codex agent link record
```

### Library Row And Detail Interaction

```txt
Given a Library skill row is visible
When the user clicks any non-control area of the row
Then the Skill Detail dialog opens
And the row does not expose a standalone View details action
And the row keeps Install to Agent and DeepChat enable/disable as visible controls

Given the Skill Detail dialog is open for a mutable skill
When the user chooses Edit
Then the dialog switches to editable name, description, allowed tools, and Markdown content fields
And Delete is next to Edit/Preview inside the same dialog
And Delete requires a second confirmation before removing the skill
And Install to Agent and DeepChat enable/disable are also available inside the detail dialog
```

### Skill Detail Preview

```txt
Given an agent skill has a long description
When the user views the agent row
Then the table does not expand horizontally for the full description
And clicking the row detail affordance opens a detail dialog
And the dialog renders the selected SKILL.md body as Markdown
```

### Manual Export

```txt
Given sync directory is ~/Documents/deepchat-skills
And selected skills are a and b
When the user exports
Then ~/Documents/deepchat-skills/skills/a/SKILL.md exists
And ~/Documents/deepchat-skills/skills/b/SKILL.md exists
And database sync lastExportAt is updated
```

### DeepChat-Only Disable

```txt
Given skill a exists in the DeepChat skills path
When the user disables a in Library
Then database state marks skill a as DeepChat-disabled
And Library still shows a
And getMetadataPrompt excludes a
And existing agent links remain unchanged
```

## Resolved Assumptions

- `~/.deepchat/skills` means the configured skills path when the user changed `skillsPath`.
- Skill management database state is local-only and not automatically synchronized.
- Existing `.deepchat-meta/<skill>.json` runtime config is legacy migration input; new writes go to
  the database.
- Plugin-contributed skills remain read-only runtime contributions and are not adopted, linked,
  exported by default, or moved into database-owned management state.
