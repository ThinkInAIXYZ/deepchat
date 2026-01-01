# AgentPresenter 重构执行 TODO（最终版）

> 对应最终设计文档：`docs/agent-presenter-refactoring-final.md`
>
> 原则：每个 Phase 都应做到“可编译、可运行、可回滚”；采用 Strangler 逐步替换，但**以模块/能力域为单位做原子切换**，切换后同步移除 `ThreadPresenter` 对等入口，避免逻辑分叉。

---

## 说明与约定

### 优先级

- **P0（阻塞）**：不做会导致后续无法推进或风险极高
- **P1（核心）**：影响主路径/架构收口
- **P2（完善）**：测试、清理、文档、性能与体验增强

### 交付物检查（每个 Phase 至少满足）

- `pnpm run typecheck` 可通过（或明确记录新增已知问题与回滚点）
- `pnpm test`（至少覆盖本 phase 新增单测）
- 主路径手测可跑（chat/agent/acp agent 覆盖按 phase 渐进）

### 模块原子切换（防止逻辑分叉）

- renderer 不要求一次性全量迁移，但每个能力域/模块迁移必须在同一 PR 内闭环完成：
  1. `agentPresenter` 新模块实现；
  2. preload 暴露更新；
  3. renderer 相关调用全部切到新入口；
  4. `IThreadPresenter` + `ThreadPresenter` 删除对等方法/IPC 路由/实现（不保留双入口）；
  5. 删除 threadPresenter 内对应旧代码路径（handlers/managers/utils 等）；
  6. 测试与回归清单通过。
- 回滚方式：`git revert` 该模块切换 PR（不依赖长期 feature flag 双实现）。

---

## Phase 0：P0 阻塞项 + 脚手架（无行为变化）

### 类型定义与导出（P0）

- [x] 新增 `src/shared/types/core/chat-message.ts`：定义 `ChatMessage` / `ChatMessageContent` / `ChatMessageToolCall`
- [x] 在 `src/shared/types/core/chat.ts` re-export `ChatMessage*`（修复现有 `*.d.ts` 误引用）
- [x] 在 `src/shared/types/core/llm-events.ts` re-export `ChatMessage*`（兼容 `legacy.presenters.d.ts` 的导入路径）
- [x] 修复 `src/shared/types/presenters/thread.presenter.d.ts` 与 `src/shared/types/presenters/llmprovider.presenter.d.ts` 中错误的 `ChatMessage`/`LLMAgentEvent` 引用来源
- [x] 新增 `src/shared/types/presenters/agent.presenter.d.ts`（Phase 1 最小接口即可）
- [x] 在 `src/shared/types/presenters/index.d.ts` 导出 `IAgentPresenter`

### main 侧目录结构（P0）

- [x] 创建 `src/main/presenter/agentPresenter/` 目录树（按设计文档）
- [x] 添加空实现文件（仅导出/编译通过，不接入业务）：`index.ts`、`types.ts`、`events.ts`、各子目录入口文件

### 测试骨架（P1）

- [x] 增加 `test/main/agentPresenter/`（或与现有目录风格一致的位置）并建立 Vitest 基础用例

---

## Phase 1：引入 AgentPresenter（Facade），内部委托旧实现（行为应等价）

### main 集成（P0）

- [x] 在 `src/main/presenter/index.ts` 初始化并挂载 `agentPresenter`
- [x] 完成 IPC 暴露（与现有 presenters 的暴露方式一致）

### AgentPresenter 最小可用接口（P0）

- [x] `sendMessage(agentId, content, tabId?)`：内部委托 `threadPresenter.sendMessage()`（保持事件流一致）
- [x] `continueLoop(agentId, messageId)`：内部委托 `threadPresenter.continueStreamCompletion()`
- [x] `cancelLoop(messageId)`：内部委托 `llmproviderPresenter.stopStream()` / `threadPresenter.stopMessageGeneration()`
- [x] `handlePermissionResponse(...)`：内部委托 `threadPresenter.handlePermissionResponse()`

