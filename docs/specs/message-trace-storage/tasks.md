# Message Trace 独立落库任务清单

## T0 规格文档

- [x] 创建 `docs/specs/message-trace-storage/spec.md`
- [x] 创建 `docs/specs/message-trace-storage/plan.md`
- [x] 创建 `docs/specs/message-trace-storage/tasks.md`

## T1 数据层

- [x] 新增 `deepchat_message_traces` Table 类
- [x] 在 `SQLitePresenter` 注册新表与迁移版本
- [x] 增加按消息查询、插入、删除方法
- [x] 增加消息/会话删除时 trace 清理逻辑

## T2 类型与接口

- [x] 新增 `MessageTraceRecord` 共享类型
- [x] `INewAgentPresenter` 增加 trace 查询接口
- [x] `newAgentPresenter` 增加 trace 查询代理实现

## T3 脱敏与截断

- [x] 扩展 `redact.ts` 支持“尾 4 位保留”策略
- [x] 对 headers/body 统一应用脱敏
- [x] 实现 512KB 截断与 `truncated` 标记

## T4 Provider 采集接入

- [x] 定义统一 trace hook/context
- [x] OpenAICompatible/OpenAIResponses 接入真实请求采集
- [x] Anthropic/Gemini/Ollama/Vertex/AWSBedrock/Copilot/VoiceAI/ACP 接入采集
- [x] 包装型 provider 透传上下文并复用父类采集
- [x] trace 开关关闭时零写库

## T5 渲染层展示

- [x] 消息查询补充 `traceCount`（或等价字段）
- [x] `MessageToolbar` 仅在 `traceCount>0 && traceDebugEnabled` 显示 Trace
- [x] `TraceDialog` 改为按消息查询 trace 列表
- [x] 默认展示最新条并支持历史切换

## T6 测试

- [x] Main：建表迁移、写入、查询、删除级联
- [x] Main：脱敏与截断测试
- [x] Main：各 provider 采集触发测试
- [x] Renderer：按钮显隐与 TraceDialog 切换测试

## T7 质量门禁

- [x] `pnpm run format`
- [x] `pnpm run lint`
- [x] `pnpm run typecheck`
- [x] 运行相关测试并记录结果
