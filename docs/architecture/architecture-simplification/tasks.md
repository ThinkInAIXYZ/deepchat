# Architecture Simplification Tasks

## Baseline

- [x] 建立 architecture simplification spec / plan / tasks
- [x] 新增依赖 / 死代码 / archive 引用基线生成脚本
- [x] 新增失败测试分组基线文档

## Main

- [x] 引入窄接口 ports
- [x] 将 `agentSessionPresenter` 的会话 UI 刷新与权限清理改成依赖 port
- [x] 将 `agentRuntimePresenter` 的权限批准与 env prompt model lookup 改成依赖 port
- [x] 让 `Presenter` 成为 port 的唯一组装入口

## Renderer

- [x] 引入 window context helper
- [x] 引入 IPC subscription helper
- [x] 收口 `App.vue`、`session`、`message` 的活跃监听链路
- [x] 拆出独立 stream state store
- [x] 修复 `session store` 对缺失 `sessionKind` 的兼容分类
- [x] 补齐 `useSearchConfig` 与 search capability 组合逻辑

## Guardrails / Docs

- [x] 新增 architecture guard
- [x] 将 lint 串上 architecture guard
- [x] 更新 `docs/README.md`、`guides/*`、架构文档的治理入口
- [x] 清理剩余 specs 对历史源码快照的直接文件级引用
- [x] 删除历史源码归档实体
