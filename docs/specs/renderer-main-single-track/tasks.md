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

- [ ] 依赖 P0 已固定 `src/renderer/api/legacy/**` 后再开始本阶段
- [ ] 把 `usePresenter()` 降级为 quarantine-only utility
- [ ] 在 renderer 层建立显式 legacy quarantine adapter 目录
- [ ] 重写或退役 `useIpcQuery`
- [ ] 重写或退役 `useIpcMutation`
- [ ] 收口 `window.electron` / `window.api` 的 runtime wrapper
- [ ] 清理 `src/renderer/src/**` 中对 transport primitive 的直接 import
- [ ] 为 transport consolidation 补验证：业务层 direct `usePresenter` import = `0`
- [ ] 为 transport consolidation 补验证：业务层 mixed transport module = `0`

## P2: Config / Provider / Model Family

- [ ] 扩展 `SettingsClient` 覆盖仍属于 settings/config 域的基础读写
- [ ] 为 provider / model / config 能力补 typed contracts
- [ ] 为 provider / model / config family 补 typed event contracts
- [ ] 为 provider / model / config 能力补 typed clients
- [ ] 迁移 `providerStore.ts`
- [ ] 迁移 `modelStore.ts`
- [ ] 迁移 `modelConfigStore.ts`
- [ ] 迁移 `systemPromptStore.ts`
- [ ] 迁移 `theme.ts`
- [ ] 迁移 `language.ts`
- [ ] 迁移 `floatingButton.ts`
- [ ] 迁移 `shortcutKey.ts`
- [ ] 迁移 `agentModelStore.ts`
- [ ] 清理 config/provider/model family 的 raw event listeners

## P3: Window / Device / Workspace Family

- [ ] 为 window / device / workspace / project / file / browser / tab 能力补 typed clients 或 runtime wrappers
- [ ] 为 window / device / workspace / project / file / browser / tab family 补 typed event contracts
- [ ] 迁移 `App.vue`
- [ ] 迁移 `AppBar.vue`
- [ ] 迁移 `WelcomePage.vue`
- [ ] 迁移 `NewThreadPage.vue`
- [ ] 迁移 `stores/ui/project.ts`
- [ ] 迁移 workspace/browser 相关组件与 composables
- [ ] 清理 window/device/workspace family 的 raw event listeners

## P4: Session Residual / MCP / Skill / Misc Family

- [ ] 扩展 `SessionClient` 覆盖 rename / delete / export / pending input / session setting 类动作
- [ ] 为 skill / mcp / sync / upgrade / dialog 等能力补 typed contracts
- [ ] 为 skill / mcp / sync / upgrade / dialog 等 family 补 typed event contracts
- [ ] 为 skill / mcp / sync / upgrade / dialog 等能力补 typed clients
- [ ] 迁移 `stores/ui/session.ts` 的 residual presenter calls
- [ ] 迁移 `stores/ui/pendingInput.ts`
- [ ] 迁移 `stores/skillsStore.ts`
- [ ] 迁移 `stores/mcp.ts`
- [ ] 迁移 `stores/mcpSampling.ts`
- [ ] 迁移 `stores/sync.ts`
- [ ] 迁移 `stores/upgrade.ts`
- [ ] 迁移 `stores/dialog.ts`
- [ ] 迁移 `stores/ollamaStore.ts`
- [ ] 清理 residual family 的 raw event listeners

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
