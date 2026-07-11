# Fatal Process Tree Governance

Status: `PTG-001` specification complete; `PTG-H0` direct-child helper limits merged in PR #1932
(`4889309b`); `PTG-M1` static launcher inventory guard implemented; `PTG-M2A` adds the reusable
mechanism-neutral real Electron harness and retained macOS development-fixture evidence. Runtime
owner fixtures beyond the neutral marked tree, descendant containment, Windows/Linux evidence, and
the packaged native matrix are not implemented. This issue remains a blocking dependency for
`FTL-002`.

Runtime owners: every main-process domain that launches an OS process, plus utility hosts that
launch or retain resources on behalf of the main process.

Observed by: branch-local `FTL-002` real Electron evidence. The harness and fatal implementation are
not present on this baseline branch, so this document records the measured result without linking to
an absent test file.

GitHub issue sync: not requested; no GitHub issue was created.

## Plain-language summary

DeepChat must stop after an unowned fatal main-process error, but stopping the main process is not
the same as stopping everything it launched.

The `FTL-002` branch proved this on macOS: Electron stopped the background-exec utility host, while
the detached shell and its grandchild remained alive after five seconds. Encoding that orphan as an
expected test result would hide the defect. The acceptance test must require all marked processes to
disappear, and `FTL-002` remains blocked until it does.

This issue does not choose a watchdog, native binding, or platform API in advance. First inventory
the launchers, then measure parent loss on macOS, Windows, and Linux, and only then compare the
smallest mechanisms that satisfy the same contract.

## Confirmed issue

The fatal main-process policy requires immediate `process.exit(1)` and deliberately cannot trust
Presenter or lifecycle cleanup after process integrity is unknown. Branch-local `FTL-002` evidence
used Electron 40.10.5 and the production background-exec launch path:

1. the real Electron main process started the background-exec utility host;
2. `BackgroundExecSessionManager.start()` launched a detached shell and a uniquely marked Node
   grandchild;
3. the main process recorded a synthetic fatal error and called `process.exit(1)`;
4. the utility host exited, but the marked shell and grandchild were still alive after a bounded
   five-second poll;
5. the harness killed marked survivors in `finally`, so the test itself left no orphan.

Observed macOS result: `[utility host exited, shell alive, grandchild alive]`.

The same branch ran a narrower exploratory parent-loss probe. `PTG-M2A` now reproduces that probe
and retains the exact macOS result. The utility registered `parentPort` `close`, `disconnect`,
`exit`, and `error` probes plus process `disconnect`, `beforeExit`, `exit`, `SIGTERM`, `SIGHUP`, and
`SIGINT` probes before main-process exit. Electron 40.10.5 documents only the `message` event and
`postMessage()` on `parentPort`; the four lifecycle event names are deliberately recorded as
runtime EventEmitter probes with `documentedByElectron: false`, not represented as supported API.
The main side observed utility exit code `0`, but none of the registered utility-side callbacks
recorded an event; the shell and grandchild were reparented and remained alive. This is reusable
macOS development-fixture evidence, but it is not enough to eliminate a cross-platform candidate.
It says nothing about Windows or Linux.

## Existing code truth

- [`BackgroundExecSessionManager.start()`](../../../src/main/lib/agentRuntime/backgroundExecSessionManager.ts)
  sets `detached: true` on non-Windows platforms and allows an arbitrary command to create further
  descendants.
- The manager terminates a tree only through explicit timeout, kill, removal, conversation cleanup,
  or shutdown. [`terminateProcessTree()`](../../../src/main/lib/agentRuntime/processTree.ts) uses a
  POSIX process-group signal or Windows `taskkill /T /F`, but it still needs living DeepChat code to
  invoke it.
- The background-exec proxy asks the utility manager to shut down before killing the utility host
  during healthy shutdown. Fatal `process.exit(1)` intentionally skips that path.
- Background-exec, file-watcher, and cron utility hosts register cleanup from `beforeExit` or an
  explicit message. Node documents that `beforeExit` is not emitted for explicit termination. The
  exploratory macOS probe was consistent with that limitation, but PTG must preserve a reproducible
  fixture before using the result to reject an implementation candidate.
- Electron documents utility `parentPort` with only `message` and `postMessage`; it does not promise
  a close or disconnect event. Node's `process.disconnect` contract applies to a Node child-process
  IPC channel, not Electron's Chromium Services utility-process MessagePort.
- Removing `detached: true` is not a portable fix. Node documents that children may continue after
  the parent exits even when they are not detached, while `detached` creates an independent process
  group/session on non-Windows platforms.

