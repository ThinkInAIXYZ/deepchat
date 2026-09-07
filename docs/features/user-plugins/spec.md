# User Plugins and Codex Package Compatibility

Status: implemented and maintained.
Author instructions and complete examples are in [authoring.md](authoring.md).

## 1. Product and compatibility boundary

Users install packages containing `.codex-plugin/plugin.json` directly from a public HTTPS Git
repository or ZIP. Authors distribute the same package to compatible hosts without a
DeepChat-specific SDK, server or marketplace. The existing official `.dcplugin` format remains
responsible for DeepChat native integrations such as CUA and Feishu.

This delivery combines Git/ZIP installation, context hooks and plugin-bundled MCP configuration
import. Existing Skills provide discovery, loading, assignment, overrides and verified script
execution. There is no new Skill runtime or editor. External ACP agents do not receive these
plugins, and importing an OpenAI `.app.json` connection ID cannot reuse a Codex account login.

Compatibility means the explicitly supported package, hook and MCP subset below. It does not
mean every Codex feature or every third-party package works unchanged. Inspection distinguishes
unsupported declarations from malformed configuration and shows findings before consent. A
package with no selected supported capability cannot be installed.

Ponytail 4.9.0 is the real upstream hook example. It has six Skills and three supported hook
events, but no MCP configuration. Independent stdio and authenticated HTTP fixtures verify MCP.

## 2. Ownership and change locations

| Owner                | Implementation                                                                   | Responsibility                                                                                        |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Plugin host          | `src/main/plugin/index.ts`, `userPlugins.ts`                                     | Combined official/user catalog, installation records, serialized lifecycle and contribution ownership |
| Source preparation   | `src/main/plugin/userPluginSource.ts`                                            | Git transport, ZIP/directory inspection, private snapshots, hashes, cancellation and staging          |
| Package reader       | `src/main/plugin/userPluginPackage.ts`                                           | Static Codex manifest, Skill, hook and MCP normalization                                              |
| Context hooks        | `src/main/plugin/userPluginHooks.ts`                                             | Command lifecycle, bounded JSON protocol, invocation persistence and current contributions            |
| Runtime boundary     | `turnCoordinator.ts`, `compactionRuntimeCoordinator.ts`                          | Accepted-input and committed-compaction event timing                                                  |
| Provider projection  | `deepChatLoopRunner.ts`, `runtime/pluginContext.ts`                              | Attributed plugin context, current user-input identity, revocation and provider dispatch checks       |
| Skills               | `src/main/skill/index.ts`, `skillExecutionAuthority.ts`                          | Registration, assignment preservation and stale revision execution rejection                          |
| MCP                  | `src/main/mcp/`                                                                  | Existing settings, identities, transports, credentials, supervision and tool/App discovery            |
| Desktop boundary     | Shared plugin route contracts, `plugin/routes.ts`, `PluginClient.ts`             | Typed source/lifecycle/setup/retry requests; no renderer filesystem/process access                    |
| UI                   | Existing Plugins Hub plus `UserPluginInstallDialog.vue`, `UserPluginDetails.vue` | Review, selection, source/revision, setup, diagnostics, update and uninstall                          |
| Developer validation | `scripts/plugin.mjs --plugin-root`                                               | Static validation through the same package reader                                                     |

All source paths in this document are relative to the repository root. The inspected starting
point was `dev` commit `8dada4b3b`. Existing asynchronous notification hooks retain their payload,
preview truncation, delivery policy and runtime scope. Context hooks use a separate awaited port.

## 3. Package format and static inspection

Only `.codex-plugin/plugin.json` identifies a portable plugin. An unrelated root `plugin.json`,
marketplace manifest, project `AGENTS.md` or `CLAUDE.md` cannot become an automatic contribution.
Package files are retained unchanged; normalized declarations are host-owned metadata.

| Declaration                                                  | Supported behavior                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `name`                                                       | Required portable identifier; displayed separately from host installation identity                          |
| `version`                                                    | Optional string; absent values display `unversioned`, while the digest identifies bytes                     |
| `description`, `author`                                      | Display metadata; publisher text is self-declared and grants no trust                                       |
| `homepage`, `repository`, `license`, `keywords`, `interface` | Inert metadata retained in original files; no automatic prompts or third-party UI/assets                    |
| `skills`                                                     | Relative directory or array; one Skill root or a directory of Skill roots; absent field discovers `skills/` |
| `hooks`                                                      | Relative JSON file or inline object; absent field discovers `hooks/hooks.json`                              |
| `mcpServers`                                                 | Relative JSON file or inline map; absent field discovers `.mcp.json`                                        |
| Other declarations                                           | Findings; no automatic execution                                                                            |
| `.app.json`                                                  | Explicit unavailable connector finding                                                                      |

