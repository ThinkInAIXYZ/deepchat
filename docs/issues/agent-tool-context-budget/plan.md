# Agent Tool Context Budget Plan

## Diagnosis

The core issue is request budgeting, not MiniMax alone. MiniMax exposes the issue quickly because
its model metadata advertises a very large output limit and reasoning-capable tool calls. DeepChat
was using that limit as the session default and reserving it on every turn, while the tool schema
payload was not included in initial history selection.

Function-call failures have a second path: models that do not use native tools fall back to a text
protocol appended to the latest user message. That protocol is verbose and brittle, so it both
consumes more context and fails on small formatting deviations.

## First Increment

- Cap agent-loop default max output tokens to a practical default and never reserve more than half
  of the context window for output.
- Reserve tool definition tokens when building the initial/resume context.
- Fit request messages again immediately before each provider call.
- Preserve the active tool continuation tail during trimming.
- Resolve an effective per-request max output value from the fitted request and tool-schema budget.
- Make legacy function-call parsing tolerant of code fences and a missing closing tag at end of
  stream.

## Follow-Up Work

- Add request trace telemetry for message tokens, tool tokens, system tokens, output reserve, and
  final effective output cap.
- Add a reasoning retention budget: keep provider-required continuation metadata, but summarize or
  omit old reasoning text once it is no longer needed.
- Add provider capability overrides for services whose model metadata says `tool_call: true` but
  whose endpoint rejects native tool payloads.
- Add a compact tool-schema mode for legacy function-call fallback.
- Add UI diagnostics for "context budget pressure" and suggested remediation.

## Second Increment

- Add a provider-call preflight helper that estimates messages, tool definitions, the safety margin,
  and the temporary effective output cap before every loop request.
- Reserve a 256-token safety margin for normal model context windows so off-by-one provider
  validators do not reject otherwise fitted requests.
- When preflight pressure would reduce a normal request below 4000 output tokens, run an internal
  recovery pass before the provider call: compact persisted old turns when enabled, then rely on the
  request fitter to trim older in-memory messages while preserving the active tail.
- Write recovered messages back into the active request array so later tool-continuation loops use
  the same compacted/trimmed history.
- Keep generation settings unchanged; only the provider call's `maxTokens` argument is reduced.
- Use the same safety-adjusted budget in tool-output fitting so continuation turns do not inject
  tool results that leave the next request over the provider limit.
- Report zero effective output tokens when a fitted request still cannot fit at all, and fail before
  calling the provider.

## Review Hardening

- Treat non-positive context windows as unknown/unbounded during request preflight, matching the
  existing fitting and max-token helpers.
- Judge tool-output continuation fitting against the next preflight-fitted request shape, so older
  history that would be trimmed before the next provider call does not falsely fail the tool result.

## Retry Overflow Hardening

- Route unfittable provider-call preflight results through the existing context-pressure recovery
  path once before failing.
- Keep the latest user/system/tool payload protected; recovery may compact persisted history,
  replace stale summary-bearing system prompt text, trim older in-memory history, and reduce only
  the per-call output cap.
- When recovery still cannot fit, fail before rate-limit wait/provider streaming with a budget
  diagnostic that includes usable context, estimated input, tool-schema reserve, requested/effective
  output, and remaining output room.

## Manual Validation Notes

For a MiniMax-M2.7 agent session, inspect trace/log output rather than running automated test
suites:

- New session default `maxTokens` should be capped.
- Requests with tools should reserve tool schema tokens before selecting history.
- After a tool result, the next request should retain the assistant tool call and corresponding tool
  result while dropping older history first.
- A legacy response like `<function_call>{"function_call":...}` at end of stream should still parse
  if JSON is repairable.
