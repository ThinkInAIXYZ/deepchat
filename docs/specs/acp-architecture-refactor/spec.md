# ACP Architecture Refactor Specification

> DeepChat ACP 架构重构规格文档
>
> 版本: 1.0-draft
> 状态: 设计中
> 最后更新: 2026-01-25

## 1. 概述

### 1.1 背景

当前 ACP (Agent Client Protocol) 实现存在架构问题：

1. **错误的继承关系**：`AcpProvider` 继承自 `BaseLLMProvider`，将 ACP Agent 当作 "模型" 处理
2. **协议违反**：DeepChat 将完整对话历史传递给 Agent，违反 ACP 协议（应只传递当前用户输入）
3. **职责混乱**：DeepChat 持久化 ACP Session 数据，违反 ACP 设计原则（数据应由 Agent 自己管理）
4. **概念混淆**：ACP Session 与 DeepChat Conversation 强绑定

### 1.2 设计目标

**核心原则**：
- **ACP 服务完全独立**：不依赖 LLM Provider 体系
- **零持久化**：DeepChat 不持久化任何 ACP Session 数据
- **内存管理**：Session 状态只在内存中维护，与进程生命周期一致
- **职责清晰**：DeepChat 只负责 UI 展示和进程管理
- **协议正确性**：严格遵循 ACP 协议规范

### 1.3 用户价值

**对用户的好处**：
- ✅ 更稳定的 ACP Agent 体验（架构清晰，职责明确）
- ✅ 更快的响应速度（移除不必要的持久化操作）
- ✅ 更好的多 Session 支持（Session 管理更灵活）
- ✅ 更符合 ACP 协议设计（与其他 ACP Client 行为一致）

**对开发者的好处**：
- ✅ 代码结构更清晰（ACP 独立于 LLM Provider）
- ✅ 更容易维护和扩展
- ✅ 减少代码量（移除 1289 行 AcpProvider + 持久化代码）

## 2. 用户故事

### 2.1 核心用户故事

**US-1: 作为用户，我希望 ACP Agent 会话独立于普通 LLM 对话**
- 验收标准：
  - [ ] ACP Agent 有独立的入口（不在 Provider/Model 选择器中）
  - [ ] 可以选择 Agent 和 Workspace 创建会话
  - [ ] ACP 会话与普通对话在 UI 上有明确区分

**US-2: 作为用户，我希望 ACP Session 能够在应用重启后恢复**
- 验收标准：
  - [ ] 应用重启后，可以通过 sessionId 恢复之前的 Session
  - [ ] Session 历史由 Agent 自己管理（如 `.claude/sessions/`）
  - [ ] DeepChat 不存储任何 Session 数据到数据库

**US-3: 作为用户，我希望能够在不同 Workspace 中使用同一个 Agent**
- 验收标准：
  - [ ] 可以为不同 Workspace 创建独立的 Session
  - [ ] 每个 Session 的 Workdir 不可变
  - [ ] 切换 Workdir 需要创建新的 Session

**US-4: 作为用户，我希望 ACP Agent 的消息处理更快**
- 验收标准：
  - [ ] 只传递当前用户输入给 Agent（不传递完整历史）
  - [ ] 移除不必要的数据库操作
  - [ ] 消息发送延迟 < 100ms

**US-5: 作为用户，我希望能够同时使用多个 ACP Session**
- 验收标准：
  - [ ] 支持多个 Agent 进程同时运行
  - [ ] 支持多个 Session 同时活跃
  - [ ] 同一个 Session 只能在一个 UI 界面中使用（由 UI 层控制）

### 2.2 非功能性需求

**NFR-1: 性能**
- Session 创建时间 < 3s
- 消息发送延迟 < 100ms
- 进程启动时间 < 5s

**NFR-2: 稳定性**
- 进程崩溃时自动清理相关 Session
- Session 超时自动取消（10 分钟）
- 应用退出时正确清理所有进程

**NFR-3: 兼容性**
- 现有 ACP Agent 配置自动迁移
- 旧的 `acp_sessions` 表数据清理
- 不影响现有的普通 LLM 对话功能

