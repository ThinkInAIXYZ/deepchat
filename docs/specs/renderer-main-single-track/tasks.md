# Renderer-Main Single Track Tasks

## Program Setup

- [x] 新建 `docs/specs/renderer-main-single-track/spec.md`
- [x] 新建 `docs/specs/renderer-main-single-track/plan.md`
- [x] 新建 `docs/specs/renderer-main-single-track/tasks.md`
- [x] 在 `docs/README.md` 增加 single-track 计划入口
- [x] 在 `docs/ARCHITECTURE.md` 增加 `phase5` 之后的执行规则
- [x] 更新 `docs/spec-driven-dev.md`，把 renderer-main 推荐模式从 `usePresenter()` 改为 typed client
- [x] 更新 `docs/guides/getting-started.md`，把 onboarding 心智模型改为 typed boundary first

## P0: Rules & Guard Hardening

- [x] 定义业务层 / typed boundary / quarantine 三层目录规则
- [x] 固定唯一 quarantine 目录为 `src/renderer/api/legacy/**`
- [x] 在仓库中实际创建 `src/renderer/api/legacy/` 目录与说明文件或首个 adapter
- [x] 为 `scripts/architecture-guard.mjs` 增加 business-layer direct `usePresenter` 禁止规则
- [x] 为 `scripts/architecture-guard.mjs` 增加 business-layer direct `window.electron` 禁止规则
- [x] 为 `scripts/architecture-guard.mjs` 增加 business-layer direct `window.api` 禁止规则
- [x] 为 `scripts/generate-architecture-baseline.mjs` 增加 business-layer / quarantine-layer 分维度统计
- [x] 定义 single-track merge gate
- [x] 定义阶段性 phase gate 指标并写入 baseline / guard 说明

## P1: Transport Consolidation

- [x] 依赖 P0 已固定 `src/renderer/api/legacy/**` 后再开始本阶段
- [x] 把 `usePresenter()` 降级为 quarantine-only utility
- [x] 在 renderer 层建立显式 legacy quarantine adapter 目录
- [x] 重写或退役 `useIpcQuery`
- [x] 重写或退役 `useIpcMutation`
- [x] 收口 `window.electron` / `window.api` 的 runtime wrapper
- [x] 清理 `src/renderer/src/**` 中对 transport primitive 的直接 import
- [x] 为 transport consolidation 补验证：业务层 direct `usePresenter` import = `0`
- [x] 为 transport consolidation 补验证：业务层 mixed transport module = `0`

## P2: Config / Provider / Model Family

- [x] 扩展 `SettingsClient` 覆盖仍属于 settings/config 域的基础读写
- [x] 为 provider / model / config 能力补 typed contracts
- [x] 为 provider / model / config family 补 typed event contracts
- [x] 为 provider / model / config 能力补 typed clients
- [x] 迁移 `providerStore.ts`
- [x] 迁移 `modelStore.ts`
- [x] 迁移 `modelConfigStore.ts`
- [x] 迁移 `systemPromptStore.ts`
- [x] 迁移 `theme.ts`
- [x] 迁移 `language.ts`
- [x] 迁移 `floatingButton.ts`
- [x] 迁移 `shortcutKey.ts`
- [x] 迁移 `agentModelStore.ts`
- [x] 清理 config/provider/model family 的 raw event listeners

`2026-04-20` 进度更新：P2 已完成，相关 renderer/main 定向测试、`typecheck`、`format`、`i18n`、`lint` 已通过。
`2026-04-20` 验收修复：补齐 `config.resolveDeepChatAgentConfig` 的 nullable agent config contract 兼容，自动回归已重新通过。

## P3: Window / Device / Workspace Family

- [x] 为 window / device / workspace / project / file / browser / tab 能力补 typed clients 或 runtime wrappers
- [x] 为 window / device / workspace / project / file / browser / tab family 补 typed event contracts
- [x] 迁移 `App.vue`
- [x] 迁移 `AppBar.vue`
- [x] 迁移 `WelcomePage.vue`
- [x] 迁移 `NewThreadPage.vue`
- [x] 迁移 `stores/ui/project.ts`
- [x] 迁移 workspace/browser 相关组件与 composables
- [x] 清理 window/device/workspace family 的 raw event listeners

