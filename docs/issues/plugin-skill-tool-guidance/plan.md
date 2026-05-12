# Plugin Skill Tool Guidance Plan

## Implementation Approach

- Add a `skills` contribution to the Feishu plugin manifest that points at a plugin-owned agent
  skill folder.
- Create a `SKILL.md` file for the Feishu plugin that frames `feishu-tools` as an MCP server tool
  surface and tells the model to invoke matching tools directly for Feishu/Lark tasks.
- Keep the skill generic enough to work with whichever Feishu/Lark tools are currently exposed by
  the active MCP preset, using the live tool names and descriptions as the source of truth.
- Add a focused regression assertion that the Feishu manifest and skill file stay wired together.

## Affected Areas

- `plugins/feishu/plugin.json`
- `plugins/feishu/skills/feishu-tools/SKILL.md`
- `test/main/presenter/pluginPresenter.test.ts`

## Test Strategy

- Add a source-level regression test asserting that the Feishu plugin manifest declares the plugin
  skill contribution.
- Assert that the skill file includes explicit MCP routing guidance so the regression catches future
  removals of the usage instructions.

## Risks

- Low. The change adds guidance metadata but does not alter plugin startup or runtime behavior.
