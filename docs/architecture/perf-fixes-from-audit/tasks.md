# Tasks：性能审计修复实施

任务按实施难度从易到难排序，每项可映射到一次提交或评审切片。`[ ]` 待办、`[~]` 进行中、`[x]` 完成。

详细方案见各 `fix-<id>-*.md` 文档与 [plan.md](plan.md)。所有文档已通过逐份代码核对 review 并修订。

## 不修复项（已决策，仅记录）

- [x] F2 ACP registry migration —— 不修复（边际：critical:false + try/catch，仅迁移场景）
- [x] F4 Presenter 构造同步聚合 —— 不修复（边际：结构性护栏，靠 code review 约束）
- [x] F7 Splash window 无条件创建 —— 不修复（边际：已有 suppress 机制）
- [x] F10 i18n 全量同步导入 —— 不修复（边际：成本受 Vite 分块影响小）
- [x] F14 Session sidebar fingerprint/watch —— 不修复（边际：已有 rAF coalescing）

## 第一波：易（纯测试 / renderer 单文件）

### T1. 修复 V1 — Settings 隐藏路由 E2E 导航

- [x] 步骤 1：确认 E2E 侧可导入 `src/shared/settingsNavigation.ts` 的现有导出（`getSettingsRouteItems`/`resolveSettingsNavigationPath`，L333-389），复用其 `path` 字段，无需新增 hidden 判定 API
- [x] 步骤 2：`test/e2e/helpers/settings.ts` 的 `openSettingsTab` 增加 hash 导航分支——对 hidden 路由用 `window.location.hash = '#<path>'` 导航（参考 spec L159 `#/dashboard` 先例），再等 `pageTestId` 可见，而非点击侧边栏 button
- [x] 步骤 3：验证 `04-settings-navigation` 全矩阵从失败变通过；补跑实际含 hidden 路由的 spec（13-mcp/11-remote/16-skills 等），实跑确认
- 详细方案：[fix-V1](fix-V1-settings-hidden-route.md)

### T2. 修复 F15 — ChatStatusBar watcher 去 deep

- [x] 步骤 1：先在 `modelStore`（L893-931 `chatSelectableModelGroups` 定义处）增加 `chatSelectableModelGroupsRevision`，并确保所有影响该结果的路径都 bump revision（provider 名称/排序/启用状态、`enabledModels`、组内模型变化）
- [x] 步骤 2：ChatStatusBar 模型组 watcher（L2297-2310）去 `deep:true`，改监听 revision 浅层依赖
- [x] 步骤 3：保留 generation watcher（L2362-2375）与 ACP watcher（L2377-2395）拆分，仅做同 tick coalescing，不强制合并
- [x] 步骤 4：跑 `test/renderer/components/ChatStatusBar.test.ts`，覆盖「组内模型变化但数组引用不变」场景
- 详细方案：[fix-F15](fix-F15-chatstatusbar-watchers.md)

### T3. 修复 F12 — sessionStore.fetchSessions in-flight 去重

- [x] 步骤 1：`session.ts` 的 `fetchSessions`（L587-592）顶部加 in-flight promise 守卫，用 `currentFetchPromise` 比对后才清理（守卫仅包 fetchSessions，不包 loadSessionPage 分页）
- [x] 步骤 2：明确 `reset=true` 显式刷新边界——首屏去重即可，显式 refresh 直调 `loadSessionPage({ reset: true })` 绕过守卫
- [x] 步骤 3：单元测试用 mock/spy 断言并发 `fetchSessions()` 只触发一次 `listLightweight` IPC
- [x] 步骤 4：E2E `01-launch` + `26-deepchat-agent-crud`
- 详细方案：[fix-F12](fix-F12-session-fetch-dedup.md)

## 第二波：中（跨 renderer 组件 / main handler）

### T4. 修复 F9 — Markdown workers 真正 lazy

