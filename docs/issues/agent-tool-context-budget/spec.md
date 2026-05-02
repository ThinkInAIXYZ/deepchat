# Agent Tool Context Budget And Function Call Reliability

> Status: Draft
> Date: 2026-04-27

## Background

DeepChat agent sessions can fail after only a few tool calls on MiniMax and other providers. The
same class of issue appears outside ACP, so the failure is not isolated to ACP transport.

Observed risk points:

- Agent default `maxTokens` can inherit very large provider output limits, for example 131072.
- Context selection reserves output tokens but did not reserve request-level tool schemas.
- Provider loop iterations after tool execution relied on tool-output fitting, but did not preflight
  the whole request before sending it.
- Legacy text-based function calls depend on exact `<function_call>...</function_call>` output.
  Small provider formatting deviations can turn a valid intent into plain assistant text.
- Interleaved reasoning models may preserve reasoning content across tool calls, increasing history
  size much faster than normal chat.

## Goals

- Make the agent loop treat tools as first-class context budget consumers.
- Avoid pathological default output reservations for agent sessions.
- Preflight every provider request, not just the initial user turn.
- Improve legacy function-call parsing tolerance without changing the public tool protocol.
- Keep the first increment provider-agnostic and applicable beyond MiniMax.

## Non-Goals

- Do not replace the AI SDK provider runtime.
- Do not redesign ACP.
- Do not remove reasoning continuation support.
- Do not change the renderer UI in this increment.

## User Stories

1. As a user, I want tool-heavy sessions to continue beyond a few tool calls without context window
   failures caused by avoidable budgeting errors.
2. As a provider adapter, I want each request to account for messages, tool schemas, and output
   reserve before it is sent.
3. As a legacy function-call model, I want minor formatting differences to still be parsed when the
   intended tool call is recoverable.

## Acceptance Criteria

- New agent sessions do not default to provider-scale output limits above the agent loop cap.
- Initial user turn and resume turn reserve tokens for tool definitions.
- Every provider-loop iteration fits messages to the effective request budget before sending.
- Tool-continuation turns preserve the assistant tool-call message and matching tool results when
  trimming older context.
- Legacy parser accepts complete function-call tags, a trailing unclosed function-call tag, and JSON
  wrapped in Markdown fences.
- No ACP-specific behavior is required for the first increment.
