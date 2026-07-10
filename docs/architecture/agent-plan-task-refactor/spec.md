# Agent Plan / `update_plan` Float-Only Spec

> Status: **implemented direction** — DeepChat agent plan follows Codex-like transient progress UI.

## Problem

DeepChat 之前同时存在两套 plan 展示路径：

- 实时路径：`update_plan` / stream `plan` update → `chat.plan.updated` → renderer float。
- 正文路径：runtime 或 ACP mapper 把 plan snapshot 转成 assistant `type:'plan'` block，再由旧正文 renderer 渲染。

这会造成同一轮生成同时出现右下角计划浮窗和正文计划表。对 agent 执行进度来说，plan 更像运行时进度而不是最终回答内容；持久化到正文还会引入 reload rehydrate、终态同步、旧计划闪回等额外状态问题。

## Decision

采用 Codex-like **float-only** 行为：

- `update_plan` 工具保留，参数结构不变。
- `chat.plan.updated` 保留，仍是 plan UI 的唯一实时输入。
- agent runtime 不再把 `update_plan` snapshot upsert 成 assistant `type:'plan'` block。
- stream `plan` event 和 ACP `plan` update 也只产生实时 plan event，不新增正文 block。
- renderer 不再从历史 assistant `type:'plan'` block rehydrate plan float。
- renderer 按 `sessionId` 保存当前 app 运行内的 live plan snapshot；A/B/C 多个 session
  可同时拥有各自 snapshot，但当前 ChatPage 只显示当前 session 的一个 float。
- 旧正文 plan block renderer 和 plan-block construction helper 删除；旧历史 block 可保留在数据中但默认隐藏。
- 不新增数据库表，不做 migration。

## Lifecycle

1. 新一轮 turn 开始时，renderer 调用 `agentPlanStore.beginTurn(sessionId)` 清理上一轮 live snapshot。
2. 生成中收到任意 session 的 `chat.plan.updated` 后，renderer 更新对应 session 的 live snapshot。
3. plan float 只在当前 session 的 turn active、存在 pending interaction 或终态 linger 时可见；
   其他 session 的 snapshot 保存在内存中，切换过去时才显示。
4. 正常结束、停止、错误、`max_steps` 后，runtime 如仍有 `in_progress` step，会发送带
   `terminalReason` 的最终 `chat.plan.updated`，随后 float 随 turn 结束消失。
5. session switch 只加载消息历史，不从旧 `type:'plan'` block 恢复；但不清除当前 app
   运行内已有的 session-scoped live snapshot。reload 后内存 snapshot 为空，因此不恢复旧 plan float。

## Scope

- 后端：`agentRuntimePresenter`、ACP content mapping、相关 main tests。
- 前端：`ChatPage.vue`、assistant message rendering、相关 renderer tests。
- 兼容：保留 shared message 类型里的 `type:'plan'` / `plan_entries` 字段以读取旧数据；不保留新建或渲染正文 plan block 的 helper/component。

## Acceptance Criteria

- 生成中收到 `chat.plan.updated`：浮窗显示并更新步骤。
- A/B/C 多个 session 同时运行时，store 保留各自 live plan；当前页面只显示当前 session 的 plan。
- 正常完成：正文没有新增 plan block；float 随 turn inactive 隐藏。
- stop/error/max steps：若存在开放步骤，发布终态 `chat.plan.updated`，不会残留 spinning UI。
- pending question/permission：float 保持可见，直到用户响应后 turn 继续或结束。
- session switch：不 rehydrate 历史 plan，也不丢当前 app 运行内的 live plan。
- reload：不恢复旧 plan float。
- 内部 `update_plan` tool call 仍标记为 internal，不出现在正文活动列表。
- 旧历史 plan-only assistant message 不渲染空行、空 toolbar 或正文 plan 表格。

## Validation

- main tests 覆盖 runtime 不插入 plan block、terminal event、ACP plan event 不产 content block。
- renderer tests 覆盖 ChatPage 不 rehydrate 历史 plan、session-scoped live plan 切换不丢、
  当前页面只显示当前 session plan、assistant 正文不渲染 legacy plan block。
- 完成后运行：
  - `mise exec -- pnpm run format`
  - `mise exec -- pnpm run i18n`
  - `mise exec -- pnpm run lint`
  - 按改动范围运行相关 Vitest。
