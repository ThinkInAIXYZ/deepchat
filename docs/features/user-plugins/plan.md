# User Plugins Implementation and Verification

Status: implemented and validated on 2026-09-07.
Branch: `codex/user-plugin-compatibility-plan`, including `dev` at `b4d93c926`.

The final contract is [spec.md](spec.md); author instructions are in [authoring.md](authoring.md).
This is the only execution tracker. D1 includes Git/ZIP installation, working context hooks,
existing Skill integration and MCP configuration import. No marketplace/server is required.

## Implementation sequence

### 1. Context boundaries and existing ownership

- [x] Trace accepted input, provider retries, committed compaction and child session ownership.
- [x] Keep existing asynchronous notification hooks unchanged; add the awaited context port.
- [x] Define startup/resume/compact ordering and invalidate history when messages are cleared.
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
- [x] Revalidate queued retries against session incarnation, owner, invocation and runtime activity.

Completion: original Ponytail helpers execute without source rewriting. Shared data and separate
Ponytail default configuration are documented rather than presented as isolated per-session state.

### 4. Skill and MCP contribution integration

- [x] Reuse Skill registration, assignment/overrides and verified execution; reject owner collisions.
- [x] Preserve assignments on disable/update and revoke historical Skill execution after owner removal.
- [x] Import direct/wrapped/inline stdio, HTTP and explicit SSE definitions into existing MCP settings.
- [x] Add typed cwd/named environment binding only; retain existing transport/authentication owners.
- [x] Register stable owned server identities and eager discovery; show missing setup independently.
- [x] Ignore auto-approval grants and reject unsupported restrictions instead of weakening them.
- [x] Invalidate connection/App authority on endpoint change and keep encrypted rollback bindings with MCP storage.

Completion: Skills and MCP remain under their existing owners; unrelated resources are unaffected.

### 5. Installation, update and recovery

- [x] Add user installation records and private revision/data paths without changing official IDs.
- [x] Install disabled, review each update, serialize lifecycle mutations and retain previous revision.
- [x] Reject updates during active DeepChat turns; prevent concurrent disable from reactivating hooks.
- [x] Roll back package selection and owned MCP configuration after failure or interrupted publication.
- [x] Restore MCP configuration and encrypted credentials even when failed-revision cleanup rejects.
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
  Also covers non-executable metadata, remote HTTPS, edited/reverted prompts, cleared Tape history,
  queued cancellation, stale in-flight output, split UTF-8 process output and queued retry rejection
  after session clear, owner replacement, turn admission or update admission.
- `test/main/plugin/userPluginLifecycle.test.ts`: install-disabled, stable MCP identity/setup,
  owner-safe uninstall, active-turn update rejection, publication rollback, interrupted recovery
  concurrent disable, encrypted credential rotation and repeated recovery/cleanup failures. Failed
  revision cleanup cannot skip restoration of the old endpoint and encrypted credentials.
- Skill suites: preserved assignment/overrides, owner collision and stale source execution rejection.
- Runtime suites: compaction projection survives hook dispatch failure; ACP dispatch excludes plugin
  context; callers without optional view metadata retain the accepted user's context.
- `test/e2e/specs/34-user-plugin-install.smoke.spec.ts`: real Electron ZIP review/install/enable/
  disable/uninstall with working stdio MCP; independent HTTP bearer authentication; accepted hook
  output in actual provider requests, next-input replacement and disable revocation.

The HTTP fixture uses the installed MCP SDK and a local test endpoint. The model fixture captures
actual outgoing OpenAI-compatible requests; it does not mock the plugin/runtime integration.
E2E user data is isolated from the user's existing DeepChat configuration.

## Repository gates

### Runtime and credential invariants

