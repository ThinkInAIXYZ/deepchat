MCPRouter 市场集成说明

本文档说明 DeepChat 如何集成 MCPRouter 市场，并提供实施步骤。

后端（主进程）

- 新增 `src/main/presenter/mcpPresenter/mcprouterManager.ts`
  - listServers(page, limit): 调用 `https://api.mcprouter.to/v1/list-servers`
    - Headers: `Content-Type: application/json`, `HTTP-Referer: deepchatai.cn`, `X-Title: DeepChat`
  - getServer(serverKey): 调用 `https://api.mcprouter.to/v1/get-server`
    - 需要 `Authorization: Bearer <MCPROUTER_API_KEY>`
  - installServer(serverKey): 将返回的 `server_url` 转换为 MCP `http` 类型（Streamable HTTP）配置，写入本地：
    - baseUrl = server_url
    - customHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer <KEY>', 'HTTP-Referer': 'deepchatai.cn', 'X-Title': 'DeepChat' }
    - icons 使用随机 emoji
- 在 McpPresenter 暴露：
  - listMcpRouterServers(page, limit)
  - installMcpRouterServer(serverKey)
  - getMcpRouterApiKey() / setMcpRouterApiKey(key)（持久化到 ConfigPresenter 的 app-settings）

配置持久化

- 使用 ConfigPresenter.setSetting('mcprouterApiKey', key) 持久化 API Key。
- 所有来自 MCPRouter 的安装均复用该 Key。

前端（渲染层）

- 新增页面 `src/renderer/src/components/settings/McpBuiltinMarket.vue`
  - Grid/Gallery 样式列表，虚拟/无限滚动：滚动接近底部自动加载下一页，直到无更多数据。
  - 顶部提供 API Key 输入框与“获取密钥”按钮（跳转到 MCPRouter Key 页面）。
  - 每个卡片提供“安装”按钮：
    - 若未配置 Key，先提醒；
    - 调用主进程的 installMcpRouterServer(server_key) 安装。
- 路由：`/settings/mcp-market`，在 SettingsTabView 菜单中显示为“内置MCP市场”。
- McpSettings.vue 增加“浏览内置 MCP 市场”按钮。

i18n

- 在 zh-CN/mcp.json 增加 market 文案键；在 zh-CN/routes.json 增加 settings-mcp-market。

使用步骤

1. 打开 设置 -> MCP -> 点击“浏览内置 MCP 市场”。
2. 首次安装前，点击“获取密钥”并在 MCPRouter 控制台创建 API Key，复制粘贴到输入框并保存。
3. 在市场页选择需要的服务，点击“安装”。
4. 安装完成后回到 MCP 服务器列表，即可看到新增的 HTTP 类型服务，按需启用与启动。

注意事项

- 遵循 Electron 最佳实践，所有网络请求在主进程完成，渲染层通过 IPC 调用 Presenter。
- 不破坏现有 MCP 配置结构；安装的服务以 http 类型保存，customHeaders 精确包含上文所述四个头。
- 若接口返回空列表，前端展示“暂无服务/没有更多了”。


