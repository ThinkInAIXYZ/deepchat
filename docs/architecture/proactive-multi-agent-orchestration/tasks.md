# Proactive Multi-Agent Orchestration Tasks

## Architecture

- [x] Reconcile Codex proactive delegation, Claude dynamic Workflow, DimAgent saved Workflow, and
  DeepChat Tape boundaries.
- [x] Define policy, executor, runtime, evidence, and UI ownership.
- [x] Define migration and compatibility requirements.
- [x] Update the retained Workflow Runtime specification and plan.
- [x] Review and commit the architecture slice.

Architecture review findings, ordered by severity:

- high, fixed before commit: exposing a generic built-in `workflow` function under both policies
  would globally shadow an unrelated MCP function with the same name; built-in orchestration
  functions now require DeepChat-specific model-facing names with legacy presentation parsing;
- medium, fixed before commit: renaming only the TypeScript field would leave a misleading
  `orchestration_mode` database column as a long-term second vocabulary; the forward migration now
  renames the physical column and confines legacy values to compatibility boundaries;
- low: no remaining architecture finding.

Architecture validation evidence:

- retained Workflow specification and plan explicitly defer session policy to this architecture;
- historical completed mode tasks remain documented but are marked superseded rather than silently
  rewritten;
- `git diff --check` passed.

## Workflow Preparation

- [x] Omit unsupported `undefined` values from execution snapshots.
- [x] Validate source before resolving launch scope.
- [x] Add a single versioned authoring contract with signatures and examples.
- [x] Add semantic helper-shape diagnostics before approval.
- [x] Add regression tests for host snapshot and foreign-dialect scripts.
- [x] Review and validate the preparation slice.
- [x] Commit the preparation slice.

Preparation review findings, ordered by severity:

- high, fixed before commit: the first AST property reader handled only member expressions, which
  made ordinary helper option objects appear to omit required keys; property nodes and quoted
  static keys now share the correct lookup path and have regression coverage;
- high, fixed before commit: allowing a caller-supplied precomputed outline at the approval
  boundary could let a future call site display a summary that did not describe the approved
  source; the bounded source is deliberately revalidated and reprojected inside the registry;
- medium, fixed before commit: the snapshot hash was normalized while the pending launch request
  still retained explicit `undefined` values; the registry now retains the same normalized snapshot
  that it hashes and later executes;
- medium, fixed before commit: malformed foreign helper dialects previously reached parent-session
  resolution and could be masked by an unrelated generation-setting error; source validation now
  happens first and returns the exact supported signature with a source location;
- low: no remaining preparation finding.

Preparation validation evidence:

- 160 Workflow, authoring, QuickJS, tool, and generation-setting tests passed under the current
  Node ABI;
- all 39 `WorkflowService` tests passed under Electron's Node ABI with native SQLite required;
- `pnpm run typecheck:node` passed;
- targeted Oxfmt, Oxlint, and `git diff --check` passed.

## Policy And Routing

- [x] Replace `adaptive | workflow` with `explicit | proactive`.
- [x] Add migration and compatibility normalization.
- [x] Remove live-delegation and Workflow mutual exclusion.
- [x] Add developer-level explicit/proactive policy instructions.
- [x] Keep reasoning settings independent in Session and draft flows.
- [x] Update typed routes, preload, renderer stores, commands, and tests.
- [x] Review and validate the policy slice.
- [x] Commit the policy slice.

Policy review findings, ordered by severity:

- high, fixed before commit: `/workflow` still toggled the former executor mode, which contradicted
  the new policy contract and made a Workflow navigation command silently change future Agent
  behavior; the exact command now opens the Workflow surface and named commands only prepare saved
  Workflows;
- medium, fixed before commit: generic policy capability and IPC ownership still depended on
  `WorkflowLaunchScopeResolver`; capability resolution and routes now live in the orchestration
  domain while Workflow retains only executor-specific launch scope;
