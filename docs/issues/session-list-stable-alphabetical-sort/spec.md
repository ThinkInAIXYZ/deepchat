# 会话列表固定字母排序

Status: implemented as of 2026-06-13. Project grouping has a deliberate recency-sort exception
documented in `docs/issues/project-group-session-update-sort/spec.md`.

## 背景

当前 renderer 的会话列表使用 `updatedAt` 倒序排列，且在切换置顶状态时会把本地 `updatedAt` 改成当前时间。
这会导致用户仅仅执行 pin / unpin 操作时，session list 也被重新洗牌，顺序不稳定。

## 目标

- 会话列表在 renderer 内保持固定排序，不因 pin / unpin 操作而按最近更新时间重排。
- pinned 区域和普通分组区域都按会话标题字母顺序展示。
- 相同标题的会话保持稳定且可预测的兜底顺序。

## 非目标

- 不调整 pin 动画、分组 UI 结构或交互文案。
- 不改变主进程 session 的持久化字段结构。
- 不新增用户设置项来切换排序方式。

## 约束

- 继续沿用 Pinia session store 作为 renderer 排序入口。
- 不引入新的 IPC 协议或主进程排序契约变更。
- 保持现有 pinned / grouped 列表拆分逻辑可用。

## 验收标准

- `fetchSessions()` 或 session 增量刷新后，会话列表按标题字母升序展示，而不是按 `updatedAt` 倒序展示。
- 对任意会话执行 pin / unpin 后，列表不会因为本地更新时间变化而跳到顶部。
- pinned 列表与普通分组内的会话都按标题字母顺序稳定排序；当标题相同时按 `id` 升序兜底。
- 为排序与 pin / unpin 回归场景补齐 renderer store 单测。
- 项目分组模式下，每个 project group 内按 `updatedAt` 降序排列，再用 title/id 做稳定兜底。
