# Settings Dashboard CPU 占用优化

## 问题描述

打开 Settings 默认 Overview 后，`DashboardSettings` 会渲染 usage chart、breakdown 和最多一年左右的
calendar cells。当前每个 calendar cell 的 title 都在 render 路径中调用 `formatDateKey()` 与
`formatFullTokens()`，两者每次分别创建新的 `Intl.DateTimeFormat` 和 `Intl.NumberFormat`；其他 summary
与 breakdown 格式化函数也在每次调用时创建 formatter。

Dashboard 在 backfill 运行时每 3 秒刷新，稳定后仍每 15 秒刷新。Settings 窗口隐藏、最小化或失焦时
timer 不会暂停，每次响应又替换完整 payload，触发 calendar、chart 和 breakdown 重算。这让 formatter
构造与 IPC/数据库 dashboard 聚合持续叠加，造成打开 Settings 时的 CPU 峰值和后台额外唤醒。

## 影响

- calendar 数据越长，单次 render 创建的 `Intl` formatter 越多，首屏和刷新时 CPU 峰值越明显。
- Settings 留在后台时仍周期性执行 IPC、dashboard 聚合和 Vue/Unovis 更新。
- 手动刷新、timer 与慢请求缺少统一 in-flight owner，后续扩展容易引入重叠请求或旧结果覆盖。
- 完成 backfill 后 15 秒刷新频率高于稳定 usage dashboard 的实际需要。

## 根因位置

- `src/renderer/settings/components/DashboardSettings.vue`
  - `formatFullTokens`、`formatPercent`、`formatCurrency`、`formatDateKey` 等按调用构造 `Intl` formatter；
  - `calendarCellTitle()` 位于 template render 路径，对每个有效 cell 重复格式化；
  - `calendarCellStyle()` 每次调用创建新 style object；
  - `scheduleRefresh()` 仅判断 mount/dashboard 状态，不判断 `visibilityState` 或窗口 focus；
  - 稳定态固定 15 秒轮询，且没有显式的 in-flight 请求 owner。

## 修复计划

1. 用 locale 依赖的 computed 一次创建 number、percent、currency、date、month 与 weekday formatters；
   locale 变化时自动重建，普通 render 复用实例。
2. 将 dashboard payload 与外部 tooltip 实例改为 `shallowRef`；payload 保持 immutable replacement。
3. 在 calendar computed 中预生成每个 day 的 title 与静态 level style，template 只读取值。
4. 将刷新改为单 owner 的 self-scheduling timeout：
   - backfill `running`：3 秒；
   - 其他稳定状态：60 秒；
   - document hidden 或 window unfocused：清除 timer 并暂停；
   - 恢复可见/焦点时按上次完成时间计算剩余延迟，已过期则立即刷新。
5. 同一时间只允许一个 dashboard IPC；手动、timer 和 focus 恢复复用 in-flight Promise。卸载后响应不得
   更新 state 或重新调度。

## 非目标

- 不修改 usage dashboard 主进程查询、数据 schema、backfill 批处理或 RTK health contract。
- 不改变 Dashboard 布局、图表、calendar 范围或用户可见文案。
- 不引入 worker、虚拟化 calendar 或跨页面 dashboard cache。
- 不创建 GitHub issue；通过独立 PR 评审该修复。

## 验收标准

1. 同一 locale 下，calendar 长度增加不会线性增加 `Intl.NumberFormat` / `Intl.DateTimeFormat` 构造次数。
2. calendar title、月份、weekday、summary、breakdown 与 tooltip 保持原有本地化输出。
3. backfill 运行时每 3 秒刷新；完成/失败/空闲状态每 60 秒刷新。
4. hidden 或 unfocused 期间不发 dashboard IPC；恢复后仅在数据已过期时立即刷新，否则等待剩余时间。
5. 慢请求期间的手动刷新或 timer 不创建第二个 IPC；卸载后不更新、不调度。
6. 组件行为测试覆盖 formatter 复用、两档 interval、visibility/focus pause-resume、in-flight dedupe 和 cleanup。
7. format、i18n、lint、typecheck 与 Dashboard/Settings 相关 renderer tests 通过。

## 任务清单

- [x] 定位 calendar render 中的线性 `Intl` 构造和后台持续轮询根因。
- [x] 缓存 locale formatter，并预计算 calendar title/style view model。
- [x] 将 dashboard payload/tooltip 改为 shallow reactive 边界。
- [x] 实现 3 秒/60 秒两档、visibility/focus aware 的单请求自调度刷新。
- [x] 补 formatter、interval、pause/resume、dedupe 与 unmount 回归测试（19 个用例通过）。
- [x] 运行 format、i18n、lint、typecheck、architecture baseline 和相关 renderer tests。
- [x] 提交、推送并创建以 `dev` 为 base 的独立 PR。

## 验证

```bash
pnpm exec vitest --config vitest.config.renderer.ts --run test/renderer/components/DashboardSettings.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:renderer
```

- `format`、`i18n`、`lint`、`typecheck` 与 renderer architecture baseline 均通过。
- `DashboardSettings` 定向测试 19/19 通过。
- 全量 renderer suite：173 个测试文件通过，1 个失败；1331 个测试通过，15 个失败。失败均来自
  `origin/dev` 已存在的 `App.startup.test.ts` mock：`initAppStores` 返回 `undefined`，而未修改的
  `ChatMainApp.vue` 对结果调用 `.then()`；本次 Dashboard 变更没有引入新的全量测试失败。
- PR: [#2004](https://github.com/ThinkInAIXYZ/deepchat/pull/2004)
