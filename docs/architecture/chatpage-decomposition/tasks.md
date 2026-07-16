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
- [ ] 后续(可选):主文件继续向 ~400 行收缩(语音输入、消息操作 handler、
      工具交互 respond 等仍在主文件;当前 ~1710 行,较 3050 行已收缩 44%)
