# Agent 输入区高级配置回归任务清单

## T0 规格文档

- [x] 新建 `spec.md`
- [x] 新建 `plan.md`
- [x] 新建 `tasks.md`

## T1 共享类型与接口

- [x] 新增 `SessionGenerationSettings`
- [x] `CreateSessionInput` 增加 `generationSettings`
- [x] `INewAgentPresenter` 增加 generation settings 读写接口
- [x] `IAgentImplementation` 增加可选 generation settings 读写接口

## T2 持久化层

- [x] `deepchat_sessions` 增加 migration v12 与新字段
- [x] `DeepChatSessionStore` 增加 generation settings get/update 封装
- [x] 兼容旧行 `NULL` 数据

## T3 DeepChat 运行时

- [x] initSession 写入会话生成配置
- [x] process/resume 使用会话配置构建上下文
- [x] runStream 使用会话 temperature/maxTokens 与扩展 modelConfig
- [x] 实现 `getGenerationSettings/updateGenerationSettings`
- [x] update 统一 sanitize/clamp 并持久化

## T4 NewAgent 透传与代理

- [x] createSession 透传 `generationSettings`
- [x] 新增 get/updateSessionGenerationSettings 代理
- [x] session 不存在时抛出一致错误

## T5 渲染层状态与 UI

- [x] draftStore 新增 generation settings 草稿字段
- [x] NewThreadPage 创建会话携带 generation settings
- [x] ChatStatusBar 新增高级配置入口（权限左侧）
- [x] overlay modal 实现（覆盖输入框上方）
- [x] modal 字段按能力显隐
- [x] Effort 外置并按能力显隐
- [x] 300ms 防抖写回会话/草稿

## T6 i18n

- [x] `zh-CN/chat.json` 新增 `advancedSettings` 文案
- [x] `en-US/chat.json` 新增 `advancedSettings` 文案

## T7 测试

- [x] 更新 `deepchatAgentPresenter.test.ts`
- [x] 更新 `newAgentPresenter.test.ts`
- [x] 更新 `NewThreadPage.test.ts`
- [x] 更新 `newAgentPresenter/integration.test.ts` 兼容新参数

## T8 质量门禁

- [x] `pnpm run format`
- [x] `pnpm run lint`
- [x] 运行相关测试并记录结果
