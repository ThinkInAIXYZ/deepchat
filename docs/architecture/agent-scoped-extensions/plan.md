# Plan: Agent-scoped Plugins, Skills, and MCP

## Current Findings

- DeepChat agent 配置已落在 `AgentRepository` 的 `DeepChatAgentConfig` 中，包含模型、system prompt、工具禁用列表、subagent、memory 等。
- 技能库由 `SkillPresenter` 管理，主目录和启停状态是全局的；会话级 active skills 通过 `conversationId/sessionId` 保存。
- 运行时构建 prompt/tools 时会读取 `skillPresenter.getMetadataList()`、`getActiveSkills(sessionId)`、`loadSkillContent()`，并按 active skills 注入 prompt。
- 插件由 `PluginPresenter` 管理，全局安装/启用，插件贡献 MCP server、skills、settings、tool policy 等资源。
- MCP server 定义与全局 MCP 开关由 `McpPresenter` / `useMcpStore` 管理；`agent_mcp_selections` 当前经 `AcpConfHelper` 退化为 shared selections，主要服务 ACP/shared 语义，不是 DeepChat agent scope。
- 设置页中技能已有“外部 agent”Tab（Claude/Codex 等技能目录扫描），但这不是 DeepChat agent 级配置。
- commit `eb81a612df06f93c5407cdf3bbb8c5c6e5fc3a5b` 将 Official Plugins、MCP、Skills 放入主窗口 `/plugins` hub，但其规格明确“不重写 MCP、Skill、Remote、Plugin presenter / 不新增统一持久化表 / 不改变 MCP schema”，所以该提交完成的是入口与视图归集，不是 agent-scoped 数据拆分。
- 当前临时修复把 `/plugins/skills` 与 `/plugins/mcp` 替换成 `AgentExtensionPolicyPanel`，会丢失添加 skill/server、市场和详情等原有管理能力；需要改为“视图不变、启停语义按 agent”。

## Target Model

Introduce per DeepChat agent extension policy on `DeepChatAgentConfig`:

```ts
interface DeepChatAgentConfig {
  enabledPluginIds?: string[] | null
  enabledSkillNames?: string[] | null
  enabledMcpServerIds?: string[] | null
}
```

Semantics:

- Built-in `deepchat` stores the source policy.
- Newly created manual DeepChat agents inherit built-in `deepchat` policy through the existing config merge model.
- `null` / `undefined` means inherit from built-in `deepchat` for manual agents; for built-in `deepchat`, it means current compatible global behavior.
- `[]` explicitly disables all plugins / skills / MCP servers for that agent.
- Non-empty array is an allow-list by plugin id / skill name / MCP server id.

## Implementation Approach

1. Add typed config fields and normalization/merge support in shared agent types and `AgentRepository`.
2. Add routes/API helpers to read and patch an agent's extension policy through existing `config.updateDeepChatAgent` unless dedicated routes are needed.
3. Update MCP runtime resolution:
   - store DeepChat agent MCP policy in `DeepChatAgentConfig.enabledMcpServerIds` or a dedicated DeepChat agent policy table; do not reuse ACP shared selections.
   - filter normal MCP tools by session `agentId` before `McpPresenter`/`ToolManager` expose tool definitions.
   - include `agentId` and enabled MCP server ids in tool-profile cache fingerprints.
   - keep global MCP server definitions, marketplace, install, and global MCP enabled state intact.
4. Update skill runtime resolution:
   - derive `agentId` from session runtime state.
   - filter skill metadata by agent enabled skill names before presenting `<available_skills>`.
   - filter manually active/session active/runtime-activated skill names against the agent allow-list.
   - enforce the same allow-list inside skill tools: `skill_list` must hide disabled skills and `skill_view` must reject disabled skill names.
   - preserve existing message-level active skills but ignore unavailable skills for prompt/tool profile.
5. Update tool/profile resolution:
   - ensure skill-provided tools/scripts are unavailable when their skill is not enabled for the session agent.
   - ensure plugin-contributed resources can be filtered by session agent policy.
