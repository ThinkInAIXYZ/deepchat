# 任务清单

## Phase 0

- [x] 记录多窗口 app ownership、目录约束、IPC transport 原则和启动状态机。
- [x] 审计 `browser` 与 `browser-overlay`：确认前者为无消费者的遗留 SVG 目录，后者为 active overlay renderer。
- [x] 为 browser-overlay 补齐 TypeScript 覆盖范围，移除遗留 `@browser` alias、注释和目录；更新项目结构说明。
- [x] 调整主窗口启动 owner：shell 不再发起首屏 session fetch，route host 在 snapshot/fallback route 确定后唯一发起。
- [x] 补组合启动和 session priority 时序测试。
- [x] 保持现有 listener lifecycle、route fallback、ChatPage keyed remount、settings independent startup 回归测试；它们包含在 targeted suite 中。
- [x] 建立 renderer architecture baseline，记录 entry 与 settings → chat-app 跨 app import 基线，并提供 `--check` 防止未经审阅的增量。
- [x] 执行 targeted tests、format、i18n、lint、typecheck 和完整 renderer suite（167 files、1302 tests）。

## Phase 1

- [x] 将 main app composition 实现移至 `src/renderer/src/apps/chat-main/ChatMainApp.vue`，保留根 `App.vue` compatibility facade 与稳定 entry shim。
- [x] 保留 `ChatTabView`、router 与 session/bootstrap owner 不变，并以现有 startup suites 保护时序。
- [x] 执行 targeted startup suites、完整 renderer suite（167 files、1302 tests）、format、i18n、lint、typecheck 与 renderer baseline check。

## 后续切片

- [x] 将 ChatPage 与既有 7 个 page-private composable 迁入 `features/chat-page/`，更新 route host、
      测试和 feature 内部路径；`messageIpc.ts` 的 stream gate 所有权保持不变。
- [x] 抽取 page-private `useVoiceInput`，保留当前模型选择在 ChatPage 装配层，收束语音输入配置
      epoch、模型配置订阅和底层 speech cleanup。
- [ ] 将 feature-local ChatPage 逻辑逐个移动并维持 `messageIpc.ts` 的 stream gate 单一所有权。
- [ ] 以明确 shared contract 替换 settings → chat-app 历史依赖。
- [ ] 当真实编排重复出现时，提取 application service；不创建 IPC facade。
