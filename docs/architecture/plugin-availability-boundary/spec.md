# Plugin Availability Boundary

## User Need

The Plugins Hub must not mix two incompatible availability models:

- ACP agents run in an external runtime and cannot consume DeepChat plugins.
- DeepChat plugins are enabled globally; a per-agent `enabledPluginIds` allow-list would filter only
  some plugin-owned MCP servers and skills without scoping plugin process lifecycle.

The ACP case needs an explicit unavailable state. A partial per-agent plugin policy must remain
absent because it exposes a scope control that the runtime does not implement consistently.

## Goal

Define one plugin availability rule:

- ACP agent selected: the Plugins Hub is unavailable.
- DeepChat agent selected, or no agent selected: every globally enabled plugin is available.
- Skills and normal MCP servers keep their existing DeepChat agent-scoped selection behavior.

## Acceptance Criteria

1. Selecting an ACP agent replaces the Plugins Hub tabs and child route with a clear unavailable
   state.
2. The unavailable state explains that ACP agents manage extensions through their own runtime and
   tells the user to select a DeepChat agent.
3. Switching back to a DeepChat agent restores the current Plugins route without another IPC read.
4. The plugin catalog no longer renders an agent-scope policy panel.
5. `DeepChatAgentConfig` no longer exposes or resolves `enabledPluginIds`.
6. Plugin-owned MCP servers and skills follow the owning plugin's global enabled state and are not
   filtered by a per-agent plugin allow-list.
7. `enabledSkillNames` and `enabledMcpServerIds` retain their current per-agent semantics.
8. Existing persisted `enabledPluginIds` values no longer affect runtime behavior; no database
   migration is required.

## Constraints

- Global plugin installation, trust, enablement, runtime lifecycle, and status stay owned by
  `PluginPresenter`.
- Remote virtual plugins keep their existing global channel configuration and lifecycle.
- The renderer must derive ACP availability from the existing agent store; do not add IPC, a new
  store, or duplicated agent state.
- Do not change ACP runtime configuration or attempt to inject DeepChat plugins into ACP agents.
- Preserve the existing agent-scoped Skills and MCP management views.

## Non-goals

- Per-agent plugin runtime instances.
- Plugin process reference counting by session.
- ACP plugin installation or adaptation.
- Redesigning the Skills or MCP pages.
- Migrating or deleting historical JSON keys from stored agent records.

## Decisions

- `PluginsHubPage` owns the ACP availability gate because it covers catalog, detail, Skills, and MCP
  child routes in one place.
- The selected agent type is `agent.agentType ?? agent.type`; a missing selection is treated as the
  normal DeepChat/global view.
- The ACP state replaces the whole Plugins Hub surface instead of disabling individual controls.
- Plugin availability is global for DeepChat. The global plugin enabled state is the only plugin
  availability source of truth.
- Old `enabledPluginIds` data is ignored by removing it from config resolution and runtime access
  contexts. Keeping a dormant compatibility field would preserve the ambiguity this change removes.

## Open Questions

None.