Configuration files and Skill metadata are bounded to 1 MiB. Skill names use the existing
portable naming contract and must be unique within the package. Activation also checks the
current catalog and reserved plugin ownership: another source's Skill cannot be overwritten.

A source ZIP can have a package at the root or inside an enclosing directory. The same search
works for Git repositories. When multiple packages are found, the error lists candidates and the
user supplies a package subdirectory; installation never imports the whole collection. Search
without an explicit package path is bounded to four directory levels. A developer directory
uses the same private snapshot pipeline and has no file watcher.

## 4. Identity, storage and installation transaction

A portable installation receives `user.<uuid>`. Name, publisher and version never select a
filesystem destination or acquire another plugin's identity. State is additive to the existing
`plugin-settings` store: `userInstallations` and one `userPluginPending` update record. Official
installation records and reconciliation remain separate.

```text
<userData>/plugins/
  .staging/<operation-uuid>/       temporary transport and reviewed snapshot
  user/<installation-uuid>/
    versions/<sha256>/             installed package snapshot
    data/                         writable state, stable across updates
```

The digest covers relative file paths, file bytes and executable flags. Snapshots reject
symlinks, hard links, devices and other special files, traversal and nonportable paths, and
case/Unicode collisions. ZIP executable flags are preserved without copying other permissions.
Directories use private staging; file copies use exclusive creation and do not follow links.

The installed package is independent of the original path or repository. Removal of the source,
offline operation or a moved ZIP does not remove an installed plugin. A snapshot must match its
reviewed digest before activation. Hooks also verify it before execution; Skills retain their
existing execution package verification. These are integrity checks, not a publisher signature
or a native-code sandbox.

### Installation and enablement

1. Prepare Git/ZIP/directory content without executing package code or connecting MCP.
2. Parse and return the resolved source/commit, digest, supported contributions, command and
   endpoint declarations, variable names and compatibility findings.
3. Review capability selection. Skills start selected; automatic hooks and MCP connections
   start unselected. Consent applies to the complete reviewed package snapshot.
4. Reverify prepared bytes, copy into a private publication directory, and rename into the
   revision directory. New installations are saved disabled.
5. Explicit enable registers selected contributions using existing owners. Missing MCP setup
   or connection failures remain component diagnostics; enabled intent alone does not mean a
   server is connected.

Prepared inspections expire after 30 minutes. At most four inspections/prepared packages are
held at once. Closing the dialog cancels the request and discards a late result. Interrupted
staging is removed at host initialization; expired staging is pruned before another inspection.

### Update and recovery

An update uses the same review pipeline, retains installation identity/data and requires fresh
capability selection. It is applied between active DeepChat turns. The hook owner coordinates
an active-run count and short update lock; an update does not silently replace code in a running
turn. No background update poller is introduced.

For an existing installation, save owned MCP settings in the existing MCP store and persist the
previous/next plugin records before publishing contributions. Stop the previous generation,
publish selected Skills/MCP/hooks, then clear the pending record. A failed publication restores
the previous package selection and MCP configuration. A restart with pending state restores the
previous generation before execution. Credential bindings use existing MCP identity generation
invalidation; authentication may need to be repeated after a changed endpoint or rollback.

Current and previous revision directories are retained. Other owned revisions and incomplete
publication directories are pruned on a successful update. A corrupt inactive snapshot can be
replaced from reviewed bytes; the user must disable an active corrupt snapshot before repairing
that same digest. Failure to clean up or restore is surfaced, and further enable/update/setup
operations are blocked while recovery remains pending.

Disable immediately revokes context/hook eligibility and cancels in-flight hook commands.
Serialized cleanup then stops owned MCP processes and removes active Skill registrations. A
concurrent publication checks the revocation before activating resources. Disable preserves
Skill assignments/overrides and disabled MCP setup. Uninstall also removes owned MCP settings,
Skill assignments and private package/data files. Historical Tape evidence remains. Cleanup
matches owner identity, so unrelated official plugins and manually configured MCP servers remain.

