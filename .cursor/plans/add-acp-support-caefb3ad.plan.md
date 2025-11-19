<!-- caefb3ad-827a-4a8e-a6e6-4538e6d29550 ddbbb19b-be42-40e7-ac7f-5a03c4be8a42 -->
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

## 0. 修复 TypeScript 错误（优先级最高）

- **修复 `llmProviderPresenter/index.ts` 参数错误**：
  - 检查 `agentLoopHandler.startStreamCompletion` 方法签名
  - 移除或修正 `conversationId` 参数传递（如果方法不支持该参数）
  - 参考：`src/main/presenter/llmProviderPresenter/managers/agentLoopHandler.ts`
- **修复 `acpProvider.ts` 中的类型错误**：
  - 修复 `schema` 导入：使用 `import type { schema } from '@agentclientprotocol/sdk'` 或从正确的路径导入
  - 修复 `connection.cancel` 类型问题：检查 `ClientSideConnection` 的实际 API
  - 修复 `child.killed` 和 `child.kill` 类型问题：确保 `child` 类型正确声明为 `ChildProcessWithoutNullStreams`

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
- 检查 agent 是否已存在（通过 id 判断），避免重复添加c

## 2. 添加 ACP 总开关

- 在 `src/main/presenter/configPresenter/index.ts` 中添加：
  - `getAcpEnabled(): Promise<boolean>` - 获取 ACP 启用状态
  - `setAcpEnabled(enabled: boolean): Promise<void>` - 设置 ACP 启用状态
- 在 acpStore 中存储 `enabled` 字段，默认 `false`
- 在 `AcpProvider.fetchProviderModels()` 中检查 `getAcpEnabled()`，如果未启用则返回空数组
- 在 `AcpProvider` 的 `init()` 方法中，如果未启用则不初始化
- 更新 `IConfigPresenter` 接口定义，添加 ACP 开关方法

## 3. 优化 AcpSettings 组件

- 参考 `McpSettings.vue` 的结构，在顶部添加总开关（类似 MCP 的开关）
- 将编辑功能改为对话框形式：
  - 创建 `AcpAgentDialog.vue` 组件
  - 使用 Dialog 组件包装编辑表单
  - 支持新建和编辑两种模式
- 添加"编辑全部"功能：
  - 添加一个按钮打开 JSON 编辑对话框
  - 使用 `Dialog` + `Textarea` 或 `Monaco Editor` 显示完整 JSON
  - JSON 格式参考：
    ```json
    {
      "agents": [
        {
          "id": "kimi-cli",
          "name": "Kimi CLI",
          "command": "kimi",
          "args": ["--acp"],
          "env": {}
        }
      ]
    }
    ```

  - 支持 JSON 验证和格式化
  - 保存时验证 JSON 格式，并更新所有 agents

## 4. 添加中文 i18n 字符串

- 在 `src/renderer/src/i18n/zh-CN/settings.json` 中添加 `acp` 部分
- 参考英文版本 (`src/renderer/src/i18n/en-US/settings.json` 的 `acp` 部分)，翻译所有 ACP 相关的字符串：
  - title: "ACP 代理"
  - description: "管理由 DeepChat 启动的本地 Agent Client Protocol 代理。"
  - enabledTitle: "启用 ACP"
  - enabledDescription: "启用后，配置的 ACP 代理将作为模型出现在模型选择器中。"
  - enableToAccess: "请先启用 ACP 以访问代理配置"
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
  - quickAdd: 快速添加相关翻译
  - editAll: "编辑全部"
  - editAllTitle: "批量编辑 ACP 代理"
  - editAllDescription: "直接编辑 JSON 配置，修改所有代理设置。"
  - editAllPlaceholder: "在此输入 JSON 配置..."
  - editAllInvalidJson: "无效的 JSON 格式"
  - editAllSaveSuccess: "配置已保存"
  - editAllSaveFailed: "保存配置失败"

## 5. 验证和测试

- 确保所有 TypeScript 错误已修复
- 确保 ACP provider 不会出现在 ModelProviderSettingsDetail 中
- 验证 ACP 总开关能正确控制 provider 的启用/禁用
- 验证启用后，agents 能作为 models 出现在 ModelChooser 中
- 验证内置 agent 能正确初始化
- 验证用户自定义 agent 能正常保存和使用
- 验证 JSON 编辑功能能正确保存和加载配置
- 测试 Kimi CLI 是否能正常启动和通信

### To-dos

- [x] Add @agentclientprotocol/sdk dependency
- [x] 修复 TypeScript 错误：conversationId 参数、schema 导入、connection.cancel、child 类型问题
- [x] 在 ConfigPresenter 中添加内置 ACP agent 初始化逻辑（kimi CLI 等）
- [x] 添加 ACP 总开关功能（getAcpEnabled/setAcpEnabled），并在 AcpProvider 中检查启用状态
- [x] 优化 AcpSettings 组件：添加总开关、将编辑改为对话框、添加 JSON 编辑功能
- [x] 添加中文 i18n 字符串（settings.json 中的 acp 部分，包括新增的开关、对话框、JSON 编辑相关）
- [x] 验证 ACP provider 不会出现在 ModelProviderSettingsDetail，启用后 agents 能作为 models 选择
