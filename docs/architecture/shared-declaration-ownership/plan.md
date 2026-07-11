# Plan

1. 用 compiler API 固定 44 个 baseline diagnostics，并按 owner 分类。
2. 移动 Shortcut 与 ImportMode 到 shared domain module，更新 main imports并保留必要兼容 export。
3. 修正 declaration 的错误路径、missing symbols、过时 Electron type 和不存在 export。
4. 反复运行同一 strict probe，直到 repo-owned declaration diagnostics 为零。
5. 跑 node/web typecheck、targeted tests、format/i18n/lint 和独立 diff review；不跑 full/E2E。

`DCL-002` 不并入本切片：把 probe 变成常规脚本/CI gate 是单独可回滚的增长护栏。
