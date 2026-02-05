# Renderer Store & Composables Rules

**Status**: Draft  
**Created**: 2026-01-20  
**Owner**: Eric

## 背景与目标
适配层已完成后，renderer 的混乱点主要集中在 `stores/` 与 `composables/` 的职责与依赖方向不一致。本规范用于明确分类、依赖边界与命名约束，保证域内实现可以持续收敛。

## 范围（In Scope）
- `src/renderer/src/stores/**` 的职责边界与依赖规则。
- `src/renderer/src/composables/**` 的分类、职责与命名约束。
- 事件订阅、生命周期与副作用的集中位置。

## 非目标（Out of Scope）
- 目录迁移与具体重构实现细节。
- 新的基础设施层或 build 工具引入。

## 术语与分类
### Store（Pinia）
- 仅负责 **application state + orchestration**。
- 不直接调用 `window.electron`、`ipcRenderer`、`usePresenter`。
- 不直接操作 DOM、路由或组件实例。

### App Composable
- 用于**编排业务流程**，可读写 store、调用 adapter/service。
- 不直接操作 DOM，不依赖具体组件。

### UI Composable
- 仅用于**组件级交互与局部状态**（输入、动画、UI 计算）。
- 可读 store，但不直接调用 adapter/service。

### Adapter Composable
- 只负责**对接 adapter/presenter/IPC**，提供稳定 API。
- 不读取或写入 store，不依赖 UI。

## 依赖方向与禁止事项
### 依赖方向（原则）
`UI Composable -> App Composable -> Adapter Composable -> Presenter/IPC`

### 允许依赖（常见）
- UI Composable：`stores/*`、`composables/*`（UI/App）、`utils/*`。
- App Composable：`stores/*`、`composables/*`（Adapter）、`lib/*`、`utils/*`。
- Store：`lib/*`、`utils/*`、domain service（如后续引入）。
- Adapter Composable：`usePresenter`、`window.electron`、`ipcRenderer`、`events.ts`。

### 禁止事项
- Store/UI Composable 中直接调用 `usePresenter` 或 `window.electron`。
- Store/UI Composable 中直接注册 `ipcRenderer.on` 或 `window.electron.on`。
- UI Composable 直接调用 Adapter Composable。
- Store 导入 UI Composable 或组件。

## Store 规则
- Store 只承载可序列化的 state、computed、actions。
- 事件订阅与清理不得放在 store 内部；使用 `useXxxStoreLifecycle` 承接。
- Store action 允许调用 App Composable 或 domain service，但不直接调用 Adapter Composable。
- Store 文件超过 500 行或出现 10+ 跨模块依赖时必须拆分。

## Composables 规则
### UI Composable
- 仅处理 UI 行为与局部状态。
- 可读 store，但不写业务流程，不调用 Adapter。

### App Composable
- 负责流程编排（例如“提交消息”“切换会话”）。
- 允许调用 Adapter Composable，写入 store。
- 避免直接依赖组件或 DOM API。

### Adapter Composable
- 只实现 IPC/Presenter/Adapter 交互。
- 对外暴露稳定 API，返回 `unsubscribe` 或 `dispose` 用于清理订阅。
- 不持久化 UI 状态，不依赖 store。

## 事件订阅与生命周期
- 所有 IPC 订阅都必须集中在 Adapter Composable。
- Store 与 UI 仅通过 App Composable 订阅事件并进行协调。
- 订阅必须返回可清理句柄，并在 `onUnmounted` 中释放。

## 重复性与必要性控制
- 新增 store/composable 前必须检查现有实现是否已覆盖；优先扩展现有实现。
- 若出现职责重叠或相近命名，必须合并或明确主入口并移除旧路径。
- 同一用例只能有一个“权威入口”（App Composable 或 Store action），避免多条执行链。
- 每个新文件需要明确“唯一职责 + 必要性”，并在分类清单中登记。

## 命名与位置约定
- Store：`src/renderer/src/stores/<domain>.ts` 或 `<domain>Store.ts`。
- Adapter Composable：`useXxxAdapter.ts`。
- Store 生命周期：`useXxxStoreLifecycle.ts`。
- UI Composable：`useXxx.ts`（仅 UI 行为）。
- App Composable：`useXxxService.ts` 或 `useXxxFlow.ts`（流程编排）。

## 验收标准
- `usePresenter`、`window.electron` 仅存在于 Adapter Composable。
- Store 与 UI Composable 中不存在 IPC 订阅代码。
- 每个需要订阅事件的 store 都有对应 `useXxxStoreLifecycle`。
- 所有 composable 归类明确，并通过文件命名体现类别。