### Feature Flag（P1）

- [x] 增加 feature flag（配置项或环境变量）用于迁移期对照/灰度（默认仍走旧实现；模块一旦切换则不再保留 `ThreadPresenter` 对等实现）
- [x] 增加 debug 日志：输出 `SessionContext.resolved`（仅开发/调试开关打开时）

验收（Phase 1）：
- [ ] 不改 renderer 代码也能正常运行
- [ ] 通过 flag 可在同一功能路径上切换新旧入口（便于对照）

---

## Phase 2：Message 层拆分（先落纯逻辑，可单测）

### 抽离模块（P1）

- [x] `src/main/presenter/agentPresenter/message/messageFormatter.ts`
  - [x] 从 `src/main/presenter/threadPresenter/utils/messageContent.ts` 迁移：用户消息 text/mention/files/prompt 片段拼装
  - [x] 统一 legacy `<function_call>` 与 native `tool_calls` 的格式处理（参考 `ToolCallProcessor` 写入逻辑）
- [x] `src/main/presenter/agentPresenter/message/messageTruncator.ts`
  - [x] 从 `src/main/presenter/threadPresenter/utils/promptBuilder.ts` 迁移 `selectContextMessages`
- [x] `src/main/presenter/agentPresenter/message/messageCompressor.ts`
  - [x] 从 `src/main/presenter/threadPresenter/utils/promptBuilder.ts` 迁移 `compressToolCallsFromContext`
- [x] `src/main/presenter/agentPresenter/utility/promptEnhancer.ts`
  - [x] 从 `promptBuilder.ts` 抽离日期/时间增强逻辑
- [x] `src/main/presenter/agentPresenter/message/messageBuilder.ts`
  - [x] 从 `promptBuilder.ts` 拆分：`preparePromptContent` / `buildContinueToolCallContext` / `buildPostToolExecutionContext`

### 旧代码接入新模块（P1）

- [x] 让 `src/main/presenter/threadPresenter/utils/promptBuilder.ts` 在内部调用新 message 模块（保持对外 API 暂不变）

### 单元测试（P1）

- [x] `messageTruncator`：覆盖 contextLength、contextEdge、成对保留、空上下文、超长上下文
- [x] `messageCompressor`：覆盖 tool call 压缩优先级、压缩后 token 降幅、极端输入
- [x] `messageFormatter`：覆盖 mention/files/prompt 片段、legacy function_call 标签解析/写入对齐

验收（Phase 2）：
- [ ] prompt 构建结果与旧逻辑保持等价（允许非关键 whitespace 差异）
- [ ] 新模块单测覆盖关键分支

---

## Phase 3：ToolCallCenter 收口（先封装 ToolPresenter，再逐步迁移）

### 薄封装（P1）

- [x] 新增 `src/main/presenter/agentPresenter/tool/toolCallCenter.ts`
  - [x] 内部委托现有 `src/main/presenter/toolPresenter/index.ts`
  - [x] 统一导出：`getAllToolDefinitions()` / `callTool()` / `grantPermission()`（如需要）
- [x] 新增 `toolRegistry.ts` / `toolRouter.ts`（可先只放接口与最小实现）

### Token 预算一致性（P1）

- [x] `messageBuilder` 获取 tool definitions 时统一走 `ToolCallCenter.getAllToolDefinitions()`（避免 `promptBuilder` 与 loop 侧工具集合不一致）

### 测试（P2）

- [ ] tool 去重策略（MCP 优先）用例
- [ ] args 解析失败时 `jsonrepair` 回退用例

验收（Phase 3）：
- [ ] chat/agent/acp agent 三模式下工具列表与旧实现一致
- [ ] 工具调用与权限请求路径不回归

---

## Phase 4：SessionManager 收口运行时状态 + mode/workspace 统一

### SessionContext.resolved（P0/P1）

