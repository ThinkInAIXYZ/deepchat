# Plan

## Scope
将 `origin/dev` 合并到当前 `gen-video` 分支，识别并解决冲突文件，保留双方必要改动，并执行仓库要求的基础校验。

## Implementation decisions
- 先 `git fetch origin dev`，再执行 `git merge origin/dev` 以基于最新远端 `dev` 合并。
- 冲突解决前先阅读每个冲突文件的上下文，按文件现有模式做最小修改。
- 若冲突涉及文档或配置，同样遵循最小差异原则，不借机整理无关内容。
- 合并完成后执行仓库要求的 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。若命令失败，记录失败点并告知用户。

## Risks and mitigations
- 风险：冲突文件较多且分散，容易误删一侧逻辑。
  - 缓解：逐文件阅读冲突块上下文后再编辑，并在完成后检查 diff。
- 风险：格式化或 lint 暴露既有问题，影响本次验证。
  - 缓解：优先区分新引入问题与仓库既有问题，向用户明确说明。

## Test strategy
- 使用 `git status` 确认冲突已清除。
- 使用格式化、i18n、lint 命令验证合并后仓库状态。
