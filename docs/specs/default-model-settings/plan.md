# 默认模型与默认视觉模型实施计划

## 1. 当前实现基线

### 1.1 新建会话模型来源（现状）

1. `src/renderer/src/components/NewThread.vue` 初始化模型时，优先“最近会话/偏好模型/第一个可用模型”。
2. `src/main/presenter/sessionPresenter/managers/conversationManager.ts` 在 `createConversation()` 中默认继承最近会话 `settings`。
3. 因此当前“新建会话默认模型”不稳定，会受最近会话影响。

### 1.2 imageServer 模型来源（现状）

1. `src/main/presenter/mcpPresenter/inMemoryServers/imageServer.ts` 构造函数接收 `provider/model`。
2. `src/main/presenter/mcpPresenter/inMemoryServers/builder.ts` 通过 `new ImageServer(args[0], args[1])` 传入。
3. `src/renderer/src/components/mcp-config/mcpServerForm.vue` 存在 `imageServer` 专属模型选择 UI，并把选择写入 server `args`。

## 2. 设计决策

### 2.1 设置数据结构

新增两个设置键（存储于 `app-settings`）：

1. `defaultModel: { providerId: string; modelId: string }`
2. `defaultVisionModel: { providerId: string; modelId: string }`

说明：

1. 两者均通过现有 `configPresenter.getSetting/setSetting` 访问。
2. 不新增独立 store 文件，先沿用现有配置存储体系。

### 2.2 新建会话默认模型决策

会话创建链路分两层处理：

1. **Renderer 层（UI 体验）**：`NewThread.vue` 初始化时优先读 `defaultModel`（非 ACP）。
2. **Main 层（最终兜底）**：`conversationManager.createConversation` 在调用方未显式传 `providerId/modelId` 时应用 `defaultModel`（非 ACP）。

规则：

1. 显式传入 `providerId/modelId` 时不覆盖。
2. `chatMode === 'acp agent'` 或目标 provider 为 `acp` 时不应用 `defaultModel`。
3. `defaultModel` 未配置或无效时，回退到现有逻辑（保持兼容）。

### 2.3 默认视觉模型决策

1. `defaultVisionModel` 选择器只展示 `vision=true` 的已启用模型。
2. 保存时做前置校验（非视觉模型不可保存）。
3. `imageServer` 运行时读取 `defaultVisionModel`；不再依赖 `args`。

### 2.4 imageServer 架构调整

目标模块：

1. `src/main/presenter/mcpPresenter/inMemoryServers/imageServer.ts`
2. `src/main/presenter/mcpPresenter/inMemoryServers/builder.ts`
3. `src/renderer/src/components/mcp-config/mcpServerForm.vue`

调整方式：

1. `ImageServer` 构造函数去掉 provider/model 参数。
2. 每次视觉调用时动态读取 `defaultVisionModel` 并校验可用性。
3. `mcpServerForm.vue` 删除 `imageServer` 专属模型选择与 args 反解析逻辑。
4. `builder.ts` 改为 `new ImageServer()`。

### 2.5 兼容与迁移策略

1. 保留旧 `imageServer.args` 数据但不再使用（兼容读取，不破坏旧配置文件结构）。
2. 不做强制迁移脚本；缺失 `defaultVisionModel` 时由运行时错误提示引导用户配置。

## 3. 实施阶段

### Phase 1：配置与类型接入

1. 新增 `defaultModel/defaultVisionModel` 的读写与默认空值处理。
2. 补充必要类型定义（若现有类型未覆盖）。

### Phase 2：新建会话默认模型

1. 调整 `NewThread.vue` 初始化优先级（`defaultModel` 优先）。
2. 调整 `conversationManager.createConversation` 的兜底模型决策。
3. 校验 `fork` 路径未被覆盖。

### Phase 3：默认视觉模型与 imageServer

1. 设置页新增 `defaultVisionModel` 选择项（vision-only）。
2. 移除 `mcpServerForm.vue` 中 `imageServer` 模型配置 UI 与 args 绑定逻辑。
3. `imageServer` 改为全局读取 `defaultVisionModel`。
4. `builder.ts` 去除 `args[0]/args[1]` 注入。

### Phase 4：验证与收尾

1. 回归新建会话路径（UI 创建、主进程创建）。
2. 回归 `imageServer` 调用成功与失败场景。
3. 统一补 i18n 文案与错误提示。

## 4. 测试策略

### 4.1 Main 测试

1. `createConversation`：无显式模型时应用 `defaultModel`。
2. `createConversation`：ACP 模式不应用 `defaultModel`。
3. `forkConversation`：继承行为不变。
4. `imageServer`：读取 `defaultVisionModel` 成功/缺失/无效分支。

### 4.2 Renderer 测试

1. `NewThread` 初始化模型优先级验证（`defaultModel` 优先）。
2. 设置页视觉模型选择仅展示 vision 模型。
3. `mcpServerForm` 不再展示 `imageServer` 模型选择控件。

## 5. 风险与缓解

1. 风险：部分隐式创建会话路径未经过 UI，仍可能走旧默认。  
缓解：在 `conversationManager.createConversation` 做主进程兜底。

2. 风险：用户升级后未配置 `defaultVisionModel` 导致 imageServer 报错。  
缓解：统一错误文案，明确引导至设置页。

3. 风险：`defaultModel` 与 `preferredModel` 语义冲突。  
缓解：明确优先级为 `defaultModel > preferredModel`（仅非 ACP）。

## 6. 质量门槛

1. `pnpm run format`
2. `pnpm run lint`
3. `pnpm run typecheck`
4. 关键 main/renderer 测试通过
