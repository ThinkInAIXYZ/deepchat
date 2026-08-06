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

## Referenced Result Handoff

- [x] Define the canonical final-answer projection and result-reference contract.
- [x] Add the additive live-delegation result-reference migration and compatibility parsing.
- [x] Persist bounded, explicitly truncated Handoffs without copying process/tool output.
- [x] Add parent-authorized cursor-based `read_result` retrieval.
- [x] Separate model mailbox Handoff bounds from UI preview bounds.
- [x] Add long-output, multilingual, cursor, ownership, migration, and recovery regressions.
- [x] Review findings by severity, fix material issues, validate, and commit locally without push.

Referenced-result review findings, ordered by severity:

- high, fixed before commit: live delegation treated combined response/tool markdown as the child
  result, so a large process trace could displace the actual conclusion at the 16 KiB storage
  boundary; final answers now use one trailing content-only projection, while the child message is
  canonical and the parent receives a bounded Handoff plus a typed reference;
- high, fixed before commit: restart recovery and missing exact-message lookups could bind an older
  child answer to a later turn; exact references never fall back to another message, and recovered
  latest-message candidates must be at least as new as the accepted turn;
- high, fixed before commit: an exception while storing a result reference could remove the active
  runtime entry while leaving its database turn active forever; settlement now retries without the
  result reference and, if necessary, without optional artifacts so the turn converges to failed;
- medium, fixed before commit: every result page initially loaded and parsed full serialized tool
  responses and reasoning text; the Session tables now expose identity and answer projections that
  omit those potentially large columns, retaining a legacy-only fallback;
- medium, fixed before commit: a fence line with trailing text could be mistaken for a Markdown
  closing fence and expose a fake `## Handoff` from untrusted code examples; closing fences now
  require only the matching marker and whitespace;
- medium, fixed before commit: old serialized task cards and v61 databases lacked `resultRef`; the
  schema defaults historical values to null, migrates additively to v62, and supports explicit
  repair when an already-current database is missing the column;
- low, fixed before commit: aggregate completion events, unavailable references, malformed cursors,
  Unicode page boundaries, and NUL-containing Handoffs had ambiguous or unsafe edge behavior; model
  mailbox content now has a 32 KiB aggregate bound, notices describe the actual recovery path,
  cursors are hash-bound, pages preserve code points, and stored Handoff/error text is sanitized;
- low: no unresolved referenced-result finding. The canonical answer remains subject only to the
  selected model's generation limit; Handoffs and `read_result` pages are bounded transport views,
  not a second full-answer limit.

Referenced-result validation evidence:

- 58 affected orchestration, migration, repository, Session projection, Workflow child, effect,
  and recovery tests passed under Electron's Node ABI with native SQLite required;
