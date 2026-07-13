# MCP Tool Cancellation

## Issue

Stopping a DeepChat Agent turn does not cancel an in-flight MCP tool request. The runtime passes an
`AbortSignal` into `ToolPresenter.callTool`, but the MCP branch drops it before calling
`McpPresenter`. The MCP SDK request can therefore continue until the server responds or the SDK's
default request timeout expires.

## Impact

- Agent Stop can remain blocked behind an MCP tool call.
- A remote MCP operation can continue after its parent generation has been cancelled.
- The runtime cannot reliably prevent another provider round until the outstanding tool call
  settles.

## Root Cause

- `ToolPresenter.callTool` forwards the signal to built-in agent tools but omits it when routing to
  `McpPresenter`.
- The concrete `McpPresenter`, `ToolManager`, and `McpClient` call paths do not accept or forward a
  tool-call abort signal.
- `McpClient` invokes the SDK `client.callTool` without request options, despite the SDK supporting
  an `AbortSignal`.

## Fix Plan

- Forward the existing optional `AbortSignal` through ToolPresenter, McpPresenter, ToolManager, and
  McpClient.
- Reject pre-aborted calls before connecting to or invoking the MCP SDK client.
- Pass only `{ signal }` to the SDK request so its existing default timeout remains unchanged.
- Check or race the signal around connection, tool-definition refresh, argument preparation, and
  CUA helper calls so cancellation is not delayed before the final SDK request.
- Observe the underlying Promise before an abort race so a late rejection after cancellation cannot
  become an unhandled rejection.
- Treat abort failures as cancellation: do not run MCP session recovery, invalidate tool caches, or
  retry the operation. Preserve the current handling of all non-abort failures.
- Classify a tool failure as parent cancellation only when the run signal is aborted; an
  `AbortError` name alone remains a tool-local failure.
- Once tool execution returns a result, commit that result and its Tape facts before settling a
  concurrently requested parent cancellation.
- Add focused forwarding and MCP client cancellation tests.

## Constraints

- No renderer, IPC, route, database, or persisted schema changes.
- No automatic retries or execution idempotency policy changes.
- No new tool timeout setting; retain the MCP SDK default request timeout.

## Tasks

- [x] Document the issue and implementation constraints.
- [x] Forward `AbortSignal` from ToolPresenter to McpPresenter.
- [x] Forward `AbortSignal` through ToolManager to McpClient.
- [x] Pass the signal into the MCP SDK request and preserve abort semantics.
- [x] Propagate cancellation through MCP preflight and helper awaits.
- [x] Keep the public `IToolPresenter` option contract aligned with the implementation.
- [x] Preserve returned tool results across late parent cancellation.
- [x] Keep tool-local `AbortError` failures inside the tool batch while the run signal is active.
- [x] Add focused regression tests.
- [ ] Run final unified tests, formatting, i18n validation, lint, typecheck, and build.

## Validation

- [x] ToolPresenter forwards the caller's exact signal to the MCP branch.
- [x] ToolManager forwards the caller's exact signal to the selected MCP client.
- [x] A pre-aborted MCP client call never invokes the SDK.
- [x] Aborting an in-flight MCP client call rejects promptly.
- [x] Abort failures do not trigger session recovery or tool-cache invalidation.
- [x] Existing non-abort MCP failure behavior remains covered and unchanged.
- [x] A native Agent turn cancellation reaches an in-flight MCP call through the real ToolPresenter.
- [x] A tool result returned as cancellation arrives is persisted before the run settles aborted.
- [x] A tool-local `AbortError` becomes a tool failure when the parent run remains active.
- [x] Abort winning a helper race consumes a later source rejection without an
  `unhandledRejection`.
- [x] Standalone media cancellation consumes iterator teardown failures without an
  `unhandledRejection`.

Final validation commands are recorded after the unified repository gate run.

## GitHub

No GitHub issue sync was requested.
