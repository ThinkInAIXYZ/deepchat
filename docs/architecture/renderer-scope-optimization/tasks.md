# 任务清单

- [x] 建立 renderer scope 优化设计、约束和验证计划。
- [x] 审查并修复 NewThreadPage 提交互斥与 deeplink token 竞态（含 ChatMain 激活抢占）。
- [x] 审查并修复 session refresh 的陈旧结果及 runtime identity 早到 IPC 事件。
- [x] 添加对应 renderer 回归测试（最终统一运行）。
- [x] 把流式生成状态收敛到单条 assistant 行，并审查渲染影响。
- [x] 对聊天搜索加入低风险防抖/高亮调度优化，并审查导航正确性。
- [x] 区分历史消息 exhausted/error 并添加重试反馈。
- [x] 提取不依赖 chat 的 renderer appearance foundation，并迁移适用 app，保持 language direction 与初始化事件一致。
- [x] 核验并清理无引用的 `views/SettingsTabView.vue` 遗留设置视图。
- [x] 将 `ChatTabView` 路由宿主迁入 `apps/chat-main/` 并保持 lazy route。
- [x] 保护项目环境重排的并发乐观回滚，并收敛 append-only 流式虚拟窗口数据路径。
- [x] 修复 review 发现的旧首屏覆盖定向更新、tool-call 搜索死结果和跨环境操作回滚。
- [x] 更新依赖 session IPC binding 的测试 mock，并同步 renderer architecture baseline。
- [x] 对每个切片执行独立 review，修复发现的问题并继续寻找剩余优化。
- [x] 执行最终 format、i18n、lint、typecheck、renderer tests 与 architecture baseline check。
- [x] 审阅最终 diff 并提交 follow-up commit；已有 base 为 `dev` 的 PR #2000。