- 29 affected portable main-process tests and 17 retained live-delegation renderer tests passed;
- `pnpm run format:check`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`,
  `pnpm run build`, and `git diff --check` passed;
- the broader legacy `mainDatabase.test.ts` run retained 8 pre-existing failures in removed
  presenter APIs and historical schema-version fixtures; 71 tests in that run passed, including all
  changed live-delegation migrations and catalog metadata checks;
- the production build retained only existing Rollup chunk/import warnings; provider refresh
  stopped at its 5 MB guard, and the normal ACP registry refresh was retained.

## Durable Workflow Decommission

- [x] Verify versions 57 and 59 were never included in a tag, `dev`, or `main`.
- [x] Replace the dual-executor specification with a single live-delegation execution plane.
- [x] Define the version-64 forward decommission and protected live-delegation assets.
- [x] Move retained policy and result-safety contracts out of `shared/workflow`.
- [x] Remove the QuickJS Workflow runtime, tool, host, routes, UI, tests, and four dependencies.
- [x] Simplify the unreleased policy migration and add the version-64 cleanup migration.
- [x] Enforce policy-aware consent and untrusted child-result handling.
- [x] Bound pending follow-up messages and make overflow recovery convergent.
- [x] Make global admission state-aware for waiting children.
- [x] Separate per-turn generation snapshots from continuously validated safety state.
- [x] Remove the dead batch orchestrator while retaining historical transcript rendering.
- [x] Evict stale renderer projections and decouple reasoning capability from orchestration UI.
- [x] Complete full validation and the final severity-ordered review.

Decommission facts established before implementation:

- commit `f9ff9056d8b3988a0ea73e7b2e67c4b1dd8f6d09` introduced both version 57 and
  version 59 and is contained only by `feat/workflow-runtime` and its remote-tracking branch;
- no Git tag contains that commit, and it is not an ancestor of `origin/dev` or `origin/main`;
- `acorn` and `ajv` have no source consumers outside the Workflow runtime;
- current feature databases can already record schema version 63, so deletion must advance to 64
  rather than lowering the application's latest version.

Consent and child-result review findings, ordered by severity:

- high, fixed before commit: `full_access` and `auto_approve` could bypass an explicit Session's
  delegation intent because consent existed only in prompt guidance and the model-loop pre-check;
  ToolService now re-evaluates policy immediately before execution and consumes an exact one-shot
  host confirmation for `spawn` and `follow_up`;
- high, fixed before commit: child Handoffs and paged answers returned as ordinary tool JSON, so
  prompt-injected instructions had no machine-readable trust boundary; every live-delegation result
  now uses one versioned untrusted envelope while renderer parsing retains the unreleased legacy
  shape;
- medium, fixed before commit: identical child starts in one batch shared a broker request because
  approvals were bound only to canonical arguments; explicit-user approvals now also bind to the
  stable tool-call execution ID;
- low: no unresolved consent or result-boundary finding. Ordinary child tool permissions remain
  independent from orchestration consent.

Consent and child-result validation evidence:

- 133 affected main-process permission, dispatch, tool, and live-delegation tests passed;
- 43 affected renderer parsing and tool-card tests passed;
- `pnpm run typecheck`, `pnpm run i18n`, `pnpm run lint`, `pnpm run format:check`, and
  `git diff --check` passed.

Renderer cleanup review findings, ordered by severity:

- medium, fixed before commit: deleting a parent Session left its delegation projection resident
  for the renderer lifetime; Session removal now purges the projection and its request bookkeeping;
- medium, fixed before commit: late list, confirmation, or interruption responses could recreate a
  purged projection; response application is now fenced by projection identity;
- medium, fixed before commit: the compact reasoning selector was mounted only when the executor
  owned orchestration, despite reasoning support being a model capability; the selector and
  collaboration section now have independent visibility contracts;
- low: no unresolved renderer lifecycle or capability-coupling finding.

Renderer cleanup validation evidence:

- 83 focused live-delegation store and status-bar tests passed;
- `pnpm run typecheck:web`, `pnpm run lint`, and `git diff --check` passed.

Turn snapshot and live-safety review findings, ordered by severity:

- high, fixed before commit: restoring a queued child turn rebuilt runtime state from an earlier
  permission value and could undo a concurrent downgrade; execution snapshots now atomically
  replace only provider, model, and generation settings while preserving the latest permission and
  rejecting runtime-instance or generation races;
- high, fixed before commit: permission could change after a tool was authorized but before its
  effect intent and actual dispatch; ToolService now binds the effective authorization mode to the
  dispatch boundary, which revalidates live safety and interrupts instead of executing with stale
  authority;
- high, fixed before commit: the composition-layer adapter could mutate a bound Session before the
  service verified its complete parent, slot, and delegation lineage; one testable safety
  coordinator now validates the full identity before any snapshot or security-state write;
- high, fixed before commit: parallel tool boundaries could resolve different parent safety states
  and let an older read converge last; child safety now serializes the complete live re-read and
  mutation boundary, and shutdown drains that boundary before disposing runtime state;
- medium, fixed before commit: a revoked suspended child first queued for a global permit and only
  discovered revocation after reacquisition; safety is now checked before queuing and again after
  the permit is granted;
- medium, fixed before commit: `follow_up` captured settings from a child object read before its
  acceptance gate, and target mismatch was discovered only after restoring that snapshot; the gate
  now re-resolves lineage and capability immediately before capture, while target policy is checked
  both before and after asynchronous restoration;
- medium, fixed before commit: a failed workdir change could leave broad permission on one side of
  the boundary, and `auto_approve` had two different tool-level interpretations; workdir changes
  stage restrictive permission before mutation, while one shared mapper defines effective tool
  authority;
- low: no unresolved turn-snapshot or live-safety finding. Direct ACP children keep their native
  execution target and fail closed if it drifts because DeepChat cannot restore ACP model state.

Turn snapshot and live-safety validation evidence:

- 425 affected portable DeepChat harness, dispatch, settings, ToolService, assignment, policy, and
  orchestration-tool tests passed;
- all 62 orchestration safety, service, repository, route, capability, and migration tests passed
  under Electron's Node ABI with native SQLite required;
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and
  `git diff --check` passed;
- the native Vitest process reported its existing post-success close timeout but exited zero after
  every test passed; the production build retained only existing Rollup annotation/import and chunk
  size warnings;
- the provider refresh retained its existing catalog after the 5 MB download guard, the normal ACP
  registry refresh produced no tracked diff, and source scans found Workflow table names only in
  the version-64 cleanup migration and its regression test;
- all changes remain local to `feat/workflow-runtime`; no push was performed.

## Post-Decommission Integration Review

- [x] Replace duplicated lexical copy order with one foreign-key-aware import/encryption planner.
- [x] Treat empty schema versions as consumed monotonic migration milestones.
- [x] Preserve unread child terminal events while compacting only consumed parent messages.
- [x] Intersect cross-Agent permission with parent authority.
- [x] Restore the durable Agent activity surface and revalidate it on mount.
- [x] Complete focused and full validation.
- [x] Perform the final severity-ordered review and commit locally without pushing.

Review triage, ordered by severity:

- critical, confirmed: lexical database-copy order inserted live-delegation children before their
  parents in both incremental import and encryption migration; one dependency planner now orders
  real foreign keys plus trigger-enforced Session ownership for both paths;
- critical, confirmed: the migration test exposed a real contract mismatch around abandoned
  versions; upgrades now record every traversed version as a high-water mark instead of teaching
  each test a growing exception list;
- high, confirmed: a cross-Agent target with no permission default resolved to `full_access` and
  could elevate a restrictive parent; parent and target modes now form an explicit least-authority
  intersection;
- high, confirmed with corrected impact: row-count pruning could lose durable completion signals,
  although authoritative delegation rows did not remain permanently `running`; terminal events are
  now retained and only consumed parent messages are compacted;
- high, confirmed with corrected impact: inline task cards remained visible, but deleting the
  Workflow panel orphaned the promised Agent activity surface; the live projection is mounted again
  and performs authoritative revalidation when shown;
- medium, not a defect: Session deletion already catches orchestration `AggregateError`, fences new
  work, and completes best-effort cleanup, so the review's undeletable-Session claim described an
  earlier implementation rather than this branch;
- medium, retained by design: inability to revalidate permission, workdir, lineage, or capability
  terminates the current child turn fail-closed. The diagnostic now says the turn could not continue
  safely rather than falsely asserting that state definitely changed;
- low, not reproduced: explicit `spawn` and `follow_up` confirmations are already one-shot and
  execution-ID-bound, while Tape recall remains under the shared untrusted-child-output policy.

Post-decommission validation evidence:

- the six focused portable suites passed all 52 tests covering copy topology, import and encryption
  wiring, permission intersection, authoritative UI revalidation, and the Agent activity surface;
- native SQLite passed all 40 targeted import, durable event, and monotonic migration tests under
  Electron's Node ABI; the wider orchestration-native run passed all 51 repository, migration, and
  service tests;
- the complete portable run passed 741 files and 7,825 tests, with 25 files and 340 tests skipped by
  their existing environment gates;
- `pnpm install --frozen-lockfile`, `pnpm run format`, `pnpm run i18n`, `pnpm run lint`,
  `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed;
