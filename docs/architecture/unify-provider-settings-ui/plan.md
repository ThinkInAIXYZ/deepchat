# 实施方案

## 设计决策

抽取共享外壳组件 `ProviderSettingsShell.vue`，承载「信息卡 + Tabs」骨架，标准
Provider 与 Bedrock 均复用，彻底消除骨架分叉，防止未来再次不一致。

## 组件契约：ProviderSettingsShell.vue

- Props：`title: string`、`subtitle?: string`、`enabledCount: number`、
  `activeTab: 'connection' | 'models' | 'advanced'`
- Emits：`update:activeTab`（支持 `v-model:active-tab`）
- Slots：`connection`、`models`、`advanced`（默认回退显示
  `settings.provider.center.noAdvancedConfig`）、`dialogs`（置于 ScrollArea 外、
  section 内，承载对话框容器）
- i18n：复用 `settings.provider.center.{noApiUrl,enabledModels,tabs.*,noAdvancedConfig}`

## 改动清单

1. 新建 `ProviderSettingsShell.vue`。
2. `ModelProviderSettingsDetail.vue`：模板改用 shell，移除内联 ScrollArea/Badge/Tabs
   导入；script 逻辑不变，`activeTab` 通过 `v-model` 接入 shell。
3. `BedrockProviderSettingsDetail.vue`：模板改用 shell；凭证表单 → connection slot，
   模型管理 → models slot，`ProviderRateLimitConfig` → advanced slot；新增 `activeTab`
   ref；移除未使用的 ScrollArea 导入。
   - `AWS_BEDROCK_PROVIDER = LLM_PROVIDER & {...}`，故 `ProviderRateLimitConfig`
     （要求 `LLM_PROVIDER`）类型兼容。

## 风险

- 改动集中在三个 Vue 文件，纯 UI 结构，业务逻辑零改动，风险低。
