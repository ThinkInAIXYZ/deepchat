# Main Kernel Refactor Test Plan

## Test Goal

本测试方案服务于“分阶段重构而不降级行为”。测试不追求一次把全仓历史问题全部清零，而是确保：

- 新架构能力可独立验证
- 每个阶段的切换点有对应测试
- 旧路径在被替换前后具备行为对照
- 最终删除旧层时没有遗漏关键用户路径

## Test Layers

### 1. Static Guard Tests

作用：

- 阻止错误依赖方向进入仓库
- 让“结构回退”尽早失败

覆盖内容：

- `architecture-guard`
- baseline 生成脚本
- grep 型 guard：`usePresenter`、`window.electron`、`window.api`、裸 timer、散落 IPC、裸 channel 字符串、bridge 内部实现名泄漏
- bridge register / scoreboard 一致性检查

### 2. Unit Tests

作用：

- 验证 `Service`、`UseCase`、`Scope`、`Scheduler` 的纯逻辑行为

建议对象：

- `ChatService`
- `SessionService`
- `ProviderService`
- `ToolService`
- `Scope`
- `Scheduler`
- `SessionEventStore`

### 3. Contract Tests

作用：

- 验证 schema、route registry、preload bridge、renderer client 的输入输出一致性

建议对象：

- `shared/contracts/routes.ts`
- route registry schema
- `createBridge`
- `renderer/api/*Client`

### 4. Main Integration Tests

作用：

- 验证 `ipc route -> service -> port/adapter` 这一整段主链路

建议对象：

- settings slice
- session create/restore
- chat send/stream/stop
- provider switch
- tool execution

### 5. Renderer Integration Tests

作用：

- 验证 renderer store/composable 在替换调用边界后仍保持状态一致

建议对象：

- settings store
- session store
- message store
- provider store
- 与 stream 状态相关的 composable/store

### 6. Electron Smoke Tests

作用：

- 对最终用户可见的核心流程做端到端验证

建议路径：

- 启动应用
- 创建会话
- 发送消息
- 接收 stream
- 停止 stream
- 切换 provider
- 触发工具/MCP
- 重启后恢复会话

## Required Harnesses

随着阶段推进，逐步补齐以下测试基础件：

- fake `Scheduler`
- fake `EventBus`
- in-memory repositories
- preload bridge test double
- route registry fixture builder
- session event fixture builder
- stream event fixture builder
- bridge register fixture

## Phase-by-Phase Test Matrix

| Phase | Automated Coverage | Manual Smoke |
| --- | --- | --- |
| P0 | guard script、baseline script | 无业务 smoke，确认脚本输出可复现 |
| P1 | route registry tests、createBridge tests、renderer client tests | 通过新 client 调用首批 route |
| P2 | scope lifecycle tests、kernel bootstrap tests | 启动应用、创建窗口、关闭窗口 |
| P3 | settings unit/integration tests | 修改设置、重启后确认持久化 |
| P4 | session service tests、restore tests、event store tests | 创建/切换/恢复会话 |
| P5 | chat send/stream/cancel tests、scheduler tests | 发消息、停止流、异常回传 |
| P6 | provider/tool/MCP integration tests | 切换 provider、执行工具 |
| P7 | full regression pack | 全量主路径 smoke，一轮冷启动与重启恢复 |

## Standard Verification Commands

每个阶段结束至少执行：

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`

建议按改动范围补充：

- `pnpm run test:main`
- `pnpm run test:renderer`
- 受影响模块的 targeted Vitest suites
- `pnpm run architecture:baseline`

## Slice-Specific Test Notes

### Settings Slice

- 验证读、写、变更通知、重启持久化
- 验证 renderer store 不再依赖 presenter 入口
- 验证 settings 能力通过 `SettingsClient` 调用，而不是组件直连 bridge

### Session Slice

- 验证 create/list/restore/archive
- 验证 event store 中的关键状态记录
- 验证会话恢复在空数据、历史数据、部分缺失数据下的表现
- 验证会话能力通过 `SessionClient` 调用

### Chat Slice

- 验证发送消息成功路径
- 验证 provider 失败路径
- 验证 stream cancel / timeout / retry
- 验证 tool callback 或中间事件不会丢失
- 验证消息发送与停止流通过 `ChatClient` 调用

### Provider / Tool Slice

- 验证 provider registry 查询与切换
- 验证 tool availability、permission、execution result
- 验证 MCP 相关事件在新边界下仍能驱动 UI

## Manual Smoke Matrix

每轮里程碑验收至少执行以下手工验证：

1. 冷启动应用，确认主窗口可正常打开。
2. 创建一个新会话并发送一条普通消息。
3. 观察 stream 开始、持续、结束，确认 UI 不挂死。
4. 在 stream 进行中执行一次 stop/cancel。
5. 切换 provider 并再次发送消息。
6. 触发一个工具或 MCP 相关操作，确认结果进入消息链路。
7. 修改一个设置并重启应用，确认设置保留。
8. 重启后恢复刚才的会话，确认消息与状态一致。

## Exit Evidence Per Phase

每个阶段完成时，应在 PR 或阶段记录中附带：

- 通过的命令列表
- 新增或修改的测试列表
- 手工 smoke 结论
- 更新后的 baseline 摘要
- route registry / bridge 分组变化摘要
- bridge register 更新结果
- migration scoreboard 更新结果
- 本阶段剩余临时 bridge 清单

## Final Regression Gate

在 Phase 7 之前，必须至少完成一次覆盖以下能力的综合回归：

- create session
- restore session
- send message
- stream reply
- stop stream
- switch provider
- tool / MCP call
- restart and recover state