## 3. 验收标准

### 3.1 功能验收

- [x] **独立的 ACP 服务层** ✅ Phase 1 完成 (2026-01-25)
  - [x] `AcpPresenter` 实现并注册到 Presenter 系统
  - [x] 不继承任何 LLM Provider 相关类
  - [x] 提供完整的 Session 管理接口

- [x] **消息处理正确性** ✅ Phase 2 完成 (2026-01-25)
  - [x] 只传递当前用户输入给 Agent
  - [x] Agent 响应正确映射为 UI 事件
  - [x] 支持多模态输入（文本、图片、文件）

- [x] **零持久化** ✅ Phase 3 完成 (2026-01-25)
  - [x] 删除 `acp_sessions` 表
  - [x] 删除 `AcpSessionPersistence` 类
  - [x] Session 状态只在内存中维护 ✅

- [x] **事件系统独立** ✅ Phase 1 完成 (2026-01-25)
  - [x] 定义独立的 `ACP_EVENTS`
  - [ ] 不再使用 `STREAM_EVENTS` (Phase 2)
  - [ ] UI 层正确监听 ACP 事件 (Phase 2)

### 3.2 代码质量验收

- [ ] 所有测试通过（`pnpm test`）
- [x] 类型检查通过（`pnpm run typecheck`） ✅ Phase 1 完成
- [ ] Lint 检查通过（`pnpm run lint`）
- [ ] 代码格式化（`pnpm run format`）

### 3.3 文档验收

- [ ] 架构文档更新（`docs/acp-agent-architecture.md`）
- [ ] API 文档更新（`AcpPresenter` 接口说明）
- [ ] 迁移指南（用户数据迁移说明）

## 4. 非目标（Non-Goals）

以下内容**不在**本次重构范围内：

- ❌ 修改 ACP 协议本身
- ❌ 添加新的 ACP Agent 功能
- ❌ 修改 UI 设计（保持现有 UI 结构）
- ❌ 优化 Agent 进程性能（由 Agent 自己负责）
- ❌ 添加 Agent 市场或发现功能

## 5. 约束条件

### 5.1 技术约束

- 必须保持与现有 ACP SDK 的兼容性（`@agentclientprotocol/sdk@0.5.1`）
- 必须支持现有的 ACP Agent（kimi-cli, claude-code-acp, codex-acp）
- 必须保持 Electron 多进程架构

### 5.2 业务约束

- 不能影响现有用户的普通 LLM 对话功能
- 必须提供数据迁移方案（旧 Session 数据清理）
- 必须在 4 周内完成（分 4 个 Phase）

### 5.3 依赖约束

**保留的基础设施复用**：
- EventBus（事件通信）
- MCP Presenter（镜像源 + 服务器配置）
- RuntimeHelper（运行时管理）
- ConfigPresenter（配置管理）
- Terminal Manager（终端管理）
- Lifecycle Presenter（清理钩子）
- Workspace 相关（workdir 管理 + 文件系统边界）

**移除的依赖**：
- BaseLLMProvider 继承关系
- SQLite Presenter（`acp_sessions` 表）

## 6. 风险与缓解

### 6.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 迁移过程中数据丢失 | 高 | 中 | 完整备份，分阶段迁移，充分测试 |
| 新旧系统不兼容 | 中 | 中 | 并存期间充分测试，提供回滚方案 |
| 性能回退 | 中 | 低 | 性能基准测试，监控关键指标 |
| Agent 进程管理问题 | 高 | 低 | 完善的异常处理，健康检查机制 |

### 6.2 用户体验风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| UI 变化导致用户困惑 | 低 | 中 | 提供迁移指南和 UI 提示 |
| Session 恢复失败 | 中 | 低 | 自动创建新 Session，显示友好提示 |
| 功能暂时不可用 | 高 | 低 | 分阶段发布，保持向后兼容 |

## 7. 成功指标

### 7.1 定量指标

