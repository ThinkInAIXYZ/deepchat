# Tasks: 助手 pending 占位去重

- [x] 更新 ChatPage pending placeholder 状态，记录创建时已有 assistant ids
- [x] 在 `shouldShowPendingAssistantPlaceholder` 中排除 pending 后新 materialize 的 assistant record
- [x] 增加 component 回归测试覆盖 stream flag 前真实 assistant 出现的场景
- [x] 运行针对性测试与必要校验
