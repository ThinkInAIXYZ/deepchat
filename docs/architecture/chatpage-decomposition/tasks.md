# Tasks: ChatPage 分解与竞态治理

- [x] 写 `spec.md` / `plan.md` / `tasks.md`
- [x] 删除死代码 `useMessageScroll.ts`(339 行)+ 孤儿测试 + `ScrollInfo` 类型
- [x] 抽取 `useDisplayMessages`(含占位符四态机,见 spec 决策记录)
- [x] 抽取 `usePlanFloatLifecycle`
- [x] 抽取 `useChatSearch`
- [x] 抽取 `useListGestures` / `useMessageVirtualization` 原子并组合接入
- [x] composable 声明顺序移到会话 watch 之前
- [x] 抽取 `useComposerSubmit`(自持 `attachmentFilterToken`,守卫收敛 `canSubmitNow()`)
- [x] 抽取 `useSessionRestore`(自持 `restoreRequestId` epoch + `deactivate()` 卸载语义)
- [x] `useAssistantPlaceholder` 决策:并入 `useDisplayMessages`,不单独成文件(spec 有记录)
- [x] 全量验证:typecheck / lint / format / i18n / `ChatPage.test.ts` 82 用例
- [x] 对抗性 review(逐行对照基线 `8b121ede8`):发现并修复 `usePlanFloatLifecycle`
      中 linger 状态从 `ref` 降级为普通对象导致的响应性回归(完成后浮窗不再驻留 1200ms);
      其余确认零漂移
- [x] 合并 origin/dev 并复核(Settings/Provider/sidepanel 的 18 个失败为 dev 既有,与本分支无关)
- [x] 将 ChatPage 和 7 个私有 composable 迁至 `features/chat-page/` 并更新 route host、测试与
      feature 内部导入；只变更模块解析路径，保留模板与运行逻辑
- [x] 抽取 `useVoiceInput`：自持 `voiceInputConfigToken`、模型配置订阅与 speech cleanup；页面仅
      装配当前模型选择和模板状态。新增竞态、订阅释放和 speech adapter 单测。
- [x] 抽取 `useToolInteraction`：收束顶层/子 agent 待处理交互聚合、响应单飞锁和当前页面会话
      刷新；新增过滤、单飞/动态 session 与失败复位单测。
- [x] 抽取 `useMessageActions` / `usePendingInputActions`：收束消息重试、删除确认、编辑、fork、
      continue 与队列项变更/steer；保持原有 session 刷新和交互守卫。
- [x] 抽取 `useChatPageEventBridge`：通过显式 `start`/`stop` 管理 window 事件与 plan 更新订阅，
      页面保留 viewport 生命周期顺序。
- [ ] 后续(可选):主文件继续向 ~400 行收缩（viewport/session 装配另行切片）