- [ ] 代码行数减少 > 1500 行（移除 AcpProvider + 持久化代码）
- [ ] Session 创建时间 < 3s（95th percentile）
- [ ] 消息发送延迟 < 100ms（95th percentile）
- [ ] 测试覆盖率 > 80%（核心模块）

### 7.2 定性指标

- [ ] 代码结构更清晰（通过 Code Review 评估）
- [ ] 更容易添加新功能（通过开发者反馈）
- [ ] 用户反馈积极（无严重 Bug 报告）

## 8. 开放问题

### 8.1 需要澄清的问题

- [ ] **Q1**: 旧的 Session 数据是否需要导出功能？
  - **决策**: 不需要，直接清理（Session 数据由 Agent 管理）

- [ ] **Q2**: UI 层的 Session-UI 绑定是否需要持久化？
  - **决策**: 使用 localStorage，不需要数据库持久化

- [ ] **Q3**: 是否需要支持 Session 迁移到其他 Workdir？
  - **决策**: 不支持，切换 Workdir 需要创建新 Session

### 8.2 待讨论的问题

- [ ] **Q4**: 是否需要在 UI 中显示 Session 的健康状态？
- [ ] **Q5**: 是否需要支持 Session 的导出/导入功能？
- [ ] **Q6**: 是否需要限制同时运行的 Agent 进程数量？

## 9. 参考资料

