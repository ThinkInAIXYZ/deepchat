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

## Manual Validation Notes

For a MiniMax-M2.7 agent session, inspect trace/log output rather than running automated test
suites:

- New session default `maxTokens` should be capped.
- Requests with tools should reserve tool schema tokens before selecting history.
- After a tool result, the next request should retain the assistant tool call and corresponding tool
  result while dropping older history first.
- A legacy response like `<function_call>{"function_call":...}` at end of stream should still parse
  if JSON is repairable.
