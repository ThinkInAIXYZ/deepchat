# AgentPresenter 重构状态（当前架构与时限）

更新时间：2026-01-01

## 当前架构（已落地部分）

### 已接入的核心模块
- `src/main/presenter/agentPresenter/`
  - Facade：`index.ts`（对外 IPC 入口，统一 send/continue/cancel/permission/preview）
  - Message：`messageBuilder` / `messageFormatter` / `messageTruncator` / `messageCompressor`
  - Tool：`toolCallCenter` / `toolRegistry` / `toolRouter`
  - Session：`sessionResolver` / `sessionContext` / `sessionManager`

### 运行链路（当前态）
1. Renderer 通过 `agentPresenter` 发起发送/继续/取消/权限/预览等操作。
2. Main 内部仍由 `ThreadPresenter` 承接生成与事件处理（stream + permission）。
3. Message 构建与 token 预算统一由 `agentPresenter/message/*` 模块提供。

### 仍在 `ThreadPresenter` 中的职责
- loop 编排与 stream 消费（`streamGenerationHandler` / `llmEventHandler`）
- permission 处理（`permissionHandler`）
- conversation/message 的 CRUD 与事件分发

## 完成情况（按 Phase 标记）

### Phase 0：类型与脚手架
- [x] `ChatMessage` 统一定义与引用修复
- [x] `agentPresenter` 目录树与空实现
- [x] 基础单测骨架

### Phase 1：Facade 接入
- [x] `agentPresenter` 初始化与 IPC 暴露
- [x] `send/continue/cancel/permission/preview` 最小接口
- [x] `SessionContext.resolved` 调试输出

### Phase 2：Message 层拆分
- [x] `messageFormatter / messageTruncator / messageCompressor / promptEnhancer`
- [x] `messageBuilder` 拆分并接入旧流程
- [x] 单测覆盖核心分支

### Phase 3：ToolCallCenter 收口
- [x] `ToolCallCenter` 薄封装 `ToolPresenter`
- [x] message 构建时统一使用 tool definitions
- [x] tool 去重与 jsonrepair 回退单测

### Phase 4：SessionManager 与状态收口
- [x] `SessionContext.resolved` 基础规则落地
- [x] `agentWorkspacePath` 默认生成与持久化
- [x] 运行时状态迁入 `SessionManager`
- [x] 替换重复的 mode/workspace 决策

### Phase 5：Loop async/await 重写
- [x] `loopOrchestrator` 事件消费层
- [x] `agentLoopHandler` 自驱动 loop
- [x] 三模式回归与性能对照

### Phase 6：Renderer 迁移与清理
- [x] Chat 主流程切换至 `agentPresenter`
- [x] utilities / search / conversation 管理迁移
- [x] 移除 `ThreadPresenter` 入口（renderer/IPC），旧模块内部保留用于委托

## 当前时限（滚动计划）

### 近期（1-2 周）
- Phase 4：SessionManager 状态收口 + workspace 默认路径持久化（已完成）
- 补齐 Phase 3 测试（tool 去重 / jsonrepair）（已完成）

### 中期（2-4 周）
- Phase 5：loop 重写与回归矩阵（已完成）

### 收尾（1-2 周）
- Phase 6：renderer 迁移剩余模块 + 清理旧入口（已完成）

## 变更记录（本轮）
- Renderer chat 流程迁移到 `agentPresenter`（send/continue/cancel/permission/preview）
- 删除 `threadPresenter/utils` 的旧包装层
- SessionManager 统一 workspace 生成/持久化与运行时状态
- LoopOrchestrator 收口 stream 事件消费
- Renderer 侧 IPC 入口统一到 `agentPresenter`
