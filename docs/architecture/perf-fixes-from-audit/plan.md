# Plan：性能审计修复实施

## 总览

基于 [性能审计报告](../../issues/performance-audit-report/report.md) 第 9 节的 17 个性能点复核结论，本计划：

- **不修复 5 项**（边际/护栏/已有缓解）：F2、F4、F7、F10、F14。
- **修复 12 项**，按实施难度从易到难排序，每项一份独立详细文档（`fix-<id>-*.md`）。

## 不修复项及理由

| 编号 | 发现 | 不修复理由 | 报告结论 |
| --- | --- | --- | --- |
| F2 | ACP registry migration 在窗口创建前 | `critical:false` + try/catch 只延迟不阻塞；稳定库走 fast-path；后移回归数据库解锁路径风险 | 修复必要：边际 |
| F4 | Presenter 构造同步聚合 | 当前构造函数只做引用装配不热；结构性风险靠 code review 约束 | 修复必要：边际（护栏） |
| F7 | Splash window 无条件创建 | 已有 `suppressSplashShow` 机制；延迟创建回归强制显示路径 | 修复必要：边际 |
| F10 | i18n 全量同步导入 | 成本受 Vite 分块影响小；locale JSON 体量小；改 vue-i18n 加载风险收益比低 | 修复必要：边际到是 |
| F14 | Session sidebar fingerprint/watch | 已有 rAF coalescing 限制布局读取频率；revision 只省字符串分配 | 修复必要：边际 |

## 修复项（按实施难度从易到难）

难度评估维度：改动文件数、是否跨进程、是否需大数据量验证、回归风险、是否需调研。

| 序 | 编号 | 发现 | 难度 | 详细文档 | 一句话方案 |
| --- | --- | --- | --- | --- | --- |
| 1 | V1 | Settings 隐藏路由 E2E 失败 | 极易 | [fix-V1](fix-V1-settings-hidden-route.md) | hidden 路由用 hash 导航代替侧边栏 tab 点击，纯测试改动 |
| 2 | F15 | ChatStatusBar watcher 链 | 易 | [fix-F15](fix-F15-chatstatusbar-watchers.md) | 去 `deep:true`，先补并全量维护浅层 revision；保留 watcher 拆分并做同 tick coalescing |
| 3 | F12 | sessionStore.fetchSessions 重复调度 | 易 | [fix-F12](fix-F12-session-fetch-dedup.md) | fetchSessions 加 in-flight promise 守卫，消除 App/ChatTabView 竞态 |
| 4 | F9 | Markdown workers eager 加载 | 中 | [fix-F09](fix-F09-markdown-workers-lazy.md) | 删 main.ts eager 调用，改所有 markdown 入口（MarkdownRenderer + ThinkContent）onMounted 触发 |
| 5 | F6 | protocol handler 同步读文件 | 中 | [fix-F06](fix-F06-protocol-handler-async.md) | 三个 handler 改 async + streaming Response，workspace-preview 加大小上限 |
| 6 | F8 | 关闭路径缺观测/timeout | 中 | [fix-F08](fix-F08-shutdown-observability.md) | destroy 链加 duration 日志；plugin server stop 改 allSettled；MCP per-server timeout |
| 7 | F13 | message store 排序/cache | 中 | [fix-F13](fix-F13-message-store-sort.md) | 新 id 二分插入；parsedMessageCache LRU；block payload 浅比较 |
| 8 | F16 | Settings provider 列表渲染 | 中 | [fix-F16](fix-F16-provider-list-render.md) | disabled 列表折叠；iconKey 保留 includes 语义做候选索引优化；enabled 区暂不动 |
| 9 | F1 | SQLite 启动关键路径 | 中高 | [fix-F01](fix-F01-sqlite-startup-defer.md) | 保留 repair 所需启动期诊断；移除重复观察性后台诊断；各阶段加 duration 日志 |
| 10 | F5 | MCP 后台启动 timeout | 中高 | [fix-F05](fix-F05-mcp-startup-timeout.md) | 引入 soft timeout；per-server 启动 status；可选受限并发 |
| 11 | F3 | backfill 争抢 + 内存峰值 | 高 | [fix-F03](fix-F03-backfill-coordinator.md) | 5 个 backfill 纳入 coordinator 限流；SELECT * 改 cursor；小 batch |
| 12 | F11 | Iconify/provider icon 包体 | 高 | [fix-F11](fix-F11-icons-bundle-slim.md) | icon 白名单加载（252 个 vs 全量 3267）；provider icon lazy；tokenflux SVG 处理 |

## 实施顺序建议

按难度递增实施，每项独立提交、可回滚：

1. **第一波（易，纯测试/renderer 单文件）**：V1 → F15 → F12。先修 V1 解锁 E2E 性能门禁，再修 renderer 常驻组件。
2. **第二波（中，跨 renderer 组件/main handler）**：F9 → F6 → F8 → F13 → F16。
3. **第三波（中高，main 启动关键路径）**：F1 → F5。
4. **第四波（高，高收益大改）**：F3 → F11。

