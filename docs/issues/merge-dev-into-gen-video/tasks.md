# Tasks

1. 获取最新 `origin/dev` 并确认当前分支状态。
2. 创建本次合并的 SDD 文档并记录范围、约束、验证方式。
3. 执行 `git merge origin/dev`，定位所有冲突文件。
4. 阅读冲突文件上下文，逐个解决冲突并保留必要改动。
5. 运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
6. 汇总结果与后续建议，等待用户决定是否提交。
