# 统一 Provider 设置界面外观

## 背景

设置页中各 LLM Provider 的详情界面由 `ModelProviderSettingsSettings.vue` 根据
`apiType` 分发到不同子组件。标准 Provider（OpenAI / Anthropic / Gemini 等）使用
`ModelProviderSettingsDetail.vue`，其结构为「顶部信息卡 + Tabs(Connect / Models /
Advanced)」。而 AWS Bedrock 使用 `BedrockProviderSettingsDetail.vue`，采用平铺表单
结构：无信息卡、无 Tabs，外层 `ScrollArea` 与内部容器叠加 `p-2`/`gap-2` 导致间距不
统一。两者视觉骨架完全不同，用户反馈“样式完全不一致”。

## 目标

让 AWS Bedrock 的设置界面在视觉骨架上与标准 Provider 完全一致，同时不改动其凭证、
验证、模型管理等业务逻辑。

## 范围

- 仅渲染进程 UI 结构调整（`src/renderer/settings/components/`）。
- 不改动 main 进程的 Provider 实现、凭证存储、模型获取逻辑。
- 复用现有 i18n key（`settings.provider.center.*` 已存在）。

## 验收标准

- Bedrock 详情页顶部显示信息卡（标题 + 副标题 + 已启用模型数 Badge）。
- Bedrock 详情页使用 Connect / Models / Advanced 三个 Tab。
- 凭证表单（认证方式切换、AccessKey/Secret/Profile/Region、验证按钮、说明文本）
  位于 Connect Tab，行为与改造前一致。
- 模型管理位于 Models Tab；速率限制位于 Advanced Tab。
- 标准 Provider 详情页外观与行为保持不变。
- `lint` / `typecheck` 通过。
