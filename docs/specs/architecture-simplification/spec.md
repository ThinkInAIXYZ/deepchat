# Architecture Simplification

## Summary

本规格定义首期“整体减负治理”的目标：不引入新功能，优先降低 `main` / `renderer` 的心智负担，清理无用代码，减少隐式调用链，并把生命周期、边界与兼容层显式化。

首期只做四类工作：

- 基线收敛
- 分层与依赖收口
- 历史归档脱钩
- 测试可信度恢复

## Goals

- 为 `main` 和 `renderer` 建立可持续更新的结构基线，而不是一次性口头结论。
- 限制活跃路径继续依赖全局 `presenter`、分散 IPC 监听和历史归档代码。
- 让 `newAgentPresenter`、`deepchatAgentPresenter`、`App.vue`、`stores/ui/*` 的职责边界更清楚。
- 为后续删除历史源码归档目录和死文件清理建立前置条件。

## Non-Goals

- 不做新功能。
- 不在首期重命名对外 IPC channel。
- 不在首期移除 `SessionPresenter`、legacy import、旧表结构这些兼容边界。
- 不要求一次性解决全部失败测试，只要求把失败分类、责任边界和修复入口理清。

## Acceptance Criteria

- 仓库存在一组可更新的基线报告，至少覆盖依赖环、零入边候选、归档引用、失败测试分组。
- 活跃主链路新增 anti-regression guard，阻止历史源码重新进入运行时依赖，阻止首批主链路继续回跳全局 `presenter`。
- `newAgentPresenter` / `deepchatAgentPresenter` 首批关键路径改为依赖窄接口 port，而不是直接 import `presenter/index.ts`。
- `renderer` 至少将 `App`、`session`、`message` 这条活跃链路的 IPC 监听收口到 helper / subscription hub，并把流式状态独立成单独状态面。
- 文档中存在本次治理的 `spec.md`、`plan.md`、`tasks.md`，并且 `docs/README.md` 能导航到这些内容。

## Constraints

- 行为兼容优先，优先保留用户可见行为和现有 IPC surface。
- 只有经过人工分类的“真正死文件”可以删除。
- 任何 archive 清理都要先完成文档脱钩。
