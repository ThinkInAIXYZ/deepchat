# Plan

## Source Review

- `YoBrowserPresenter.updateSessionBrowserBounds()` marks a session invisible
  when the renderer reports `visible=false` or zero-size bounds.
- `YoBrowserPresenter.getBrowserStatus()` already returns enough state for an
  agent-facing recovery hint: initialized, page, navigation flags, visible, and
  loading.
- `YoBrowserToolHandler.callTool()` currently checks `getBrowserPage()` before
  `cdp_send` and throws a generic initialization error when no page is available.
- `AgentToolManager` currently wraps YoBrowser handler success as `{ content }`;
  thrown errors are caught later in the agent runtime and become errored tool
  results with text like `Error: ...`.
- `ToolPresenter` can preserve agent tool failures through `rawData.isError` and
  `createAgentToolErrorResult`, which is a better fit for recoverable,
  structured YoBrowser failures than an untyped exception string.

## Design

- Add a small YoBrowser recoverable error contract for browser availability
  failures. The contract should include:
  - `code: "yobrowser_unavailable"`
  - `recoverable: true`
  - `sessionId`
  - attempted `method`
  - sanitized `browserStatus` from `getBrowserStatus(sessionId)` when available
  - concise `suggestedNextActions`
- Detect unavailable-browser states before CDP execution in
  `YoBrowserToolHandler.callTool("cdp_send", ...)`:
  - missing conversation/session id remains a validation error
  - missing or destroyed page maps to the recoverable YoBrowser error
  - a known not-ready browser/CDP error that means the browser cannot accept CDP
    commands maps to the same recoverable YoBrowser error
  - ordinary CDP protocol errors remain ordinary tool errors
- Propagate the recoverable YoBrowser error as an errored agent tool result with
  structured content instead of only throwing a generic exception. Prefer the
  existing `AgentToolCallResult`/`rawData.isError` path so the runtime marks the
  block as an error while preserving the model-readable JSON content.
- Keep the agent-visible payload compact. Do not include stack traces, Electron
  internals, full DOM content, screenshots, or local paths.
- Update the YoBrowser tool system prompt only if needed to make the recovery
  path explicit. If changed, keep it brief and tool-oriented:
  `If cdp_send reports yobrowser_unavailable, inspect get_browser_status and use
  load_url to reopen the browser when you have a URL.`

## Event Flow

1. User closes or hides the YoBrowser panel while an agent task is running.
2. Renderer bounds update reaches `YoBrowserPresenter.updateSessionBrowserBounds`
   with `visible=false` or an unusable size.
3. YoBrowser session state becomes not visible or no longer CDP-ready.
4. The agent later calls `cdp_send`.
5. `YoBrowserToolHandler` detects the unavailable browser state and builds the
   recoverable YoBrowser error payload.
6. Agent tool routing returns that payload as an errored tool result.
7. The agent runtime records the tool call as failed but injects the structured
   error content into the next model context.
8. The model can call `get_browser_status`, call `load_url` with an available
   URL, ask the user to reopen the panel, or continue without browser
   verification.

## Compatibility

- No storage migration is required.
- No tool name, IPC route, or renderer event contract changes are required for
  the first increment.
- Existing successful YoBrowser automation remains source-compatible.
- Existing generic failure logs can stay, but the agent-visible error should no
  longer depend on raw exception text for the browser-unavailable case.

## Test Strategy

- Update `test/main/presenter/browser/YoBrowserToolHandler.test.ts` to verify
  that `cdp_send` on a missing browser returns or raises the recoverable
  YoBrowser error contract expected by the chosen propagation path.
- Add or update agent tool manager / tool presenter coverage to verify
  recoverable YoBrowser errors become `rawData.isError === true` with structured
  model-visible content.
- Add or update agent runtime dispatch coverage to verify the tool block remains
  errored and the response text contains the stable `yobrowser_unavailable`
  signal.
- Keep existing tests for successful `cdp_send` and `load_url` behavior passing.

## Risks

- If the recoverable error is returned as normal content without `isError`, the
  UI and runtime may mark the tool as successful. The implementation should use
  the existing errored tool-result path.
- If the error payload is too verbose, it may waste context or obscure the
  recovery instruction. Keep only state needed for model recovery.
- If all CDP exceptions are treated as browser unavailable, real page/script/CDP
  protocol mistakes could become misleading recovery prompts. Limit mapping to
  missing page, destroyed page, detached/closed state, and known not-ready
  failures.
