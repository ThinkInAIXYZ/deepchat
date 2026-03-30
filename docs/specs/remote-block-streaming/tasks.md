# Remote Block Streaming Tasks

## T0 Spec

- [x] Add `spec.md`, `plan.md`, and `tasks.md`

## T1 Shared Rendering

- [x] Add `RemoteRenderableBlock`
- [x] Add shared remote block renderer
- [x] Add `draftText`, `renderBlocks`, and `fullText` snapshot fields

## T2 Stream Finalization

- [x] Finalize pending `content` / `reasoning_content` blocks on type transitions
- [x] Mark tool-call arguments as complete after `tool_call_end`
- [x] Finalize narrative blocks before search/action/error insertions

## T3 Telegram Delivery

- [x] Keep draft updates for unfinished reasoning/content
- [x] Send completed blocks incrementally in both draft and final modes
- [x] Keep pending interaction prompts after block delivery

## T4 Feishu Delivery

- [x] Deliver completed blocks incrementally during polling
- [x] Keep append-only reply behavior
- [x] Keep pending interaction card fallback behavior

## T5 Validation

- [x] Add formatter, accumulator, runner, Telegram, and Feishu tests
- [x] Run repo quality gates and capture residual issues
