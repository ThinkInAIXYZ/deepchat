# 默认模型与默认视觉模型规格

## 概述

新增两个全局设置项：

1. `默认模型`（`defaultModel`）
2. `默认视觉模型`（`defaultVisionModel`）

其中：

1. `默认模型`用于所有“新建会话”默认模型选择（`fork` 例外，`acp` 模式例外）。
2. `默认视觉模型`用于视觉场景，当前仅供内置 `imageServer` 使用。
3. `imageServer` 现有的“按服务器 args 配置模型”能力移除，统一改为读取全局 `defaultVisionModel`。
4. `默认视觉模型`只能选择具备 `vision` 能力的模型。

## 背景与动机

1. 当前新建会话模型会受到“最近会话/偏好模型”影响，缺少稳定的全局默认入口。
2. `imageServer` 以 MCP 服务器局部参数维护模型，配置分散，和全局模型管理不一致。
3. 视觉模型应统一做能力约束（`vision=true`），避免运行时才发现模型不支持图像输入。

## 用户故事

### US-1：新建会话统一默认模型

作为用户，我希望设置一次“默认模型”，以后新建会话时自动使用它，而不是被最近会话模型影响。

### US-2：ACP 模式不受影响

作为用户，我希望 ACP 会话仍按 ACP 机制选模型，不被“默认模型”覆盖。

### US-3：视觉能力统一入口

作为用户，我希望设置一个“默认视觉模型”，内置图片工具直接使用它，不再在 `imageServer` 里重复配置。

## 功能需求

### A. 新增全局设置项

- [ ] 新增 `defaultModel` 配置，数据结构为 `{ providerId: string, modelId: string }`
- [ ] 新增 `defaultVisionModel` 配置，数据结构为 `{ providerId: string, modelId: string }`
- [ ] 两项配置均通过 `configPresenter.getSetting/setSetting` 读写并持久化

### B. 新建会话默认模型规则

- [ ] 适用范围：所有“新建会话”路径（即调用 `createConversation` 创建新会话）
- [ ] 排除范围：`forkConversation`（以及基于分支语义的会话继承路径）不改，继续继承源会话模型
- [ ] ACP 例外：当会话处于 `acp agent` 模式时，不应用 `defaultModel`
- [ ] 优先级：当调用方未显式传入 `providerId/modelId` 时，`defaultModel` 优先于“最近会话/旧偏好模型”逻辑
- [ ] 当 `defaultModel` 未配置或已失效时，回退到当前现有兜底策略

### C. 默认视觉模型规则

- [ ] `defaultVisionModel` 的候选列表仅允许 `vision=true` 的已启用模型
- [ ] 若用户尝试保存非视觉模型，需阻止并给出明确提示
- [ ] 若 `defaultVisionModel` 未配置或失效，视觉调用返回可读错误并引导去设置页配置

### D. imageServer 统一使用全局视觉模型

- [ ] `imageServer` 不再从 MCP server `args` 读取 provider/model
- [ ] `imageServer` 每次视觉调用前从全局配置读取 `defaultVisionModel`
- [ ] `inMemoryServers/builder.ts` 中 `imageServer` 构造不再依赖 `args[0]/args[1]`
- [ ] MCP 配置表单中针对 `imageServer` 的模型选择 UI 移除

### E. 验收标准

- [ ] 在非 ACP 新建会话中，未手动改模型时默认使用 `defaultModel`
- [ ] `fork` 新会话继续继承原会话模型，不受 `defaultModel` 干预
- [ ] ACP 新建会话不受 `defaultModel` 影响
- [ ] `imageServer` 在已配置 `defaultVisionModel` 时可正常调用视觉能力
- [ ] `imageServer` 在未配置/配置无效时给出明确错误（非静默失败）
- [ ] `imageServer` 相关 MCP args 模型配置入口已移除

## 非目标

1. 不改标题生成链路的模型选择策略（本次仅新增会话默认模型与视觉默认模型）。
2. 不新增“按工具分别配置视觉模型”的能力（仅一个全局视觉模型）。
3. 不修改 ACP 模型管理机制。

## 约束

1. 保持现有 Presenter 架构与 IPC 类型边界，不引入新通信通道。
2. 保持设置持久化兼容，旧配置文件可继续加载。
3. UI 文案必须走 i18n。

## 开放问题

无。