每波完成后跑 `pnpm run typecheck && pnpm run lint && pnpm run format && pnpm run i18n` + 相关 E2E。

## 涉及模块与文件分布

- **E2E/测试**：V1
- **renderer stores**：F12（session）、F13（message）
- **renderer 组件**：F9（main.ts + MarkdownRenderer）、F15（ChatStatusBar）、F16（ModelProviderSettings + ModelIcon）
- **main process**：F6（protocol handler）、F8（presenter destroy + mcp/plugin shutdown）、F1（sqlitePresenter + lifecycle）、F5（mcpClient + mcpPresenter）、F3（agentSessionPresenter + lifecycle hooks）
- **renderer 资源/build**：F11（iconLoader + ModelIcon + asset）

## 验证策略

每项文档已列验证命令。共性验证：

- `pnpm run typecheck`（node + web）
- `pnpm run lint` + `pnpm run format` + `pnpm run i18n`
- E2E 基线：`01-launch --repeat-each=3`（启动）、修复后的 `04-settings-navigation`（Settings）、`18-provider-readonly-route`（provider 页）
- 构建体积对比（F9/F11）：`pnpm run build` 后对比 `out/renderer/assets` chunk
- 单元测试：每项对应的 `test/main` / `test/renderer` test

## 风险与兼容

- 所有修复保持现有接口兼容，不破坏 IPC contract。
- F1/F3 涉及启动关键路径，必须保证 migration/核心表仍在使用前就绪（文档已明确区分可延迟/不可延迟）。
- F8/F5 的 timeout 值需与现有 stdio 2s grace 协调。
- F11 的白名单基于源码静态统计（252 个），需视觉回归确认无遗漏。
- 不修复合入 build 刷新的 `resources/*.json`（正常维护）。

## Open Questions

无。所有修复点的代码位置已在审计阶段确认到行号；每项文档的「剩余不确定性」均为实现阶段的微调项（如 timeout 具体值、LRU 容量），不阻塞方案落地。

## Review 结论汇总

12 份修复文档已由 `gpt-5.4` 逐份对照当前代码做 review（每份独立 agent，核对行号 + 方案可行性 + 步骤完整性 + 验证覆盖 + 风险漏判）。**初版 12 份全部「需修订」**，发现的共性问题与已落实的修订如下：

| 文档 | review 发现的关键问题 | 已落实修订 |
| --- | --- | --- |
| V1 | App.vue 行号偏移；误建议新增 helper；回归范围是推测 | 更正行号 L37-47；改复用现有 `resolveSettingsNavigationPath`；回归改实跑确认 |
| F15 | 误称「未确认到定义」；缺 revision 硬前置；漏判组内变化 | 更正定义在 modelStore L893-931；revision 列硬前置；补组内变化测试 |
| F12 | 守卫位置歧义；finally 清理不严谨；漏 reset=true 边界 | 明确仅包 fetchSessions；改 currentFetchPromise 比对；补 reset 边界；验证改 spy |
| F9 | 「统一入口」不成立（漏 ThinkContent）；误称独立 chunk；fallback 未实证 | 纳入 ThinkContent；改 ?worker&inline 产物核实；补 fallback 实证 |
| F6 | stream 兼容未定；阈值未给；漏 .wasm MIME | 明确 Electron 40 + Readable.toWeb + readFile fallback；给 50MB 阈值；保留 .wasm |
| F8 | Promise.race 不可取消遗留 zombie；并发共享状态未核实；日志层级模糊 | 补 stdio 强杀/非 stdio warning；核实 stopServer 独立可并发；destroy 层必做 |
| F13 | LRU 未定值；二分前提未规则化；漏 optimistic/streaming 回归 | LRU 定 1024；有序性检测规则；补三类顺序回归 |
| F16 | 误建议精确 Map.get（破坏 includes 语义）；enabled/disabled 边界不清 | 改候选索引保留 includes；明确只改 disabled；补排序交互回归 |
| F1 | 误设 SQLitePresenter 直接调度；target 非法值；多处 new 不准 | 改 DatabaseInitializer 注入 coordinator；target 用 'main'；更正仅一处 new |
| F5 | 误称复用布尔态事件；soft timeout 后生命周期不明；缺 retry/shutdown 交互 | 改扩展枚举态事件；保留 client 转 retrying；补 shutdown 慢连接验证 |
| F3 | rtkHealthCheck resource 未定；缺 taskContext 接线；iterate 未验证 | 定 resource:io；补签名改造；补 iterate 类型验证；batch 改待压测 |
| F11 | 252 当成完整覆盖；白名单手工维护；承诺具体降幅；tokenflux 验收空 | 改基线+运行时回灌；脚本生成+CI；收紧降幅表述；给 <200KB 阈值 |

修订后文档均已与当前代码行号对齐，方案可行性收敛。残留的「剩余不确定性」均为实现阶段微调项（timeout 值、LRU 容量、iterate 运行时确认、tokenflux 能否压到阈值），不阻塞方案落地，已在各文档风险节标注。
