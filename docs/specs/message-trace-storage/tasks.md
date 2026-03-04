# Message Trace 独立落库任务清单

## T0 规格文档

- [x] 创建 `docs/specs/message-trace-storage/spec.md`
- [x] 创建 `docs/specs/message-trace-storage/plan.md`
- [x] 创建 `docs/specs/message-trace-storage/tasks.md`

## T1 数据层

- [ ] 新增 `deepchat_message_traces` Table 类
- [ ] 在 `SQLitePresenter` 注册新表与迁移版本
- [ ] 增加按消息查询、插入、删除方法
- [ ] 增加消息/会话删除时 trace 清理逻辑

## T2 类型与接口

- [ ] 新增 `MessageTraceRecord` 共享类型
- [ ] `INewAgentPresenter` 增加 trace 查询接口
- [ ] `newAgentPresenter` 增加 trace 查询代理实现

## T3 脱敏与截断

- [ ] 扩展 `redact.ts` 支持“尾 4 位保留”策略
- [ ] 对 headers/body 统一应用脱敏
- [ ] 实现 512KB 截断与 `truncated` 标记

## T4 Provider 采集接入

- [ ] 定义统一 trace hook/context
- [ ] OpenAICompatible/OpenAIResponses 接入真实请求采集
- [ ] Anthropic/Gemini/Ollama/Vertex/AWSBedrock/Copilot/VoiceAI/ACP 接入采集
- [ ] 包装型 provider 透传上下文并复用父类采集
- [ ] trace 开关关闭时零写库

## T5 渲染层展示

- [ ] 消息查询补充 `traceCount`（或等价字段）
- [ ] `MessageToolbar` 仅在 `traceCount>0 && traceDebugEnabled` 显示 Trace
- [ ] `TraceDialog` 改为按消息查询 trace 列表
- [ ] 默认展示最新条并支持历史切换

## T6 测试

- [ ] Main：建表迁移、写入、查询、删除级联
- [ ] Main：脱敏与截断测试
- [ ] Main：各 provider 采集触发测试
- [ ] Renderer：按钮显隐与 TraceDialog 切换测试

## T7 质量门禁

- [ ] `pnpm run format`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 运行相关测试并记录结果
