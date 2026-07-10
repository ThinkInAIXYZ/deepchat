# Main Process Fatal Error Policy

Status: decision complete; implementation is intentionally deferred to `FTL-002`.

Runtime owner: the earliest main-process entry boundary in
[`src/main/index.ts`](../../../src/main/index.ts). Expected request and background-operation errors
remain owned by the Presenter, service, route, or job that starts the operation.

Audit source: [A-06](../../audits/2026-07-10-architecture-performance/02-architecture-findings.md#a-06-高可靠性已确认过度兜底-network-ux-handler-吞掉所有-fatal-exception).

GitHub issue sync: not requested; no GitHub issue was created.

## Plain-language decision

A failed request and a broken process are not the same thing.

- A request owner that receives a timeout, disconnected network, invalid response, or rejected
  operation handles that failure where it has enough context to retry, update state, return an
  error, or show a useful message. The app keeps running.
- An exception or rejection that reaches the process boundary has no remaining owner. At that point
  DeepChat cannot prove that its in-memory state is still consistent. DeepChat normalizes and records
  the failure synchronously, then calls `process.exit(1)` in `finally`.
- The process-level policy never decides recoverability by searching error text for words such as
  `ECONNRESET`, `Network Error`, or `fetch failed`. An unowned network-looking rejection is still
  fatal because the ownership contract has already failed.
- The first implementation does not automatically relaunch, start Crashpad, or enter a safe mode.
  Those features need product and privacy contracts that do not currently exist in this repository.

This is a fail-stop policy: a truly fatal error becomes visible instead of letting DeepChat continue
in an unknown state. It does not rely on Electron readiness, Electron application shutdown, Node's
default listener behavior, or another framework listener.

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

1. [`src/main/index.ts`](../../../src/main/index.ts) statically imports `appMain.ts` and then calls
   `startApp()`. ESM evaluates the complete static dependency graph before the entry body runs.
2. [`src/main/appMain.ts`](../../../src/main/appMain.ts) registers the two process listeners inside
   `startApp()`, before Electron readiness and Presenter construction but after every `appMain.ts`
   import has already evaluated. An import-time failure in that graph is outside the current custom
   logging boundary and receives only framework/Node behavior with no DeepChat termination guarantee.
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

Focused `ServerManager` tests distinguish regular, plugin-owned, and cancelled connection outcomes;
`ToolManager` code records tool-list failures and chooses between plugin status and global toast
surfaces. Together they provide representative owner evidence, not proof for every MCP or network
path. A process-level text classifier cannot reproduce these decisions.

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

The dependency's synchronous file transport does not report write success to its caller.
`File.writeLine()` catches `writeFileSync` failures and emits an internal error; the default logger
also catches transport exceptions and its `processInternalErrorFn()` is a no-op. A return from
`log.error()` therefore does not prove that bytes reached disk.

There is one startup edge: the module initializes `loggingEnabled` to false but temporarily sets the
file transport to `info` until `configInitHook` reads persisted configuration and calls
`setLoggingEnabled()`. A fatal policy cannot infer a persisted opt-in before that hook completes.
`FTL-002` must therefore treat "not loaded yet" as not opted in for its fatal record and skip the
file logger. It must not rely on the transport's temporary startup level as consent.

Therefore the fatal policy must not silently override the logging opt-out:

- when persisted opt-in is confirmed, the fatal terminator attempts the synchronous file logger;
- regardless of opt-in or the file logger's apparent success, the same preformatted record is also
  passed to `fs.writeSync(process.stderr.fd, ...)`;
- when logging is disabled, the policy must not call the file logger, force-create, or re-enable
  `main.log`;
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
- Node documents
  [`uncaughtExceptionMonitor`](https://nodejs.org/docs/latest-v24.x/api/process.html#event-uncaughtexceptionmonitor)
  for synchronous observation without changing whatever subsequent exception listeners do. Its
  presence does not force termination.
- [Electron `app` documentation](https://www.electronjs.org/docs/latest/api/app#appexitexitcode)
  distinguishes `app.quit()` (interceptable graceful lifecycle) from `app.exit()` (immediate exit
  without `before-quit` or `will-quit`) and documents that `app.relaunch()` does not itself exit.
- [Electron `crashReporter` documentation](https://www.electronjs.org/docs/latest/api/crash-reporter)
  says Crashpad must start early, cannot be disabled after startup, and stores reports locally even
  when upload is disabled.

These mechanisms are available, but availability alone is not a reason to enable all of them.

### Real Electron verification changed the selected mechanism

Two harness modes produced different results:

- `ELECTRON_RUN_AS_NODE=1` confirmed ordinary bundled Node 24.15.0 semantics: synchronous throw and
  unhandled rejection exited `1`; an immediate catch exited `0`; a `setImmediate` catch was too late.
- A real Electron 40.10.5 main-process harness already had a framework `uncaughtException` listener
  before application code ran. With only `uncaughtExceptionMonitor` added, a synchronous throw
  reached the monitor and then remained alive after the framework listener ran. Non-`Error`
  rejection and late catch only produced Electron main-process rejection warnings and also remained
  alive; neither reached the monitor or uncaught-exception path. An immediate catch produced no
  warning or fatal event.

Therefore run-as-Node evidence proves only Node semantics; it cannot represent Electron main-process
listener behavior. A monitor/default-exit design is invalid for DeepChat: a later framework listener
can consume a synchronous exception, while Electron's rejection handling may warn without promoting
the rejection to uncaught. `FTL-002` must explicitly terminate from DeepChat's first listeners for
both events.

## Intent assessment and conservative inference

The repository evidence decides the failure ownership boundary and proves that the current handler
overrides Node's fatal behavior. It does not document a product promise about automatic restart,
crash-dump retention, or safe mode.

`[INFERENCE]` The most conservative reversible product behavior is to stop once, add no recovery
mutation, and let the user explicitly reopen DeepChat. This avoids both continuing with unknown
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

"Before" means within the same event-loop turn. An immediately attached catch is owned; attaching a
catch after Node has classified the rejection as unhandled is not recovery. DeepChat's prepended
`unhandledRejection` listener terminates before a `setImmediate` late catch can make the application
safe again.

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

- an exception reaches the prepended `uncaughtException` listener;
- a promise remains unhandled long enough to reach the prepended `unhandledRejection` listener;
- an expected network or provider error reaches either boundary because no owner handled it.

Failure of normalization or either diagnostic sink does not create a new recovery branch. The fatal
terminator catches those failures and calls `process.exit(1)` from `finally`.

The fatal boundary does not inspect error messages, provider names, HTTP status, or network codes.
Those attributes can be logged for diagnosis, but they cannot downgrade the process outcome.

## Final mechanism decisions

| Mechanism | Decision | Reason |
| --- | --- | --- |
| Request-owner handling | Adopt | Only the initiating domain knows whether to retry, degrade, update status, return an error, or notify the user. |
| Global network string classifier | Remove | Error text cannot prove recoverability or identify the correct UX/state owner. |
| `process.prependListener('uncaughtException', ...)` | Adopt | DeepChat runs before the observed Electron framework listener and cannot return to it in a fatal state. |
| `process.prependListener('unhandledRejection', ...)` | Adopt | DeepChat handles Error and non-Error reasons directly, independent of Node flags or framework listeners. |
| Shared fatal terminator | Adopt | Both listeners and bootstrap import/start errors use one normalization and synchronous dual-sink path. |
| Controlled termination | Adopt `process.exit(1)` in `finally` | It works before Electron readiness and runs even when normalization or either sink fails. |
| `uncaughtExceptionMonitor` plus default exit | Reject | Real Electron verification showed a pre-existing framework listener consumed the later exception and the process survived. |
| `app.exit(1)` fatal path | Reject | It adds an Electron dependency to the earliest boundary and is unnecessary when `process.exit(1)` is available before `app` readiness. |
| `app.quit()` for fatal errors | Reject | It is asynchronous/interceptable in this repository and can execute or be cancelled by stateful shutdown hooks. |
| Automatic `app.relaunch()` | Reject for `FTL-002` | The same startup defect can repeat indefinitely; no external supervisor, crash-loop counter, or one-shot recovery marker exists. |
| `crashReporter.start()` | Reject for `FTL-002` | It was deliberately removed, is irreversible for the running process, stores dumps, and lacks consent, retention, upload, and support workflows. |
| Safe mode | Reject for `FTL-002` | There is no defined safe subset, activation rule, exit rule, persistence model, or recovery UI. A name without those contracts would be a second ambiguous fallback. |
| Renderer fatal toast | Reject | Renderer/window infrastructure may not exist or may share inconsistent state; fatal handling must not depend on IPC. |
| `render-process-gone` / `child-process-gone` | Out of scope | These are separate failure domains and need their own recovery decisions. |

The fatal terminator must be synchronous. It normalizes the reason, formats one record,
conditionally attempts the file logger only after persisted opt-in, always attempts
`fs.writeSync(process.stderr.fd, record)`, catches normalization/sink failures, and invokes
`process.exit(1)` from `finally`. It must not await telemetry, call an Electron API, run Presenter
cleanup, publish IPC, show a dialog, retry the failed operation, mutate user data, or schedule a
timer.

Registration is idempotent: repeated calls in the same module instance do not add another DeepChat
listener. Both listeners are installed with `prependListener` so the DeepChat handler remains first
even when Electron already registered a framework listener. No general error framework or listener
registry is introduced.

A reentrancy state machine is unnecessary. The terminator performs no asynchronous work, catches its
own bounded diagnostic failures, and production `process.exit(1)` does not return. Tests model that
`never` behavior by throwing a dedicated exit sentinel; they must not use a returning exit spy that
creates a production-impossible second pass.

## Acceptance criteria

- Expected network failure handled by its request or background-operation owner updates the owner's
  result/status and does not reach either DeepChat fatal listener.
- An `Error('ECONNRESET')` that is uncaught or remains unhandled is fatal. Its message no longer
  grants a process-wide recovery exception.
- After handler installation, every uncaught main-process exception uses the shared terminator,
  emits one preformatted record with origin `uncaughtException`, and calls `process.exit(1)`.
- After handler installation, every unhandled main-process rejection, including a non-`Error`
  reason, uses the same terminator with origin `unhandledRejection` and calls `process.exit(1)`.
- An immediately attached rejection handler does not invoke the fatal terminator; a handler attached
  after the unhandled event is too late and does not prevent the exit.
- Repeated installation adds no duplicate DeepChat listener. Exactly one DeepChat handler is at
  index `0` of each event's listener list immediately after installation and after normal startup;
  Electron/framework listeners may remain behind it.
- The file logger is called only after persisted logging opt-in is confirmed. Its success or failure
  does not suppress the unconditional `fs.writeSync` attempt to `stderr`.
- Failure of normalization, the file logger, `fs.writeSync`, or all three still reaches the
  `process.exit(1)` call in `finally` and cannot resume normal work.
- Fatal termination does not call `publishDeepchatEvent`, `app.exit()`, `app.quit()`,
  `app.relaunch()`, lifecycle hooks, Presenters, or renderer APIs.
- With logging enabled and a writable disposable log path, the fatal entry reaches `main.log` before
  `process.exit(1)`; an unwritable path must not produce a false disk-success assertion or change
  termination.
- With logging disabled, the fatal terminator does not enable or call application file logging; the
  record is attempted on `stderr` before `process.exit(1)`.
- Before persisted logging configuration has loaded, the file sink remains unregistered rather
  than treating the logger's temporary startup transport level as consent.
- The handlers are installed in the entry before dynamically importing `appMain.ts`. The guarantee
  is explicitly "after handler installation": failures while evaluating the tiny helper itself
  remain outside application observation and receive only framework/Node behavior with no DeepChat
  guarantee.
- A synthetic `appMain.ts` import-time failure and a synthetic synchronous `startApp()` failure are
  explicitly forwarded to the same terminator and exit `1`.
- Existing owner-published `notification.error` events remain available for MCP, deep-link, and other
  domain UX; the event contract is not deleted with the global classifier.
- No automatic relaunch, crash dump collection, safe-mode state, settings migration, or renderer UI
  is added in `FTL-002`.

## Fix plan for `FTL-002`

### 1. Install the terminator before the application import graph

Add one tiny main-process module that statically imports only Node built-ins needed to format and
write the fatal record. It must not import Electron, `electron-log`, `appMain.ts`, a Presenter, or a
shared module that imports Electron.

The module owns only three small operations:

- an idempotent installer that prepends one DeepChat handler for `uncaughtException` and one for
  `unhandledRejection`;
- the shared synchronous fatal terminator;
- a nullable file-writer sink, initially `null`, with a narrow setter.

`configInitHook` registers the existing logger writer only after persisted `loggingEnabled: true` is
known; false resets the sink to `null`. This late injection avoids importing the logging/Electron
graph before the handlers exist. Settings changes already restart the application, so there is no
separate live-toggle protocol to invent.

Change `src/main/index.ts` to:

1. install the two prepended fatal listeners;
2. dynamically import `appMain.ts`;
3. call `startApp()` from the fulfilled import.

The dynamic import rejection branch explicitly passes its reason to the shared terminator with a
`bootstrap-import` origin. The fulfilled branch wraps the synchronous `startApp()` call and passes a
throw to the same terminator with a `bootstrap-start` origin. Neither branch converts failure into a
normal result or waits for the process event machinery to classify it.

This is the honest boundary: the helper cannot observe failure while its own tiny module is being
evaluated, but after installation it owns the entire `appMain.ts` dependency graph and all later
startup/runtime work. Acceptance statements must say "after handler installation," not "every
possible bootstrap instruction."

### 2. Keep fatal recording synchronous and independent from termination

Normalize the input and format the fatal record exactly once per terminator call. The record includes
timestamp, PID, origin, error name/code/message, and stack when available. Send that same string to
both eligible sinks:

- only after `configInitHook` has confirmed persisted logging opt-in, attempt the existing file
  logger; the temporary startup transport level is not consent;
- in all cases, independently attempt `fs.writeSync(process.stderr.fd, record)` even when the file
  logger returned without throwing;
- catch normalization and each sink failure, then call `process.exit(1)` from `finally`.

The file logger call is best effort because `electron-log` 5.4.4 swallows file transport errors. A
successful return is not recorded as proof of disk persistence. Do not add a dedicated always-on
fatal file merely to obtain an acknowledgement.

The helper has no retry, timeout, cleanup callback, or Electron API. Production `process.exit(1)` is
the terminal operation and does not return.

### 3. Remove the fail-open listeners and process-level network UX

Delete both current process listeners, the network-fragment list, and the `notification.error`
publication from `appMain.ts`. The only replacements are the two earliest prepended listeners in the
minimal helper. Do not delete the typed notification contract or renderer listener because domain
owners still use them.

### 4. Verify and repair only real unowned operation boundaries

Run focused tests with explicit fail-stop behavior enabled. If an expected network or cancellation
path now becomes unhandled, fix the initiating owner by attaching an immediate error path and
preserving its domain state. Do not add broad catches around unrelated subsystems and do not restore
global text matching.

The first inventory covers main bootstrap callbacks and detached operations that initiate I/O.
Existing MCP connection tests are only a representative owner example: they prove that
`ServerManager` records connection state and selects a notification surface. They do not prove that
every network call in DeepChat is owned. Self-contained async methods that already catch internally
do not need duplicate catches solely to silence static search results.

### 5. Prove real event-loop semantics outside the test runner

Use child-process fixtures so a fatal test cannot kill Vitest. The authoritative harness launches a
real Electron 40.10.5 main process. Run-as-Node may remain as a contrast test, but its result cannot
satisfy an Electron acceptance criterion.

The harness records exit code, `origin`, sink output, and listener counts for:

- synchronous throw after handler installation;
- rejected `Error` and rejected non-`Error` reason;
- an immediately attached catch, which exits `0` with no DeepChat fatal record;
- a catch attached through `setImmediate`, which is already fatal;
- a message containing `ECONNRESET`, which remains fatal when unowned;
- repeated installer calls, proving one DeepChat handler per event;
- `process.listeners(event)[0]` identity immediately after installation and after normal startup,
  proving each DeepChat handler stays ahead of observed framework listeners;
- exactly one DeepChat fatal record and `process.exit(1)` invocation for each fatal case;
- a file logger that returns success, throws, and points at an unwritable path; every case still
  attempts `fs.writeSync` and reaches `process.exit(1)`;
- a synthetic module-evaluation failure in the dynamic `appMain.ts` position;
- a synthetic synchronous startup failure after that module resolves.

Fixtures use disposable directories and are never exposed as production debug routes.

### 6. Validate the deliberate loss of graceful cleanup

Explicit `process.exit(1)` termination is immediate. It does not run `LifecycleManager` before-quit
hooks or `Presenter.destroy()`. `FTL-002` explicitly accepts skipping these normal cleanup paths:

| Owner | Normal cleanup that fatal termination skips | Risk to verify |
| --- | --- | --- |
| Cron | `cronJobs.stop()` and scheduler utility-host stop | Scheduler host or its descendants may survive. |
| Plugin | `pluginPresenter.shutdown()` | Plugin-owned MCP processes and policy registrations are not explicitly released. |
| MCP | `mcpPresenter.shutdown()` | Stdio servers may survive; SSE/HTTP connections close only through process loss. |
| ACP | `acpCleanupHook`, provider cleanup, init terminal and PTY cleanup | ACP child/PTY trees may become orphaned. |
| Memory | `memoryPresenter.dispose()` | In-flight consolidation/embedding and vector stores are not drained or closed. |
| SQLite | `sqlitePresenter.close()` | The connection closes through process death, not an orderly close call. |
| Watchers | `workspacePresenter.destroy()` and watcher-handle shutdown | Utility watcher hosts or native watchers may outlive main briefly. |
| Remote control | `RemoteControlPresenter.destroy()` | Bot runtimes, sockets, auth waits, and login windows are not explicitly stopped. |

This is not permission to assume the OS cleans every descendant correctly. On macOS, Windows, and
Linux, launch a disposable app profile with representative process trees: cron or watcher utility
host, ordinary/plugin MCP stdio child, ACP or PTY child, and a background shell with a grandchild.
Record PID plus a unique command marker before the fatal event. After main exits, poll for a bounded
five seconds and assert that no marked PID, descendant, listening port, or PTY remains; use process
identity/command markers rather than PID alone to avoid PID-reuse false results.

A reproducible persistent orphan is blocking for `FTL-002`. Create a local process-tree governance
issue spec and make its fix a merge dependency; GitHub sync still follows the repository's explicit
approval rule. Do not call lifecycle hooks from the fatal terminator as a local workaround. A helper
that is already documented to self-terminate and disappears within the bounded window can be
recorded as passing evidence rather than treated as an orphan.

### 7. Validate SQLite restart integrity

Use a copy of a disposable real DeepChat database in WAL mode. In isolated processes, trigger fatal
termination (a) after an uncommitted write has begun and (b) immediately after a committed write.
Reopen through the real SQLite initialization path and verify:

- `PRAGMA quick_check` and `PRAGMA integrity_check` succeed;
- required schemas and representative rows remain readable;
- the uncommitted row is absent and the committed row is present;
- a new transaction can write and commit after restart;
- schema/version initialization does not enter repair or reset unexpectedly.

Any repeatable corruption, unreadable database, or failed post-restart write blocks `FTL-002`.
Graceful fatal cleanup is not an acceptable patch because the process state is already untrusted;
the database/write boundary must be repaired or isolated before merge.

### 8. Run repository and release-relevant gates

Run focused terminator, entry, logging, network-owner, process-tree, and database tests; then run the
repository gates and compare the full suite with the recorded BASE-001 failure set. Any new unhandled
rejection is a blocking regression, not a test warning to suppress.

## Ordered task checklist

### Decision (`FTL-001`)

- [x] Trace current process handler, typed notification, renderer toast, and lifecycle paths.
- [x] Inspect handler history and distinguish deliberate network UX from unproven fatal recovery.
- [x] Inspect current owner-handled network examples and tests.
- [x] Inspect Electron 40.10.5 / Node 24 fatal, exit, relaunch, and crash-reporting mechanisms.
- [x] Decide logging, controlled exit, relaunch, crash reporter, and safe-mode behavior.
- [x] Record compatibility, validation, rollback, rejected alternatives, and residual risk.

### Implementation (`FTL-002`)

- [ ] Add an isolated real Electron harness; keep run-as-Node only as a contrast fixture.
- [ ] Add the minimal normalizer/terminator with independent file and `stderr` sinks and
      `process.exit(1)` in `finally`.
- [ ] Idempotently prepend one DeepChat listener for each fatal process event before importing
      `appMain.ts`.
- [ ] Remove global network string classification and process-level toast publication.
- [ ] Remove the later process listeners currently registered inside `startApp()`.
- [ ] Explicitly forward synthetic `appMain.ts` import and startup failures to the same terminator.
- [ ] Prove a representative owner-handled network failure remains non-fatal.
- [ ] Repair only observed unowned I/O launch boundaries, if tests expose any.
- [ ] Run macOS, Windows, and Linux marked child-process tree smoke checks.
- [ ] Run fatal-during-SQLite-write restart integrity/readability checks.
- [ ] Block merge and link process governance work if a persistent orphan is reproduced.
- [ ] Run focused tests, typecheck, format, i18n, lint, and the full test suite.
- [ ] Perform packaged/dev smoke validation for abrupt exit and normal owner-handled network UX.
- [ ] Update this checklist and the unified audit delivery ledger with PR and validation evidence.

## Validation plan

### Automated

- Normalizer, opt-in file sink, unconditional `fs.writeSync`, `finally` exit, installer idempotence,
  and sink-failure unit tests.
- Isolated real Electron event-loop harnesses for immediate/late catch, Error/non-Error reasons,
  handler order/count, import/startup forwarding, and exit codes; run-as-Node is contrast evidence.
- Existing MCP server-manager and tool-manager tests as scoped owner examples, not whole-network
  proof.
- Existing typed event contract and renderer listener tests.
- Disposable SQLite fatal-write/restart integrity tests.
- Cross-platform marked child-process tree smoke tests.
- `pnpm run typecheck`
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- --reporter=dot`, compared with BASE-001 rather than treated in isolation.

### Manual smoke

Use a disposable user-data directory and synthetic test build; never trigger a fatal error in a
developer's real profile.

1. Trigger a synthetic app-module import failure, then a post-startup synchronous failure. Confirm
   bootstrap/process origin, the preformatted `stderr` record, `process.exit(1)`, and no Electron
   exit/relaunch call.
2. With logging enabled, repeat against a writable and unwritable disposable log path. Confirm a
   writable path receives the record; both cases independently attempt `fs.writeSync` and call
   `process.exit(1)`.
3. Repeat with logging disabled and before configuration loads. Confirm the file logger is not called
   and both cases still attempt `stderr` before `process.exit(1)`.
4. Trigger a request-owner network failure, such as an unreachable disposable MCP endpoint. Confirm
   owner status/error UX and that the app remains running. This proves only that selected owner.
5. Trigger the synthetic process-level path with a message containing `ECONNRESET`. Confirm it exits;
   this proves text no longer changes fatality.
6. Run the marked PID/tree matrix and SQLite restart checks described above on disposable profiles.

The synthetic fatal hook must remain test-only and must not ship as a production debug route.

## Compatibility and user-visible impact

### Compatibility

- No IPC, route, event payload, stored data, configuration, or renderer contract changes are needed.
- The existing `notification.error` contract remains intact for domain owners.
- The terminator uses only Node built-ins available in Electron 40.10.5 and does not depend on
  Electron readiness, `app`, Node's default fatal policy, or listener behavior outside DeepChat.
- Existing explicit restart and updater flows keep their current `relaunch` behavior; this policy
  applies only to uncaught main-process failures.

### User-visible impact

- Normal owner-handled network and provider failures continue to show domain-appropriate errors and
  keep the app running.
- A previously swallowed process-level failure now closes DeepChat abruptly. The latest in-memory or
  in-flight work may be lost. Cron, plugin, MCP, ACP, memory, SQLite, watcher, and remote-control
  cleanup hooks do not run; the required process-tree and database checks gate this accepted trade-off.
- DeepChat does not reopen automatically, so a deterministic startup fault cannot create an
  unattended restart loop.
- Users who disabled logging do not silently acquire a new local crash archive.

### Engineering benefit

- Fatal state can no longer masquerade as a successful recovery.
- Network UX gains a real owner that can keep status, retry, and caller outcomes consistent.
- Tests can distinguish expected operational failures from process invariant failures.
- One small DeepChat terminator owns bootstrap and process-event fatal paths; it adds no Electron
  lifecycle or general recovery framework.
- The change is small, has no migration, and can be reverted independently from future crash-recovery
  product work.

## Rollback

`FTL-002` has no schema or data migration. The safe rollback depends on the failing part:

- if formatting or optional file logging regresses, retain both prepended handlers and
  `process.exit(1)`, then reduce diagnostics to the fixed `fs.writeSync` path;
- do not remove the explicit terminator and rely on Node default: real Electron verification proved
  that a framework listener can keep the process alive;
- if rollout exposes a frequent unowned network rejection, repair that operation owner and add a
  regression test;
- a full emergency revert may restore the previous application behavior, but it knowingly restores
  A-06 fail-open semantics and must carry a blocking follow-up. Do not add a network-message exemption
  inside the terminator.

Do not retain a runtime feature flag after validation. A feature flag would create two process
semantics and make failures environment-dependent without solving ownership.

## Rejected alternatives

### Keep the current handlers and rethrow non-network errors

Rejected because message matching still treats text as a recovery contract, and throwing from an
`uncaughtException` handler creates a second exceptional path that is harder to test and diagnose.

### Use `app.quit()` for graceful fatal shutdown

Rejected because this repository intercepts and can cancel `before-quit`; fatal handling must not
trust the normal lifecycle or wait for asynchronous hooks.

### Call `app.exit(1)` from custom fatal listeners

Rejected because the earliest fatal boundary should not import Electron or wait for `app` readiness.
`process.exit(1)` is available in the built-in-only helper and gives the same immediate, no-cleanup
semantics without another dependency.

### Use `uncaughtExceptionMonitor` and Node's default exit

Rejected by real Electron 40.10.5 evidence. Electron had already installed an
`uncaughtException` listener; after the monitor returned, that listener consumed a synchronous throw
without terminating. Non-`Error` rejection and late catch only emitted Electron main-process
rejection warnings and remained alive; they did not reach the monitor or uncaught-exception path.
`ELECTRON_RUN_AS_NODE=1` did exit, which proves why run-as-Node cannot stand in for a real Electron
main-process harness.

### Add a first-event-wins guard

Rejected because production `process.exit(1)` in `finally` does not return. A guard would model a
second pass that only exists when a test incorrectly mocks `process.exit` as returning. Installer
idempotence is still required and is separate from fatal-event reentrancy.

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
- Abrupt exit bypasses every graceful cleanup path listed above and can lose the latest in-flight
  operation. Cross-platform orphan and SQLite integrity checks reduce, but cannot eliminate, platform
  and third-party child-process risk.
- The handlers are not literally the first instructions: their tiny helper and Node built-in imports
  must evaluate before installation. Failures there still receive framework/Node behavior but no
  DeepChat guarantee or formatted record.
- A future dependency that prepends another fatal listener after DeepChat could change ordering. The
  real Electron harness checks identity at index `0` after normal startup, and that assertion must
  remain a regression gate.
- `electron-log` does not acknowledge file transport success. Even with opt-in, only the writable-path
  harness proves the tested case; `stderr` remains the unconditional diagnostic attempt.
- A native main-process crash can occur before JavaScript handlers run. Crashpad or an external
  supervisor would be needed for that class of failure and remains outside `FTL-002`.
- Renderer and utility-process crashes need separate policies using Electron's process-gone events.
- A next-launch explanation, crash-loop detector, external relaunch supervisor, or safe mode may be
  designed later only with explicit UX, privacy, retention, activation, and recovery contracts.

## Open questions

None. The implementation decisions required by `FTL-002` are fixed above.
