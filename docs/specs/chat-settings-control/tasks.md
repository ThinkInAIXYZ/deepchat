# 任务：通过对话控制设置

## 步骤 0 - 技能优先设计（上下文控制）

1. 起草内置技能：`resources/skills/deepchat-settings/SKILL.md`。
2. 确保前置元数据 `description` 明确限制激活仅针对 DeepChat 设置更改。
3. 确保技能主体列出允许列表的设置 + 安全处理 + 自停用指导。

## 步骤 1 - 安全设置应用 API（主进程）

1. 添加设置应用请求/结果的共享类型。
2. 实现经过验证的应用入口点（Zod 风格的 `unknown` 解析）。
3. 实现允许列表映射到现有 `ConfigPresenter` 方法：
   - `soundEnabled`
   - `copyWithCotEnabled`
   - `language`
   - `theme`
   - `fontSizeLevel`
4. 实现工具注入控制：仅当 `deepchat-settings` 活动并允许时，才在工具定义中包含 `deepchat_settings_toggle`/`deepchat_settings_set_language`/`deepchat_settings_set_theme`/`deepchat_settings_set_font_size`/`deepchat_settings_open`。
5. 添加纵深防御控制：如果 `deepchat-settings` 技能对对话未活动，则拒绝应用。
6. 添加"打开设置"辅助程序/工具，用于不支持的设置（MCP/提示词等），包括尽力导航。
7. 添加主进程测试：
   - 验证和映射
   - 工具定义仅在技能活动时存在
   - 技能控制在非活动时拒绝应用

## 步骤 2 - UX 行为（LLM + 技能）

1. 验证技能元数据提示列表足够清晰地列出 `deepchat-settings`，以便模型可以选择它。
2. 确保技能指示：仅当用户询问时激活；完成后停用。
3. 在 SKILL.md 中添加中文/英文用户表述的示例。
