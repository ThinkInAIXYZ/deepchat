<!-- caefb3ad-827a-4a8e-a6e6-4538e6d29550 e8026907-c360-4514-b187-bb0baf0bf120 -->
# 完善 ACP 集成计划

## 参考资源

- ACP 官方文档：https://agentclientprotocol.com/overview/agents
- 支持的 Agents 列表：
- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) - command: `kimi`, args: `["--acp"]`, env: `{}`
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (via [Zed's SDK adapter](https://github.com/zed-industries/claude-code-acp))
- [Codex CLI](https://developers.openai.com/codex/cli) (via [Zed's adapter](https://github.com/zed-industries/codex-acp))
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Augment Code](https://docs.augmentcode.com/cli/acp)
- [Code Assistant](https://github.com/stippi/code-assistant)
- [Docker's cagent](https://github.com/docker/cagent)
- [Goose](https://block.github.io/goose/docs/guides/acp-clients)
- [OpenCode](https://github.com/sst/opencode)
- [Stakpak](https://github.com/stakpak/agent)
- [VT Code](https://github.com/vinhnx/vtcode)

## 1. ConfigPresenter 初始化内置 ACP Agents

- 在 `src/main/presenter/configPresenter/index.ts` 的构造函数中，初始化 acpStore 后添加内置 agent 初始化逻辑
- 添加 `initBuiltinAcpAgents()` 方法，初始化已知的 ACP agent 配置：
- **Kimi CLI**: 
- id: `kimi-cli`
- name: `Kimi CLI`
- command: `kimi`
- args: `["--acp"]`
- env: `{}`
- 参考：https://github.com/MoonshotAI/kimi-cli
- **Claude Code** (预留):
- id: `claude-code-acp`
- name: `Claude Code ACP`
- command: `claude-code-acp` (需要先安装: `npm install @zed-industries/claude-code-acp`)
- args: `[]`
- env: `{ ANTHROPIC_API_KEY: "" }` (用户需要填写)
- 参考：https://github.com/zed-industries/claude-code-acp
- **Codex CLI** (预留):
- id: `codex-acp`
- name: `Codex CLI ACP`
- command: `codex-acp` (需要先安装: `npm install @zed-industries/codex-acp`)
- args: `[]`
- env: `{ OPENAI_API_KEY: "" }` (用户需要填写)
- 参考：https://github.com/zed-industries/codex-acp
- 只在首次初始化或升级时添加，避免覆盖用户自定义配置
- 检查 agent 是否已存在（通过 id 判断），避免重复添加

## 2. 添加中文 i18n 字符串

- 在 `src/renderer/src/i18n/zh-CN/settings.json` 中添加 `acp` 部分
- 参考英文版本 (`src/renderer/src/i18n/en-US/settings.json` 的 `acp` 部分)，翻译所有 ACP 相关的字符串：
- title: "ACP 代理"
- description: "管理由 DeepChat 启动的本地 Agent Client Protocol 代理。"
- addAgent: "添加代理"
- editAgent: "编辑代理"
- formHint: "提供命令、参数和环境变量以启动您的 ACP 代理。"
- name: "代理名称"
- namePlaceholder: "例如：Claude Code ACP"
- command: "命令"
- commandPlaceholder: "可执行文件或脚本路径"
- args: "参数"
- argsPlaceholder: "可选，用空格分隔。使用引号将参数组合在一起。"
- env: "环境变量"
- addEnv: "添加变量"
- envKeyPlaceholder: "KEY"
- envValuePlaceholder: "VALUE"
- missingFieldsTitle: "名称和命令为必填项"
- missingFieldsDesc: "保存前请填写名称和命令。"
- saveSuccess: "代理已保存"
- saveFailed: "保存代理失败"
- deleteConfirm: "删除代理 \"{name}\"？"
- deleteSuccess: "代理已删除"
- empty: "尚未配置任何 ACP 代理。"

## 3. 优化 AcpSettings 组件

- 在 `src/renderer/settings/components/AcpSettings.vue` 中添加"快速添加"功能
- 添加一个下拉菜单或按钮组，允许用户快速添加内置的 agent（如 Kimi CLI）
- 显示内置 agent 的说明和配置预览
- 添加确认对话框，避免重复添加
- 内置 agent 列表：
- Kimi CLI（推荐，开箱即用）
- Claude Code ACP（需要 API Key）
- Codex CLI ACP（需要 API Key）

## 4. 验证和测试

- 确保 ACP provider 不会出现在 ModelProviderSettingsDetail 中
- 验证内置 agent 能正确初始化
- 验证用户自定义 agent 能正常保存和使用
- 测试 Kimi CLI 是否能正常启动和通信

### To-dos

- [ ] Add @agentclientprotocol/sdk dependency
- [ ] Create AcpProvider implementation
- [ ] Register AcpProvider in ProviderInstanceManager
- [ ] Create AcpSettings.vue component
- [ ] Register ACP settings route
- [ ] Update i18n strings