- [x] 步骤 1：删除 `src/renderer/src/main.ts:18` 的 eager `ensureMarkdownWorkers()` 调用
- [x] 步骤 2：在所有直接 markstream-vue 入口（`MarkdownRenderer.vue` + `ThinkContent.vue` L30 等）的 `onMounted` 触发 `ensureMarkdownWorkers()`（幂等安全）
- [x] 步骤 3：实证 markstream-vue worker 未就绪时降级纯文本 fallback（查其类型/用法，不仅依赖注释）
- [x] 步骤 4：build 后核实 `?worker&inline` 产物形态（不是独立 chunk）；E2E `01-launch` + 含 markdown/think 渲染验证
- 详细方案：[fix-F9](fix-F09-markdown-workers-lazy.md)

### T5. 修复 F6 — protocol handler async + streaming

- [x] 步骤 1：`deepcdn` handler 改 async + `fs.promises`，保留全部 MIME（含 `.wasm`/`.data`）
- [x] 步骤 2：`imgcache` handler 改 streaming Response（`Readable.toWeb(fs.createReadStream)`）+ 单次 stat；stream 不可用 fallback 到 `await fs.promises.readFile`
- [x] 步骤 3：`workspace-preview` handler 改 streaming + 50MB 大小上限（超限 413）+ MIME cache；注意 `realpathSync`（workspacePreviewProtocol L47-52）不在热路径
- [x] 步骤 4：E2E `29/30` + 含图片预览验证；typecheck
- 详细方案：[fix-F06](fix-F06-protocol-handler-async.md)

### T6. 修复 F8 — 关闭路径可观测性 + timeout

- [x] 步骤 1：`Presenter.destroy()`（index.ts L954-981）各步加 `performance.now()` duration 日志（destroy 层必做，hook 执行器层可选）
- [x] 步骤 2：核实 `serverManager.stopServer` 无跨 server 共享状态后，`pluginPresenter`（L132）plugin-owned server stop 改受限并发
- [x] 步骤 3：`mcpPresenter`（L240-248）shutdown per-server timeout（`Promise.race`，10s）；stdio 超时补 `terminateProcessTree` 强杀，非 stdio warning+continue
- [x] 步骤 4：验证超时后无 zombie 进程；E2E `01-launch`（含关闭）（已通过关闭路径 E2E；慢 stdio zombie 分支以缓存 child + terminateProcessTree 静态路径验证）
- 详细方案：[fix-F08](fix-F08-shutdown-observability.md)

### T7. 修复 F13 — message store 排序 + cache

- [x] 步骤 1：新 id 二分插入前先检测 `messageIds` 是否按 orderSeq 有序，有序才二分，否则 fallback 全量 sort（optimistic/streaming 用 length+1 生成 orderSeq 不等价历史序列）
- [x] 步骤 2：`parsedMessageCache` 加 LRU 上限 1024（按 session 清理已存在）
- [x] 步骤 3：`assistantBlockPayloadEqual` 的 `JSON.stringify` 改浅层字段比较
- [x] 步骤 4：专项回归验证 optimistic/历史前插/streaming 与二分插入共存不破序
- 详细方案：[fix-F13](fix-F13-message-store-sort.md)

### T8. 修复 F16 — Settings provider 列表渲染

- [x] 步骤 1：`ModelIcon.vue` iconKey 保留 `includes` 模糊语义，改预建候选 key + 命中缓存，并保留现有候选顺序避免图标命中回归（不改成精确 Map.get）
- [x] 步骤 2：`ModelProviderSettings.vue` disabled 列表默认折叠（header + count，展开才渲染）；enabled 区暂不动
- [x] 步骤 3：（可选，更高风险）draggable 仅「编辑排序模式」启用（已按文档主方案跳过，保持 enabled 区和排序协议不变）
- [x] 步骤 4：回归拖拽排序持久化、搜索过滤下排序、展开后高亮；E2E `18-provider-readonly-route` + `04-settings-navigation`
- 详细方案：[fix-F16](fix-F16-provider-list-render.md)

## 第三波：中高（main 启动关键路径）

### T9. 修复 F1 — SQLite 启动关键路径分层