- medium, fixed before commit: a Session deleted during proactive-policy admission caused the
  rejection path to read the missing Session again and throw instead of returning its typed
  receipt; the route now returns a stable fail-closed `explicit` rejection for that exact race;
- medium, fixed before commit: the existing Agent-config migration followed the renamed Workflow
  constant and could leave the legacy built-in `workflow` override behind on a direct upgrade;
  migration now removes both legacy and current DeepChat-only names;
- medium, fixed before commit: orchestration policy remained in the tool-catalog context and cache
  fingerprint even though it no longer selects an executor; policy now changes only the system
  prompt, while catalogs invalidate only for actual capability or tool changes;
- low, fixed before commit: a dead `mode-controlled` exposure value, an ambiguous legacy constant,
  and an empty inactive icon slot preserved obsolete vocabulary or layout cost; all three were
  removed;
- low: no remaining policy-slice finding.

Policy validation evidence:

- 343 policy, route, prompt, tool, Session, settings, and Workflow scope tests passed;
- 382 renderer client, composer, status bar, page, store, activity, and approval tests passed;
- 12 native SQLite table and forward-migration tests passed under Electron's Node ABI;
- `pnpm run typecheck:node`, `pnpm run typecheck:web`, `pnpm run lint`, and `pnpm run i18n`
  passed;
- targeted Oxfmt and `git diff --check` passed.

## Live Delegation V2

- [x] Add lifecycle spawn, message, follow-up, list, wait, and interrupt contracts.
- [x] Persist child thread and turn identity before handoff.
- [x] Add bounded parent mailbox completion.
- [x] Reconcile interrupted live delegation after restart.
- [x] Preserve compatibility for the batch orchestrator without duplicate model tools.
- [x] Share child invocation capabilities without merging state machines.
- [x] Add concurrency, cancellation, permission, Tape, and recovery tests.
- [x] Review, validate, and commit lifecycle slices.

Persistence foundation review findings, ordered by severity:

- high, fixed before commit: installing a child-ownership trigger before an old `new_sessions`
  table had gained its Subagent columns made forward migration fail while altering that table; the
  trigger is now installed conditionally during bootstrap and unconditionally only after v60;
- high, fixed before commit: SQLite foreign-key enforcement is not globally enabled, so deleting a
  parent Session could leave delegation, turn, and mailbox rows behind; explicit cleanup triggers
  now preserve ownership semantics independently of connection pragmas;
- medium, fixed before commit: a child ID could be bound without proving that it was a direct
  Subagent of the recorded parent; the database now rejects unrelated or regular Sessions and the
  repository keeps child binding immutable;
- medium, fixed before commit: migration SQL initially embedded trigger bodies that the generic SQL
  splitter cannot execute atomically; table/index creation and trigger finalization now follow the
  established Workflow migration boundary;
- low: no remaining persistence-foundation finding.

Persistence foundation validation evidence:

- 12 native repository, v60 migration, and retained Workflow migration tests passed under
  Electron's Node ABI;
- the legacy v20 missing-Subagent-column migration regression passed under Electron's Node ABI;
- `pnpm run typecheck:node`, targeted Oxfmt, targeted Oxlint, and `git diff --check` passed.

Lifecycle service and model-tool review findings, ordered by severity:

- high, fixed before commit: the model catalog exposed `deepchat_subagents` while the dynamic
  orchestration prompt still detected and instructed the hidden `subagent_orchestrator`; the prompt
  now derives guidance from the actual model-facing tool and the legacy name remains call-routing
  compatibility only;
- high, fixed before commit: the new built-in name was not in ToolService's reserved-name set, so
  an untrusted MCP definition could collide with a call that native routing would execute as a
  built-in; both the current and legacy native names are now reserved and collision-tested;
- high, fixed before commit: service shutdown did not await in-progress restart reconciliation,
  allowing a late recovery continuation to touch a database after maintenance closed it; shutdown
  now fences the reconciliation promise before settling active turns;
- high, fixed before commit: `follow_up` could persist and schedule a second turn while the stable
  child Session was already generating through another entry point; it now checks before mutation
  and again before handoff, while still allowing an errored child to recover on a later turn;