Primary mechanism references:

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron parentPort](https://www.electronjs.org/docs/latest/api/parent-port)
- [Node child process detached behavior](https://nodejs.org/docs/latest-v24.x/api/child_process.html#optionsdetached)
- [Node process beforeExit, disconnect, and exit events](https://nodejs.org/docs/latest-v24.x/api/process.html#process-events)

## Launcher inventory

This is a source inventory, not proof of runtime containment. Each row still needs a marked
parent-loss smoke. `Arbitrary tree` means the launched command can create descendants that DeepChat
does not control individually.

### Required runtime matrix

| Owner and launch site | Direct child / possible descendants | Normal cleanup today | Parent-loss status |
| --- | --- | --- | --- |
| Background exec in [`backgroundExecSessionManager.ts`](../../../src/main/lib/agentRuntime/backgroundExecSessionManager.ts) | Main → Electron utility host → detached shell → arbitrary tree | Proxy `shutdown`; manager timeout, kill, remove, conversation cleanup; `terminateProcessTree` | macOS failure confirmed for shell and grandchild |
| Agent exec fallback in [`agentBashHandler.ts`](../../../src/main/presenter/toolPresenter/agentTools/agentBashHandler.ts) | Main → detached shell → arbitrary tree when no conversation owner is supplied | Timeout calls `terminateProcessTree`; production conversation-owned calls normally use background exec | Unmeasured; must either prove unreachable in production or test it |
| Skill execution in [`skillExecutionService.ts`](../../../src/main/presenter/skillPresenter/skillExecutionService.ts) | Foreground: main → runtime/shell → arbitrary tree. Background: background-exec path | Foreground timeout signals only the direct child; background uses manager cleanup | Unmeasured |
| Hook command in [`hooksNotifications/index.ts`](../../../src/main/presenter/hooksNotifications/index.ts) | Main → shell command → arbitrary tree | Timeout calls `child.kill('SIGKILL')` on the direct child | Unmeasured |
| Ordinary MCP stdio in [`mcpClient.ts`](../../../src/main/presenter/mcpPresenter/mcpClient.ts) | Main → configured executable → arbitrary MCP descendants | Transport close plus `terminateProcessTree`; shutdown has a bounded force-terminate fallback | Unmeasured |
| Plugin-owned MCP stdio registered by [`pluginPresenter/index.ts`](../../../src/main/presenter/pluginPresenter/index.ts) | Same MCP launcher, but executable and lifetime originate from a plugin manifest | Plugin shutdown delegates to MCP stop; common MCP tree termination | Unmeasured; separate fixture is required because ownership and configuration differ |
| ACP agent in [`acpProcessManager.ts`](../../../src/main/presenter/llmProviderPresenter/acp/acpProcessManager.ts) | Main → agent executable → arbitrary provider descendants | Eager shutdown uses `taskkill` on Windows or asynchronous `pkill` plus direct SIGTERM on POSIX, then release | Unmeasured; existing POSIX descendant kill is not awaited |
| ACP protocol terminal in [`acpTerminalManager.ts`](../../../src/main/presenter/llmProviderPresenter/acp/acpTerminalManager.ts) | Main → native PTY child → shell/tool descendants | Release and shutdown call `IPty.kill()` | Unmeasured |
| ACP installation terminal in [`acpInitHelper.ts`](../../../src/main/presenter/configPresenter/acpInitHelper.ts) | Main → interactive PTY shell → installation descendants | One active shell; replacement or explicit terminal kill calls `IPty.kill()` | Unmeasured |
| File watcher in [`watcherHostClient.ts`](../../../src/main/lib/fileWatcher/watcherHostClient.ts) | Main → content or Git utility host; host owns native watcher handles | RPC shutdown followed by utility `kill()` | Direct utility host not measured in the full matrix; static source shows no further OS-process launcher in the host |
| Cron scheduler in [`schedulerProcessManager.ts`](../../../src/main/presenter/cronJobs/schedulerProcessManager.ts) | Main → scheduler utility host; due work is posted back to main | STOP message followed by utility `kill()` | Direct utility host not measured in the full matrix; static source shows no scheduler-spawned command |

### Helper launchers that still need disposition

Short expected duration is not a containment guarantee. `PTG-H0` was delivered separately in PR
#1932 (`4889309b`) before the parent-loss mechanism work. Current source applies a 30-second
workspace Git limit, a 10-second device-query limit, and a five-second skill command-probe limit
plus a one-second reap grace. These are conservative initial ceilings: workspace operations get the
largest budget, while local system and availability probes align with adjacent five/ten-second
probes. A timeout settles the caller once and is not presented as successful output. Existing public
failure semantics remain authoritative: Workspace Git APIs converge to `null`, device queries
reject, and `hasCommand()` resolves `false` for normal absence or a timeout whose direct child has
closed. Timeout containment uses only the owned `ChildProcess` handle and
`child.kill('SIGKILL')`; it never signals a cached raw PID. If the owner kill returns `false` or
throws, the probe still waits up to the one-second reap grace for `close`. `close` resolves ordinary
timeout failure as `false`; no confirmed `close` rejects `CommandProbeContainmentError`. The
exception path reports only that containment is unconfirmed and does not claim the child was reaped.
`PTG-H0` proves bounded direct-child handling only. Process-tree containment remains a later PTG
slice because a finite caller result does not prove that descendants stopped.

For every row, implementation must also add a marked parent-loss case, route it through a proven
governed launcher, or record why a JavaScript fatal cannot overlap that synchronous call.

| Launch site | Healthy-path bound today | Required disposition |
| --- | --- | --- |
| [`rtkRuntimeService.ts`](../../../src/main/lib/agentRuntime/rtkRuntimeService.ts) | Bounded: configured timeout with direct-child TERM/KILL | Prove direct child and any marked grandchild disappear, or use governed helper execution |
| [`shellEnvHelper.ts`](../../../src/main/lib/agentRuntime/shellEnvHelper.ts) | Bounded: login-shell probe has a timeout and direct `kill()` | Marked parent-loss probe |
| [`acpInitHelper.ts`](../../../src/main/presenter/configPresenter/acpInitHelper.ts) | Bounded: dependency and `which`/`where` probes use five seconds | Marked representative probe or governed helper path |
| [`pluginPresenter/index.ts`](../../../src/main/presenter/pluginPresenter/index.ts) | Bounded: runtime version and permission probes use five/ten seconds | Marked representative probe; plugin runtime may itself create descendants |
| [`skillPresenter/index.ts`](../../../src/main/presenter/skillPresenter/index.ts) | Bounded: `git clone` uses the download timeout | Marked Git child/descendant probe |
| [`workspacePresenter/index.ts`](../../../src/main/presenter/workspacePresenter/index.ts) | Bounded: Git status/diff helpers use a 30-second timeout with `SIGKILL` | `PTG-H0` delivered; marked Git parent-loss and descendant coverage remain |
| [`ollamaProvider.ts`](../../../src/main/presenter/llmProviderPresenter/providers/ollamaProvider.ts) | Bounded: local `ollama list` uses a timeout | Marked CLI probe |
| [`devicePresenter/index.ts`](../../../src/main/presenter/devicePresenter/index.ts) | Bounded: `wmic` and `df` queries use a 10-second timeout with `SIGKILL` | `PTG-H0` delivered; marked parent-loss and descendant coverage remain |
| [`skillExecutionService.ts`](../../../src/main/presenter/skillPresenter/skillExecutionService.ts) | Bounded: foreground execution has its existing timeout; `hasCommand()` uses five seconds plus a one-second reap grace | `PTG-H0` delivered for the probe's direct child; foreground and descendant behavior remain in the runtime matrix |

### Explicit exclusions and unresolved edges

| Surface | Disposition |
| --- | --- |
| [`TerminalHelper`](../../../src/main/lib/terminalHelper.ts) | No repository caller exists on this baseline. Its purpose is explicitly opening a user terminal that may remain open. Do not silently govern or activate it; if made reachable, first define the user-owned lifetime contract. |
| Electron `shell.openExternal` | Real call surfaces are [`externalUrl.ts`](../../../src/main/lib/externalUrl.ts), the preload bridge, GitHub device flow, MCP OAuth, OpenAI Codex auth, plugin guide/CUA links, and upgrade links. Electron/system owns the transient opener; the selected browser or protocol handler is a user/system-owned external lifetime and may outlive DeepChat. PTG asserts only that the opener promise settles or rejects and excludes the target app from DeepChat-child absence checks. |
| Electron `shell.openPath` | Real call surfaces open the log folder, plugin helper app, project path, skills directory, sync folder, downloaded file, or workspace path from Config, Plugin, Project, Skill, Sync, Window, and Workspace presenters. Electron/system owns the transient opener; the chosen file manager or default application is external. PTG must classify these calls in the inventory guard and assert opener settlement, not target-app exit. |
| Windows browser fallback in [`githubCopilotDeviceFlow.ts`](../../../src/main/presenter/githubCopilotDeviceFlow.ts) | `explorer`/`start` is a separate transient opener for the same external-browser contract. Its launcher callback must settle; the browser itself is not a DeepChat-owned child tree. |
| Synchronous tar extraction in [`acpLaunchSpecService.ts`](../../../src/main/presenter/configPresenter/acpLaunchSpecService.ts) | `execFileSync` blocks the JavaScript turn, so the `FTL-002` JavaScript fatal handler cannot interleave with it. Native process death remains outside the JavaScript-fatal scope. |
| `taskkill`, `pkill`, and helpers spawned by [`processTree.ts`](../../../src/main/lib/agentRuntime/processTree.ts) | These are termination mechanisms, not product workloads. They need settlement tests inside the selected governance design, not independent lifetime ownership. |
| `worker_threads` discovery/scan/inline workers | Threads are part of the main OS process rather than independently surviving child processes. Runtime census must still detect if a native dependency secretly launches a process. |
| Electron renderer, GPU, network-service, and crash infrastructure | Chromium-owned processes are not application launcher sites in this inventory. Electron process-gone policy is separate, but the runtime census must distinguish them from DeepChat-owned utilities. |

The concrete Electron shell call inventory is:

- `openExternal`: [`externalUrl.ts`](../../../src/main/lib/externalUrl.ts),
  [`preload/index.ts`](../../../src/preload/index.ts),
  [`githubCopilotDeviceFlow.ts`](../../../src/main/presenter/githubCopilotDeviceFlow.ts),
  [`mcpOAuthProvider.ts`](../../../src/main/presenter/mcpPresenter/mcpOAuthProvider.ts),
  [`openaiCodexAuth/index.ts`](../../../src/main/presenter/openaiCodexAuth/index.ts),
  [`pluginPresenter/index.ts`](../../../src/main/presenter/pluginPresenter/index.ts), and
  [`upgradePresenter/index.ts`](../../../src/main/presenter/upgradePresenter/index.ts).
- `openPath`: [`configPresenter/index.ts`](../../../src/main/presenter/configPresenter/index.ts),
  [`pluginPresenter/index.ts`](../../../src/main/presenter/pluginPresenter/index.ts),
  [`projectPresenter/index.ts`](../../../src/main/presenter/projectPresenter/index.ts),
  [`skillPresenter/index.ts`](../../../src/main/presenter/skillPresenter/index.ts),
  [`syncPresenter/index.ts`](../../../src/main/presenter/syncPresenter/index.ts),
  [`windowPresenter/index.ts`](../../../src/main/presenter/windowPresenter/index.ts), and
  [`workspacePresenter/index.ts`](../../../src/main/presenter/workspacePresenter/index.ts).

Static search cannot prove that a native addon or third-party library never launches a child. The
test harness must record a process-tree census before and after activating each surface; any new
unclassified child becomes an inventory failure rather than being ignored.

### Static inventory gate (`PTG-M1`)

[`process-launcher-inventory-guard.mjs`](../../../scripts/process-launcher-inventory-guard.mjs)
scans `src/` during `pnpm run lint:process-launchers`. The tracked
[`process-launcher-inventory.json`](../../../scripts/process-launcher-inventory.json) records each
repository path, launcher API, same-file API ordinal, owner, and category. This is more specific than
a repository-wide count, but the ordinal is not a semantic call-site identity.

The guard recognizes `child_process`/`node:child_process`, `cross-spawn`, `node-pty`, Electron
`utilityProcess.fork`, MCP SDK `StdioClientTransport`, `shell.openExternal`, and `shell.openPath`.
Named import aliases, named Electron imports, dynamic Electron destructuring, and the existing
one-step `promisify(exec|execFile)` wrappers are covered. Default imports and equivalent
`import { default as local }` bindings use the actual module shapes: `child_process` and `node-pty`
defaults are namespaces, while the `cross-spawn` default is callable and also exposes `sync`. A new
detected site is unclassified;
file, launcher API, or same-file API count drift fails lint until a reviewer assigns an explicit
owner and category. CommonJS launcher imports, non-Electron dynamic launcher imports, Electron
default/namespace imports, runtime launcher re-exports, opaque module-loader calls, and other
explicitly detected unsupported binding forms fail closed instead of disappearing from the
inventory. Type-only imports and re-exports do not create runtime launcher capability and are
ignored.

The categories distinguish DeepChat runtime trees, utility hosts, bounded helpers, termination
helpers, synchronous exclusions, Electron/system openers, and the intentionally user-owned terminal
surface. Category assignment is evidence metadata, not proof that a process is bounded or contained.

Module bindings and direct call sites are read with the repository's existing TypeScript compiler
AST; this adds no parser dependency and handles legal JavaScript trivia consistently. It is still
not a call-graph analyzer. Residuals are explicit:

- static string element access is classified like property access; dynamic computed access and
  launcher aliases are not followed and fail closed as unsupported binding use;
- direct calls/construction, the covered one-step `promisify` form, type-only/`instanceof` checks,
  and the existing out-of-scope `shell.showItemInFolder` call are allowed. Passing, assigning,
  re-exporting, or invoking a launcher through `call`/`apply`/`bind` fails closed;
- launchers hidden behind factories or third-party/native code are not followed;
- syntax that refers to a watched module through a statically known but unsupported import form
  fails closed and requires a focused scanner fixture or an explicit supported binding;
- the conservative module-loader check rejects any call whose first argument is a watched module
  string, even an unrelated call such as `report('electron')`. Authors must avoid that form or add a
  reviewed scanner fixture; `PTG-M1` does not track loader symbols to remove this false positive;
- same-file sites use API ordinal order rather than a semantic call-site name. Reordering calls to
  the same API, or replacing one with different semantics while keeping the same file/API/count, is
  not detected by this guard and still requires code review.

Dynamic computed access and opaque aliasing are therefore rejected for these launcher APIs unless
the guard and fixtures are extended in the same change. Code review and the later runtime process
census remain required for native and dependency-hidden launchers. `PTG-M1` changes no runtime
behavior, does not execute the native matrix, selects no containment mechanism, and does not unlock
`FTL-002`.

## Required contract

Every DeepChat-owned child tree must have an owner-independent termination guarantee when its owning
main or utility boundary disappears unexpectedly. The guarantee must:

- cover direct children and descendants, not only one PID;
- require no Presenter, lifecycle hook, renderer, Electron API, or asynchronous cleanup from the
  fatal terminator;
- target only the owned tree and never kill an unrelated process after PID reuse;
- avoid creating a watchdog, supervisor, pipe holder, or helper that can itself remain orphaned;
- preserve explicit healthy shutdown, timeout, cancellation, output drain, and exactly-once
  settlement;
- make any intentional user-owned detached lifetime an explicit product contract, not an accidental
  exception.

## Evidence-first mechanism comparison

No implementation mechanism is selected by this spec.

| Candidate | Current evidence | Evidence required before selection |
| --- | --- | --- |
| Utility-side parentPort/disconnect/exit cleanup | Branch-local exploratory macOS observation saw no callback, but no reusable fixture/result was preserved | Reproduce in the PTG harness on all target platforms; reject only where preserved evidence proves the callback is not delivered in time |
| Cleanup from the fatal helper or Presenter lifecycle | Rejected: it violates the built-in-only fail-stop boundary and trusts potentially inconsistent state | None; out of contract |
| Remove `detached` | Rejected as a guarantee; Node documents that ordinary children can outlive a parent | May still be an incidental simplification only after containment is independently proven |
| External watchdog/supervisor | Not measured | Prove startup-race handling, reliable owner-loss signal, exact tree identity, bounded self-exit, no second orphan, and healthy-shutdown compatibility on all three platforms |
| Platform process containment | Not measured in this repository | Compare native availability and packaging cost. Windows Job Objects can group processes and support kill-on-last-handle-close, but nested-job/breakaway behavior must be tested. Linux parent-death signals concern the calling process and are reset across fork, so descendant coverage must be demonstrated. macOS needs its own measured primitive or supervisor path. |
| One common mechanism for every launcher | Not assumed | Prefer shared behavior only if the launcher matrix proves it; platform or owner-specific adapters are acceptable when they keep one contract without speculative abstraction |

Primary platform references for candidate research:

- [Microsoft Job Objects](https://learn.microsoft.com/windows/win32/procthread/job-objects)
- [Linux `PR_SET_PDEATHSIG`](https://man7.org/linux/man-pages/man2/pr_set_pdeathsig.2const.html)

## Acceptance matrix

Each required row runs in real Electron with a disposable profile and unique marker. `M`, `U`, and
`D` mean main process, utility host when present, and all direct/descendant workload processes.

| Surface | macOS fatal owner loss | Windows fatal owner loss | Linux fatal owner loss | Healthy-path regression checks |
| --- | --- | --- | --- | --- |
| Background exec shell + grandchild | `M` exits; `U` and all `D` gone ≤5s | Same | Same | stream, yield, timeout, explicit kill, remove, conversation cleanup, shutdown settle once |
| Direct agent exec fallback | Prove unreachable or all `D` gone ≤5s | Same | Same | output, timeout, process-tree escalation |
| Skill foreground/background + grandchild | All `D` gone ≤5s | Same | Same | stdout/stderr, offload, stdin, timeout, background polling |
| Hook shell + grandchild | All `D` gone ≤5s | Same | Same | success, error, timeout, diagnostics |
| Ordinary and plugin MCP stdio + grandchild | All `D` gone; port closed ≤5s | Same | Same | connect, request, stop, stop timeout, plugin disable/uninstall |
| ACP agent + grandchild | All `D` gone; protocol pipe closed ≤5s | Same | Same | warmup, bind, release, shutdown, restart |
| ACP protocol and install PTYs | PTY and all `D` gone ≤5s | Same | Same | input/output, resize, wait, release, init cancellation |
| File-watcher content/Git utilities | `U` gone; watcher handles released ≤5s | Same | Same | watch, unwatch, restart, shutdown |
| Cron scheduler utility | `U` gone; DB/heartbeat resources released ≤5s | Same | Same | reconcile, run-now, idle stop, restart, shutdown |
| Helper launcher group | Every activated marked child/descendant gone ≤5s | Same | Same | all helpers have finite limits; timeout settles once as failure; the three `PTG-H0` ceilings are 30s/10s/5s |

`PTG-H0` was accepted in PR #1932 against these direct-child criteria:

- a hung workspace Git child is terminated within 30 seconds plus a bounded test grace period, and
  the public Workspace API resolves to its existing `null` failure sentinel;
- a hung `wmic`/`df` direct child is killed and reaped within 10 seconds plus grace, while the
  public device query keeps its existing rejection semantics;
- a hung `SkillExecutionService.hasCommand()` direct child is killed and reaped within five seconds
  plus grace, then resolves as unavailable; an owner-handle kill that has no confirmed `close`
  rejects the typed containment error instead of returning `false`, with no raw-PID signal fallback;
- each timeout settles once, clears its timers, and never returns partial output as success; normal
  settlement removes listeners immediately, while typed containment rejection retains the ownership
  listeners only until a late `close` removes them without settling the caller again;
- existing successful Git, device-query, and command-availability results remain unchanged; and
- tests prove the direct timeout behavior without claiming that it governs descendants. Descendant
  absence remains part of the later real Electron parent-loss matrix.

Assertions must use PID plus a unique command marker and a captured start identity; ports and PTYs
must be checked when applicable. PID absence alone is insufficient because of reuse. The harness
must kill only marked survivors in `finally`, including when assertions fail or time out.

### Mechanism-neutral marked-tree harness (`PTG-M2A`)

[`process-tree-harness.mjs`](../../../scripts/process-tree-harness.mjs) runs independently of the
`FTL-002` fatal helper and production containment code. It launches this disposable tree:

```text
Node measurement owner
└─ real Electron main fixture
   └─ Electron utilityProcess host
      └─ OS shell
         └─ marked Node grandchild
```

The outer Node measurement process registers the Electron owner's exit observation immediately
after `spawn`, then waits until all four Electron-owned roles report readiness. Readiness is raced
against early owner exit, preserving its exact code and signal instead of waiting for the tree-ready
timeout. Only after capturing each PID, parent PID, command line, unique run marker, and OS start
identity and verifying every parent edge does the harness permit the selected owner action. Darwin
identity uses `ps` parent PID, `lstart`, and full command line. Linux reads parent PID and kernel
start ticks from `/proc/<pid>/stat` and the command from `/proc/<pid>/cmdline`, avoiding the
second-resolution `ps` start-time collision. Windows identity uses
`Win32_Process.ParentProcessId`, `CreationDate`, and `CommandLine`.

Electron does not include utility script arguments in the native utility command line on macOS.
The utility fixture therefore applies the run marker through `process.title`; retained macOS
evidence confirms that `ps` exposes that unique marker. The harness requires this external marker
and the captured `lstart` before treating the utility PID as signalable. A platform that cannot
externally verify the marker fails with `PROCESS_IDENTITY_UNVERIFIED`; cleanup does not signal that
unverified PID. Owner, shell, and grandchild markers remain command-line arguments. Identity-safe
cleanup treats either a start-identity mismatch or marker mismatch as unrelated and sends no
signal. In particular, if a native Windows utility command line does not expose the marker, the
development probe fails safely: PID plus `CreationDate` may be retained for survivor observation,
but never authorizes a signal. The artifact records `signalAttempted: false` and whether that
survivor requires operator cleanup.

The modes are measurements rather than mechanism choices:

- `healthy-shutdown` writes a cooperative stop sentinel. The grandchild exits, the shell reaps it,
  the utility settles once, and Electron exits normally.
- `owner-loss` directly calls `process.exit(17)` in the Electron main fixture. It does not import or
  simulate the future fatal helper.
- `callback-observation` performs the same forced owner loss after registering utility
  `parentPort` and process lifecycle observations. The artifact separately records every probe,
  whether registration happened, and whether Electron documents the event. A missing callback is
  recorded as an exact empty observation, not inferred from logs or replaced by a synthetic event.

Each run writes JSON and Markdown with the platform, architecture, OS release, Electron and Node
versions, development/packaged flag, owner exit, all captured identities, pre-action/post-action/
post-cleanup census, callback probes and observed callbacks, utility settlements, expected and
actual owner exit, exact role status, per-condition contract checks, stderr, cleanup attempts, and a
SHA-256 digest of the harness sources used for that run. The CLI exits successfully when measurement
and cleanup complete even if `contractSatisfied` is `false`; an orphan is never relabelled as a
passing containment assertion. Harness errors or a marked cleanup survivor make the CLI fail.

Cleanup is deliberately narrower than a production mechanism. It checks the captured start
identity and marker immediately before each exact PID signal, tries TERM then KILL with bounded
grace, and checks identity again. It never uses `pkill`, `killall`, a marker-wide signal, a process
group, or a cached PID after identity or marker mismatch. Tests cover successful cleanup,
PID/start-identity mismatch, same-start-identity marker mismatch, early owner exit using
`/usr/bin/false`, cancellation of the losing readiness poll with a separate CLI wall-time check,
exit/timeout exactly-once listener settlement, a synthetic Windows utility-marker failure with zero
cleanup calls for that role, real Electron artifact persistence, wrong owner exit, wrong healthy
settlement, and exactly-once healthy utility settlement.

Retained macOS development-fixture evidence is under
[`evidence/macos`](./evidence/macos). On Darwin 25.5.0 arm64 with Electron 40.10.5:

- healthy shutdown produced `[owner absent, utility absent, shell absent, grandchild absent]` and
  one `shell-close:0:null`, code-0 utility settlement with `settlementCount: 1`; owner exit code was
  the mode-required `0`, every pre-cleanup census check passed, and `contractSatisfied` was `true`;
- forced owner loss produced `[owner absent, utility absent, shell match, grandchild match]` after
  five seconds, with the mode-required owner exit code `17`; `contractSatisfied` remained `false`;
- callback observation forced the owner to exit with code 17; after five seconds it produced
  `[owner absent, utility absent, shell match, grandchild match]`. All four undocumented
  `parentPort` probes and six process probes were recorded as registered, while observed utility
  callbacks remained exactly empty;
- identity-safe `finally` cleanup removed both survivors and the post-cleanup marked census was
  empty.

These files preserve the pre-change result that was previously only branch-local. They do not prove
Windows or Linux behavior, do not cover a packaged DeepChat application, do not select a watchdog
or OS containment primitive, and do not satisfy any `FTL-002` unlock condition.

Native runner commands use the same source and must retain their own output rather than copying the
macOS artifact:

```bash
# macOS or Linux, from a native checkout with dependencies installed
pnpm exec vitest run test/main/scripts/processTreeHarness.test.ts
pnpm run smoke:process-tree-harness -- --mode healthy-shutdown --observation-ms 250 --phase pre-change --output-dir artifacts/ptg
pnpm run smoke:process-tree-harness -- --mode owner-loss --observation-ms 5000 --phase pre-change --output-dir artifacts/ptg
pnpm run smoke:process-tree-harness -- --mode callback-observation --observation-ms 5000 --phase pre-change --output-dir artifacts/ptg
```

```powershell
# Windows PowerShell, from a native checkout with dependencies installed
pnpm exec vitest run test/main/scripts/processTreeHarness.test.ts
pnpm run smoke:process-tree-harness -- --mode healthy-shutdown --observation-ms 250 --phase pre-change --output-dir artifacts/ptg
pnpm run smoke:process-tree-harness -- --mode owner-loss --observation-ms 5000 --phase pre-change --output-dir artifacts/ptg
pnpm run smoke:process-tree-harness -- --mode callback-observation --observation-ms 5000 --phase pre-change --output-dir artifacts/ptg
```

PR manual validation must attach each runner's JSON and Markdown, verify that runtime platform and
Electron version are native rather than emulated, inspect every exact role status and callback, and
confirm `cleanup.allMarkedGone` is `true`. A `contractSatisfied: false` pre-change result remains a
recorded failure to contain, not a failed measurement. The current harness labels itself
`development-fixture` and `packaged: false`; packaged app entry and native package evidence belong
to the later full matrix and must not be claimed by changing metadata.

On Windows, a `PROCESS_IDENTITY_UNVERIFIED` result is an intentional safe failure when the utility
marker is absent from externally queried process data. Preserve the non-zero CLI result and the
artifact, verify that the utility cleanup record has `signalAttempted: false`, and perform any
required cleanup manually in that disposable runner. Do not relabel this as an executable matrix
pass or signal the PID from the harness based only on `CreationDate`.

Run both development bundles and packaged applications for entry resolution and native behavior.
CI evidence is required from native macOS, Windows, and Linux runners; emulation or one host cannot
close the issue.

## Ordered implementation tasks

- [x] Record the branch-local macOS background-exec orphan and bounded result.
- [ ] Reproduce the exploratory utility callback observation in a reusable PTG fixture and run it
      on all targets. `PTG-M2A` retained the macOS development-fixture result; Windows, Linux, and
      packaged results remain open.
- [x] Complete the baseline source launcher inventory and explicit exclusions.
- [x] Add an inventory guard or generated census that classifies `child_process`, `cross-spawn`,
      `node-pty`, Electron `utilityProcess.fork`, MCP SDK `StdioClientTransport`,
      `shell.openExternal`, and `shell.openPath`, and fails when a new direct or wrapped launcher is
      unclassified.
- [x] Deliver `PTG-H0`: add the 30-second workspace Git, 10-second device query, and five-second
      `SkillExecutionService.hasCommand` healthy-path limits with deterministic timeout tests.
- [x] Build a mechanism-neutral real Electron marked-tree harness independent of the `FTL-002`
      fatal helper; trigger forced main exit directly.
- [ ] Implement every required runtime and helper-launcher fixture without changing runtime
      behavior.
- [ ] Run the pre-change matrix on native macOS, Windows, and Linux and record exact results.
- [ ] Compare external watchdog and platform containment candidates against the measured matrix.
- [ ] Select and document the smallest mechanism only after evidence exists.
- [ ] Implement governance at process owners or an independent supervisor; keep it out of the fatal
      helper.
- [ ] Prove healthy shutdown, timeout, cancellation, output drain, and exactly-once settlement for
      every changed owner.
- [ ] Run the post-change native and packaged matrix on all three platforms.
- [ ] Merge the governance PR into `docs/audit-remediation-plan`.
- [ ] Rebase `FTL-002`, require its process-tree assertion to pass without expected-orphan logic,
      then complete its remaining SQLitePresenter and packaged smoke gates.

## `FTL-002` unlock conditions

`FTL-002` remains blocked until all of the following are true:

1. every required matrix row passes on native macOS, Windows, and Linux;
2. the production background-exec result is `[utility host exited, shell exited, grandchild exited]`
   within five seconds;
3. no acceptance test encodes an orphan as the expected result;
4. any excluded lifetime has a reviewed product contract and cannot be reached accidentally;
5. governance stays outside the built-in-only fatal helper and needs no Presenter cleanup;
6. the implementing PR records automated evidence, residual platform gaps, and manual packaged/dev
   validation;
7. the governance PR is merged into the audit remediation base before the FTL PR is reviewed.

## Impact

- Fatal main-process exit can no longer leave DeepChat-owned commands, MCP servers, ACP agents,
  PTYs, or helper utilities consuming files, ports, credentials, or compute without a UI owner.
- The implementation may touch process launch and cleanup across several domains. That breadth is
  why the evidence and owner slices precede a shared abstraction or large refactor.
- Healthy process behavior must remain unchanged; this issue governs unexpected owner loss rather
  than turning normal shutdown into a forced kill.

## Rollback

The spec adds no runtime behavior. Implementation must be split by process owner or platform seam so
a regressing owner change can be reverted without removing evidence or restoring fatal fail-open
handling.

If a selected containment mechanism breaks startup, healthy shutdown, cancellation, or packaging:

1. revert that owner/platform implementation slice;
2. keep this issue and `FTL-002` blocked;
3. retain the red marked-tree acceptance test and recorded evidence;
4. do not move cleanup into the fatal handler, weaken the matrix, broaden PID kills, or restore an
   expected-orphan assertion.

## Open questions

Mechanism selection is intentionally unresolved pending the native pre-change matrix. There is no
product clarification blocking the inventory, harness, or measurement work.
