# MessageToolbar 功能补齐任务清单（不含 Trace 落库）

## T0 规格文档

- [x] 创建 `docs/specs/message-toolbar-actions/spec.md`
- [x] 创建 `docs/specs/message-toolbar-actions/plan.md`
- [x] 创建 `docs/specs/message-toolbar-actions/tasks.md`

## T1 Phase 1：前端接线与降级

- [ ] `ChatPage/MessageList` 补齐 toolbar 事件透传
- [ ] `MessageToolbar` 增加统一 `capabilities/disabled` 输入
- [ ] 下线 variants 按钮与相关文案
- [ ] 生成中高风险动作禁用策略落地
- [ ] 未闭环动作在新页面做隐藏/禁用，杜绝 no-op

## T2 Phase 2：新后端消息操作 API

- [ ] `INewAgentPresenter` 增加消息操作接口定义
- [ ] `newAgentPresenter` 增加消息操作代理实现
- [ ] `deepchatAgentPresenter` 实现编辑/重试/删除/fork 语义
- [ ] MessageStore/SQLite 层补齐对应读写方法

## T3 渲染层动作闭环

- [ ] `MessageItemUser` 切换到新 `edit/retry/delete` 接口
- [ ] `MessageItemAssistant` 切换到新 `retry/delete/fork` 接口
- [ ] 保留 `copy/copyImage` 既有语义与反馈

## T4 测试

- [ ] Main：消息操作语义单测（截断、重生、fork、删除边界）
- [ ] Renderer：toolbar 显隐/禁用与事件派发单测
- [ ] Renderer：编辑流程与 retry/fork 流程单测

## T5 质量门禁

- [ ] `pnpm run format`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 运行相关测试并记录结果