- medium, fixed before commit: one failed child lookup aborted reconciliation for every later
  delegation; each active record now converges independently and persists a bounded interrupted
  result on recovery failure;
- medium, fixed before commit: mailbox waits could return fifty 16 KiB results and silently label
  truncated text as complete `content`; model DTOs now expose bounded 2 KiB `contentPreview` plus
  `contentTruncated`, while durable evidence remains intact;
- medium, fixed before commit: runtime update failures could escape an event callback or become an
  unhandled rejection, and arbitrary error text could exceed the repository contract; update paths
  are contained and terminal errors are bounded before persistence;
- medium, fixed before commit: persisted child metadata could ambiguously claim both Workflow and
  live-delegation ownership; lifecycle creation, database parsing, and shared route contracts now
  enforce exactly one orchestration owner;
- medium, fixed before commit: child output lacked an explicit prompt-injection boundary; shared
  model guidance now treats child results as untrusted evidence rather than instructions;
- low: no remaining finding in the lifecycle service/model-tool slice. Shared effect evidence,
  write safeguards, permission projection tests, and activity UI remain explicitly pending.

Lifecycle service and model-tool validation evidence:

- all 184 Agent-tool and ToolService tests passed;
- 42 Session lifecycle, Session parsing, base prompt, and dynamic system-prompt tests passed;
- 15 native live-delegation repository, migration, lifecycle, Tape, cancellation, mailbox, and
  restart tests passed under Electron's Node ABI with native SQLite required;
- the provider tool-snapshot harness regression passed;
- `pnpm run typecheck:node`, `pnpm run typecheck:web`, targeted Oxfmt, targeted Oxlint, and
  `git diff --check` passed.

Shared effect boundary and activity completion review findings, ordered by severity:

- high, fixed before commit: restart reconciliation could await child lookup, race with a direct
  interrupt that terminally persisted the turn, and then register the stale active-turn snapshot
  again; that direct path also failed to send cancellation to the physical child. Interruption now
  terminally persists first while retaining its effect guard, requests child cancellation, and
  reconciliation re-reads persistent state after the asynchronous boundary; a dedicated regression
  proves interrupted turns cannot be revived or left without a cancellation request;
- high, fixed before commit: active child-to-turn effect indexes were rebuilt only as asynchronous
  reconciliation progressed, leaving early post-restart tool calls without write-ahead evidence;
  startup now indexes every persisted active child synchronously before subscribing or yielding;
- high, fixed before commit: reusing `chat.workflow.title` for the combined activity surface would
  also rename the `/workflow` command and durable Workflow cards; Agent activity now has a separate
  i18n key while retained Workflow surfaces keep their established contract;
- medium, fixed before commit: `orchestration.*` routes remained callable while database
  maintenance had stopped the live service and could close the main database; the application
  maintenance gate now rejects the whole orchestration route domain consistently with Workflow;
- medium, fixed before commit: Live change events initially projected full inspection details,
  repeatedly parsing and truncating twenty turns for updates that require only one summary; event
  publication now uses the bounded single-delegation projection;
- medium, fixed before commit: generic persisted Tape objects and loosely bounded effect data made
  IPC size and audit meaning dependent on unvalidated JSON; strict shared schemas now bound IDs,
  previews, evidence, Tape receipts, detail arrays, and event/list outputs;
- medium, fixed before commit: collapsing the activity surface destroyed its subscription, and
  list or interrupt responses could overwrite newer event state, including an A -> B -> A Session
  switch; the subscription remains mounted and revision plus request-generation fences reject stale
  responses;
- medium, fixed before commit: finishing an active persisted turn before recovery registered its
  in-memory controller did not publish the unified change event; direct persistent interruption now
  publishes the same projection as ordinary settlement;
- low, fixed before commit: unknown model-tool fields were silently stripped, the activity title
  remained English in non-English locales, and a route test name claimed an ownership assertion it
  did not perform; strict parsing, localized copy, and accurate test naming remove those misleading
  contracts;