- [x] Parse Skill front matter without executable engines across inspection, import and discovery.
- [x] Require explicit, encrypted MCP variable bindings; preserve templates and credential rotation.
- [x] Bind hook reuse and cached history to prompt content and Tape incarnation; bound the cache.
- [x] Preserve compaction projection, ACP exclusion and current-input context across runtime paths.
- [x] Recover failed updates without a global mutation lock or an incorrect enabled state.
- [x] Preserve official Skill collision handling and shared installation paths.
- [x] Localize consent, expose binding declarations and use the standard confirmation/checkbox UI.
- [x] Validate security, recovery, persistence and platform-independent regression contracts.

Results on the completed implementation:

| Check | Result |
| --- | --- |
| Format and format check | Passed |
| i18n | Passed: 20 locales, no missing or invalid keys |
| Lint and repository guards | Passed |
| Main/renderer typecheck | Passed |
| Full app and CLI build | Passed; existing bundle-size warnings only |
| Plugin, session, ACP, route and runtime suites | 42 files passed, 9 skipped; 1,160 tests passed, 132 native SQLite tests skipped under Node |
| Native session and Tape suites under Electron | 41 files passed, 1 skipped; 700 tests passed, 1 standalone worker fixture skipped |
| Renderer draft, mode, queue and chat suites | 8 files passed; 172 tests passed |
| Native MCP settings under Electron | 2 tests passed |
| Real Electron plugin acceptance | 2 tests passed: ZIP lifecycle and authenticated HTTP MCP/hooks with credential rotation |
| Original Ponytail Git/ZIP and hooks | Passed at the pinned commit above |
| Static portable CLI validation | Passed on Node 24 |
| Document links / diff whitespace | Passed |

The 800 × 620 Electron window was visually inspected in dark appearance. Review
commands and long paths wrap inside the scrolling dialog; detail actions remain reachable.
The Node run skips native SQLite cases because its ABI differs from the installed Electron binding;
the native session and Tape run covers these cases, including transcript projection, Queue/Steer
transaction rollback and real SIGKILL recovery. Its standalone worker fixture runs through the
crash-recovery tests. Compaction fixtures implement the current transcript projection contract;
database failure checks use SQLite triggers against the persisted rows. Queue recovery includes the
10-item capacity, claimed-slot restoration and atomic rollback when the second Steer message fails.
Harness compaction cases use distinct message IDs to preserve assistant/user row identity.
Temporary acceptance probes were removed. Normal build-generated provider/ACP registry changes
are retained. There are no package dependency changes.

Reproduction commands:

```sh
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm exec vitest run test/main/plugin/userPlugins.test.ts test/main/plugin/userPluginLifecycle.test.ts \
  test/main/agent/deepchat/runtime/compactionRuntimeCoordinator.test.ts \
  test/main/agent/deepchat/runtime/deepChatLoopRunner.test.ts \
  test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts test/main/session \
  test/main/agent/acp/compatibility/adapters.test.ts test/main/routes/dispatcher.test.ts
pnpm exec vitest run --config vitest.config.renderer.ts \
  test/renderer/pages/NewThreadPage.test.ts test/renderer/components/NewThreadPage.test.ts \
  test/renderer/components/NewThreadPage.onboarding.test.ts test/renderer/components/ChatPage.test.ts \
  test/renderer/components/PendingInputLane.test.ts test/renderer/composables/useChatMode.test.ts \
  test/renderer/stores/pendingInputStore.test.ts test/renderer/stores/draft.test.ts
pnpm exec playwright test --config test/e2e/playwright.config.ts 34-user-plugin-install
ELECTRON_RUN_AS_NODE=1 DEEPCHAT_REQUIRE_NATIVE_SQLITE=1 pnpm exec electron \
  node_modules/vitest/vitest.mjs run --config vitest.config.ts --project main \
  test/main/session/data test/main/tape test/main/session/runtimeIntegration.test.ts \
  test/main/session/transcriptMutations.test.ts test/main/session/usageStatsService.test.ts
ELECTRON_RUN_AS_NODE=1 pnpm exec electron node_modules/vitest/vitest.mjs run \
  --config vitest.config.ts --project main test/main/mcp/data/settingsTable.test.ts
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
