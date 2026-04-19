# Main Kernel Refactor Test Plan

## Test Goal

本测试方案服务于“边界稳定化 + 热路径减耦”。

测试目标不是一轮内把整个仓库历史问题清零，而是确保：

- migrated path 的新边界可独立验证
- owner 切换点有明确测试
- cleanup / cancel / timeout 行为可证明
- 旧路径在被替换时不会静默回退

## Test Layers

### 1. Static Guard Tests

作用：

- 阻止错误依赖方向继续进入仓库
- 让结构回退尽早失败

覆盖内容：

- `architecture-guard`
- baseline 生成脚本
- grep 型 guard：`usePresenter`、`window.electron`、`window.api`
- migrated path 的 raw channel / raw timer 检查
- hot path direct dependency 趋势检查
- bridge register / scoreboard 一致性检查

### 2. Contract Tests

作用：

- 验证 route registry、schema、typed event、preload bridge、renderer client 的一致性

建议对象：

- `shared/contracts/routes`
- `shared/contracts/events`
- `createBridge`
- `renderer/api/*Client`

### 3. Orchestration Unit Tests

作用：

- 验证新引入的 orchestration 层与 port 协作逻辑

建议对象：

- `SettingsService`
- `SessionService`
- `ChatService`
- `Scheduler`
- provider / permission adapter

### 4. Main Integration Tests

作用：

- 验证 `route -> handler -> orchestration -> adapter` 这一整段主链路

建议对象：

- settings 读写
- session create / restore
- chat send / stop
- provider query / permission response

### 5. Renderer Integration Tests

作用：

- 验证 store / composable 在切换到 `renderer/api` 后状态仍保持一致

建议对象：

- settings store
- session store
- message / stream store
- provider store

### 6. Electron Smoke Tests

作用：

- 验证最终用户可见的核心行为未回退

建议路径：

- 启动应用
- 修改设置
- 创建会话
- 发送消息
- 观察 stream
- 停止流
- 恢复会话
- 切换 provider 或完成一次 provider 相关交互

## Required Harnesses

随着阶段推进，逐步补齐：

- fake `Scheduler`
- route registry fixture
- typed event fixture
- fake provider adapter
- fake permission adapter
- preload bridge test double

## Phase-by-Phase Test Matrix

| Phase | Automated Coverage | Manual Smoke |
| --- | --- | --- |
| P0 | guard script、baseline script | 确认脚本输出可复现 |
| P1 | route registry tests、typed event tests、bridge/client tests | 通过新 client 调 settings / session / chat 首批 route |
| P2 | settings contract/integration/store tests | 修改设置并重启确认持久化 |
| P3 | chat/session orchestration tests、scheduler tests | 创建会话、发消息、停止流、恢复会话 |
| P4 | provider/permission/tool boundary tests | 完成 provider 相关交互与权限响应 |
| P5 | full regression pack for migrated paths | 冷启动、重启恢复、一轮完整主路径 smoke |

## Current Phase Evidence

- Phase 0 completed on `2026-04-19`
- Automated verification for Phase 0 uses `node scripts/architecture-guard.mjs`
- Automated verification for Phase 0 uses `pnpm run architecture:baseline`
- Automated verification for Phase 0 uses `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`
- Repro smoke for Phase 0 is rerunning guard and baseline scripts and confirming committed reports regenerate without drift
- Phase 0 artifacts are `docs/architecture/baselines/main-kernel-boundary-baseline.md`
- Phase 0 artifacts are `docs/architecture/baselines/main-kernel-bridge-register.md`
- Phase 0 artifacts are `docs/architecture/baselines/main-kernel-migration-scoreboard.md`
- Phase 1 completed on `2026-04-19`
- Automated verification for Phase 1 uses `pnpm exec vitest --config vitest.config.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts`
- Automated verification for Phase 1 uses `pnpm exec vitest --config vitest.config.renderer.ts test/renderer/api/createBridge.test.ts test/renderer/api/clients.test.ts`
- Automated verification for Phase 1 uses `pnpm run typecheck`
- Automated verification for Phase 1 uses `pnpm run format`, `pnpm run i18n`, `pnpm run lint`
- Repro smoke for Phase 1 is invoking `window.deepchat` routes through the new bridge and confirming typed event subscriptions receive `settings.changed`, `sessions.updated`, and `chat.stream.*`
- Phase 1 artifacts are `src/shared/contracts/`, `src/preload/createBridge.ts`, `src/main/routes/`, and `src/renderer/api/`
- Phase 2 implementation and automated verification completed on `2026-04-19`
- Automated verification for Phase 2 uses `pnpm exec vitest --config vitest.config.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/main/routes/settingsHandler.test.ts`
- Automated verification for Phase 2 uses `pnpm exec vitest --config vitest.config.renderer.ts test/renderer/api/clients.test.ts test/renderer/stores/uiSettingsStore.test.ts`
- Automated verification for Phase 2 uses `pnpm run typecheck`
- Automated verification for Phase 2 uses `pnpm run format`, `pnpm run i18n`, `pnpm run lint`
- Automated verification for Phase 2 uses `pnpm run architecture:baseline`
- Repro smoke for Phase 2 is modifying font size, notifications, and font family through the settings UI, then restarting the app to confirm persistence and cross-window refresh
- Phase 2 artifacts are `src/main/routes/settings/`, `src/main/routes/index.ts`, `src/renderer/api/SettingsClient.ts`, and `src/renderer/src/stores/uiSettingsStore.ts`

## Standard Verification Commands

每个阶段结束至少执行：

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`

按改动范围补充：

- `pnpm run test:main`
- `pnpm run test:renderer`
- 受影响模块的 targeted Vitest suites
- baseline / guard 相关脚本

## Slice-Specific Test Notes

### Settings Slice

- 验证读、写、变更通知、重启持久化
- 验证 settings store 不再依赖 `usePresenter()` 主入口
- 验证 settings 通知走 typed event

### Chat & Session Slice

- 验证 session create / restore / activate
- 验证发送消息成功路径
- 验证停止流
- 验证 provider 失败路径和超时路径
- 验证 cancel / timeout / retry 的 owner 清楚且不会残留无主状态

### Provider / Permission Slice

- 验证 provider query 与执行能力边界
- 验证 permission request / response contract
- 验证 migrated path 不再通过 presenter 直接协商 provider 行为

## Manual Smoke Matrix

每轮阶段验收至少执行以下手工验证：

1. 冷启动应用，确认主窗口正常打开。
2. 修改一个设置并确认界面状态更新。
3. 创建一个新会话。
4. 发送一条普通消息。
5. 在 stream 进行中执行一次 stop/cancel。
6. 关闭并重新打开相关页面或重启应用，确认会话与设置可恢复。
7. 完成一次 provider 相关交互，确认结果正常返回。

## Exit Evidence Per Phase

每个阶段完成时，应附带：

- 通过的命令列表
- 新增或修改的测试列表
- 手工 smoke 结论
- 更新后的 baseline 摘要
- bridge register 更新结果
- scoreboard 更新结果

## Final Regression Gate

在 Phase 5 之前，必须至少完成一次覆盖以下能力的综合回归：

- settings read/write
- create session
- restore session
- send message
- stream reply
- stop stream
- provider or permission interaction
