# ACP Tool Result Projection

## 问题

DimCode、Claude Code 等 ACP agent 的工具调用能够执行并把结果返回给 agent，但 DeepChat 消息只显示工具参数，不显示工具响应。终端工具还可能只留下 terminal 引用，最终消息和 Tape 都缺少结果。

## 影响范围

- 所有通过 ACP `tool_call` / `tool_call_update` 投影到 DeepChat 消息的 agent。
- 工具卡片的响应展示、错误状态和完成态。
- 从 assistant message 派生的 Tape `tool_result` 事实。
- 不影响 DeepChat 原生 agent 的工具执行和非 ACP provider。

## 根因

`AcpContentMapper` 把 `rawInput` 映射为 `tool_call_chunk` 后，将后续 `content` 当作参数 fallback 丢弃，并且从未读取 `rawOutput`。完成事件只携带参数；兼容投影的 accumulator 因此只能生成空 `tool_call.response`。ACP terminal content 又只携带 `terminalId`，当前 mapper 没有读取 terminal manager 已缓存的输出。

## 修复方案

- 让 ACP mapper 分别维护参数快照和结果快照，遵守 ACP update 的 replace 语义。
- 结果优先使用面向 client 展示的结构化 `content`；没有可显示 content 时使用 `rawOutput`。
- terminal content 通过只读 terminal snapshot 解析为已缓存输出；terminal 已不可用时保留明确引用。
- 在现有 `tool_call_end` stream event 上增加可选 result/status，不增加新的事件类型。
- accumulator 仅在可选字段存在时写入 `tool_call.response` 和最终状态，保持其他 provider 行为不变。

## 兼容性

- 新字段全部可选，现有 stream producer 和 consumer 不需要迁移。
- ACP 参数仍写入 `tool_call.params`，结果单独写入 `tool_call.response`。
- 失败结果写入 response 并将 block 标记为 `error`。
- 非 ACP tool call 的完成态保持当前行为。

## 任务

- [x] 覆盖 raw input + raw output 的 mapper 回归测试。
- [x] 覆盖 content、diff 和 terminal snapshot 的结果映射。
- [x] 覆盖 accumulator 对 result/status 的投影。
- [x] 验证消息持久化和 Tape 生成 `tool_result`。
- [x] 运行格式化、i18n、lint、类型检查和相关测试。

## 验证

- `pnpm exec vitest run test/main/agent/acp/runtime/acpContentMapper.test.ts test/main/presenter/agentRuntimePresenter/accumulator.test.ts test/main/presenter/agentRuntimePresenter/acpCompatibilityAdapters.test.ts`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck:node`
- `git diff --check`

## GitHub

未同步 issue；本次未请求 GitHub 操作。
