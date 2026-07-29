# Plugin External Runtime Lifecycle

## Status

Lifecycle and model-facing CUA 0.13.1 compatibility implementation are complete with automated
validation. Native Windows/Linux behavior, release-signed macOS behavior, and preinstalled custom
cursor themes remain release-gated.

## Context

[GitHub issue #2039](https://github.com/ThinkInAIXYZ/deepchat/issues/2039) reports that enabling the
official CUA plugin on Arch Linux/X11 can black out the desktop until the X server or machine is
restarted. DeepChat 1.0.9 bundles CUA driver 0.7.1 and eagerly starts it while activating the
plugin.

The incident exposes a host-level ownership problem, not only an obsolete driver argument:

- plugin installation state and the persisted MCP `enabled` field both attempt to represent user
  intent;
- plugin activation writes `enabled: true` back to SQLite, so a direct database workaround is
  overwritten on a later activation;
- plugin-owned processes can be started, stopped, or restarted through at least six independent
  paths;
- the MCP service, rather than the plugin host, performs the effective startup during application
  initialization;
- a normal executable inherits the complete DeepChat environment;
- package checksums are verified when a plugin is installed, but not before a user-writable runtime
  is spawned.

The implementation must therefore upgrade CUA and establish one durable lifecycle boundary for all
plugin-owned external processes.

## Goals

1. Make a plugin runtime supervisor the sole owner of plugin-owned process lifecycle.
2. Separate capability, persistent user intent, persistent safety evidence, and transient process
   state.
3. Start CUA only when one of its tools is invoked, while keeping its tool catalog visible before
   process startup.
4. Upgrade the bundled driver to pinned upstream release `cua-driver-rs-v0.13.1` and adapt to its
   embedded daemon/proxy contract.
5. Fail closed on stale crash evidence, runtime integrity failures, incomplete packaged catalogs,
   and unsupported launch contracts.
6. Restrict the environment inherited by bundled native runtimes without changing legacy MCP
   server behavior.
7. Preserve current macOS helper signing/notarization, current unsigned Windows distribution, and
   the independent DeepChat application build matrix.

## Non-goals

- This change does not make on-demand startup a general MCP feature for prompts or resources.
- This change does not vendor the Feishu `npx` dependency closure.
- This change does not claim protection against an actively malicious process running as the same
  OS user or close hash-to-spawn and endpoint-attestation-to-signal TOCTOU windows with native
  process handles.
- This change does not add Windows Authenticode signing; DeepChat currently has no Windows signing
  certificate.
- This change does not add CUA to Linux arm64 until that target passes DeepChat native validation.
- This change does not add a temporary 0.7.1 command-line workaround.
- This change does not idle-reap a healthy CUA daemon. On-demand controls the first start; keeping
  the verified daemon warm until plugin disable or application shutdown is an explicit latency
  tradeoff, not a session-lease contract.
- This change does not retain raw screenshot base64 in the main agent conversation. Explicit CUA
  visual-grounding requests use the resolved session or agent vision model and return bounded text
  to the tool transcript.

## Invariants

### Four state layers

| Layer | Owns | Persistence | Mutation authority |
| --- | --- | --- | --- |
| Manifest | Capability: ownership, surfaces, start mode, catalog, runtime adapter | Packaged | Plugin release |
| Installation | Whether the user enabled the plugin | Persistent | Explicit user action |
| Sentinel / quarantine | Dirty-start evidence and a safety lock bound to a runtime fingerprint | Persistent | Supervisor safety policy |
| Supervisor | Starting, running, stopping, and error state | In-memory | Runtime supervisor |

The manifest defines capability, the installation record preserves user intent, and the supervisor
tracks process state. A persisted MCP `enabled` field is not an independent source of truth for a
plugin-owned server.

### One lifecycle gate

Every actual start, stop, restart, authentication recovery, configuration restart, renderer
request, and shutdown action for a plugin-owned server must pass the runtime supervisor. The
low-level MCP start/stop implementation remains private to an unforgeable host capability; it must
not be unlocked with a mutable global flag.

Ownership is established by trusted plugin registration. It is not inferred solely from
`manifest.runtime`, because Feishu also owns an external stdio process, and it is not trusted solely
from `source === "plugin"` in the user-writable SQLite database.

The supervisor must either receive every low-level lifecycle event or own both start and stop.
This implementation chooses symmetric ownership: external callers cannot directly stop a
plugin-owned client while leaving supervisor state stale.

### Startup phases

Application startup is ordered as:

1. discover enabled plugins, validate manifests, and register contributions without starting
   plugin-owned processes;
2. initialize the MCP service and start only non-plugin-owned servers;
3. reconcile plugin-owned servers through the supervisor, starting only `eager` servers.

The following current paths are all covered by the same gate:

1. plugin activation;
2. MCP initialization;
3. manual MCP enable/disable;
4. configuration-driven restart;
5. authentication-driven restart;
6. renderer `mcpStartServer` / `mcpStopServer`;
7. application shutdown and plugin disable.

### On-demand scope and discovery

`startMode: "onDemand"` is valid only when a server explicitly declares `surfaces: ["tools"]` and a
packaged immutable tool catalog. Absence of prompt/resource declarations must not be interpreted as
tool-only support.

DeepChat may expose catalog tools while the client is stopped. On the first tool call the
supervisor:

1. coalesces concurrent starts for the same runtime;
2. validates integrity and quarantine state;
3. starts and verifies the runtime;
4. resolves the live MCP client and revalidates that the requested tool exists;
5. dispatches the call.

The CUA daemon remains running after a successful first call until plugin disable or application
shutdown. Do not describe this tools-only mechanism as general MCP lazy activation.

Live revalidation compares both the tool name and its complete input schema with the packaged
catalog. A protocol or capability version match is not a substitute for schema equality because an
upstream release can change a schema without correctly bumping those versions.

Package verification fails if the catalog is missing, malformed, contains duplicate/empty names,
contains invalid input schemas, disagrees with the pinned runtime's generated catalog, lacks exact
tool-policy coverage, declares a non-tool surface, or cannot be resolved from the packaged plugin.
There is no eager-start or empty-catalog fallback.

The source CUA manifest carries the reviewed union of platform-specific tool policies. Packaging
must explicitly recognize every platform-only tool and scope that union to the native target
catalog, so each final `.dcplugin` still has exact catalog/policy parity. An unknown platform
addition, a missing policy decision, or a platform-only tool appearing on the wrong target fails
packaging rather than broadening the policy implicitly.

Explicitly denied tools are not advertised to the model. The Windows-only diagnostic tool is
denied because it exposes executable paths and UI Automation internals. Linux's stateful
`mouse_button_down` / `mouse_drag` / `mouse_button_up` sequence is also denied because exact
per-tool approval cannot make its press-to-release interval atomic; the atomic
`parallel_mouse_drag` operation remains available behind `ask`.

### Sentinel and quarantine

A sentinel is evidence: it is persisted immediately before a risky runtime spawn and cleared only
after a verified clean stop. A quarantine is policy: on startup, a residual sentinel for the same
runtime fingerprint prevents automatic or on-demand restart.

Each spawn attempt has a UUID `attemptId`. A clean stop may clear persisted evidence only when both
the fingerprint and `attemptId` still match, so an older stop cannot erase evidence written by a
newer attempt.

The fingerprint includes `pluginId`, `runtimeId`, target, and the verified executable digest. A
new fingerprint is eligible for one supervised start, which allows a repaired runtime release to
recover without silently treating the old binary as healthy. Retrying the same quarantined
fingerprint requires the explicit, private supervisor authorization path.

User intent remains enabled while quarantined. The user action is `runtime.retry`, not “enable
plugin.” Integrity failure is tracked separately from quarantine, remains visible while stale
evidence exists, and cannot be bypassed with retry; repair or reinstall followed by an integrity
recheck is required before `runtime.retry` becomes available.

Immediately after daemon spawn, launch context records the child PID as diagnostics and as part of
attested orphan recovery; POSIX endpoint identity is added after readiness. A later process may
terminate that PID only after the persisted endpoint returns metadata with the same PID, embedded
mode, and host bundle identity. A bare persisted PID is never sufficient because PID reuse could
otherwise terminate an unrelated process. A reachable or ambiguously broken endpoint without
attestable PID evidence remains quarantined rather than being unlinked as if it were absent.

### Migration

Plugin installation records are stored in ElectronStore while MCP configs are stored in SQLite, so
the migration cannot be transactional across both stores. It must be versioned, idempotent, and
safe-side first:

1. recognize only the one-to-one legacy CUA launch contract;
2. when that record is explicitly disabled, persist `installation.enabled: false` before any
   cleanup;
3. clear stale CUA tool-policy state and remove the obsolete MCP record;
4. write the migration marker only after cleanup succeeds so partial failures retry.

The migration is explicitly for the one-to-one CUA server. It must not generalize “any disabled
plugin-owned server disables the whole plugin,” which would corrupt intent for multi-server
plugins.

For legacy CUA specifically, `enabled: false` on its owned MCP record is treated as an explicit
disable signal and is migrated to `installation.enabled: false` before removing the obsolete MCP
record. An enabled legacy record does not disable an enabled installation. Migration failure must
remain retryable without preventing unrelated plugins from activating; CUA itself stays inactive
for that launch so a failed safe-side write cannot expose it under stale intent.

### Exact plugin tool policy

An enabled plugin tool-policy record is a closed per-tool allowlist:

- `allow` always permits that exact tool;
- `ask` may be remembered only for that exact server/tool pair in the current conversation;
- `deny` always blocks;
- a tool absent from the closed policy is denied.

Plugin policy is evaluated before coarse server-level session or persisted `read`/`write`/`all`
permissions. Coarse grants remain compatible for servers without a plugin tool-policy record but
cannot override an exact plugin decision.

## Manifest contract

Plugin MCP manifests gain these capability fields:

- `startMode`: `eager` by default; `onDemand` for CUA;
- `surfaces`: explicit subset of `tools`, `prompts`, and `resources`;
- `toolCatalog`: plugin-relative generated catalog, required for on-demand tools;
- `inheritEnv`: `legacy` by default; `minimal` for controlled native helpers.

Runtime manifests may select a closed host adapter. CUA uses `cua-embedded-v1`; other plugins
continue to use the direct stdio path. Adapter-specific state does not leak into the generic MCP
configuration persisted in SQLite.

## CUA 0.13.1 adapter

The CUA adapter starts two related processes:

- daemon:
  `serve --embedded --parent-liveness-stdio --no-permissions-gate --socket <private-endpoint>
  --host-bundle-id <id> --permission-mode standard`;
- stdio proxy:
  `mcp --embedded --socket <private-endpoint> --host-bundle-id <id>`.

The daemon stdin remains open for parent-liveness. Startup completes only after a newline-delimited
metadata response validates:

- driver version `0.13.1`;
- contract version `0.2.0`;
- tools-list schema version `1`;
- capability version `1`;
- MCP protocol version `2025-06-18`;
- child PID, embedded mode, and host bundle identifier.

The endpoint is unique per attempt, private to the user, persisted before spawn, and constrained to
the platform path-length rules. On POSIX, the supervisor adds the socket device/inode identity
after readiness and stale recovery unlinks only a managed endpoint whose current identity matches.
If identity was never observed, recovery leaves the path untouched and uses a new unique endpoint.
Windows named pipes disappear with their owning process and require no filesystem unlink. Start
requests are coalesced and stop is idempotent.

### Model-facing CUA tool adapter

DeepChat preserves the MCP protocol's raw `structuredContent` separately from display `content`.
For CUA `get_window_state`, the model-facing text receives a compact projection of the latest
snapshot id, `element_index` to non-empty `element_token` mapping, and degraded/escalation metadata.
It does not duplicate `tree_markdown` or the complete structured element array in the prompt.
For any CUA result carrying `structuredContent.refusal.code`, DeepChat appends a bounded,
single-line code projection to model-visible `content` while preserving the raw structured value.
The human-readable refusal message is already present in MCP text content and is not duplicated.

CUA 0.13.1 declares `element_token` as an optional unconstrained string but rejects an empty string
at runtime and gives any present token precedence over a valid index. Immediately before dispatch,
the closed CUA adapter therefore removes only an empty or whitespace-only `element_token` from these
seven tools:

- `click`;
- `double_click`;
- `right_click`;
- `type_text`;
- `press_key`;
- `set_value`;
- `scroll`.

The adapter preserves every other value, including `x: 0`, `y: 0`, empty arrays, booleans, and a
non-empty opaque token. The normalization naturally becomes a no-op after upstream schemas and
model/provider argument generation stop producing empty optional tokens.

A non-empty token is preferred when it came from the latest `get_window_state`. Tokens are opaque;
the current eight-hex-digit representation must not be parsed or synthesized by DeepChat. When
the projected `refusal.code` is `stale_element_token`, `generation_mismatch`, or
`invalid_element_token`, the packaged skill requires one fresh `get_window_state` call and a retry
with the new token. It must not reuse a stale token or silently fall back to an older snapshot's
index.

### CUA 0.13.1 tool-contract changes

The static catalog, closed policy, skill, and tests track these reviewed changes together:

- `set_agent_cursor_style` is replaced by `set_agent_cursor_theme`;
- cursor state and mutation tools use a required stable `session`;
- `set_agent_cursor_motion` no longer accepts appearance fields, and
  `get_agent_cursor_state` returns a single-session state object;
- `browser_type` accepts `replace`; an empty replacement clears the editable field;
- normal `start_session` calls omit optional `cursor_theme`, while an explicit user theme request
  uses the reviewed `set_agent_cursor_theme` action;
- `kill_app` is denied because the 0.13.1 public `launch_app` and `kill_app` schemas omit
  `session`, preventing standard-mode ownership proof. DeepChat does not rely on the proxy's
  current acceptance of undeclared fields.

The `kill_app` mitigation is version-specific. A direct native smoke test must use a disposable
fixture process rather than the DeepChat product path, because the closed policy blocks the call
before it reaches the driver. A future driver upgrade may restore `ask` only after native testing
confirms an owned process can be terminated and a foreign process remains denied.

Screenshot delivery is opt-in at the tool-call boundary:

- `include_screenshot: true` permits the returned MCP image to be sent to the resolved current
  session vision model or configured agent vision model for bounded visual grounding;
- omitted or false does not trigger model-side image analysis;
- the original image remains available as a DeepChat tool preview;
- successful analysis, unavailability, cancellation, and failure are appended as bounded text
  without replacing the accessibility tree or structured token projection;
- screen text and derived visual grounding are labeled as untrusted observations, never as
  authoritative instructions.

This policy avoids accumulating a full-window image in every provider round while still giving a
vision-capable model actual pixels when the caller explicitly requests them. The packaged skill
uses screenshots for initial, ambiguous, sparse, or visually verified states and uses
`include_screenshot: false` for routine AX re-indexing.

## Controlled process environment

`inheritEnv: "minimal"` starts from an empty environment, copies only the platform baseline, and
then applies manifest-declared values. Missing variables are skipped.

Common baseline:

- `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`;
- `TMPDIR`, `TMP`, `TEMP`;
- `LANG` and `LC_*`.

Linux/session additions:

- `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`;
- `XDG_RUNTIME_DIR`, `XDG_SESSION_TYPE`;
- `DBUS_SESSION_BUS_ADDRESS`, `AT_SPI_BUS`, `SWAYSOCK`;
- `XDG_CURRENT_DESKTOP`, `XDG_SESSION_DESKTOP`, `DESKTOP_SESSION`;
- `XDG_DATA_HOME`, `XDG_DATA_DIRS`.

Windows additions:

- `SystemRoot` / `SYSTEMROOT`, `windir` / `WINDIR`, `COMSPEC`, `PATHEXT`;
- `USERPROFILE`, `USERNAME`, `APPDATA`, `LOCALAPPDATA`, `PROGRAMDATA`,
  `PROCESSOR_ARCHITECTURE`.

`CUA_LOG` is a CUA-adapter-only diagnostic pass-through and is not part of the generic minimal
environment. The CUA adapter accepts only its exact host-owned environment contract and rejects
manifest attempts to supply authorization controls such as `CUA_DRIVER_PERMISSION_MODE` or
`CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS`. Existing user-managed MCP configs and plugin manifests
without `inheritEnv` retain legacy behavior for compatibility.

## Runtime integrity contract

Integrity is checked immediately before every CUA daemon spawn.

Windows and Linux validation:

- resolve within the registered runtime root;
- reject symlinks and non-regular files (and Windows reparse points where Node can identify them);
- compare the complete declared file set and executable digest against a release-generated
  descriptor obtained from the packaged official artifact, not from the writable installation;
- reject unexpected executable files.

macOS validation:

- resolve the expected `.app` and executable within the registered runtime root;
- run strict code-signature verification;
- verify the DeepChat bundle identifier and expected signing team/identity;
- require hardened runtime and the exact helper entitlement contract:
  `com.apple.security.automation.apple-events` and
  `com.apple.security.device.screen-capture`.

The digest is still used in the quarantine fingerprint after DeepChat re-signing, but the
code-signature identity is the trust decision on macOS.

These checks detect stable replacement, corruption, incomplete extraction, and AV
quarantine/deletion. Windows per-user installs and Linux AppImage/tar.gz locations are not strong
trust roots, and this contract does not claim to resist an active same-user attacker or the
hash-to-spawn race.

Feishu is an explicit exception to complete launch-artifact attestation: its packaged `serve.mjs`
invokes `npx -y @larksuiteoapi/lark-mcp@0.5.1`, so part of the execution closure is resolved at
runtime. The supervisor still owns its lifecycle; vendoring and lockfile attestation are a follow-up
security task and do not block CUA remediation.

## Platform distribution

| Target | CUA artifact policy | Signature/integrity policy |
| --- | --- | --- |
| macOS arm64/x64 | Bundle upstream `.app`, remove authoring sidecar, rebrand/sanitize, then DeepChat-sign | Verify helper, sign helper before parent app, preserve notarization |
| Windows x64/arm64 | Bundle only `cua-driver.exe`; omit UIA worker | Keep unsigned; checksum/file-set gate |
| Linux x64 | Bundle executable | Checksum/file-set gate and executable mode |
| Linux arm64 | DeepChat still builds/releases; CUA remains unbundled until validated | Unsupported CUA target |

The upstream UIA worker is not part of the 0.13.1 release contract. DeepChat continues to package
only `cua-driver.exe` on Windows and removes the obsolete worker opt-in environment variable.

The macOS `cua-cursor-theme` executable is an authoring utility, not part of the embedded runtime.
Staging removes it and immediately requires `Contents/MacOS` to contain only the regular
`deepchat-cua-driver` file before signing and integrity descriptor generation. The bundled
`cua.default` theme is binary-tested; loading a separately preinstalled custom theme remains a
native release gate even though the upstream loader supports it.

`--no-permissions-gate` skips only the upstream macOS TCC first-launch UI. It does not disable
DeepChat's per-tool approval or the driver's `--permission-mode standard` authorization. DeepChat
owns the permission diagnostics and System Settings guidance exposed by the plugin UI.

## Acceptance and release gates

Automated gates:

- manifest schema and lifecycle ownership tests;
- all start/stop/restart entry-point tests;
- on-demand catalog discovery and concurrent first-call tests;
- migration idempotency and user-intent preservation tests;
- sentinel/quarantine/fingerprint tests;
- controlled-environment tests;
- integrity descriptor and platform package tests;
- exact CUA tool catalog/policy parity tests;
- explicit local `kill_app === deny` coverage;
- seven-tool empty-token normalization and zero-coordinate preservation tests;
- raw MCP `structuredContent`, compact CUA token/refusal projections, and stale-token guidance
  tests;
- explicit CUA screenshot visual-grounding and no-vision fallback tests;
- macOS signing and entitlement contract tests.

Native release gates:

- a version-gated direct-driver ownership smoke with a disposable process on each supported
  platform;
- macOS arm64 and x64 packaged helper, TCC, screen capture, input, restart, and notarized-app tests;
- Windows x64 and arm64 clean consumer-machine tests with Defender real-time protection enabled,
  recording `Get-MpComputerStatus`, installation, first launch, tool execution, restart, and
  protection history;
- Linux x64 X11 regression test that reproduces the #2039 activation path without desktop/session
  loss, plus Wayland validation where supported;
- Linux X11 validation with and without a compositor records warm-daemon idle CPU, handle/file
  descriptor count, and residual windows before accepting the no-idle-reap tradeoff;
- disable, crash, stale-sentinel quarantine, retry, and upgrade recovery on every target.

CI runner success is not a substitute for Windows Defender or Linux desktop-session validation.
DeepChat Linux builds continue normally. Until a release containing this architecture lands, a
release must not ship another Linux CUA artifact that still bundles and auto-starts 0.7.1; if
native CUA validation fails, whether to omit that optional plugin artifact is a release decision,
not a reason to stop building the Linux application.

## Implementation verification

Automated verification completed on 2026-07-28:

- `pnpm test`: 657 files and 7005 tests passed; 20 files and 277 tests were conditionally skipped.
- `pnpm run build`, `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and
  `pnpm run typecheck` passed.
- CUA manifest validation and a real `darwin/arm64` plugin bundle/verification passed with the
  development signing path.
- Provider/ACP catalog refresh validation passed after the build-generated snapshots changed.

The macOS development artifact was not notarized and did not exercise TCC, screen capture, or input.
Windows, Linux desktop-session, macOS x64, and release-signed/notarized native gates remain release
blockers and are tracked in `tasks.md`.

Native macOS development testing subsequently confirmed on-demand startup, exact per-tool
permissions, app launch, and window discovery, but exposed a deterministic first-action failure:
the provider emitted both a valid `element_index` and `element_token: ""`, and upstream 0.12.6 gave
the invalid empty token precedence.

Model-facing compatibility verification completed on 2026-07-28:

- `pnpm exec vitest run test/main/plugin/cuaToolAdapter.test.ts test/main/mcp/toolManager.test.ts
  test/main/agent/deepchat/runtime/toolAdapters.test.ts
  test/main/agent/deepchat/runtime/toolRuntimeBindings.test.ts`: 62 tests passed;
- `pnpm run test:main`: 5416 tests passed and 277 environment-gated tests skipped;
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run i18n`, and `pnpm run
  plugin:validate -- --name cua`: passed.

The native Calculator flow must be rerun after restarting the development app before the
model-facing native behavior is accepted.

CUA 0.13.1 upgrade verification completed on 2026-07-29:

- `pnpm run plugin:bundle -- --name cua --platform darwin --arch arm64` and
  `pnpm run plugin:verify -- --name cua --platform darwin --arch arm64 --plugin-root
  build/bundled-plugins` passed with a development-signed artifact;
- the generated macOS arm64 catalog reports driver 0.13.1 and 49 tools, and the packaged runtime
  excludes `cua-cursor-theme`;
- 182 focused CUA, plugin, MCP, package, and renderer tests passed;
- `pnpm run test:main`: 467 files and 5568 tests passed; 20 files and 279 tests were
  conditionally skipped;
- `pnpm run test:renderer`: 207 files and 1653 tests passed;
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run plugin:validate -- --name cua` passed.

The direct-driver ownership smoke, Windows/Linux native catalogs and runtime behavior,
release-signed/notarized macOS behavior, and preinstalled custom-theme loading remain native
release gates.