- [x] 新增 `src/main/presenter/agentPresenter/session/sessionContext.ts`（或 `types.ts`）
- [ ] 统一 resolve 规则（P0）：
  - [x] `chatMode`：Conversation settings 优先；缺失回退 `input_chatMode`
  - [ ] `agentWorkspacePath`：仅 agent 模式；缺失时生成默认并持久化（迁移自现有逻辑）
  - [x] `acpWorkdirMap[modelId]`：仅 acp agent 模式
  - [x] `supportsVision/functionCall`：来自 modelConfig 或 modelCapabilities
- [x] 抽离为纯函数/可单测的 resolver（P1）

### 状态集中（P1）

- [ ] 逐步把 `ThreadPresenter.generatingMessages` / pending tool call / buffer 状态迁入 `SessionManager`
- [ ] 将 `StreamGenerationHandler` / `AgentLoopHandler` 中重复的 workspace/mode 决策替换为 resolver（按功能路径逐步替换）

验收（Phase 4）：
- [ ] cancel / continue / permission-resume 状态正确
- [ ] 多 tab 切换/恢复行为与旧实现一致

---

## Phase 5：Loop async/await 重写（目标态核心）

### Orchestrator 先行（P1）

- [ ] 新增 `src/main/presenter/agentPresenter/loop/loopOrchestrator.ts`
  - [ ] 先作为 “消费 `LLMAgentEvent` → 更新 UI blocks/持久化” 的适配层
  - [ ] 逐步替代 `threadPresenter/handlers/llmEventHandler.ts`、`toolCallHandler.ts` 的逻辑入口

### 完整 loop 驱动（P1）

- [ ] 引入 `agentPresenter/loop/agentLoopHandler.ts`（async/await）
  - [ ] Build context（MessageBuilder）
  - [ ] Call provider stream（需要明确使用 `coreStream` 或新增 provider API）
  - [ ] Tool calls 执行（ToolCallCenter）
  - [ ] permission pause/resume（ToolRouter + SessionManager）
  - [ ] finalize/错误恢复/重试策略

### 集成测试（P1/P2）

- [ ] 最小 chat（无工具）
- [ ] MCP 工具调用（含 permission-required）
- [ ] agent 工具（filesystem + browser）
- [ ] cancel / pause / resume

验收（Phase 5）：
- [ ] 三模式功能对齐旧实现
- [ ] 性能无明显退化（可接受小幅波动，后续再优化）

---

## Phase 6：Renderer 迁移与清理

### Renderer 迁移（P1）

- [ ] preload 增加 `agentPresenter` 暴露（与现有 `usePresenter()` 兼容）
- [ ] 按模块/能力域迁移（每批迁移需同步删除 `ThreadPresenter` 对等 API/实现，避免双入口）
  - [ ] 批次建议：chat 主流程（send/continue/cancel/permission）→ utilities（translate/askAI/export/title）→ search → conversation 管理 → workspace/ACP 相关

### 清理（P2）

- [ ] 将 `ThreadPresenter` 收缩为“仅保留尚未迁移能力”的薄层；已迁移模块的对等 API/实现必须删除，避免分叉
- [ ] 最终移除 `ThreadPresenter`（含 IPC 暴露与 `IThreadPresenter` 类型出口）
- [ ] 移除重复模块与废弃入口（最后做）
- [ ] 更新相关文档（含新架构说明与迁移指南）

---

## 推荐 PR 拆分（减少冲突与回滚成本）

- PR 1：Phase 0 类型修复 + agentPresenter 目录脚手架
- PR 2：Phase 1 Facade 接入 + feature flag（无行为变化）
- PR 3：Phase 2 messageTruncator/compressor/formatter 拆分 + 单测
- PR 4：Phase 3 ToolCallCenter 封装 + token 预算一致性
- PR 5：Phase 4 SessionManager/resolver 引入 + 分路径替换
- PR 6+：Phase 5 loop 重写（可继续拆多 PR）
- PR N：Phase 6 renderer 迁移 + 清理
