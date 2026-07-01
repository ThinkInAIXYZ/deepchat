# Agent-scoped Plugins, Skills, and MCP

## User Need

当前插件、技能和 MCP 已经在导航/视图上被放进 Plugins / agent 相关入口，但底层数据仍主要是全局或 ACP/shared 维度：切换不同 DeepChat agent 后，看到和运行时使用的插件、技能、MCP server 没有按 DeepChat agent 隔离，只是 UI 视角做了拆分。

用户进一步明确：Chat Plugins 下的 Skills 与 MCP 页面不应改成新的简化选择器视图。页面应保持原有 Skills/MCP 管理体验（搜索、添加、安装、市场、详情等），但在该入口里点击启用/禁用时，必须修改当前 DeepChat agent 的配置，而不是全局禁用同名 skill 或全局关闭同一个 MCP server。

## Goal

让 DeepChat agent 能拥有独立的插件、技能与 MCP 配置，并确保 UI 展示、运行时可用能力、提示词/工具装配与持久化状态使用同一份 agent-scoped 数据。

Chat Plugins 入口的 Skills/MCP 子页需要复用原有管理视图，同时把“启用/禁用”解释为当前 agent 的 allow-list 编辑。

## Acceptance Criteria

1. 每个 DeepChat agent 可以独立配置可用技能集合。
2. 每个 DeepChat agent 可以独立配置可用插件集合，并影响该 agent 的插件 runtime 生命周期。
3. 每个 DeepChat agent 可以独立配置可用 MCP server 集合。
4. 切换 agent 后，设置页展示该 agent 自己的插件/技能/MCP 启用状态，而不是只展示全局列表。
5. 发起会话或继续会话时，运行时按会话绑定的 `agentId` 解析对应 agent 的插件/技能/MCP 配置。
6. 保留现有全局插件安装、MCP server 定义、技能安装/导入目录、外部 agent 技能同步能力；agent-scoped 配置只决定 DeepChat agent 是否使用这些资源。
7. 缺省兼容：已有用户升级后，内置 `deepchat` agent 继续拥有当前全局行为，其他 agent 继承内置 `deepchat` 的配置。
8. 设置页避免把“外部工具 agent（Claude/Codex 等技能目录同步）”、ACP shared MCP selections 和“DeepChat agent 配置”混为同一个作用域。
9. `/plugins/skills` 保持原有 Skills 管理页面形态，仍可添加/安装/查看/编辑 skill；该页切换 skill 时只写当前 DeepChat agent 的 `enabledSkillNames`，不得调用全局 `setSkillDisabled`。
10. `/plugins/mcp` 保持原有 MCP 管理页面形态，仍可添加 server、进入市场、查看详情；该页切换 server 时只写当前 DeepChat agent 的 `enabledMcpServerIds`，不得调用全局 `toggleServer`。
11. Skills/MCP agent-scoped 页面进入时按当前会话 `agentId` 优先，其次当前选中的 agent，最后 `deepchat` 查询 agent 配置。
12. 运行时 skill discovery/view 工具必须受当前 DeepChat agent 的 `enabledSkillNames` 约束；agent 禁用的 skill 不应出现在 `skill_list`，也不能被 `skill_view` 读取。

## Constraints

- 不降低现有插件信任、安装、运行时权限、安全校验。
- 不把插件安装状态复制到每个 agent；安装/更新/信任仍是全局资源生命周期，但运行时启用按 agent 拆分。
- 不复制 MCP server 定义到每个 agent；MCP server 配置仍是全局资源，agent 只保存选择/启用策略。
- 不复制技能文件到每个 agent；技能文件库仍是全局资源，agent 只保存选择/启用策略。
- 不破坏现有会话级 active skills：用户消息或工具临时激活的 skill 仍可作为本轮上下文状态，但必须受 agent 可用集合约束。
- 遵循现有 Presenter、typed route contracts、renderer API client 与 Vue 组件模式。
- Skills/MCP 原有管理能力（添加、详情、市场、安装等）仍是全局资源管理；仅启用/禁用状态在 Chat Plugins agent-scoped 入口下改为 agent allow-list。

## Non-goals

- 不实现插件市场、多源插件安装或插件沙箱重构。
- 不改变第三方外部工具的技能目录格式。
- 不迁移或删除当前全局技能库、插件安装库。
- 不把 ACP agent 的外部运行时插件化。
- 不重做 Skills/MCP 页面布局或替换为简化策略面板。

## Decisions

- 插件 agent-scoped 行为需要覆盖插件 runtime 生命周期：插件进程也应按 DeepChat agent 启停，而不是只在运行时过滤贡献能力。
- 插件 runtime 生命周期按 agent 配置启用/禁用管理，不按单会话引用计数管理。
- 插件贡献的 MCP server 只跟随插件启用；某 agent 启用插件后，该插件 owned MCP 自动属于该 agent，不再要求额外进入 MCP 选择列表。
- MCP 也需要纳入 DeepChat agent scope；现有 ACP/shared MCP selections 不能代表 DeepChat agent 的 MCP 配置。
- 新建 DeepChat agent 默认继承内置 `deepchat` agent 的插件/技能/MCP 配置。
- Chat Plugins 的 Skills/MCP 页面复用原有管理 UI；通过 scope prop 切换保存语义，避免用户失去添加 skill/server 等原有入口。