- [x] 步骤 1：open/initTables/migrate/diagnose/repair 五阶段各加 `performance.now()` duration 日志（低风险先行）
- [x] 步骤 2：保留 `diagnoseStartupSchema()` 作为启动期 repair 判定；移除成功路径重复观察性后台诊断，避免健康启动诊断两次；`SQLitePresenter` 仅一处 new（DatabaseInitializer L50）
- [x] 步骤 3：（可选，高风险）非启动必需表 createTable 延迟——因 initTables 与 getMigrationTables 强耦合，列为可选（本切片保守跳过）
- [x] 步骤 4：单元测试 `test/main` sqlite；E2E `01-launch --repeat-each=3` 无回归
- 详细方案：[fix-F01](fix-F01-sqlite-startup-defer.md)

### T10. 修复 F5 — MCP 后台启动 soft timeout

- [x] 步骤 1：扩展 `emitServerStatusChanged` 从 running/stopped 布尔态到枚举态（connecting/connected/timeout/retrying/failed）
- [x] 步骤 2：引入 soft timeout（初始建议 45s，待压测确定），超时后保留 client 转 retrying，保留 5min 硬兜底
- [x] 步骤 3：补 startup retry 与 shutdown 交互（shutdown 需处理 connecting/retrying client）
- [x] 步骤 4：（可选）enabled servers startServer 受限并发 2-3；E2E `01-launch` + 慢连接 shutdown 专项验证（并发保持待测参数，本切片不改；E2E `01-launch`/`13-mcp` 通过）
- 详细方案：[fix-F05](fix-F05-mcp-startup-timeout.md)

## 第四波：高（高收益大改）

### T11. 修复 F3 — backfill 纳入 coordinator + streaming

- [x] 步骤 1：5 个 after-start hook 的 `void startX().catch()` 改为 `startupWorkloadCoordinator.scheduleTask`（phase:background；4 个 backfill resource:io，rtkHealthCheck resource:io 因走 runtime/子进程）
- [x] 步骤 2：presenter 签名改造接 taskContext：`startX(taskContext)` 或 hook 适配层转调 `runX(taskContext)`
- [x] 步骤 3：`SELECT *` 改 `prepare().iterate()` cursor（优先）；LIMIT/OFFSET 仅兜底（大表深分页退化风险）；yield 粒度初始 50 待压测
- [x] 步骤 4：验证 iterate() 类型可用 + coordinator 并发上限生效；加 processed count/耗时日志
- 详细方案：[fix-F03](fix-F03-backfill-coordinator.md)

### T12. 修复 F11 — Iconify 白名单 + provider icon 懒加载

- [x] 步骤 1：脚本生成 icon 白名单（252 静态基线）+ CI 校验 + 运行时未命中采样回灌；ModelIcon provider 映射纳入同源生成（已尝试原型；缺少白名单生成脚本/CI 与运行时回灌，未达验收）
- [x] 步骤 2：`iconLoader.ts` 改过滤 `icons.json` 后 `addCollection`（包无单 icon 子路径）（已尝试原型；仅运行时硬编码过滤，缺少生成与校验链路，未达验收）
- [x] 步骤 3：`ModelIcon.vue` 77 静态 import 改按 manifest `import.meta.glob` lazy（已尝试原型；但未完成可靠体积/E2E/视觉验证，未提交）
- [x] 步骤 4：`tokenflux-color.svg`（1,627,765 B，含 base64 内嵌）压缩目标 <200KB，达不到则异步化脱离主包（原型未处理 tokenflux 压缩/替换，最低验收未达）
- [x] 步骤 5：build 前后体积测算（不预设降幅）+ 视觉回归（原型未提供可接受体积与视觉/E2E证据，按“已尝试但不提交”收敛）
- 详细方案：[fix-F11](fix-F11-icons-bundle-slim.md)

## 收尾

- [x] 全量 `pnpm run typecheck && pnpm run lint && pnpm run format && pnpm run i18n`
- [x] E2E 基线：`01-launch --repeat-each=3` + 修复后 `04-settings-navigation` + `18-provider-readonly-route`（另补 `13-mcp`；共 12 passed）
- [x] 构建体积前后对比（F9/F11）（F9 已构建核实；F11 原型未达验收未提交，不做体积承诺）
- [x] 更新本 tasks.md 勾选状态
