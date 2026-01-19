# 计划：通过对话控制设置

## 关键决策：基于技能的上下文控制

此功能必须描述并交付为 DeepChat 技能，以便仅在用户实际请求更改 DeepChat 设置时才注入额外的指令/上下文。

- 技能名称（建议）：`deepchat-settings`
- 激活：通过 `skill_control` **仅当**用户请求涉及 DeepChat 设置/偏好时激活。
- 停用：完成设置更改后调用 `skill_control`，以保持上下文精简。

## 工具注入控制（无技能，无工具）

配置相关工具不得出现在 LLM 工具列表中（且不得在系统提示中提及），除非 `deepchat-settings` 技能处于活动状态。

实现意图：

- 定义专用工具（MCP 格式的函数定义）：
  - `deepchat_settings_toggle`
  - `deepchat_settings_set_language`
  - `deepchat_settings_set_theme`
  - `deepchat_settings_set_font_size`
  - `deepchat_settings_open`
- **不**通过 MCP 服务器/工具列表 UI 暴露它们（避免被自动启用到 `enabledMcpTools`）。
- 仅在以下条件满足时注入这些工具定义：
  - 当前对话启用了 `deepchat-settings`，并且
  - 技能的前置元数据 `allowedTools` 包含工具名称。

这需要对话范围的工具定义构建：

- 扩展工具定义构建上下文以包含 `conversationId`。
- 获取该对话的 `skillsAllowedTools`（通过 `SkillPresenter.getActiveSkillsAllowedTools`）。
- 仅在允许时条件性地追加 `deepchat_settings_*` 工具定义。

## 步骤 1：安全设置应用 API（主进程）

### 入口点

在主进程中实现一个狭窄的、经过验证的应用表面（presenter 方法或代理工具处理器），用于：

- 接受 `unknown` 输入并进行验证（Zod 风格，类似于 `AgentFileSystemHandler`）。
- 使用设置 ID 的允许列表。
- 通过调用现有的 `ConfigPresenter` 方法应用更改，以便现有的事件广播保持正确。
- 返回结构化结果以渲染确认/错误消息。

### 允许列表的设置和映射

开关设置：

- `soundEnabled` -> `ConfigPresenter.setSoundEnabled(boolean)`（广播：`CONFIG_EVENTS.SOUND_ENABLED_CHANGED`）
- `copyWithCotEnabled` -> `ConfigPresenter.setCopyWithCotEnabled(boolean)`（广播：`CONFIG_EVENTS.COPY_WITH_COT_CHANGED`）

枚举设置：

- `language` -> `ConfigPresenter.setLanguage(locale)`（广播：`CONFIG_EVENTS.LANGUAGE_CHANGED`）
- `theme` -> `ConfigPresenter.setTheme('dark' | 'light' | 'system')`（广播：`CONFIG_EVENTS.THEME_CHANGED`）
- `fontSizeLevel` -> `ConfigPresenter.setSetting('fontSizeLevel', level)`（通过特殊情况广播 `CONFIG_EVENTS.FONT_SIZE_CHANGED`）

### 验证规则

- 严格的允许列表；拒绝未知 ID。
- 步骤 1 中不进行隐式类型转换。
- 每个设置的验证：
  - 布尔值：必须是布尔类型
  - 枚举值：必须匹配允许的集合
  - `fontSizeLevel`：必须是支持范围内的整数（真实来源待定；可能与 `uiSettingsStore` 常量对齐）
  - `language`：必须是支持的语言环境之一（重用配置中的支持列表）

### 纵深防御：要求技能活动

即使有控制的工具注入，也要保持运行时检查：

- 如果对话**未**启用 `deepchat-settings`，拒绝应用并返回错误，告知模型/用户激活它。
- 这确保设置不会因无关的代理行为而意外更改。

## 步骤 2：技能定义（自然语言行为）

### 内置技能工件

添加 `resources/skills/deepchat-settings/SKILL.md`：

- 前置元数据 `description` 必须明确声明：
  - 这仅用于更改 DeepChat 应用设置。
  - 仅当用户请求设置更改时激活（设置/偏好/主题/语言/字体/音效/复制COT）。
  - 不要为操作系统设置或编程/代码设置激活。
- 主体必须定义：
  - 支持的设置（允许列表）和规范值。
  - 在有歧义时如何提出澄清问题。
  - 何时拒绝并改为打开设置。
  - 完成设置任务后始终停用。

### 不允许的设置 -> 打开设置

对于涉及 MCP 配置、提示词、提供者、API 密钥等的请求：

- 不通过工具应用。
- 提供精确的说明告诉用户在哪里更改。
- 打开设置窗口并尽可能导航到相应位置。

打开/导航设置的实现选项：

- 使用 `presenter.windowPresenter.createSettingsWindow()`。
- 可选择 `executeJavaScript` 设置 localStorage 导航提示，设置 UI 可以读取。
- 或添加专用的 IPC 通道从主进程 -> 设置渲染器导航到选项卡/部分。

## 数据模型

引入共享的请求/响应类型（用于步骤 1 入口点 + 工具）：

- `ChatSettingId`（允许列表 ID 的联合）
- `ApplyChatSettingRequest`（可区分联合 `{ id, value }`）
- `ApplyChatSettingResult`
  - `{ ok: true; id; value; previousValue?; appliedAt }`
  - `{ ok: false; errorCode; message; details? }`

## 测试策略

- 主进程（Vitest）：
  - 允许列表 + 验证（拒绝无效值，无写入）
  - 每个支持的设置映射到正确的 `ConfigPresenter` 方法
  - 技能要求控制工作（技能非活动时工具拒绝）
- 渲染器/UI（如果添加了任何导航提示）：
  - 设置页面导航处理器测试（可选）