- the standalone native `mainDatabase` suite retains eight pre-existing presenter/schema-guard
  failures unrelated to this change; its migration contract is covered by the passing native
  memory migration suite above;
- the production build retained only its existing Rollup annotation/import and chunk warnings, and
  no provider or ACP registry refresh produced an unexpected tracked change.

## Least-Authority Integration Hardening

- [x] Compose cross-Agent built-in and MCP authority without capability elevation.
- [x] Require execution-bound explicit consent at the live-delegation service boundary.
- [x] Make parent active-turn capacity transactional for initial and follow-up turns.
- [x] Preserve pending mailbox messages when a complete follow-up task exhausts the prompt budget.
- [x] Add per-parent waiter fairness without weakening the process-wide resource ceiling.
- [x] Run focused and full validation, then complete a severity-ordered pre-commit review.

Review triage, ordered by severity:

- high, confirmed: cross-Agent assignment intersected only permission mode; target defaults could
  re-enable a parent-disabled built-in tool or widen the parent's MCP allowlist;
- high, confirmed: delegation consent was brokered in the model-tool adapter but not represented in
  the service contract, so a policy race or future direct caller could bypass explicit intent;
- medium, confirmed: the active-parent check and insert were separate, and `follow_up` did not
  participate in the limit at all;
- medium, confirmed: a maximum-sized legal follow-up task could cause pending messages to be marked
  consumed even though neither the messages nor a recovery notice reached the child;
- medium, confirmed: the global waiter ceiling bounded resources but allowed one parent to occupy
  every slot;
