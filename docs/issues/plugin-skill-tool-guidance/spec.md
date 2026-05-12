# Plugin Skill Tool Guidance

## User Need

As a user who already enabled the Feishu plugin and can see its tools in DeepChat, I need the AI to
understand that the plugin exposes MCP tools for Feishu/Lark work so it invokes those tools directly
instead of asking me to classify the plugin type or explain how to call it.

## Acceptance Criteria

- The Feishu plugin declares an agent skill contribution in its manifest so DeepChat can register a
  plugin-owned skill alongside the MCP server.
- The skill explicitly tells the model that the plugin is an MCP tool surface and that it should not
  ask the user to classify the plugin as MCP, CLI, or another type.
- The skill gives direct routing guidance for common Feishu/Lark requests such as documents,
  spreadsheets, knowledge content, and other supported workspace artifacts.
- The skill explains that available Feishu/Lark tools depend on the current MCP preset and that the
  model should use currently exposed tool names and descriptions as the source of truth.

## Constraints

- Keep the change within the Feishu plugin manifest and skill assets.
- Do not redesign plugin MCP startup, settings UX, or global tool routing.
- Keep the guidance compatible with the current plugin skill registration path in `PluginPresenter`.

## Non-goals

- Changing Feishu MCP tool implementations.
- Rewriting DeepChat's global tool-selection prompt.
- Adding renderer UI for skill management.

## Open Questions

None.
