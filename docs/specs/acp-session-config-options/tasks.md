# ACP Session Config Options 任务清单

## T0 规格文档

- [x] 新建 `spec.md`
- [x] 新建 `plan.md`
- [x] 新建 `tasks.md`

## T1 SDK 与共享类型

- [x] 升级 `@agentclientprotocol/sdk` 到 `0.16.1`
- [x] 修正 ACP schema import 路径
- [x] 新增 `AcpConfigOptionValue`
- [x] 新增 `AcpConfigOption`
- [x] 新增 `AcpConfigState`

## T2 ACP 主进程归一层

- [x] 新增 `acpConfigState.ts`
- [x] warmup 解析 `configOptions`
- [x] legacy `models/modes` 回退归一
- [x] `config_option_update` 整组替换 session config state
- [x] `session_info_update` / `usage_update` 静默兼容

## T3 Presenter / EventBus

- [x] `AcpProcessHandle` / `AcpSessionRecord` 缓存统一 config state
- [x] 新增 `SESSION_CONFIG_OPTIONS_READY` 事件
- [x] `ILlmProviderPresenter` 增加 ACP process/session config 读写接口
- [x] `INewAgentPresenter` 增加 ACP session config 读写接口

## T4 Renderer 状态栏

- [x] `NewThreadPage` 透传 `acpDraftSessionId`
- [x] `ChatStatusBar` 增加 ACP config 拉取与事件订阅
- [x] ACP trigger 显示 `agent / internal model`
- [x] draft 无 sessionId 时显示 warmup config 且只读
- [x] draft sessionId 就绪后切换到 session 级读写

## T5 测试

- [x] 更新 `acpContentMapper.test.ts`
- [x] 更新 `acpProvider.test.ts`
- [x] 更新 `newAgentPresenter.test.ts`
- [x] 更新 `ChatStatusBar.test.ts`

## T6 质量门禁

- [x] `pnpm run format`
- [x] `pnpm run i18n`
- [x] `pnpm run lint`
- [x] 运行关键测试并记录结果