## 5. Hook runtime contract

### Events and ordering

| Event                             | Boundary and input                                                                                                              | Contribution lifetime                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `SessionStart`, `source: startup` | First accepted input for an eligible top-level session and installation revision, before its prompt hook                        | Latest successful result of that handler within the session          |
| `SessionStart`, `source: resume`  | First new input after application restart for a session with persisted plugin invocation history; page navigation is not resume | Replaces that handler's session contribution                         |
| `SessionStart`, `source: compact` | Successful committed compaction with a stable compaction-attempt boundary                                                       | Replaces that handler's session contribution                         |
| `SessionStart`, `source: clear`   | No Codex clear event; clearing messages invalidates hook history                                                                | Startup runs on the next input                                       |
| `UserPromptSubmit`                | Full accepted input text, including accepted steering, before provider assembly                                                 | That user input's provider requests and tool loop, including retries |
| `SubagentStart`                   | Child DeepChat session's first accepted input; parent session ID plus child/agent identity                                      | That child session; no top-level startup reset                       |

Input JSON contains `session_id`, `hook_event_name`, `cwd`, `model` and
`transcript_path: null`, with `source`, `prompt`, or `agent_id`/`agent_type` for the corresponding
event. ACP sessions do not run this port. Resume reuses prior output for an already accepted input;
it does not run startup again merely because a request or provider attempt is retried.

`SessionStart` matchers test source; `SubagentStart` matchers test selected agent identity.
`UserPromptSubmit` matchers are unavailable. Matchers are length-bounded and checked with the
existing safe-regex utility. Only command handlers are supported. Async handlers, tool decisions,
request replacement, permission grants and other events remain unsupported findings.

### Process and output

Reviewed commands run through the platform shell with a minimal environment and the Node/uv
paths selected by DeepChat's existing Toolchain service. Expose
`PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`, and
`DEEPCHAT_PLUGIN_ID`. Prefer the session project directory as `cwd`, otherwise private data.
`commandWindows` overrides the command on Windows. A POSIX variable command without a Windows
override produces an explicit unavailable diagnostic there. Interpreters must be available;
package installation never runs build or package-manager scripts.

Native commands have the user's filesystem/network permissions. A reduced environment and
private data directory do not restrict all effects of arbitrary trusted code. Commands such as
`npx` and `uvx` may fetch dependencies when a reviewed MCP server starts.

Accepted stdout is a JSON object with `hookSpecificOutput.hookEventName` and optional string
`additionalContext`, plus optional `systemMessage` and `suppressOutput`. The event must match.
Unknown control/decision fields fail that invocation. `systemMessage` is a diagnostic, not
model instructions. Empty output succeeds without contribution. Failures do not grant permissions
or abort an otherwise usable chat turn.

| Limit                                           | Value                                                         |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Declared hooks                                  | 64 per package                                                |
| Handler timeout                                 | Default 5 seconds; explicit positive value at most 30 seconds |
| Entire accepted boundary, after queue admission | 10 seconds                                                    |
| stdin JSON                                      | 1 MiB                                                         |
| stdout / stderr                                 | 64 KiB each                                                   |
| accepted context per input/compaction boundary  | 8 KiB                                                         |
| concurrency                                     | One serialized context-hook boundary across sessions          |

Timeout, cancellation, revision replacement and disable discard late output and terminate the
owned process tree. POSIX process-group cleanup also removes descendants after normal completion.

### Durable execution and projection

Invocation identity hashes installation, digest, session, handler and boundary. Input boundaries
include the user message ID and prompt-content hash, so edits receive fresh results while retries
reuse matching results. Cached history is tied to the Tape incarnation; clearing messages invalidates
old results, discards in-flight output and permits startup on the next input. This does not emit a
Codex `clear` event. The host writes
`plugin/context-hook` Tape anchors before execution and after acceptance/failure. When no handler
matches an admitted session, a host-only observation anchor preserves the resume boundary; it
is excluded from hook diagnostics and contributes no model instructions. A started
invocation with no result after restart is `uncertain`, and is not automatically rerun. Explicit
retry is allowed for an active revision's failed/uncertain handler; it executes only that handler,
has a new invocation identity, and can repeat external effects. Retry requires idle turns and updates;
queue admission rechecks the session incarnation, registered owner, invocation status and input.
Diagnostics show the latest twenty invocations from up to sixteen recently loaded
sessions. Evicted sessions reload their durable history on demand. Completed in-memory entries omit
retry input payloads; Tape retains the audit record. Malformed persisted JSON is skipped.

