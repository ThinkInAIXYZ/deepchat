# 任务清单

- [x] 拆分 plural rules，并实现显式 locale loader registry、规范化与 Promise 缓存。
- [x] 实现容错的 renderer i18n bootstrap，只注册当前 locale 和 `en-US` fallback。
- [x] 将主窗口、Settings 与 floating renderer 入口迁移为挂载前异步 bootstrap。
- [x] 更新 language store，保证 load → register → locale 的顺序并防止异步竞态。
- [x] 删除 Settings App 中重复获取/设置 locale 的 watcher，保留方向同步 owner。
- [x] 补 loader、bootstrap、language store fallback/竞态/RTL 单元测试（9 个用例通过）。
- [x] production build 已生成 20 个独立 locale chunk；Settings 同步 JS 为 917,504 B，gzip
      300,498 B，未包含翻译正文。
- [x] format、i18n、lint、typecheck、build 和定向 renderer tests 通过。完整 renderer suite 为
      1333 passed / 16 failed：15 个失败来自 `origin/dev` 未改动的 `App.startup.test.ts` Promise mock，
      1 个全量并发超时的 `MemorySettings` 用例单跑 11/11 通过。
- [x] 已提交、推送并创建以 `dev` 为 base 的独立 PR #2003。