- [ACP 协议规范](https://github.com/agentclientprotocol/spec)
- [ACP SDK 文档](https://www.npmjs.com/package/@agentclientprotocol/sdk)
- [当前架构文档](../../../docs/acp-agent-architecture.md)
- [Specification-Driven Development](../../../docs/spec-driven-dev.md)

## 10. 实施进度

### Phase 1: 创建独立的 ACP 服务层 ✅ 已完成 (2026-01-25)

**完成内容**：
- ✅ 创建 `src/main/presenter/acpPresenter/` 目录结构
- ✅ 实现 `AcpPresenter` 核心接口（`index.ts`）
- ✅ 迁移 `AcpProcessManager` 到新位置（`managers/processManager.ts`）
- ✅ 重构 `AcpSessionManager` 为纯内存版本（`managers/sessionManager.ts`）
- ✅ 迁移 `AcpFsHandler` 和 `AcpTerminalManager`（`handlers/`）
- ✅ 定义独立的 `ACP_EVENTS` 事件系统（`src/main/events.ts`）
- ✅ 注册 `AcpPresenter` 到 Presenter 系统
- ✅ 类型检查通过（`pnpm run typecheck`）

**关键文件**：
- `src/main/presenter/acpPresenter/index.ts` - ACP Presenter 主入口
- `src/main/presenter/acpPresenter/types.ts` - 类型定义
- `src/main/presenter/acpPresenter/managers/sessionManager.ts` - Session 管理（纯内存）
- `src/main/presenter/acpPresenter/managers/processManager.ts` - 进程管理
- `src/shared/types/presenters/acp.presenter.d.ts` - 接口定义

**架构改进**：
- ✅ ACP 服务完全独立，不依赖 LLM Provider 体系
- ✅ Session 状态只在内存中维护（零持久化）
- ✅ 独立的事件系统（`ACP_EVENTS`）
- ✅ 清晰的职责分离

### Phase 2: 拆分消息处理逻辑 ✅ 已完成 (2026-01-25)

**完成内容**：
- ✅ 实现 `AcpInputFormatter`（只处理当前输入，不涉及历史）
- ✅ 实现独立的消息发送流程（`sendPrompt` 方法）
- ✅ 集成 InputFormatter 到 AcpPresenter
- ✅ 添加输入验证逻辑
- ✅ 类型检查通过（`pnpm run typecheck`）

**关键文件**：
- `src/main/presenter/acpPresenter/formatters/inputFormatter.ts` - 输入格式化器
- `src/main/presenter/acpPresenter/index.ts` - 更新的消息发送流程

**架构改进**：
- ✅ 只传递当前用户输入给 Agent（不传递历史消息）
- ✅ 支持多模态输入（文本、图片、文件）
- ✅ 输入验证确保数据完整性
- ✅ 清晰的错误处理和日志记录

**注意事项**：
- AgentPresenter 对 ACP 的调用移除工作留待 Phase 4（需要同时删除旧代码）
- UI 层事件监听更新留待 UI 实现阶段

### Phase 3: 移除数据持久化 ✅ 已完成 (2026-01-25)

**完成内容**：
- ✅ 删除 `acp_sessions` 表定义文件
- ✅ 删除 `AcpSessionPersistence` 类
- ✅ 从 SQLitePresenter 中移除所有 ACP Session 相关方法
- ✅ 清理 SQLitePresenter 的表初始化和迁移逻辑

**关键文件**：
- ❌ 已删除：`src/main/presenter/sqlitePresenter/tables/acpSessions.ts`
- ❌ 已删除：`src/main/presenter/agentPresenter/acp/acpSessionPersistence.ts`
- ✅ 已更新：`src/main/presenter/sqlitePresenter/index.ts` - 移除所有 ACP Session 方法

**架构改进**：
- ✅ 完全移除数据库持久化层
- ✅ Session 状态完全在内存中维护（符合 ACP 协议设计）
- ✅ 简化数据库结构

**注意事项**：
- 旧代码（`agentPresenter/acp`）中仍有对已删除类的引用，这些将在 Phase 4 中一并清理
- ISQLitePresenter 接口中的 ACP 方法定义将在 Phase 4 中移除

### Phase 4: 移除旧代码 ✅ 已完成 (2026-01-25)

**完成内容**：
- ✅ 删除 `AcpProvider` 类（1289 行）
- ✅ 清理 `LLMProviderPresenter` 中的 ACP 逻辑
  - 移除所有 ACP 方法（getAcpWorkdir, setAcpWorkdir, warmupAcpProcess 等）
  - 移除 AcpProvider 实例化逻辑
  - 移除 acpSessionPersistence 依赖
- ✅ 更新 `ISQLitePresenter` 接口（移除 ACP Session 方法）
- ✅ 更新 `ILlmProviderPresenter` 接口（移除 ACP 方法）
- ✅ 更新 `ISessionPresenter` 接口（移除 ACP 方法）
- ✅ 清理 `SessionPresenter` 实现（移除 ACP 方法和 workdir 处理）
- ✅ 更新 `PermissionHandler` 使用新的 `acpPresenter.resolvePermission`
- ✅ 清理旧 `agentPresenter/acp` 目录中的引用
- ✅ 移除未使用的导入和参数
- ✅ 主进程类型检查通过（`pnpm run typecheck:node`）

**关键文件**：
- ❌ 已删除：`src/main/presenter/llmProviderPresenter/providers/acpProvider.ts`
- ✅ 已更新：`src/main/presenter/llmProviderPresenter/index.ts` - 移除 ACP 逻辑
- ✅ 已更新：`src/main/presenter/llmProviderPresenter/managers/providerInstanceManager.ts` - 移除 ACP 实例化
- ✅ 已更新：`src/main/presenter/sessionPresenter/index.ts` - 移除 ACP 方法
- ✅ 已更新：`src/main/presenter/agentPresenter/permission/permissionHandler.ts` - 使用新 ACP 接口
- ✅ 已更新：`src/shared/types/presenters/*.d.ts` - 移除 ACP 方法定义

**架构改进**：
- ✅ ACP 完全从 LLM Provider 体系中解耦
- ✅ 清理了所有旧的 ACP 持久化代码引用
- ✅ 权限处理现在使用独立的 `acpPresenter`
- ✅ 主进程代码完全迁移到新架构

**待完成工作**：
- ⚠️ **Renderer 进程更新**（需要单独的 Phase 5）：
  - `src/renderer/src/composables/chat/useAcpRuntimeAdapter.ts` - 需要重写以使用新 ACP 接口
  - `src/renderer/settings/components/AcpDebugDialog.vue` - 需要更新调试功能
  - 其他 UI 组件可能需要更新以使用新的事件系统

**注意事项**：
- 主进程重构已完成，类型检查通过
- Renderer 进程的更新需要单独规划，因为涉及 UI 交互逻辑的重大变更
- 建议创建 Phase 5 专门处理前端迁移工作

### Phase 5: 重组工具系统架构 (待实施)

**背景说明**：
经过代码审查发现，`AgentToolManager` 及相关工具（FileSystem、Bash、Settings 等）是 **DeepChat Agent 服务的核心组件**，不是 ACP 专用的。两种 Agent 模式都使用这套工具系统：
- `chatMode: 'agent'` - 普通 LLM Agent 模式
- `chatMode: 'acp agent'` - ACP Agent 模式

当前这些工具放在 `agentPresenter/acp/` 目录下，导致架构理解困难。

**核心原则**：
- ✅ 工具系统是 Agent 服务的核心能力，应该作为 `agentPresenter` 的一部分
- ✅ ACP 只是一种 Agent 实现方式，复用工具系统
- ✅ ToolPresenter 作为统一的工具调度层

**计划内容**：

#### 5.1 移动工具系统到正确位置
- [ ] 创建 `src/main/presenter/agentPresenter/tools/` 目录
- [ ] 移动并重命名工具文件：
  - `acp/agentToolManager.ts` → `tools/toolManager.ts`
  - `acp/agentFileSystemHandler.ts` → `tools/fileSystemHandler.ts`
  - `acp/agentBashHandler.ts` → `tools/bashHandler.ts`
  - `acp/chatSettingsTools.ts` → `tools/settingsTools.ts`
  - `acp/commandProcessTracker.ts` → `tools/commandProcessTracker.ts`
- [ ] 更新所有导入路径
- [ ] 更新 `agentPresenter/acp/index.ts` 的 re-export

#### 5.2 更新架构文档
- [ ] 补充工具系统架构图（展示工具层的组成和调用关系）
- [ ] 补充工具调用流程图（从 Agent tool_use 到工具执行的完整流程）
- [ ] 说明两种 Agent 模式如何共享工具系统
- [ ] 明确 ACP 与工具系统的关系（复用，不是专属）

#### 5.3 代码质量验收
- [ ] 所有测试通过（`pnpm test`）
- [ ] 类型检查通过（`pnpm run typecheck`）
- [ ] Lint 检查通过（`pnpm run lint`）
- [ ] 代码格式化（`pnpm run format`）

**关键文件**：
- `src/main/presenter/agentPresenter/tools/` - 新的工具系统目录
- `src/main/presenter/toolPresenter/index.ts` - 工具调度层
- `docs/acp-agent-architecture.md` - 更新架构说明

**架构改进**：
- ✅ 工具系统位置更合理（在 `agentPresenter/tools/`）
- ✅ 命名更清晰（不再暗示是 ACP 专用）
- ✅ 架构文档更完整（说明工具系统的通用性）

### Phase 6: 前端迁移到新 ACP 架构 (待实施)

**前置条件**：Phase 5 完成后，工具系统架构清晰

**计划内容**：
- [ ] 重写 `useAcpRuntimeAdapter` composable 使用新 ACP Presenter 接口
- [ ] 更新 `AcpDebugDialog` 组件
- [ ] 更新所有使用旧 ACP 方法的 UI 组件
- [ ] 更新事件监听器使用新的 `ACP_EVENTS`
- [ ] 完整的类型检查通过（包括 renderer）

## 11. 变更历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0-draft | 2026-01-25 | - | 初始版本 |
| 1.1 | 2026-01-25 | Claude | Phase 1 完成，更新实施进度 |
| 1.2 | 2026-01-25 | Claude | Phase 2 完成，实现独立的消息处理逻辑 |
| 1.3 | 2026-01-25 | Claude | Phase 3 完成，移除数据持久化 |
| 1.4 | 2026-01-25 | Claude | Phase 4 完成，移除旧代码（主进程） |
| 1.5 | 2026-01-25 | Claude | 重新设计 Phase 5：明确工具系统架构，说明 Agent 工具系统是通用组件而非 ACP 专用 |
