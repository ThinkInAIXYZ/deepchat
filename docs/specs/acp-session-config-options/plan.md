# ACP Session Config Options 实施计划

## 1. 当前基线

1. ACP 状态栏当前只把 provider/model 锁定为外层 ACP agent。
2. ACP 内部 model/mode 能力部分来自旧 `models/modes`，没有统一配置状态。
3. 新版 SDK `0.16.1` 已支持 `configOptions`、`config_option_update`、`session_info_update`、`usage_update`。

## 2. 设计决策

### 2.1 统一配置状态

新增共享类型：

1. `AcpConfigOptionValue`
2. `AcpConfigOption`
3. `AcpConfigState`

主进程通过 `normalizeAcpConfigState()` 统一把两类来源归一为同一结构：

1. `configOptions` 直接映射，标记 `source=configOptions`
2. legacy `models/modes` 合成为伪 config option，标记 `source=legacy`

### 2.2 Warmup / Session 双缓存

1. `AcpProcessHandle` 缓存 process 级 warmup config state
2. `AcpSessionRecord` 缓存 session 级 config state
3. `prepareAcpSession` 在 draft 建立后立即发出 config-ready 事件，让 renderer 无缝从 process cache 切到 session cache

### 2.3 事件策略

新增事件：

1. `ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY`

触发时机：

1. process warmup 完成
2. `prepareAcpSession` / `coreStream` 绑定 session 后
3. 收到 `config_option_update`
4. `setSessionConfigOption` / legacy mode/model 写入成功后

### 2.4 Renderer 展示策略

状态栏维持双轨：

1. 非 ACP：继续显示普通模型列表和 generation settings
2. ACP：显示 ACP options 面板，不再清空设置区

排序规则：

1. `model`
2. `thought_level`
3. 其余按 agent 原顺序

读写规则：

1. 有 `draftSessionId` 或活动 ACP session 时，走 session 级读写
2. 仅有 process warmup 数据时，面板只读

UI refinement：

1. ACP 状态栏隐藏 permission mode 入口，右侧只保留 `更多` 与最右侧 `MCP`
2. inline 只展示前 3 个 `select` 类型配置，触发器复用 MCP 风格的 ghost button + popover header
3. `boolean` 与剩余配置统一进入 `更多` 面板，不再 inline 展示

## 3. 分阶段实施

### Phase 1：SDK 与主进程兼容

1. 升级 SDK 到 `0.16.1`
2. 修正 schema import 路径
3. 兼容 `unstable_setSessionModel` / `KillTerminalRequest` 等 SDK 差异

### Phase 2：ACP 配置状态归一

1. 新增 `acpConfigState.ts`
2. `AcpProcessManager` warmup 归一 `configOptions/models/modes`
3. `AcpSessionManager` 建 session 时继承并缓存统一 state
4. `AcpContentMapper` 支持 `config_option_update`

### Phase 3：Presenter 与事件

1. `AcpProvider` 增加 process/session config 读写接口
2. `LLMProviderPresenter` 和 `NewAgentPresenter` 暴露代理方法
3. 发出 `SESSION_CONFIG_OPTIONS_READY`

### Phase 4：Renderer 状态栏

1. `NewThreadPage` 透传 ACP draft sessionId
2. `ChatStatusBar` 加入 ACP config 同步、只读控制和更新逻辑
3. trigger 显示 `ACP agent / internal model`

## 4. 测试策略

### 4.1 Main

1. `AcpContentMapper` 覆盖 `config_option_update`
2. `AcpProvider.prepareSession` 发出 config-ready 事件
3. `AcpProvider.setSessionConfigOption` 使用 agent 返回的全量 state 回写缓存
4. `NewAgentPresenter` 覆盖 ACP session config 读写代理

### 4.2 Renderer

1. ACP draft 首屏读取 process warmup config
2. draft sessionId 就绪后切换到 session config
3. 写入 ACP select/boolean option 时调用 session presenter
4. 非 ACP 原有状态栏行为无回归

## 5. 风险与缓解

1. 风险：不同 ACP agent 同时返回 `configOptions` 与 legacy 字段。
   缓解：统一以 `configOptions` 为准，legacy 仅在缺失时启用。

2. 风险：renderer 在 draft 早期拿不到 sessionId，导致控件误可写。
   缓解：基于 `activeAcpSessionId` 做只读门控。

3. 风险：新 SDK 增加的 session 通知被误判为未处理异常。
   缓解：`session_info_update` 与 `usage_update` 静默兼容。

## 6. 质量门槛

1. `pnpm run typecheck`
2. `pnpm run format`
3. `pnpm run i18n`
4. `pnpm run lint`
5. 关键 main/renderer 测试通过
