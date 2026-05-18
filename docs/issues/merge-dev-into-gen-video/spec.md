# Merge dev into gen-video

## User stories
- 作为 `gen-video` 分支开发者，我需要合并最新 `dev` 变更到当前分支，以便继续在最新主线基础上开发。
- 作为评审者，我需要本次冲突解决范围清晰、仅限必要文件，并保留两侧已完成的有效修改。

## Acceptance criteria
- 当前分支成功合并 `origin/dev`，不存在未解决的 merge conflict。
- 冲突文件采用最小变更原则解决，不引入与本次合并无关的重构。
- 合并后工作区状态可继续提交，且相关校验命令已执行并记录结果。

## Non-goals
- 不在本次任务中实现新的产品功能。
- 不主动修改与冲突无关的历史代码风格。
- 不提交 commit，除非用户额外要求。

## Constraints
- 仅处理 `dev` 合并到当前 `gen-video` 分支产生的冲突。
- 遵循仓库现有 SDD、格式化、i18n、lint 规范。
- 如需保留双方逻辑，优先基于现有实现做兼容合并，而非重写。

## Open questions
- 无
