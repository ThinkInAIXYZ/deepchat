# 任务清单

- [x] 建立 shared locale manifest 和确定性 locale resolver。
- [x] 迁移 renderer、main、Settings、agent tool 与 shared type 的重复清单。
- [x] 重建 native menu translation lookup，并覆盖 exact/fallback 行为。
- [x] 补齐 8 个 locale 的 10 处 namespace 注册遗漏。
- [x] 新增 namespace completeness 校验。
- [x] 修复 named interpolation 与 literal brace 不一致。
- [x] 新增 interpolation contract 校验并接入 `pnpm run i18n`。
- [x] 运行 format、i18n、lint、typecheck 与定向测试。
- [x] 每个提交前完成严重度排序 review，修复发现后再提交。