`2026-04-20` 进度更新：P3 已完成。新增 `WindowClient`、`DeviceClient`、`WorkspaceClient`、`ProjectClient`、`FileClient`、`BrowserClient`、`TabClient` 与 `src/renderer/api/runtime.ts`，并完成 window / workspace / browser typed event cutover。
`2026-04-20` 范围备注：`WelcomePage.vue` 为已满足 P3 gate 的既有 typed path，无需改动；`NewThreadPage.vue` 的 P3 范围已完成审计，剩余 legacy 调用仅属于 P4 的 `agentSessionPresenter` residual。
`2026-04-20` 自动回归：`pnpm exec vitest --config vitest.config.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/main/presenter/workspacePresenter.test.ts` 与 `pnpm exec vitest --config vitest.config.renderer.ts test/renderer/api/clients.test.ts test/renderer/stores/projectStore.test.ts test/renderer/components/WorkspacePanel.test.ts test/renderer/components/WindowSideBar.test.ts test/renderer/stores/spotlight.test.ts test/renderer/components/SvgArtifact.test.ts test/renderer/components/AgentWelcomePage.test.ts test/renderer/components/WelcomePage.test.ts test/renderer/components/NewThreadPage.test.ts test/renderer/pages/NewThreadPage.test.ts` 已通过。
`2026-04-20` 静态检查：`pnpm run format`、`pnpm run i18n`、`pnpm run lint`、`pnpm run typecheck` 已通过。

## P4: Session Residual / MCP / Skill / Misc Family

- [x] 扩展 `SessionClient` 覆盖 rename / delete / export / pending input / session setting 类动作
- [x] 为 skill / mcp / sync / upgrade / dialog 等能力补 typed contracts
- [x] 为 skill / mcp / sync / upgrade / dialog 等 family 补 typed event contracts
- [x] 为 skill / mcp / sync / upgrade / dialog 等能力补 typed clients
- [x] 迁移 `stores/ui/session.ts` 的 residual presenter calls
- [x] 迁移 `stores/ui/pendingInput.ts`
- [x] 迁移 `stores/skillsStore.ts`
- [x] 迁移 `stores/mcp.ts`
- [x] 迁移 `stores/mcpSampling.ts`
- [x] 迁移 `stores/sync.ts`
- [x] 迁移 `stores/upgrade.ts`
- [x] 迁移 `stores/dialog.ts`
- [x] 迁移 `stores/ollamaStore.ts`
- [x] 清理 residual family 的 raw event listeners

`2026-04-20` 进度更新：P4 已完成。已补齐 session residual / skill / mcp / sync / upgrade / dialog / tool family 的 typed route 与 typed event contracts、typed clients，以及 main route dispatcher/runtime 接线。
`2026-04-20` 迁移结果：`src/renderer/src/**` 内 `agentSessionPresenter` / `skillPresenter` / `mcpPresenter` / `syncPresenter` / `upgradePresenter` / `dialogPresenter` / `toolPresenter` 的 P4 业务命中已清零，相关 raw event listeners 已切到 typed subscriptions。
`2026-04-20` 自动回归：`pnpm run format`、`pnpm run i18n`、`pnpm run lint`、`pnpm run typecheck` 已通过；`pnpm exec vitest --config vitest.config.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/main/presenter/upgradePresenter.test.ts test/main/presenter/mcpPresenter.test.ts test/main/presenter/mcpPresenter/toolManager.test.ts test/main/presenter/agentRuntimePresenter/pendingInputStore.test.ts test/main/routes/sessionService.test.ts` 与 `pnpm exec vitest --config vitest.config.renderer.ts test/renderer/api/clients.test.ts test/renderer/stores/mcpStore.test.ts test/renderer/stores/mcpSampling.test.ts test/renderer/stores/upgradeStore.test.ts test/renderer/stores/pendingInputStore.test.ts test/renderer/stores/sessionStore.test.ts test/renderer/stores/ollamaStore.test.ts test/renderer/pages/NewThreadPage.test.ts test/renderer/components/ChatStatusBar.test.ts test/renderer/components/message/MessageBlockContent.test.ts test/renderer/components/MarkdownRenderer.test.ts test/renderer/components/TranslatePopup.test.ts test/renderer/components/trace/TraceDialog.test.ts test/renderer/components/McpIndicator.test.ts test/renderer/components/ChatPage.test.ts` 已通过。

## P5: Retirement & Merge Gate

- [ ] 清理 `src/renderer/src/**` 剩余 direct `usePresenter` import
- [ ] 清理 `src/renderer/src/**` 剩余 direct `window.electron` access
- [ ] 清理 `src/renderer/src/**` 剩余 direct `window.api` access
- [ ] 将 `usePresenter()` internal-only 或删除
- [ ] 更新 `docs/README.md` / `docs/ARCHITECTURE.md` / `docs/guides/code-navigation.md` 的最终状态
- [ ] 刷新 architecture baseline / scoreboard
- [ ] 运行 `pnpm run format`
- [ ] 运行 `pnpm run i18n`
- [ ] 运行 `pnpm run lint`
- [ ] 跑针对性 renderer/main 测试并记录结果

## Final Checklist

- [ ] renderer 业务层 single-track 达成
- [ ] quarantine 范围明确、可审计
- [ ] 新功能接入规则写入 active docs
- [ ] reviewer 无需口头背景即可判定是否合规
