# Renderer 性能诊断链路

## 背景

主窗口已定义 `uninitialized → snapshot-loading → shell-hydrated → interactive → deferred-settled` 的启动 owner，也有 ChatPage 的 `performance.mark`。但这些信号没有同一个可查询、可保留、与 `startupRunId` 关联的记录链：控制台日志无法可靠比较耗时，主进程 startup workload 的任务耗时也不会汇入同一诊断文件。

排查冷启动、fallback、会话恢复和后台任务变慢时，需要一个本地、低开销、可审阅的记录文件，而不是引入遥测上传或改写现有启动并行策略。

## 目标

1. 对 chat main 建立从 renderer shell 到 startup workload、session 首屏恢复的结构化性能记录链。
2. 在用户已启用本地日志时，将经过 schema 校验和隐私裁剪的 NDJSON 记录写入 userData 的 logs 目录；文件可与现有 `main.log` 一同通过日志目录入口获取。
3. 将记录关联到 `startupRunId`、阶段、相对耗时、fallback 结果和 workload task 完成状态，不记录会话内容、session ID、项目路径、模型/Provider 配置、错误原文或密钥。
4. 保持 owner：`ChatMainApp` 负责 app shell 阶段，`ChatTabView` 负责 bootstrap/route/interactive/deferred 阶段，ChatPage feature 只负责其 session viewport 阶段；主进程只负责持久化已校验的诊断记录。
5. 诊断路径失败、日志关闭、写入失败或性能 API 不可用时均不能阻塞启动、会话恢复或用户交互。

## 非目标

- 不上传遥测数据，不接入第三方监控服务，不新增网络请求。
- 不新增 renderer 之间共享 store、bridge facade 或修改 preload 暴露面。
- 不更改 IPC 权限模型、聊天 stream gate、session single-flight 或 startup workload 调度策略。
- 不新增启动性能面板、toast 或用户可见文案；使用既有 `loggingEnabled` 本地日志开关和日志目录入口。
- 不将完整异常对象、性能 API 的任意 detail、用户内容或持久化标识写入诊断文件。

## 数据与隐私约束

每行必须是独立 JSON 对象（NDJSON），由主进程附加 `recordedAt`，并且只允许以下字段：

- schema 版本、固定 renderer source、scope、受控 phase、outcome；
- 不超过 24 小时的 `elapsedMs`；
- 受限长度的 `startupRunId`；
- 可选 fallback flag、session epoch、受控 workload task id/state。

主进程必须再次解析输入 schema，只有 `loggingEnabled` 为真时才入队写入 `logs/renderer-performance.ndjson`。单次写入故障仅输出安全的诊断告警，不能使 route reject 或影响 renderer。记录文件沿用日志目录，不包含用户数据；写入序列化以保持行边界。

## 验收标准

1. chat main 的每次启动可记录 `shell-mounted`、`app-stores-ready`、`bootstrap-ready` 或 `bootstrap-fallback`、`route-ready`、`interactive`、`deferred-settled`；成功 bootstrap 使用其 `startupRunId`。
2. startup workload 的主窗口 task 在 terminal state 时最多记录一次，包含 task id/state 和由已有时间戳计算的耗时；不记录 task payload。
3. ChatPage 的 session phase 保持现有 Performance Timeline 可见性，并以无 session ID 的 session epoch 关联可选结构化记录。
4. 记录 route、main logging service、renderer reporter 与调用点均有针对性测试：schema 拒绝越界/未知字段，日志关闭不写文件，写入顺序稳定，失败不会向 renderer 冒泡，阶段/去重/elapsed 正确。
5. 相关 SDD 计划和任务记录完整，无 `[NEEDS CLARIFICATION]`；format、i18n、lint、typecheck、targeted 与完整 renderer tests、architecture baseline check 均通过。

## 兼容性与回滚

记录是新的可选本地日志文件，不改变已有设置格式、用户数据 schema 或 IPC channel。关闭本地日志后不再追加记录。回滚时删除新的 route/client/reporter；已有 startup 行为与 ChatPage `performance.mark` 仍可独立工作。
