# Agent Cancellation and Code Cell Timeouts

## Context

[Issue #2221](https://github.com/ThinkInAIXYZ/deepchat/issues/2221) reports a Code Mode run that
stopped progressing and could not be stopped by the user. Its partial trace records a provider
429 followed by a scheduled retry; it does not identify the complete incident sequence.

Independent reproduction identifies two cancellation boundaries that require protection:

- A provider iterator can remain pending after the Run signal is aborted. Waiting for its next
  event or asynchronous cleanup must not prevent attempt settlement.
- An unresolved browser Promise can leave a YoBrowser CDP command and its activity waiting
  indefinitely unless both observe the tool cancellation signal.

Code cells already have a five-minute execution deadline. That default is useful, but a longer
operation must be able to request a longer cell lifetime without weakening user cancellation.

## Contract

### User Cancellation

- Deliver the Run signal to the provider immediately. The provider-attempt owner also interrupts
  its own iterator wait if the provider ignores that signal.
- Request iterator cleanup without waiting indefinitely after cancellation. Observe late
  rejections, discard late output, and record the attempt as aborted exactly once.
- Preserve usage observed before cancellation and existing no-replay rules for committed output.
- Browser tools observe cancellation while waiting and check the signal immediately before
  dispatch. A canceled readiness wait must not dispatch a CDP command later.
- Cancellation ends browser activity without projecting a late response into the canceled run.
  It does not claim to undo browser or external side effects already dispatched.
- Code cell startup and execution both observe cancellation. An abandoned utility process must
  be reclaimed even if it becomes ready after cancellation.
- Do not add a whole-run deadline or infer failure merely from a lack of output.

### Code Cell Execution Limit

- `run_code` accepts optional `timeout_ms`, an integer duration in milliseconds. Omitting it uses
  `300000` milliseconds, or five minutes. `code` and `description` remain the only required fields.
- The valid range is `1` through `2147483647`, the host timer's supported range. Invalid values fail
  before a utility process or tool dispatch starts.
- The Code Mode `exec` frontend accepts the same optional field in its first-line pragma, because
  both frontends share the same cell runtime.
- The limit covers one cell, including awaited subtools. It starts when the cell is attached and
  does not restart on yield, `wait`, or a permission continuation.
- The tool description, parameter description, and SDK prompt all instruct the model to omit the
  field for routine work and set a larger value only when the current operation is expected to
  exceed five minutes. A cell override does not extend a subtool's own timeout.
- User cancellation always takes precedence over a longer requested timeout. Existing source,
  output, concurrency, heartbeat, memory, startup, and abandoned-cell limits remain unchanged.

## Ownership and Scope

`DeepChatContextCoordinator` owns provider iterator cancellation and attempt provenance.
`AgentToolManager`, `YoBrowserToolHandler`, and the existing browser command path carry the tool
signal through dispatch and response handling. `ToolService` validates the public timeout input;
`RunCodeRuntimeManager` applies the selected cell deadline. Code Mode definitions and generated
SDK text expose the same contract.

This change does not modify provider retry budgets, add dependencies, introduce a new task
scheduler, change UI layout, automatically replay canceled work, or add an unlimited timeout mode.

## Acceptance Criteria

- Stopping a silent provider settles the attempt without needing another provider event or a
  cooperative iterator `return()`; late output does not start a tool or create another outcome.
- A normal long-running operation is not canceled merely because it is silent.
- Stopping a pending CDP call returns control and prevents delayed dispatch after readiness.
- An omitted cell timeout still expires at five minutes; an explicit longer timeout survives that
  boundary and expires at the requested duration.
- A cell with an extended timeout still stops promptly when the user cancels.
- Invalid timeout values do not dispatch work, and both model-facing frontends document the
  default, omission guidance, and extension semantics.

## Implementation and Validation

- [x] Provider and browser waits observe cancellation without requiring downstream cooperation.
- [x] Utility startup observes cancellation; both frontends accept the optional cell timeout.
- [x] The maintained Code Mode contract and model-facing instructions describe the same behavior.
- [x] Regression coverage protects cancellation, late completion, and timeout overrides.
- [x] Formatting, i18n, lint, type checks, and relevant test suites pass.

Validation uses Node 24.18.0 and pnpm 10.34.5:

- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck` pass.
- 407 main-process tests pass across 13 relevant suites: Code Mode, ToolService, browser tools,
  provider attempts and retries, stream processing, Run lifecycle, and abortable waits.
- All three ChatPage stop-request tests pass, covering duplicate requests, unsuccessful stop
  responses, and rejected stop requests.
- Fake-clock cases verify the five-minute default, a ten-minute override, and explicit
  cancellation of a provider silent for fifteen minutes and a CDP command silent for ten minutes.
  Browser integration cases use mocked Electron boundaries; no live provider credentials are used.