Projection reads persisted accepted results; it never executes a hook or performs source/network
inspection. `plugin_context` is a distinct attributed prompt-assembly section. Each contribution
carries installation ID, digest, invocation ID and Tape entry ID. Instructions remain subordinate
to host policies and explicit user instructions. Session handlers are replaced by their latest
invocation, including failure/empty output; input handlers are filtered to the current **user**
message ID, not the assistant response ID.

The loop reapplies current projection before budgeting and dispatch, and rechecks it at the
provider authority boundary. Disable/update removes obsolete contributions from subsequent
requests. A request already sent cannot be recalled. Hook context remains separate from ordinary
conversation summaries; historical evidence does not grant permission to execute a revoked Skill.

### Ponytail behavior

Ponytail's initial startup runs before `/ponytail off`, so the explicit off command wins that
input. Ordinary turns and child creation do not rerun top-level startup. Child context uses
Ponytail's current shared mode. Data is shared by one installation across sessions: another
session's startup can reset the mode to the configured default. Ponytail also stores default
configuration outside `PLUGIN_DATA`. Resume/compact execute its original SessionStart handler,
which reapplies that default. DeepChat does not rewrite the package or invent session isolation.

## 6. Existing Skill integration

Each declaration calls `registerPluginSkill()` with installation owner, Skill root and immutable
plugin root. Existing parsing, agent assignments, extensions, selection, materialization and
execution remain authoritative. Duplicate names fail activation instead of silently replacing
another Skill. The shared Skill management record preserves `ownerPluginId` so a disabled
contribution retains its assignment and cannot be claimed by another plugin.

Temporary unregister preserves assignment/override records; permanent uninstall removes them.
Execution authorization checks the active owner/root using the materialized source ID as well
as existing package and runtime binding checks. A historical provider view cannot execute a
Skill after disable/uninstall or after its revision has been replaced. No broad namespacing
migration is introduced.

## 7. MCP configuration adapter

MCP format adaptation translates portable server declarations into the existing
`MCPServerConfig`. It is not a new wire protocol or authentication implementation.

Accept a direct map, `mcp_servers` wrapper, or the common `mcpServers` wrapper. Reject conflicting
wrappers, transports, header aliases and simultaneous command/URL declarations. Unknown
operational/restrictive fields make that server unavailable instead of weakening restrictions.
`enabled: false` is inert. `autoApprove` never grants host tool permission.

| Portable declaration                                           | Existing DeepChat configuration                      |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `command`, `args`, `env`, forwarded `env_vars`, optional `cwd` | stdio process; default cwd is installed package root |
| `url`, `type: http` or implicit URL transport                  | Streamable HTTP `baseUrl`                            |
| `type: sse`                                                    | Existing explicit legacy SSE transport               |
| `headers`, `http_headers`                                      | `customHeaders`                                      |
| `env_http_headers`                                             | Named environment references in headers              |
| `bearer_token_env_var`                                         | `Authorization: Bearer ${NAME}` binding              |
| `${PLUGIN_ROOT}` and root/data aliases                         | Installed paths, never mutable source paths          |
| `${NAME}`, `${env:NAME}`                                       | Explicitly supplied, per-server setup values         |

Remote URLs require HTTPS, with HTTP allowed only for loopback endpoints (`localhost`, `127.0.0.1`
and `[::1]`). URLs are literal and cannot contain environment placeholders; credentials belong in
header bindings. Resolved header values must satisfy the same byte and CR/LF limits as literal
headers. Relative stdio cwd values resolve against the installed plugin root after
variable expansion.

Server names become `<installation-id>.<declared-name>`. Existing host-generated server identity
and configuration generation remain authoritative. Portable servers register with eager discovery
for tools/prompts/resources, since packages do not have to ship a static tool catalog. Existing
global MCP enablement still applies. A selected but disconnected server never reports as running.

