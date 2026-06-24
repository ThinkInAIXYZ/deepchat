# CUA Sidecar Cleanup On Quit Plan

## Approach

Add a `mcp-shutdown` before-quit lifecycle hook that runs soon after user-cancellable hooks and
before window/tray/floating/presenter teardown. The hook calls the existing `presenter.mcpPresenter.shutdown()`
so all running MCP clients, including plugin-owned CUA servers, follow the current `stopServer ->
McpClient.disconnect -> terminateProcessTree` cleanup path.

Keep `Presenter.destroy()`'s existing MCP shutdown call as a final fallback. Make
`McpPresenter.shutdown()` concurrency-safe so an early hook and final presenter teardown cannot stop
the same client at the same time.

## Affected Files

- `src/main/presenter/lifecyclePresenter/hooks/beforeQuit/mcpShutdownHook.ts`
- `src/main/presenter/lifecyclePresenter/hooks/index.ts`
- `src/main/presenter/mcpPresenter/index.ts`
- `test/main/presenter/lifecyclePresenter/hooks/beforeQuit/mcpShutdownHook.test.ts`
- `test/main/presenter/mcpPresenter.test.ts`

## Lifecycle Order

`builtinKnowledgeDestroyHook` remains first because it can cancel quit when there are pending
knowledge tasks. The MCP shutdown hook runs after that confirmation and before other teardown hooks,
so stdio sidecars get a chance to receive termination while the presenter graph is still intact.

## Compatibility

The change is generic for MCP servers, not CUA-specific. It preserves existing plugin shutdown and
presenter destruction behavior, and it does not kill unrelated processes outside DeepChat's MCP
client process trees.

## Test Strategy

- Unit-test the new lifecycle hook for successful shutdown, missing presenter, and swallowed/logged
  shutdown errors.
- Unit-test `McpPresenter.shutdown()` repeated and concurrent calls.
- Run focused tests for lifecycle hook and MCP presenter.
- Run repository-required `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
