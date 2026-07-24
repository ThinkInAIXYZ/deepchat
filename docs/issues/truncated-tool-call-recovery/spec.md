# Truncated Tool Call Recovery

## Issue

When a provider reaches the output token limit after emitting one or more tool calls, DeepChat
preserves the `max_tokens` stop reason but treats the round as a normal terminal completion. The
calls are not executed, which is safe, but they are also not settled with matching tool results.
The current finalizer can consequently mark unresolved tool-call blocks as successful, and neither
the active run nor a rebuilt history reliably tells the model why the calls were skipped.

## Impact

- The model cannot re-issue a complete call within the same run.
- Persisted history can omit the truncated call or retain misleading successful UI state.
- A provider can reject a later request when an assistant tool call has no corresponding result.
- Executing a call that merely looks complete would risk running silently truncated arguments.

## Root Cause

- The provider adapter correctly maps an AI SDK `length` finish reason to `max_tokens`.
- The DeepChat loop creates a tool batch only for `stopReason === 'tool_use'` with completed calls.
- Tool dispatch models only execution, although assistant-message creation, output fitting, block
  updates, notifications, execution-state snapshots, and Tape persistence are batch settlement
  responsibilities shared by executed and rejected calls.
- Stream events do not identify whether DeepChat or the provider owns tool execution. ACP and AI
  SDK provider-executed calls therefore cannot be excluded by a provider-neutral rule.

## Fix Design

1. Add optional per-call execution ownership to core tool-call start events. Missing ownership
   remains DeepChat-owned for compatibility; official AI SDK and ACP adapters mark provider-owned
   calls explicitly.
2. Refactor tool dispatch into `settleToolBatch`, with an explicit `execute` or
   `reject/output_truncated` disposition and one shared result-commit path.
3. On `max_tokens`, collect every DeepChat-owned call from the current provider round in source
   order, including a started call whose argument stream did not end. Reject the entire batch and
   generate one matching error tool result per call. Never invoke permission checks, reviewers, or
   tool executors for this disposition.
4. Count rejected calls as zero requested and zero executed tool calls. Persist their call/result
   facts and execution state, but do not increment `metadata.toolCalls` or feed the synthetic batch
   to the no-progress guard.
5. Permit one automatic recovery provider round per run. If a second round is truncated while
   producing DeepChat-owned calls, settle it and finish with `max_tokens` instead of requesting a
   third round. Do not modify the user's `maxTokens` setting.
6. Mark other unresolved tool blocks from a `max_tokens` round as incomplete without fabricating a
   client tool result. Provider-owned calls remain display-only and are never locally settled.

## Compatibility And Failure Semantics

- Existing stream producers that omit execution ownership keep the current DeepChat-owned behavior.
- Plain-text `max_tokens`, normal `tool_use`, provider-owned tool lifecycles, and stored database
  formats remain compatible; no migration or user setting is introduced.
- Explicit provider-round limits, aborts, pending user input, and terminal tool-result fitting
  errors retain their existing priority. The current truncated batch is settled before a provider
  round limit prevents recovery.
- The rejection result uses the existing tool-result fitting path, so context budget failure remains
  a terminal error rather than an unbounded or malformed retry.
- Full provider-executed tool-result round-tripping is outside this issue; execution ownership only
  prevents DeepChat from taking over those calls and preserves results already emitted by providers.
- No GitHub issue is created or synchronized for this local change.

## Acceptance Criteria

1. No tool, permission precheck, or auto-approve review runs for a `max_tokens` tool batch.
2. Every rejected DeepChat-owned call receives an ordered error result and an error UI block marked
   with `toolCallSkippedReason: 'max_tokens'`.
3. Incomplete non-rejected tool blocks are errors marked with
   `toolCallIncompleteReason: 'max_tokens'` and do not create fake tool messages.
4. A first truncated tool batch can recover in one additional provider round; a second truncated
   batch is settled and terminates without a third request.
5. Rejected calls do not consume the 128-call execution budget or increment persisted tool-call
   accounting.
6. Rejected call/result pairs survive context rebuilding and Tape fact persistence.
7. Native, legacy, multiple, pending, provider-owned, abort, pending-input, and explicit-round-limit
   cases have deterministic regression coverage.

## Tasks

- [x] Refactor the loop and dispatch APIs around tool batch settlement.
- [x] Add per-call execution ownership to adapters and accumulation.
- [x] Implement atomic truncated-batch rejection and one-round recovery.
- [x] Add unit, context-rebuild, and deterministic eval coverage.
- [x] Run formatting, i18n, lint, type checking, targeted tests, and agent evals.
- [x] Review every staged commit for correctness, compatibility, side effects, and maintenance risk.

## Validation

```bash
pnpm exec vitest run --config vitest.config.ts \
  test/main/agent/deepchat/loop/deepChatLoopEngine.test.ts \
  test/main/agent/deepchat/runtime/accumulator.test.ts \
  test/main/agent/deepchat/runtime/dispatch.test.ts \
  test/main/agent/deepchat/runtime/process.test.ts \
  test/main/agent/deepchat/runtime/contextBuilder.test.ts \
  test/main/agent/acp/runtime/acpContentMapper.test.ts \
  test/main/provider/aiSdkStreamAdapter.test.ts \
  test/main/evals/nativeAgent/nativeAgentBehavior.eval.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:agent:eval
```

Validated on 2026-07-24: all eight targeted test files passed (273 tests), formatting and i18n
checks completed cleanly, lint and full type checking passed, and all 15 deterministic native Agent
eval scenarios passed.