6. Update plugin handling:
   - keep global plugin installation/update/trust as global lifecycle.
   - split runtime enablement by DeepChat agent: plugin runtime instances and their contributed resources must be started/stopped for the selected agent scope.
   - lifecycle is config-driven by `(agentId, pluginId)` enablement, not session reference-count driven.
   - plugin-owned MCP follows plugin enablement: when an agent enables a plugin, that plugin's MCP servers are automatically in-scope for that agent and are not separately selected in the normal MCP selector.
   - model runtime identity as `(agentId, pluginId)` so errors/statuses do not collapse across agents.
   - expose per-agent enabled/available/runtime status in renderer model.
7. Update UI while preserving existing page layouts:
   - `/plugins` can keep a compact plugin policy editor alongside the plugin catalog.
   - `/plugins/skills` renders the existing `SkillsSettings` view in `scope="agent"` mode. It still loads the full global skill library and supports add/install/detail/edit, but skill card switches and detail enable toggles patch only `enabledSkillNames` for the target DeepChat agent.
   - `/plugins/mcp` renders the existing `McpSettings` view in `scope="agent"` mode. It still supports add server, marketplace, detail, tools/prompts/resources views, but server card switches patch only `enabledMcpServerIds` for the target DeepChat agent.
   - Target agent resolution: active session `agentId` -> selected agent id -> `deepchat`.
   - When an allow-list is absent and the user toggles one item, initialize from currently globally available items, then apply the requested toggle.
   - Preserve hidden existing allow-list ids when saving to avoid dropping entries not currently rendered.
8. Add tests for config normalization, runtime MCP filtering, runtime skill filtering, plugin-owned MCP scoping, and policy persistence.

## Affected Interfaces

- `src/shared/types/agent-interface.d.ts`
- `src/main/presenter/agentRepository/index.ts`
- `src/main/presenter/agentRuntimePresenter/index.ts`
- `src/main/presenter/pluginPresenter/index.ts`
- `src/main/presenter/skillPresenter/index.ts`
- `src/main/presenter/mcpPresenter/index.ts`
- `src/main/presenter/mcpPresenter/toolManager.ts`
- `src/main/presenter/mcpPresenter/agentMcpFilter.ts`
- `src/shared/contracts/routes/config.routes.ts` if adding dedicated policy routes
- `src/renderer/api/ConfigClient.ts`
- `src/renderer/settings/components/skills/SkillsSettings.vue`
- `src/renderer/settings/components/McpSettings.vue`
- `src/renderer/src/components/mcp-config/components/McpServers.vue`
- `src/renderer/src/pages/plugins/SkillsPluginsPage.vue`
- `src/renderer/src/pages/plugins/McpPluginsPage.vue`

## Compatibility and Migration

- No database schema migration is required if policy is stored in existing `agents.config_json`.
- Existing sessions keep their stored `agentId`; runtime policy is resolved dynamically from that agent's current config.
- Existing global skill/plugin/MCP definitions remain untouched.
- Existing ACP shared MCP selections remain compatible, but must not be treated as DeepChat agent MCP policy.
- If policy fields are absent, built-in `deepchat` behaves as before.

## Test Strategy

- Unit tests for `AgentRepository.resolveDeepChatAgentConfig()` merging policy fields.
- Runtime tests or focused presenter tests to assert unavailable MCP servers/tools are not exposed and cannot be called for a DeepChat agent.
- Runtime tests or focused presenter tests to assert unavailable skills are not shown in prompt and cannot be loaded as active skills.
- Presenter tests for plugin-owned MCP scoped server naming/status and per-agent plugin runtime activation/deactivation.
- Renderer/component tests:
  - `SkillsSettings` in agent scope renders original controls and saves `enabledSkillNames` without global `setSkillDisabled`.
  - `McpServers`/`McpSettings` in agent scope renders original controls and saves `enabledMcpServerIds` without global `toggleServer`.
- Manual smoke: create two DeepChat agents, select different MCP/skills/plugins, switch sessions, inspect available skills/tool list and plugin-owned MCP status.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- Targeted tests if added or existing relevant suites are identified.
