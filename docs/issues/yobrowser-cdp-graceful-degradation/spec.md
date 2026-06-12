# YoBrowser CDP Graceful Degradation

## Problem

GitHub issue #1734 reports that a running agent task can lose browser control when
the user closes the right-side YoBrowser panel mid-session. The browser view is
detached or hidden, but the agent still attempts later `cdp_send` calls for DOM
inspection, scripted interaction, or screenshot verification. Today those calls
surface as generic initialization failures or blocked CDP failures, which gives
the model too little context to decide whether it should reopen the browser,
inspect status, skip browser-dependent verification, or ask the user for help.

## User Story

As a user running a browser-assisted agent task, I need CDP failures caused by an
unavailable YoBrowser session to be reported as meaningful, recoverable tool
errors so the agent can adapt its next step instead of stalling the task.

As an agent, when `cdp_send` cannot execute because the session browser is
closed, detached, hidden, destroyed, or otherwise not ready, I need a compact
error payload that explains the browser state and names the safe recovery tools
available in the same context.

## Acceptance Criteria

- `cdp_send` failures caused by an unavailable session browser are delivered to
  the agent as tool errors, not as silent hangs or terminal application crashes.
- The tool error is meaningful to both the model and logs. It includes a stable
  error code, the attempted CDP method, the conversation/session id, the current
  YoBrowser status when available, whether the failure is recoverable, and a
  short recovery hint.
- The tool error explicitly tells the agent that it may call
  `get_browser_status` to inspect state and `load_url` to recreate or reopen the
  session browser when it still has a target URL. If there is no target URL, the
  hint allows the agent to ask the user to reopen the panel or continue without
  browser verification.
- The agent runtime preserves the failure as an errored tool result so follow-up
  model context can see that `cdp_send` failed, while still allowing the model to
  choose a recovery strategy.
- Existing successful `cdp_send`, `load_url`, and `get_browser_status` behavior
  remains unchanged.
- Non-browser-availability CDP errors, malformed arguments, missing
  conversation ids, permission denials, and user cancellation keep their existing
  error semantics unless they can be safely wrapped with the same recoverable
  browser-unavailable code.
- The implementation avoids leaking Electron stack traces, internal object
  dumps, filesystem paths, or private page content in the agent-visible error.
- Unit coverage verifies the unavailable-browser case, the still-successful CDP
  case, and runtime propagation of the structured recoverable error into the
  tool result.

## Non-goals

- Do not automatically reattach or reopen the YoBrowser panel in this first
  increment.
- Do not add a new renderer-main browser state synchronization channel unless
  implementation proves the existing status APIs are insufficient.
- Do not change the public names of `cdp_send`, `load_url`, or
  `get_browser_status`.
- Do not retry CDP commands automatically. The model should decide whether to
  retry, reopen, skip, or ask the user based on the tool error and conversation
  context.
- Do not introduce UI copy or renderer layout changes for this issue.

## Constraints

- The fix should follow the existing Presenter and agent tool routing patterns:
  YoBrowser-specific readiness detection belongs near
  `YoBrowserPresenter`/`YoBrowserToolHandler`, while tool-result propagation
  belongs in the agent tool path.
- Tool outputs are part of the model context, so the error payload must be small,
  deterministic, and easy to parse even when prefixed by the runtime's standard
  error formatting.
- `get_browser_status` already exposes the primary session state
  (`initialized`, `visible`, `loading`, and page information), so the first
  implementation should prefer reusing that state over adding broader event
  synchronization.

## Proposed Agent-Visible Error Shape

The exact TypeScript representation can be refined during implementation, but
the agent-visible content should be equivalent to:

```json
{
  "ok": false,
  "error": {
    "code": "yobrowser_unavailable",
    "message": "YoBrowser is not available for this session, so the CDP command was not run.",
    "recoverable": true,
    "sessionId": "<conversation id>",
    "method": "Page.captureScreenshot",
    "browserStatus": {
      "initialized": false,
      "visible": false,
      "loading": false,
      "page": null
    },
    "suggestedNextActions": [
      "Call get_browser_status to inspect the current browser state.",
      "Call load_url with the target URL to recreate or reopen the session browser.",
      "If no URL is available, ask the user to reopen the browser panel or continue without browser verification."
    ]
  }
}
```

## Business Value

This turns a brittle browser-control failure into an agent-readable recovery
signal. The immediate user impact is fewer stalled browser-assisted tasks after
the panel is closed, while the implementation stays smaller and safer than
automatic recovery because it does not mutate browser visibility on behalf of
the model.
