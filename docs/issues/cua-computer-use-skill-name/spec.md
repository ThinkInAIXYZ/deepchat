# CUA Computer Use Skill Name

## Issue

The official CUA plugin contributes its built-in agent skill as `cua-driver` from
`skills/cua-driver/SKILL.md`. DeepChat skills use the folder-format contract
`<skill-name>/SKILL.md`, and discovery warns when `SKILL.md` frontmatter `name` differs from the
folder name. The user-facing capability is Computer Use; `cua-driver` is the runtime and MCP server
implementation detail.

GitHub issue: https://github.com/ThinkInAIXYZ/deepchat/issues/1900

## Impact

- Users see or activate a runtime implementation name instead of the Computer Use capability.
- The plugin skill is easier to confuse with the MCP server id.
- Future skill sync/export behavior expects the folder and frontmatter name to match.
- Existing sessions that persisted `cua-driver` as an active skill should keep Computer Use enabled
  after the rename.

## Root Cause

The plugin skill was adapted from upstream CUA's `cua-driver` skill package without renaming the
DeepChat-owned skill contribution to the product capability name.

## Fix Plan

- Rename the plugin skill id and folder to `computer-use`.
- Rename `SKILL.md` frontmatter and heading to `computer-use`.
- Migrate persisted active skill names from `cua-driver` to `computer-use`.
- Keep runtime id, MCP server id, binary names, and upstream metadata as `cua-driver`.
- Update focused plugin tests.

## Tasks

- [x] Rename the CUA plugin skill contribution.
- [x] Migrate old active skill state to `computer-use`.
- [x] Update tests and references.
- [x] Run focused tests and required repository checks.

## Validation

- `corepack pnpm exec vitest run test/main/presenter/pluginPresenter.test.ts`
- `corepack pnpm exec vitest run test/main/presenter/skillPresenter/skillPresenter.test.ts`
- `corepack pnpm run plugin:bundle -- --name cua --platform darwin --arch arm64`
- `corepack pnpm run format`
- `corepack pnpm run i18n`
- `corepack pnpm run lint`
