# Agent-scoped Skills and MCP

## User Need

Skills and normal MCP servers are global resources, but different DeepChat agents need independent
choices about which of those resources they can use. The Plugins pages must preserve the existing
management experience while interpreting enable/disable actions as edits to the current DeepChat
agent.

Official plugins are different: their installation, enablement, process lifecycle, contributed
resources, and status are global. ACP agents use an external runtime and cannot use the Plugins Hub.

## Goal

Give each DeepChat agent an independent Skills and MCP policy while keeping resource installation
global. Keep plugin availability global for DeepChat agents and unavailable for ACP agents.

## Acceptance Criteria

1. Each DeepChat agent can independently configure its available skill set.
2. Each DeepChat agent can independently configure its available normal MCP server set.
3. Switching DeepChat agents updates Skills and MCP enablement from that agent's policy.
4. Runtime prompt, skill tools, MCP definitions, and MCP calls use the session agent's policy.
5. Existing global skill installation/import and MCP server definitions remain global resources.
6. Existing users retain compatible behavior: the built-in `deepchat` agent defaults to globally
   available Skills and MCP servers; other DeepChat agents inherit its policy.
7. `/plugins/skills` keeps the full Skills management view and writes `enabledSkillNames` instead of
   globally disabling a skill.
8. `/plugins/mcp` keeps the full MCP management view and writes `enabledMcpServerIds` instead of
   globally disabling a server when used in agent scope.
9. Skill discovery, `skill_list`, and `skill_view` enforce `enabledSkillNames`.
10. Plugin-owned MCP servers and skills follow global plugin enablement and are not separately
    filtered by a DeepChat agent plugin policy.

## Constraints

- Do not copy skill files or MCP definitions per agent; store only allow-lists in agent config.
- Keep session-level active skills bounded by the agent's available skill set.
- Keep plugin installation, trust, enablement, lifecycle, and status global.
- Keep ACP shared MCP selections separate from DeepChat agent MCP policy.
- Preserve the Presenter, typed route, renderer client, and Vue ownership boundaries.

## Non-goals

- Per-agent plugin process instances or plugin allow-lists.
- Changing external tool agents' skill directory formats.
- Removing the global Skills library or MCP server catalog.
- Adapting DeepChat plugins for ACP agents.
- Replacing Skills or MCP management pages with a generic policy panel.

## Decisions

- `DeepChatAgentConfig.enabledSkillNames` and `enabledMcpServerIds` are nullable allow-lists.
- `null` / `undefined` inherits the built-in `deepchat` policy; `[]` disables the category.
- Plugin-owned MCP servers follow the owning plugin and are excluded from normal MCP selection.
- Plugins are globally enabled for every DeepChat agent; `enabledPluginIds` is not part of agent
  config.
- ACP selection replaces the Plugins Hub with an unavailable state.
