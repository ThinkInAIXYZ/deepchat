# Fatal Process Tree Governance

Status: `PTG-001` specification complete; implementation not started. This issue is a blocking
dependency for `FTL-002`.

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

The same branch ran a narrower parent-loss probe. The utility process registered `parentPort`
`close`, `disconnect`, `exit`, and `error` listeners and process `disconnect`, `beforeExit`, `exit`,
`SIGTERM`, `SIGHUP`, and `SIGINT` listeners before main-process exit. The main side observed utility
exit code `0`, but none of those utility-side JavaScript callbacks recorded an event; the shell and
grandchild were reparented and remained alive. This rejects a utility-side JavaScript event handler
as the macOS solution for forced main-process exit. It is not evidence for Windows or Linux.

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
  explicit message. Node documents that `beforeExit` is not emitted for explicit termination, and
  the macOS probe confirms that utility teardown did not deliver a usable JavaScript cleanup event.
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

### Bounded helper launchers that still need disposition

Short expected duration is not a containment guarantee. For each row, the implementation work must
either add a marked parent-loss case, route it through a proven governed launcher, or record why a
JavaScript fatal cannot overlap that synchronous call.

| Launch site | Purpose and current bound | Required disposition |
| --- | --- | --- |
| [`rtkRuntimeService.ts`](../../../src/main/lib/agentRuntime/rtkRuntimeService.ts) | RTK health/rewrite child with timeout and direct-child TERM/KILL | Prove direct child and any marked grandchild disappear, or use governed helper execution |
| [`shellEnvHelper.ts`](../../../src/main/lib/agentRuntime/shellEnvHelper.ts) | Login-shell environment probe with timeout and direct `kill()` | Marked parent-loss probe |
| [`acpInitHelper.ts`](../../../src/main/presenter/configPresenter/acpInitHelper.ts) | Dependency check and `which`/`where` commands with five-second timeout | Marked representative probe or governed helper path |
| [`pluginPresenter/index.ts`](../../../src/main/presenter/pluginPresenter/index.ts) | Runtime version and permission probes with five/ten-second timeouts | Marked representative probe; plugin runtime may itself create descendants |
| [`skillPresenter/index.ts`](../../../src/main/presenter/skillPresenter/index.ts) | `git clone` for skill installation with download timeout | Marked Git child/descendant probe |
| [`workspacePresenter/index.ts`](../../../src/main/presenter/workspacePresenter/index.ts) | Git status/diff helpers, currently without a local timeout | Marked Git probe and bounded healthy behavior |
| [`ollamaProvider.ts`](../../../src/main/presenter/llmProviderPresenter/providers/ollamaProvider.ts) | Local `ollama list` with timeout | Marked CLI probe |
| [`devicePresenter/index.ts`](../../../src/main/presenter/devicePresenter/index.ts) | `wmic` or `df` device query | Marked helper probe or bounded governed path |
| [`skillExecutionService.ts`](../../../src/main/presenter/skillPresenter/skillExecutionService.ts) | Runtime availability probe plus foreground execution | Availability probe may share a helper case; foreground remains in the required runtime matrix |

### Explicit exclusions and unresolved edges

| Surface | Disposition |
| --- | --- |
| [`TerminalHelper`](../../../src/main/lib/terminalHelper.ts) | No repository caller exists on this baseline. Its purpose is explicitly opening a user terminal that may remain open. Do not silently govern or activate it; if made reachable, first define the user-owned lifetime contract. |
| Windows browser opening in [`githubCopilotDeviceFlow.ts`](../../../src/main/presenter/githubCopilotDeviceFlow.ts) | `explorer`/`start` hands a URL to a user-owned external application. The transient launcher must settle, but the browser is not a DeepChat-owned child tree. |
| Synchronous tar extraction in [`acpLaunchSpecService.ts`](../../../src/main/presenter/configPresenter/acpLaunchSpecService.ts) | `execFileSync` blocks the JavaScript turn, so the `FTL-002` JavaScript fatal handler cannot interleave with it. Native process death remains outside the JavaScript-fatal scope. |
| `taskkill`, `pkill`, and helpers spawned by [`processTree.ts`](../../../src/main/lib/agentRuntime/processTree.ts) | These are termination mechanisms, not product workloads. They need settlement tests inside the selected governance design, not independent lifetime ownership. |
| `worker_threads` discovery/scan/inline workers | Threads are part of the main OS process rather than independently surviving child processes. Runtime census must still detect if a native dependency secretly launches a process. |
| Electron renderer, GPU, network-service, and crash infrastructure | Chromium-owned processes are not application launcher sites in this inventory. Electron process-gone policy is separate, but the runtime census must distinguish them from DeepChat-owned utilities. |

Static search cannot prove that a native addon or third-party library never launches a child. The
test harness must record a process-tree census before and after activating each surface; any new
unclassified child becomes an inventory failure rather than being ignored.

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
| Utility-side parentPort/disconnect/exit cleanup | Rejected for the measured macOS forced-exit path: no registered JavaScript callback ran | Do not revive without contradictory real Electron evidence |
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
| Bounded helper group | Every activated marked child/descendant gone ≤5s | Same | Same | original timeout/result semantics remain bounded |

Assertions must use PID plus a unique command marker and a captured start identity; ports and PTYs
must be checked when applicable. PID absence alone is insufficient because of reuse. The harness
must kill only marked survivors in `finally`, including when assertions fail or time out.

Run both development bundles and packaged applications for entry resolution and native behavior.
CI evidence is required from native macOS, Windows, and Linux runners; emulation or one host cannot
close the issue.

## Ordered implementation tasks

- [x] Record the branch-local macOS background-exec orphan and bounded result.
- [x] Record the macOS utility JavaScript parent-loss callback probe.
- [x] Complete the baseline source launcher inventory and explicit exclusions.
- [ ] Add an inventory guard or generated census that fails when a new launcher is unclassified.
- [ ] Build a mechanism-neutral real Electron marked-tree harness independent of the `FTL-002`
      fatal helper; trigger forced main exit directly.
- [ ] Implement every required launcher and bounded-helper fixture without changing runtime
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
