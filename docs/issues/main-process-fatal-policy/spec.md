# Main Process Fatal Error Policy

Status: decision complete; implementation is intentionally deferred to `FTL-002`.

Runtime owner: main-process bootstrap in
[`src/main/appMain.ts`](../../../src/main/appMain.ts). Expected request and background-operation
errors remain owned by the Presenter, service, route, or job that starts the operation.

Audit source: [A-06](../../audits/2026-07-10-architecture-performance/02-architecture-findings.md#a-06-高可靠性已确认过度兜底-network-ux-handler-吞掉所有-fatal-exception).

GitHub issue sync: not requested; no GitHub issue was created.

## Plain-language decision

A failed request and a broken process are not the same thing.

- A request owner that receives a timeout, disconnected network, invalid response, or rejected
  operation handles that failure where it has enough context to retry, update state, return an
  error, or show a useful message. The app keeps running.
- An exception or rejection that reaches the process-level handler has no remaining owner. At that
  point DeepChat cannot prove that its in-memory state is still consistent. It records the fatal
  event synchronously and terminates the main process with exit code `1`.
- The process-level policy never decides recoverability by searching error text for words such as
  `ECONNRESET`, `Network Error`, or `fetch failed`. An unowned network-looking rejection is still
  fatal because the ownership contract has already failed.
- The first implementation does not automatically relaunch, start Crashpad, or enter a safe mode.
  Those features need product and privacy contracts that do not currently exist in this repository.

This is a fail-stop policy: a truly fatal error becomes visible instead of letting DeepChat continue
in an unknown state.

## Issue

[`startApp()`](../../../src/main/appMain.ts) currently installs both an `uncaughtException` listener
and an `unhandledRejection` listener. Both listeners log and then return. The exception listener also
looks for six network-related text fragments and publishes a global toast for matches.

Installing an `uncaughtException` listener replaces Node's default behavior. Returning from that
listener therefore keeps the main process alive after an exception escaped every normal owner.
Installing an `unhandledRejection` listener and returning has the same practical fail-open result for
Promise failures. The process may continue with partially updated maps, queues, presenters, database
work, or lifecycle state.

The network toast is useful. Its placement at the process boundary is not: the boundary has neither
the failed operation's intent nor enough information to decide whether retry, fallback, cancellation,
or user notification is correct.

## Impact today

- Programming errors and invariant failures can be logged and silently treated as recoverable.
- A network-looking string receives special treatment even when the actual failure is a programming
  error whose message happens to contain that string.
- A genuine network failure can be reduced to a toast without its request owner updating status,
  retry state, or the caller's result.
- The handler can run before `WindowPresenter` exists. In that case
  [`publishDeepchatEvent()`](../../../src/main/routes/publishDeepchatEvent.ts) warns and drops the
  notification, while still keeping the failed process alive.
- No focused test currently protects the intended process outcome for either event.

## Code and history evidence

### Current call chain

1. [`src/main/index.ts`](../../../src/main/index.ts) calls `startApp()`.
2. [`src/main/appMain.ts`](../../../src/main/appMain.ts) registers the two process listeners before
   Electron readiness and Presenter construction.
3. Only the `uncaughtException` path whose message contains a configured network fragment publishes
   `notification.error`; every other path only logs.
4. [`publishDeepchatEvent()`](../../../src/main/routes/publishDeepchatEvent.ts) validates the typed
   event and broadcasts it if `WindowPresenter` has already been attached.
5. [`WindowClient.onNotificationError()`](../../../src/renderer/api/WindowClient.ts) and
   [`useAppIpcRuntime()`](../../../src/renderer/src/composables/useAppIpcRuntime.ts) deliver the event
   to the renderer toast queue.

The notification transport is reusable infrastructure. It does not make the process handler the
owner of the failed operation.

### Historical intent

The behavior was first added to `src/main/index.ts` by `fc1405ac` (`feat: show network error`) on
2025-12-15. Commit `746e5c69` later created `src/main/appMain.ts` and copied the same handlers into the
new bootstrap file. Commit `d780d1a1` wrapped bootstrap work in the idempotent `startApp()` function
without changing the handlers' semantics. Commit `32bacc5f` only migrated the toast transport to the
typed event system.

This refines the audit wording: `746e5c69` is when the behavior entered `appMain.ts`, but
`fc1405ac` is when the repository first acquired the process-wide behavior.

The original commit title, code comment, string matching, and toast publication all support one
intent: make network failures visible without a blocking dialog. No reviewed spec, test, or commit
message found in this history defines all main-process exceptions as recoverable.

Conclusion: the network UX was deliberate; allowing every other fatal exception to continue was an
unproven scope expansion, not a documented resilience policy.

### Existing request owners already handle operational failures

The codebase already contains the intended local pattern:

- [`ServerManager`](../../../src/main/presenter/mcpPresenter/serverManager.ts) stores MCP connection
  failures on the affected server, lets OAuth handle auth-specific errors, and publishes a localized
  notification for ordinary user-owned MCP servers.
- [`ToolManager`](../../../src/main/presenter/mcpPresenter/toolManager.ts) catches a failed tool-list
  request, records the server error, decides whether the plugin status surface or global toast owns
  the UX, and continues to the next client.
- [`DeeplinkPresenter`](../../../src/main/presenter/deeplinkPresenter/index.ts) catches parsing and
  execution failures at the deep-link boundary; provider import errors use a typed notification.
- [`McpClient`](../../../src/main/presenter/mcpPresenter/mcpClient.ts) has a cleanup-only settlement
  branch whose silent catch does not replace observation of the original connection promise. The
  audit already records this as intentional design I-09.

Focused MCP tests already distinguish regular server notifications, plugin status ownership, and
cancelled startup. These are owner decisions; a process-level text classifier cannot reproduce them.

### Lifecycle and restart behavior

[`LifecycleManager`](../../../src/main/presenter/lifecyclePresenter/index.ts) intercepts
`before-quit`, runs asynchronous hooks, and can cancel a normal shutdown. This is correct for a user
quit, but it is unsafe as a fatal cleanup path because the exception may have damaged the same
Presenter or lifecycle state used by those hooks.

DeepChat already uses `app.relaunch()` followed by `app.exit()` for explicit, healthy restart flows
in [`DevicePresenter`](../../../src/main/presenter/devicePresenter/index.ts) and
[`UpgradePresenter`](../../../src/main/presenter/upgradePresenter/index.ts). Those flows start from a
known state and are not evidence that automatic fatal relaunch is safe.

### Logging contract

[`src/shared/logger.ts`](../../../src/shared/logger.ts) points `electron-log` at
`userData/logs/main.log`. The file transport is synchronous by default in the installed
`electron-log` 5.4.4 and is disabled when the user's `loggingEnabled` setting is false. The setting
defaults to false, and the settings copy says disabling logging stops collecting application logs.

There is one startup edge: the module initializes `loggingEnabled` to false but temporarily sets the
file transport to `info` until `configInitHook` reads persisted configuration and calls
`setLoggingEnabled()`. A fatal policy cannot infer a persisted opt-in before that hook completes.
`FTL-002` must therefore treat "not loaded yet" as not opted in for its fatal record and use only the
fallback `stderr` sink. It must not rely on the transport's temporary startup level as consent.

Therefore the fatal policy must not silently override the logging opt-out:

- when logging is enabled, the fatal record must be written synchronously before termination;
- when logging is disabled, the fatal record must still reach `stderr`, but the policy must not
  force-create or re-enable `main.log`.
- before the setting has loaded, the fatal record follows the disabled behavior; an early fatal may
  be less diagnosable, but it does not guess the user's privacy choice.

This deliberately narrows the roadmap's shorthand that a fatal error should always be "written to
disk." Unconditional disk persistence would conflict with the repository's current privacy contract.

### Crash reporting and safe mode do not currently exist

Crash reporting briefly existed in 2025:

- `3becdb46` added `crashReporter.start({ uploadToServer: false })`;
- `555e62c8` put startup behind the logging preference;
- `5c86c507` adjusted its company identifier;
- `cb43391c` removed the integration about four hours after that final adjustment, three days after
  its introduction, with `fix: cancel crash report`.

There is no current Crashpad startup, upload endpoint, retention policy, consent surface, crash-dump
management UI, or test. There is also no main-process safe-mode argument, persisted crash-loop
counter, documented set of features to disable, or recovery UI. Repository search found neither a
`render-process-gone` nor a `child-process-gone` policy; those Electron events concern other process
types and do not replace a main-process JavaScript fatal policy.

### Runtime mechanisms verified

The repository pins [Electron 40.10.5](https://releases.electronjs.org/release/v40.10.5), which
bundles Node 24.15.0.

- [Node 24 process documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#event-uncaughtexception)
  says the default uncaught-exception behavior is to print to `stderr` and exit with code `1`, and
  warns that normal operation must not resume from an undefined state.
- The same documentation says unhandled rejection mode `throw` is the default and an unhandled
  rejection is raised as an uncaught exception when it is not otherwise handled.
- [Electron `app` documentation](https://www.electronjs.org/docs/latest/api/app#appexitexitcode)
  distinguishes `app.quit()` (interceptable graceful lifecycle) from `app.exit()` (immediate exit
  without `before-quit` or `will-quit`) and documents that `app.relaunch()` does not itself exit.
- [Electron `crashReporter` documentation](https://www.electronjs.org/docs/latest/api/crash-reporter)
  says Crashpad must start early, cannot be disabled after startup, and stores reports locally even
  when upload is disabled.

These mechanisms are available, but availability alone is not a reason to enable all of them.

## Intent assessment and conservative inference

The repository evidence decides the failure ownership boundary and proves that the current handler
overrides Node's fatal behavior. It does not document a product promise about automatic restart,
crash-dump retention, or safe mode.

`[INFERENCE]` The most conservative reversible product behavior is to stop once, leave persisted
data untouched, and let the user explicitly reopen DeepChat. This avoids both continuing with unknown
state and entering an automatic crash loop. It is reversible by one implementation PR and does not
add stored schema, settings, or migration state.

`[INFERENCE]` An abrupt close is preferable to displaying a renderer toast from a process whose
state is already untrusted. A later recovery experience may add a next-launch explanation, but that
requires a separately reviewed minimal crash marker and privacy contract.

## Error ownership contract

### Expected operational error

An expected operational error is a failure the initiating owner can explain without assuming that
the whole process is corrupt. Examples include DNS failure, connection reset, timeout, HTTP failure,
provider rejection, authentication failure, cancellation, unavailable optional capability, or an
invalid user-supplied payload.

The initiating owner must choose one or more explicit outcomes:

- return or propagate a typed error to its caller;
- retry under that operation's bounded retry contract;
- update domain status and preserve enough context for a later retry;
- use a documented fallback;
- publish a user-facing error through the domain's chosen surface;
- record and intentionally ignore a cleanup-only failure.

### Owner-handled rejection

A rejection is owner-handled only when its promise has an error path attached before it can become a
process-level unhandled rejection, and that path makes an explicit domain decision.

The following count as owned:

- an awaited call whose rejection propagates to a route, Presenter, job, or request boundary that
  handles or returns it;
- a fire-and-forget operation with an immediately attached `.catch(...)` that updates status,
  reports, retries, degrades, or deliberately records cleanup failure;
- a cleanup-only settlement branch when the original promise is still returned or awaited elsewhere.

The following do not count as owned:

- relying on the process handler to recognize the error text;
- attaching a catch after the rejection has already been unhandled for an event-loop turn;
- logging from a detached promise and then losing the operation's state or caller outcome;
- `.catch(() => undefined)` on the only observable operation promise without a documented
  cleanup/optional-failure contract.

### Fatal process error

Any of the following is fatal:

- an exception reaches `uncaughtException`;
- a promise reaches `unhandledRejection`;
- an expected network or provider error reaches either process event because no owner handled it;
- the fatal-recording path itself fails.

The fatal boundary does not inspect error messages, provider names, HTTP status, or network codes.
Those attributes can be logged for diagnosis, but they cannot downgrade the process outcome.

## Final mechanism decisions

| Mechanism | Decision | Reason |
| --- | --- | --- |
| Request-owner handling | Adopt | Only the initiating domain knows whether to retry, degrade, update status, return an error, or notify the user. |
| Global network string classifier | Remove | Error text cannot prove recoverability or identify the correct UX/state owner. |
| `uncaughtException` | Fatal | Perform synchronous recording, then immediately stop with exit code `1`; never return to normal work. |
| `unhandledRejection` | Fatal | Reaching this event means the promise had no timely owner. Network-looking reasons receive no exemption. |
| Controlled exit | Adopt `app.exit(1)` | It is immediate and bypasses lifecycle hooks that may depend on damaged state. The call must run in `finally` so logging failure cannot restore fail-open behavior. |
| `app.quit()` for fatal errors | Reject | It is asynchronous/interceptable in this repository and can execute or be cancelled by stateful shutdown hooks. |
| Automatic `app.relaunch()` | Reject for `FTL-002` | The same startup defect can repeat indefinitely; no external supervisor, crash-loop counter, or one-shot recovery marker exists. |
| `crashReporter.start()` | Reject for `FTL-002` | It was deliberately removed, is irreversible for the running process, stores dumps, and lacks consent, retention, upload, and support workflows. |
| Safe mode | Reject for `FTL-002` | There is no defined safe subset, activation rule, exit rule, persistence model, or recovery UI. A name without those contracts would be a second ambiguous fallback. |
| Renderer fatal toast | Reject | Renderer/window infrastructure may not exist or may share inconsistent state; fatal handling must not depend on IPC. |
| `render-process-gone` / `child-process-gone` | Out of scope | These are separate failure domains and need their own recovery decisions. |

The controlled exit handler must be synchronous. It may write to the existing logger and a
last-resort `stderr` sink, but it must not await telemetry, run Presenter cleanup, publish IPC, show a
dialog, retry the failed operation, mutate user data, or schedule a timer.

## Acceptance criteria

- Expected network failure handled by its request or background-operation owner updates the owner's
  result/status and does not invoke the fatal policy.
- An `Error('ECONNRESET')` that reaches `uncaughtException` or `unhandledRejection` is fatal. Its
  message no longer grants a process-wide recovery exception.
- Every uncaught main-process exception is synchronously recorded and invokes `app.exit(1)` exactly
  once.
- Every unhandled main-process rejection, including a non-`Error` reason, is normalized,
  synchronously recorded, and invokes `app.exit(1)` exactly once.
- A failure in the primary logging sink still reaches the fallback `stderr` path and cannot prevent
  `app.exit(1)`.
- Fatal handling does not call `publishDeepchatEvent`, `app.quit()`, `app.relaunch()`, lifecycle
  hooks, Presenters, or renderer APIs.
- With logging enabled, the fatal entry reaches the configured `main.log` synchronously before exit.
- With logging disabled, the handler does not enable or create application file logging; diagnostic
  output is limited to `stderr` and the platform's normal process-exit behavior.
- Before persisted logging configuration has loaded, the handler follows the disabled path rather
  than treating the logger's temporary startup transport level as consent.
- Process listeners are installed once by `startApp()` and do not accumulate across repeated calls.
- Existing owner-published `notification.error` events remain available for MCP, deep-link, and other
  domain UX; the event contract is not deleted with the global classifier.
- No automatic relaunch, crash dump collection, safe-mode state, settings migration, or renderer UI
  is added in `FTL-002`.

## Fix plan for `FTL-002`

### 1. Isolate the fatal policy without creating a recovery framework

Add one small main-process helper under `src/main/lib/` that owns only:

- normalization of `Error` and non-`Error` reasons;
- synchronous fatal recording with a fallback `stderr` write;
- use of an explicit read-only logging opt-in state; add a getter beside `setLoggingEnabled()` rather
  than inferring consent from the temporary file transport level;
- a first-event-wins guard;
- the `app.exit(1)` call in `finally`;
- registration of the two process listeners.

Keep error classification, retry, UI notification, lifecycle cleanup, relaunch, and persistence out
of this helper. `startApp()` calls it once under the existing `appStarted` guard.

### 2. Remove process-level network UX behavior

Delete the network-fragment list and the `notification.error` publication from `appMain.ts`. Do not
delete the typed notification contract or renderer listener because domain owners still use them.

### 3. Verify and repair only real unowned operation boundaries

Run focused tests with the new fatal behavior enabled. If an expected network or cancellation path
now becomes unhandled, fix the initiating owner by attaching an immediate error path and preserving
its domain state. Do not add broad catches around unrelated subsystems and do not restore global text
matching.

The first inventory should cover main bootstrap callbacks and detached operations that initiate I/O,
then the existing MCP connection/tool-list paths used as the representative network-owner contract.
Self-contained async methods that already catch internally do not need duplicate catches solely to
silence static search results.

### 4. Add failure-first tests

Add focused main-process tests that capture the registered listeners through injected/fake process
and Electron app dependencies. Cover:

- uncaught programming error;
- unhandled rejected `Error`;
- unhandled non-`Error` reason;
- unhandled `ECONNRESET` reason;
- owner-handled `ECONNRESET` that remains non-fatal;
- primary logger failure;
- logging enabled, logging disabled, and logging not-yet-loaded behavior;
- repeated/reentrant fatal delivery;
- repeat `startApp()` registration;
- absence of notification, quit, relaunch, and lifecycle calls.

Extend the existing MCP server-manager test with a representative network code if needed to prove
that its owner records state and chooses the correct notification surface.

### 5. Validate exit and logging behavior

Use an isolated test harness so the test runner itself is not terminated. Assert exit code `1`, log
before exit, and no pending async cleanup. Exercise logging-enabled and logging-disabled cases without
writing to the developer's real `userData` directory.

Run the repository gates and compare the full suite with the recorded BASE-001 failure set. Any new
unhandled rejection is a blocking regression, not a test warning to suppress.

## Ordered task checklist

### Decision (`FTL-001`)

- [x] Trace current process handler, typed notification, renderer toast, and lifecycle paths.
- [x] Inspect handler history and distinguish deliberate network UX from unproven fatal recovery.
- [x] Inspect current owner-handled network examples and tests.
- [x] Inspect Electron 40.10.5 / Node 24 fatal, exit, relaunch, and crash-reporting mechanisms.
- [x] Decide logging, controlled exit, relaunch, crash reporter, and safe-mode behavior.
- [x] Record compatibility, validation, rollback, rejected alternatives, and residual risk.

### Implementation (`FTL-002`)

- [ ] Add focused failing tests for uncaught exception and unhandled rejection outcomes.
- [ ] Add the narrow synchronous fatal-policy helper with first-event-wins behavior.
- [ ] Register the policy once from `startApp()`.
- [ ] Remove global network string classification and process-level toast publication.
- [ ] Prove a representative owner-handled network failure remains non-fatal.
- [ ] Repair only observed unowned I/O launch boundaries, if tests expose any.
- [ ] Run focused tests, typecheck, format, i18n, lint, and the full test suite.
- [ ] Perform packaged/dev smoke validation for abrupt exit and normal network failure UX.
- [ ] Update this checklist and the unified audit delivery ledger with PR and validation evidence.

## Validation plan

### Automated

- Focused fatal-policy tests for both process events and all failure paths listed above.
- Existing MCP server-manager and tool-manager tests.
- Existing typed event contract and renderer listener tests.
- `pnpm run typecheck`
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- --reporter=dot`, compared with BASE-001 rather than treated in isolation.

### Manual smoke

Use a disposable user-data directory and synthetic test build; never trigger a fatal error in a
developer's real profile.

1. With logging enabled, trigger a synthetic uncaught main-process error after startup. Confirm one
   fatal entry, immediate process exit, exit code `1`, no relaunch, and no network toast.
2. Repeat with logging disabled. Confirm no application log file is enabled by the fatal path and the
   process still exits with code `1` after `stderr` output.
3. Trigger a request-owner network failure, such as an unreachable disposable MCP endpoint. Confirm
   owner status/error UX and that the app remains running.
4. Trigger the synthetic process-level path with a message containing `ECONNRESET`. Confirm it exits;
   this proves text no longer changes fatality.

The synthetic fatal hook must remain test-only and must not ship as a production debug route.

## Compatibility and user-visible impact

### Compatibility

- No IPC, route, event payload, stored data, configuration, or renderer contract changes are needed.
- The existing `notification.error` contract remains intact for domain owners.
- The policy depends only on Electron 40.10.5 / Node 24 behavior already pinned by the repository.
- Existing explicit restart and updater flows keep their current `relaunch` behavior; this policy
  applies only to uncaught main-process failures.

### User-visible impact

- Normal owner-handled network and provider failures continue to show domain-appropriate errors and
  keep the app running.
- A previously swallowed process-level failure now closes DeepChat abruptly. The latest in-memory or
  in-flight work may be lost, but persisted data is not intentionally mutated by the fatal handler.
- DeepChat does not reopen automatically, so a deterministic startup fault cannot create an
  unattended restart loop.
- Users who disabled logging do not silently acquire a new local crash archive.

### Engineering benefit

- Fatal state can no longer masquerade as a successful recovery.
- Network UX gains a real owner that can keep status, retry, and caller outcomes consistent.
- Tests can distinguish expected operational failures from process invariant failures.
- The change is small, has no migration, and can be reverted independently from future crash-recovery
  product work.

## Rollback

`FTL-002` has no schema or data migration. Roll back by reverting its implementation PR.

If rollout exposes a frequent unowned network rejection, the preferred response is to repair that
operation owner and add a regression test. Restoring the global message classifier is permitted only
as a full emergency revert of the PR, not as a new exception inside the fatal helper.

Do not retain a runtime feature flag after validation. A feature flag would create two process
semantics and make failures environment-dependent without solving ownership.

## Rejected alternatives

### Keep the current handlers and rethrow non-network errors

Rejected because message matching still treats text as a recovery contract, and throwing from an
`uncaughtException` handler creates a second exceptional path that is harder to test and diagnose.

### Use `app.quit()` for graceful fatal shutdown

Rejected because this repository intercepts and can cancel `before-quit`; fatal handling must not
trust the normal lifecycle or wait for asynchronous hooks.

### Automatically relaunch once

Rejected because "once" requires durable crash-loop identity, argument handling, stale-marker
cleanup, and a definition of success. None exists today. Adding only `app.relaunch()` risks a loop
without providing recovery.

### Start Crashpad locally with upload disabled

Rejected because local-only still stores crash dumps, cannot be disabled after startup, and does not
provide consent, retention, discovery, deletion, or support ingestion. The repository's previous
integration was explicitly removed.

### Add safe mode together with the fatal fix

Rejected because no safe subset has been defined. Disabling arbitrary providers, plugins, MCP,
memory, GPU, or databases without a product contract could hide the root cause or cause a different
failure. Safe mode is a separate feature, not a fallback label.

### Always write a dedicated fatal file

Rejected because logging defaults off and the settings contract says disabling logging stops log
collection. A dedicated always-on file would change that privacy promise and need its own retention
and disclosure design.

### Show a final renderer toast or blocking dialog

Rejected because fatal errors can occur before windows exist and because IPC, Presenter, or renderer
state may be part of the damaged graph. A toast also cannot make an immediate exit understandable in
the time available.

## Residual risks and follow-ups

- Existing detached async call sites may rely on the current fail-open behavior. The full test suite
  and dev smoke can expose some, but not every provider/network combination. New occurrences must be
  fixed at their owner.
- With logging disabled, support receives no persistent JavaScript stack from this policy. This is an
  intentional privacy trade-off, not an implementation omission.
- Abrupt exit bypasses graceful hooks and can lose the latest in-flight operation. Continuing in an
  unknown state is judged riskier.
- A native main-process crash can occur before JavaScript handlers run. Crashpad or an external
  supervisor would be needed for that class of failure and remains outside `FTL-002`.
- Renderer and utility-process crashes need separate policies using Electron's process-gone events.
- A next-launch explanation, crash-loop detector, external relaunch supervisor, or safe mode may be
  designed later only with explicit UX, privacy, retention, activation, and recovery contracts.

## Open questions

None. The implementation decisions required by `FTL-002` are fixed above.
