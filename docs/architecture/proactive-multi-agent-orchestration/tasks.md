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

- [ ] Add lifecycle spawn, message, follow-up, list, wait, and interrupt contracts.
- [ ] Persist child thread and turn identity before handoff.
- [ ] Add bounded parent mailbox completion.
- [ ] Reconcile interrupted live delegation after restart.
- [ ] Preserve compatibility for the batch orchestrator without duplicate model tools.
- [ ] Share child invocation capabilities without merging state machines.
- [ ] Add concurrency, cancellation, permission, Tape, and recovery tests.
- [ ] Review, validate, and commit lifecycle slices.

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

## UX

- [x] Rename Workflow mode copy to proactive collaboration.
- [x] Preserve reasoning-only button text and branch-icon accent.
- [x] Change `/workflow` from a mode switch to Workflow navigation/preparation.
- [ ] Project live and durable work in one activity surface.
- [x] Add policy-control i18n, accessibility, and renderer tests.
- [ ] Review, validate, and commit UX slices.

## Final Validation

- [ ] Run affected main and renderer suites.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run build`.
- [ ] Perform the final cross-module review and record findings by severity.
- [ ] Confirm all commits remain local and the branch was not pushed.
