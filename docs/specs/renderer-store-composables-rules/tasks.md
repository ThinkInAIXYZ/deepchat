# Renderer Store & Composables Rules Tasks

## Todo (Ordered)
- [x] 1. 定义 store/composables 规则并写入 spec。
- [x] 2. 输出 file -> category 分类清单（UI/App/Adapter/Store）。
- [x] 3. 选定试点域并完成规则对齐（Notifications & Dialogs）。
- [x] 4. 拆分 Top 3 store 的流程编排到 App Composable。
- [x] 4.1 拆分 modelStore 的流程编排到 App Composable。
- [x] 4.2 拆分 mcp store 的流程编排到 App Composable。
- [x] 4.3 拆分 chat store 的流程编排到 App Composable。
- [x] 5. 加入 lint 或脚本，约束 `usePresenter` 与 IPC 仅在 Adapter Composable。
- [x] 6. 建立重复性与必要性审计（合并重叠入口，标注权威入口）。
- [ ] 7. 更新基线统计并记录迁移进度。

## Deferred (Out of Scope)
- [ ] 全量目录迁移到 `features/` 结构。
