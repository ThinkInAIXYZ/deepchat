# Tasks

- [x] Inspect E2E commands, fixtures, and SDD/report conventions.
- [x] Run required build/E2E smoke validation and capture outcomes.
- [x] Run repeated launch/close validation and targeted route smoke slices.
- [x] Audit main-process startup/shutdown and presenter hot paths with code references.
- [x] Audit renderer/Vue hot paths and route-specific work with code references.
- [x] Cross-check findings against E2E/log evidence; remove unsupported claims.
- [x] Write `report.md` with findings, evidence, and prioritized recommendations.

## 复核阶段（2026-07-04）

- [x] 重新执行 `pnpm run build`，逐字节核对 F9/F11/F16 引用的 bundle 体积。
- [x] 重新执行 `01-launch --repeat-each=3`，复现启动耗时 4.6/4.7/4.1s。
- [x] 重新执行 `04-settings-navigation`，复现 V1 失败（settings-tab-mcp toBeVisible 超时）。
- [x] 4 组并行代码审计逐条复核 F1–F4、F5–F8、F9–F12、F13–F16+V1 的文件与行号。
- [x] Final verification: ensure every finding has code location and evidence classification.
- [x] 更新 `report.md`：每个发现新增「验证结论」与「修复收益」节，修正 F1/F2/F3/F7/F8/F9/F10/F12/F13/F14/F16 的 nuance，新增第 9 节复核结论汇总表。
