# Model & Provider Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- Model/Provider 作为能力与配置域，不参与消息执行。
- 运行时校验与能力探测通过适配层统一输出。
- Settings 仅负责配置持久化与入口 UI。

## 代码现状分析（收敛点）
- Provider 与模型能力逻辑分散在多个 store 与 settings 组件。
- 能力判断与 UI 展示耦合较强，难以复用。

## 结构与边界
- **Provider Config**：供应商配置与鉴权信息。
- **Model Catalog**：模型列表与能力元数据。
- **Capability Gate**：能力校验与过滤策略。

## 事件与数据流
- 配置变更 -> Provider Config 更新 -> Model Catalog 重新计算。
- 能力校验 -> UI 选择器渲染可用模型。

## 迁移策略
- 先稳定 Provider/Model 数据接口，再收敛 UI 入口。
- 能力校验逻辑下沉到 domain 层，UI 只消费结果。

## 架构变更步骤与涉及文件范围

### 1) Provider 配置入口收敛
目标：统一 Provider 配置读写与校验入口。
影响范围：
```txt
src/renderer/src/stores/providerStore.ts
src/renderer/settings/components/ProviderDialogContainer.vue
src/renderer/settings/components/AddCustomProviderDialog.vue
src/renderer/settings/components/ProviderApiConfig.vue
```

### 2) Model Catalog 与能力收敛
目标：模型列表与能力过滤统一到 store/service。
影响范围：
```txt
src/renderer/src/stores/modelStore.ts
src/renderer/src/components/ModelChooser.vue
src/renderer/src/components/ModelSelector.vue
```

### 3) Settings 与运行时分离
目标：设置页只做配置与展示，不参与运行态判断。
影响范围：
```txt
src/renderer/settings/components/ModelProviderSettings.vue
src/renderer/src/components/settings/ModelConfigDialog.vue
src/renderer/src/components/settings/ModelCheckDialog.vue
```

## 测试策略
- Provider 配置校验与模型过滤逻辑单测。
- UI 选择器只做渲染，不直接校验。