- medium, retained by design: unread terminal events cannot be compacted safely without a persisted
  reader cursor, and V1 does not promise automatic isolation for parallel workspace writers;
- medium, not actionable as described: child payloads already cross a typed, locally produced
  untrusted-result envelope. Semantic prompt-injection elimination is not achievable by parsing the
  same valid envelope or filtering child text at the host boundary;
- low, deferred: splitting the tested live-delegation facade and renaming the historical branch are
  maintenance work, not correctness fixes for this integration slice.

Pre-commit review findings, ordered by severity:

- high, fixed: a structural authorization object would have been forgeable by any in-process caller;
  explicit confirmation now crosses the adapter as an opaque, one-shot receipt backed by a private
  `WeakMap` binding;
- high, fixed: an optional service verifier would have left the host contract dependent on runtime
  wiring; the live-delegation service now requires the verifier at construction time and still
  rejects missing, mismatched, or already-consumed receipts;
- high, fixed: catalog filtering alone would not cover stale tool definitions or deferred execution;
  current parent and child restrictions are re-resolved immediately before built-in or MCP dispatch;
- medium, fixed: regular Sessions avoid repeated authority lookups, while immutable Session-kind
  cache entries are cleared with their ToolService conversation mapping;
- medium, accepted: effect intent is recorded before final Subagent authority rejection. This is a
  conservative retry-safety fact for an attempted tool action, not evidence that the external effect
  completed, and it avoids moving the continuously validated authority check earlier than dispatch;
- low: no unresolved correctness, compatibility, performance, security, naming, test, or maintenance
  issue was found inside this hardening slice.

Validation evidence:

- `pnpm run format:check`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck` passed;
- focused portable authority, resolver, assignment, ToolService, and delegation-tool suites passed:
  6 files, 64 tests;
- native repository, service, safety, and migration suites passed: 4 files, 63 tests. Vitest emitted
  its known post-success Electron close-timeout diagnostic after all assertions passed;
- the complete portable suite passed: 743 files and 7,832 tests passed, with 25 files and 345 tests
  skipped by their existing environment guards;
- `pnpm run build` passed. Prebuild retained the existing provider-database download-size guard, and
  Vite retained its existing third-party annotation, mixed-import, and chunk-size warnings; generated
  provider and ACP resources produced no unexpected tracked changes.

## Authority Boundary Follow-Up

- [x] Fail closed when execution cannot resolve an unproven Session identity.
- [x] Replace the standalone regular-Session cache with catalog-owned immutable Session-kind state.
- [x] Route assignment, catalog, and execution through one authority composer.
- [x] Reject already-disabled Subagent tools before recording effect intent and revalidate before
  dispatch.
- [x] Validate the locally generated child-result envelope at the model-facing ToolService boundary.
- [x] Consume explicit consent only when the synchronous repository mutation succeeds.
- [x] Run focused and full validation, complete a severity-ordered review, and commit locally.

Follow-up review triage, ordered by severity:

- high, confirmed: an unresolved conversation returned `null` authority and could dispatch through a
  stale Subagent tool mapping without least-authority checks;
- medium, confirmed: an authority denial occurred after effect intent was recorded, creating false
  write evidence for an action the host never dispatched;
- medium, confirmed as maintenance risk: the union/intersection primitives were shared, but three
  boundaries still assembled their authority inputs independently without a parity contract;
- medium, partially confirmed: child results were always created through the strict envelope helper,
  so parsing alone cannot remove semantic prompt injection. A final host assertion is still valuable
  to prevent future adapters from falling back to raw child text;
- medium, confirmed as contract quality: receipt consumption preceded repository persistence. This
  remained fail-closed, but did not model successful mutation as the consumption boundary;
- medium, retained by design: V1 does not promise automatic parallel-writer isolation, and proactive
  remains explicit Session-level standing authorization;
- low, retained by design: unread terminal events require a durable reader cursor before safe
  compaction; service decomposition, historical naming, and hypothetical ACP local-tool authority are
  follow-up architecture work rather than defects in the current execution path.

Follow-up validation evidence:

- focused portable authority, resolver, assignment, consent, repository, service, and ToolService
  suites passed: 61 tests passed and 52 native-only tests skipped under Node;
- native repository and service suites passed under Electron's ABI: 2 files and 52 tests;
- the complete portable suite passed: 743 files and 7,836 tests, with 25 files and 346 tests skipped
  by their existing environment guards;
- `pnpm run format:check`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` passed. The build retained only its existing provider-database size guard and Vite
  third-party annotation, mixed-import, and chunk-size warnings; generated resources produced no
  unexpected tracked changes.
