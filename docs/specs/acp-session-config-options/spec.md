# ACP Session Config Options 规格

## 概述

为 ACP 接入协议级 `session config options`，让 ACP agent 的内部 `model`、`thought_level`、`mode`、布尔开关等能力在 DeepChat 状态栏中直接展示和修改。

本次改动同时完成：

1. 升级 `@agentclientprotocol/sdk` 到 `0.16.1`
2. ACP 优先走新版 `configOptions`
3. 旧 `models/modes` 仅作为兼容兜底
4. 预热阶段拿到的配置立即可展示，不等待首条消息

## 背景与动机

1. 当前 ACP 外层模型选择器只表示“ACP agent”，内部 session model 被固定，用户无法直观看到真实内部模型。
2. 协议已提供 `session config options`，可以统一承载 `model`、`thought_level`、`mode` 以及其他 agent 自定义配置。
3. ACP warmup 阶段已经能拿到这些信息，继续延迟到首条消息后再展示会造成首屏空窗。

## 用户故事

### US-1：看到 ACP 内部真实模型

作为用户，我希望状态栏显示 `ACP agent / 内部 model`，这样我能确认当前 ACP session 真正在用哪个模型。

### US-2：在新线程阶段就能看配置

作为用户，我希望 ACP draft 刚建立时就能看到 agent 的可配置项，而不是要先发一条消息。

### US-3：统一修改 ACP session 配置

作为用户，我希望在同一个状态栏面板里修改 ACP 的 `model`、`thought_level`、`mode` 和布尔类开关。

## 功能需求

### A. 配置来源与兼容策略

- [ ] ACP 主路径使用协议 `configOptions`
- [ ] 当 agent 未返回 `configOptions` 时，回退到 legacy `models/modes`
- [ ] 若同时返回两套字段，只采用 `configOptions`

### B. 外层 agent 与内层 session model 分离

- [ ] 状态栏外层仍显示 ACP agent
- [ ] ACP 内部 `model` 不写回现有通用 `SessionGenerationSettings`
- [ ] ACP agent 不允许通过普通 `setSessionModel` 切走 provider/model

### C. Warmup 与缓存

- [ ] warmup 的 `newSession/loadSession` 结果要归一为统一 `AcpConfigState`
- [ ] 预热缓存应绑定到 process handle
- [ ] `prepareAcpSession` 建立 draft/session 后立即把缓存灌入 session，并发出 ready 事件

### D. Renderer 状态栏

- [ ] 非 ACP 路径保持现有模型选择和 generation settings 行为
- [ ] ACP 路径改为展示 ACP options 面板
- [ ] `category=model` 作为首要选项，并参与 trigger 文案展示
- [ ] `category=thought_level` 排在 `model` 后，保留 agent 返回的 label/value
- [ ] `category=mode` 与其他 generic 选项保持 agent 顺序
- [ ] draft 无 sessionId 时展示 warmup 数据但控件只读
- [ ] draft sessionId 就绪后切到 session 级读写

### E. 事件与接口

- [ ] 新增 `AcpConfigOption`、`AcpConfigOptionValue`、`AcpConfigState`
- [ ] `ILlmProviderPresenter` 增加 ACP process/session config 读写接口
- [ ] `IAgentSessionPresenter` 增加 ACP session config 读写接口
- [ ] 新增 renderer 事件 `ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY`

## 验收标准

- [ ] ACP trigger 可显示 `agentId / internal model`
- [ ] 新线程 ACP draft 能先显示 warmup config
- [ ] draft sessionId 就绪后可切到 session config 并允许写入
- [ ] `config_option_update` 会整组替换当前 config state
- [ ] 旧 ACP agent 只有 `models/modes` 时仍可正常展示和切换

## 非目标

1. 不把 ACP `model/thought_level/mode` 混入通用 provider generation settings。
2. 不重做非 ACP 状态栏 UI。
3. 不在本次把 `systemPrompt/temperature/contextLength/maxTokens` 合并进 ACP options。

## 约束

1. 继续遵循现有 Presenter + EventBus 架构。
2. 所有兼容逻辑集中在 ACP 主进程归一层，不在 renderer 分散判断 legacy 字段。
3. UI 不新增独立 ACP 设置页，先复用状态栏入口。

## 开放问题

无。
