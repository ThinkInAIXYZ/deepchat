# User Plugins Implementation and Verification

Status: implemented and validated on 2026-09-06.
Branch: `codex/user-plugin-compatibility-plan`, including `dev` at `e9f909519`.

The final contract is [spec.md](spec.md); author instructions are in [authoring.md](authoring.md).
This is the only execution tracker. D1 includes Git/ZIP installation, working context hooks,
existing Skill integration and MCP configuration import. No marketplace/server is required.

## Implementation sequence

### 1. Context boundaries and existing ownership

- [x] Trace accepted input, provider retries, committed compaction and child session ownership.
- [x] Keep existing asynchronous notification hooks unchanged; add the awaited context port.
- [x] Define startup/resume/compact ordering and explicitly unavailable clear semantics.
- [x] Persist invocation identity and accepted/failed/uncertain results in existing Tape anchors.
- [x] Project contributions with the user input's ID, revision and Tape provenance; revoke them
      before subsequent provider dispatch. Keep context out of ordinary conversation summaries.

Completion: context hooks add instructions at supported boundaries without gaining tool decisions,
permissions or authority over user instructions.

### 2. Private source preparation and static package parsing

- [x] Parse `.codex-plugin/plugin.json`, Skill directories, hook JSON and inline/file MCP maps.
- [x] Support public HTTPS Git refs/subdirectories, bounded ZIP and snapshot-only developer input.
- [x] Resolve a pinned Git commit without checkout hooks, credentials, filters or submodules.
- [x] Enforce path/file-kind/case/Unicode, count and size limits; retain executable ZIP flags.
- [x] Bind review to private bytes and digest; cancel/discard late operations and recover staging.
- [x] Surface unsupported components and reject installation with no selected usable component.

Completion: inspection executes no package code and cannot grant official provenance.

### 3. Reviewed hook command execution

- [x] Support command handlers for SessionStart, UserPromptSubmit and SubagentStart.
- [x] Use minimal environment, selected Toolchain paths, stable data/root aliases and Windows overrides.
- [x] Bound input/output/context, timeout and serialized execution; terminate owned descendants.
- [x] Reject control decisions and stale output; preserve provider retry idempotency.
- [x] Retry only the failed/uncertain handler on explicit request, with a fresh invocation identity.

Completion: original Ponytail helpers execute without source rewriting. Shared data and separate
Ponytail default configuration are documented rather than presented as isolated per-session state.

### 4. Skill and MCP contribution integration

- [x] Reuse Skill registration, assignment/overrides and verified execution; reject owner collisions.
- [x] Preserve assignments on disable/update and revoke historical Skill execution after owner removal.
- [x] Import direct/wrapped/inline stdio, HTTP and explicit SSE definitions into existing MCP settings.
- [x] Add typed cwd/named environment binding only; retain existing transport/authentication owners.
- [x] Register stable owned server identities and eager discovery; show missing setup independently.
- [x] Ignore auto-approval grants and reject unsupported restrictions instead of weakening them.
- [x] Invalidate connection/App authority on endpoint change and keep rollback secrets in MCP storage.

Completion: Skills and MCP remain under their existing owners; unrelated resources are unaffected.

### 5. Installation, update and recovery

- [x] Add user installation records and private revision/data paths without changing official IDs.
- [x] Install disabled, review each update, serialize lifecycle mutations and retain previous revision.
- [x] Reject updates during active DeepChat turns; prevent concurrent disable from reactivating hooks.
- [x] Roll back package selection and owned MCP configuration after failure or interrupted publication.
- [x] Preserve offline snapshots, repair inactive corruption and prune only owned unreferenced revisions.
- [x] Remove private data, owned MCP resources and Skill assignments on uninstall; retain Tape history.

Completion: the visible enabled state, active revision and contribution owners recover coherently.

### 6. User interface and developer guide

- [x] Add typed inspect/install/update/uninstall/discard/setup/retry routes and PluginClient methods.
- [x] Add Git/ZIP review dialog and user detail management within the existing Plugins Hub.
- [x] Keep Skills selected and execution capabilities unselected before review; install disabled.
- [x] Preserve catalog mutation guards, native file selection, dialog focus/scrolling and cancellation.
- [x] Add localized copy with Chinese variants, source/command/setup review and expandable identifiers.
- [x] Provide complete Skill/hook/MCP authoring examples and static `plugin:validate --plugin-root`.
- [x] Maintain Plugins Hub, Shared Skills and harness contracts, including BEFORE/AFTER ASCII UI.

## Executed acceptance

### Original Ponytail 4.9.0

