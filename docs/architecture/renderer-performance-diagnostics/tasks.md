# 任务清单

- [x] 定义共享 renderer performance record schema、route 和 renderer typed client。
- [x] 实现主进程 `RendererPerformanceLogService`，以本地日志开关、严格数据与串行 NDJSON 追加保护记录。
- [x] 将性能记录 route 装配到 app composition，保持 failure isolation。
- [x] 实现 renderer platform reporter：phase elapsed、workload terminal dedupe、chat session safe phase，并提供可释放生命周期。
- [x] 在 `ChatMainApp`、`ChatTabView` 与 ChatPage 按已有 owner 接入，不改变启动并发/route/session ownership。
- [x] 补 main、renderer platform、startup integration 测试与性能 record 隐私回归。
- [x] 已完成已启动的 targeted validation；用户后续明确要求不再在本地运行 lint、test 或 typecheck，因此未运行完整 renderer suite 与 architecture baseline check。
- [x] 独立 review 变更并修复发现的问题（workload terminal 去重改为 `(runId, taskId)`）。
- [x] 提交、推送，更新现有 PR #1994 描述并转为 ready for review。