- low: no unresolved completion-slice finding. V1 still deliberately does not promise exactly-once
  external effects or automatic parallel-writer isolation.

## UX

- [x] Rename Workflow mode copy to proactive collaboration.
- [x] Preserve reasoning-only button text and branch-icon accent.
- [x] Change `/workflow` from a mode switch to Workflow navigation/preparation.
- [x] Project live and durable work in one activity surface.
- [x] Add policy-control i18n, accessibility, and renderer tests.
- [x] Review, validate, and commit UX slices.

## Final Validation

- [x] Run affected main and renderer suites.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run build`.
- [x] Perform the final cross-module review and record findings by severity.
- [x] Confirm all commits remain local and the branch was not pushed.

Final validation evidence:

- 84 portable main-process tests passed and 21 native-ABI tests were explicitly skipped by the
  portable harness;
- all 92 orchestration and retained Workflow persistence, migration, service, effect, and recovery
  tests passed under Electron's Node ABI with native SQLite required;
- all 17 orchestration client, Live Delegation panel, and combined activity-panel renderer tests
  passed;
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and
  `git diff --check` passed;
- the production build retained only the repository's existing Rollup chunk-size and Iconify
  import-shape warnings; provider refresh stopped at its configured 5 MB download guard without
  overwriting the retained generated catalog;
- all implementation commits are local to `feat/workflow-runtime`; no push was performed.

## Inline Live Delegation Visibility

- [x] Define task-first naming and inline visibility contracts without adding another identity.
- [x] Add one revision-aware renderer projection shared by inline and side-panel consumers.
- [x] Render trusted live-delegation spawns as persistent task cards with child navigation.
- [x] Preserve raw tool disclosure and exclude the task cards from generic activity collapse.
- [x] Add naming, trust-boundary, stale-response, navigation, and rendering regressions.
- [x] Review findings by severity, fix material issues, validate, and commit locally without push.

Inline visibility review findings, ordered by severity:

- high, fixed before commit: transcript snapshots initially carried executable child navigation and
  interruption data without re-establishing ownership through the main-process repository; inline
  actions now confirm the parent/delegation relationship, immutable task metadata, and child binding
  before acting, while authoritative host data always replaces transcript revisions;
- medium, fixed before commit: transcript-seeded entries could appear in Agent activity and affect
  its count even though they were not host-confirmed; the side panel now consumes only authoritative
  projections while historical inline cards retain a non-authoritative display fallback;
- medium, fixed before commit: concurrent consumers could observe an incomplete initial load, and
  list, event, inspect, or interrupt responses lacked one shared relationship/revision merge path;
  loads and actions are deduplicated and every authoritative response is correlated before merge;
- medium, fixed before commit: tightening new task titles to 80 characters would have hidden earlier
  81-160 character transcript cards; new spawns use the concise limit while the renderer retains the
  persisted 160-character compatibility bound;
- low, fixed before commit: string-keyed object projections and a control-character regular
  expression created avoidable prototype-key and lint ambiguity; reactive Maps/Sets and explicit
  code-point validation make both boundaries unambiguous;
- low: no unresolved inline-visibility finding. V1 intentionally keeps opaque IDs for routing and
  does not add persona nicknames, canonical Agent paths, or nested Subagent addressing.

Inline visibility validation evidence:

- 58 affected portable main-process tests passed; 21 native SQLite tests were skipped by the
  portable harness, unchanged from the existing suite configuration;
- 107 orchestration client, shared projection, task-card, message-grouping, side-panel, and retained
  Workflow renderer tests passed;
- `pnpm run format`, `pnpm run format:check`, `pnpm run i18n`, `pnpm run lint`,
  `pnpm run typecheck`, `pnpm run architecture:renderer-baseline:check`, `pnpm run build`, and
  `git diff --check` passed;
- the production build retained only existing Rollup chunk/import warnings; provider refresh stopped
  at its 5 MB guard, and the unrelated ACP registry refresh was excluded from this change.