The public Git tag resolves to `0a4dd63ad4541f4f655c4108a295916f3c1d8fda`.
The original files were inspected through Git and an enclosing-folder ZIP; both normalize to
six Skills and three hooks. A temporary acceptance probe used isolated HOME and plugin data,
ran original upstream helpers, and was removed from the repository after verification.

Verified behavior:

- Startup context followed by an initial `/ponytail off` result.
- `/ponytail ultra`, ordinary turns retaining mode, and child context inheriting ultra.
- A second top-level session resetting shared mode to the configured default.
- `/ponytail default lite` changing defaults independently of current active mode.
- Successful compact and application-restart resume applying that default.
- Replay of an already admitted input executing no command again.
- All inspected original hook invocations completed; static CLI package validation passed.

This proves package/handler compatibility on macOS. It does not assert identical model behavior
or native Windows/Linux compatibility for Ponytail's POSIX commands.

### Durable regression protection

- `test/main/plugin/userPlugins.test.ts`: parsing/wrappers, restrictive fields, private snapshots,
  links/traversal, executable ZIP flags, startup/input/child ordering, revocation, uncertain crash,
  limits, named environment variables, isolated explicit retry and resume-only lifecycle persistence.
- `test/main/plugin/userPluginLifecycle.test.ts`: install-disabled, stable MCP identity/setup,
  owner-safe uninstall, active-turn update rejection, publication rollback, interrupted recovery
  and concurrent disable.
- Skill suites: preserved assignment/overrides, owner collision and stale source execution rejection.
- `test/e2e/specs/34-user-plugin-install.smoke.spec.ts`: real Electron ZIP review/install/enable/
  disable/uninstall with working stdio MCP; independent HTTP bearer authentication; accepted hook
  output in actual provider requests, next-input replacement and disable revocation.

The HTTP fixture uses the installed MCP SDK and a local test endpoint. The model fixture captures
actual outgoing OpenAI-compatible requests; it does not mock the plugin/runtime integration.
E2E user data is isolated from the user's existing DeepChat configuration.

## Repository gates

Results on the completed implementation:

| Check | Result |
| --- | --- |
| Format and format check | Passed |
| i18n | Passed: 20 locales, no missing or invalid keys |
| Lint and repository guards | Passed |
| Main/renderer typecheck | Passed |
| Full app and CLI build | Passed; existing bundle-size warnings only |
| Relevant Vitest suites | 55 files passed, 4 skipped; 1,589 tests passed, 73 skipped |
| Native Tape suites under Electron | 23 files passed, 1 skipped; 488 tests passed, 1 standalone worker fixture skipped |
| Real Electron acceptance | 3 tests passed: plugin lifecycle, HTTP MCP/hooks and prompt scrolling |
| Original Ponytail Git/ZIP and hooks | Passed at the pinned commit above |
| Static portable CLI validation | Passed on Node 24 |
| Document links / diff whitespace | Passed |

The 800 × 620 Electron window was visually inspected in light and dark appearances. Review
commands and long paths wrap inside the scrolling dialog; detail actions remain reachable.
The Node test run skips native SQLite cases because its ABI differs from the installed Electron
binding. The native Tape run requires SQLite support and covers these cases, including real
SIGKILL recovery; its standalone worker fixture runs through the crash-recovery tests.
The new regression suite also verifies resume-only handlers when no startup matcher ran.
Temporary acceptance probes were removed. Normal build-generated provider/ACP registry changes
are retained. There are no package dependency changes.

Reproduction commands:

```sh
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm exec playwright test --config test/e2e/playwright.config.ts 34-user-plugin-install 34-prompt-editor-scroll
ELECTRON_RUN_AS_NODE=1 DEEPCHAT_REQUIRE_NATIVE_SQLITE=1 pnpm exec electron \
  node_modules/vitest/vitest.mjs run --config vitest.config.ts --project main \
  test/main/session/data/tape test/main/tape
```

Run the affected plugin, Skill, notification-hook, MCP, runtime/context and renderer suites.
Oxfmt excludes Markdown and some established source owners; verify document links and whitespace
separately. Preserve provider/ACP registry refreshes produced by the normal build.

## Supported release claims and limitations

- Native execution and Electron UI were exercised on macOS. Windows/Linux require native validation
  before publishing equivalent platform claims; unsupported Windows hook commands report findings.
- Public HTTPS Git only. Private repository login, marketplaces, automated updates and publishing
  services are outside D1.
- Context-only command hooks. `clear`, tool/permission decisions, ACP propagation and OpenAI
  connector IDs are unavailable.
- Hook data is shared across sessions per installation. Failed/uncertain explicit retries can repeat
  side effects. Diagnostics load persisted session history on demand in the current app process.
- Missing MCP runtime/credentials remain visible component setup errors. A plugin's enabled intent
  does not imply that every declared server is connected.