Missing variables are listed in the plugin details. User plugins never resolve declared variables
from the host process environment. Setup values are encrypted through the existing SecretStore,
separate from MCP configuration, plugin metadata, packages and hook records. MCP settings retain
templates; connection setup substitutes only explicit bindings for that server. Details keep the
setup form available for credential rotation without displaying saved values. Bindings are scoped
to the owner, transport, endpoint/command, arguments, working directory and variable/header templates.
Changing that scope requires fresh setup; disable preserves bindings. OAuth and MCP App authorization
use existing owners. Rotation and endpoint/revision changes revoke old App/connection authority.
Update backups contain wrapped ciphertext alongside MCP configuration and are deleted after successful
commit/recovery. Cleanup failures still restore the previous MCP configuration and credentials;
the plugin remains disabled when runtime cleanup prevents reactivation. Recovery failures release
the mutation lock. There is no OpenAI account or connector-ID adapter.

## 8. Source/process bounds

Git preparation performs a public HTTPS bare fetch with optional ref, resolves an immutable
commit and uses `git archive`. It disables repository hooks, templates, system/global Git config,
credential helpers, interactive prompts, redirects, file/ext protocols and submodule recursion.
There is no checkout filter, install script, npm hook or marketplace parsing step.

| Limit                           | Value                                           |
| ------------------------------- | ----------------------------------------------- |
| Archive / Git transport storage | 200 MiB                                         |
| Extracted package tree          | 256 MiB                                         |
| Entries                         | 4096                                            |
| Single file                     | 64 MiB                                          |
| JSON configuration              | 1 MiB                                           |
| Git subprocess                  | 60 seconds; 64 KiB captured output              |
| ZIP central directory           | 16 MiB; no encrypted, multidisk or ZIP64 layout |

ZIP extraction uses the bounded streaming Skill archive implementation with abort support, plus
central-directory file-kind validation. Local directories and Git output undergo the same
snapshot checks. Git storage size is monitored during transport. Package files cannot escape
private staging through links or paths. Filesystem metadata and hashes do not authenticate a
publisher; user selection authorizes inspected native code.

## 9. User interface and typed routes

```text
Plugins                   [Install from Git] [Install from ZIP]
  Built-in tools
  Official plugins                  [Enable]
  User packages                     [Details]

Install
  Git URL / ZIP, ref, package directory
  [Inspect package]
  Source and resolved commit
  Supported components and compatibility findings
  [x] Skills
  [ ] Reviewed automatic hooks      commands and limits
  [ ] Reviewed MCP connections      commands / endpoints / setup variables
      Environment and headers       visible template declarations
  [Cancel]                          [Install]

Details
  Name, description, enabled state  [Enable / Disable]
  [Review update] [Reload] [Uninstall]
  Source                            > Technical details
  Skills / Hooks / MCP              selected state
  Hook activity                     retry failures explicitly
  MCP setup and connection state    [Save replacement values] [Open MCP settings]
  Uninstall confirmation            [Cancel] [Uninstall]
```

The install dialog owns temporary form/review state. Generation guards discard stale inspection
and native-picker responses after close. Publication prevents closing while applying. Existing
catalog mutation versions protect status updates. User packages route to their detail page
before enablement; official quick actions remain intact. Dialog primitives provide focus trapping,
keyboard dismissal and scrolling; long paths/commands wrap. User copy uses vue-i18n.

Typed routes are `plugins.inspectSource`, `plugins.installUser`, `plugins.uninstallUser`,
`plugins.discardPrepared`, `plugins.configureMcp`, and `plugins.retryHook`, alongside existing
list/get/enable/disable. Native file selection uses `DeviceClient`. No untyped action bag or native process API is exposed to the renderer.

## 10. Validation and release boundary

Durable tests cover static parsing, source integrity, bounded execution, retry/recovery, ownership,
assignment preservation and update rollback. Electron smoke tests exercise real install UI, stdio MCP,
authenticated HTTP MCP and hook content in actual provider requests. Build checks retain normal
provider/ACP registry refreshes.

macOS is the exercised native platform. Windows shell overrides/path rules are implemented, but
Windows/Linux process and UI claims require their own native runs. Unsupported hook boundaries,
private Git authentication, marketplace/services, creator/export UI, full tool-decision hooks,
OpenAI connector IDs and ACP distribution remain outside this delivery.

References inspected on 2026-09-05:
[plugin overview](https://learn.chatgpt.com/docs/plugins),
[package format](https://developers.openai.com/plugins/build/plugins),
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Ponytail](https://github.com/DietrichGebert/ponytail).
