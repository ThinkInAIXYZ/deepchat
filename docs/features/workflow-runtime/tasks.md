# Workflow Runtime Tasks

## Specification

- [x] Inspect current DeepChat child-session, Tape, permission, tool, utility-process, event, and
  database paths.
- [x] Verify the sync QuickJS deferred-promise direction and reject Asyncify for concurrent waits.
- [x] Replace hash-occurrence replay identity with stable logical call paths plus input hashes.
- [x] Replace Tape-only effect inference with write-ahead effect state plus Tape evidence.
- [x] Require an immutable executed source snapshot for cross-restart resume.
- [x] Write the feature specification and implementation plan.
- [x] Complete the pre-commit SDD review and fix findings.
- [x] Commit the specification slice.

## Runtime Contracts And QuickJS Spike

- [x] Add versioned Zod domain and utility-process protocol contracts.
- [x] Add canonical bounded JSON serialization and hashing.
- [x] Add minimal sync QuickJS dependencies.
- [x] Add workflow utility-process build entry and minimal environment.
- [x] Implement the guest driver and deterministic global restrictions.
- [x] Reject unsupported direct promise scheduling and dynamic code.
- [x] Implement deferred promise settlement with serialized pending-job drains.
- [x] Implement keyed `agent`, `parallel`, `pipeline`, `phase`, and `log`.
- [x] Enforce guest CPU, memory, stack, IPC, log, result, and invocation limits.
- [x] Prove concurrent `Promise.all` progress.
- [x] Prove cancellation and handle disposal.
- [x] Prove development and packaged WASM resolution.
- [x] Prove utility-process exit notification.
- [x] Prove active-run and queued-run bounds.
- [x] Complete the pre-commit runtime review and focused validation.
- [x] Commit the runtime slice.

Validation evidence (2026-07-31):

- `pnpm run typecheck:node`
- 49 focused main/build tests
- `pnpm exec electron-vite build`
- packaged ASAR inspection, unpacked WASM size check, and Electron `utilityProcess` end-to-end
  execution returning a settled QuickJS result
- `electron-builder --dir` reached `afterPack`; the outer command then failed because this worktree
  lacks the pre-existing OCR `runtime/node/bin/node` asset

## Persistence And Recovery

- [x] Add schema version 53.
- [x] Add schema version 54 for the durable workspace and capability scope.
- [x] Add `workflow_runs`.
- [x] Add `workflow_invocations`.
- [x] Store immutable source, hashes, statuses, attempts, effects, usage, and delivery state.
- [x] Persist stable child correlation slots.
- [x] Add repository parsing and transactional sequence allocation.
- [x] Add startup and utility-exit interruption reconciliation.
- [x] Add stable call-path replay and downstream invalidation.
- [x] Add timeout replay and explicit retry attempts.
- [x] Add migration, constraint, replay, and reconciliation tests.
- [x] Complete the pre-commit persistence review and focused validation.

Validation evidence (2026-07-31):

- 63 workflow, schema repair, schema catalog, and database connection tests passed under
  Electron's Node ABI.
- `pnpm run typecheck:node`
- The broader `test/main/data` run passed 81 tests and exposed 8 pre-existing
  `mainDatabase.test.ts` failures against removed presenter APIs or incomplete legacy fixtures;
  none touched workflow code or failed in the workflow migration tests.

## Shared Admission

- [x] Add cancellation-aware owner-fair `AgentInvocationAdmission`.
- [x] Apply the process-wide default limit of four active children.
- [x] Add a separate bounded workflow utility-process admission gate.
- [x] Gate both workflow and `subagent_orchestrator` child starts.
- [x] Gate `subagent_orchestrator` child lifetimes through the shared admission layer.
- [x] Preserve existing orchestrator local limits.
- [x] Bound waiters and make close/cancel/release leak-free.
- [x] Add concurrency, fairness, cancellation, overflow, and orchestrator regression tests.
- [x] Complete the pre-commit admission review and focused validation.
- [x] Commit the shared-admission slice.

## Child Execution And Effects

- [x] Create workflow children through `AgentSubagentToolPort`.
- [x] Reject direct ACP and preserve DeepChat-loop ACP compatibility.
- [x] Enforce the launch target-agent allowlist before admission.
- [x] Make child creation crash-safe and idempotent by correlation slot.
- [x] Persist child identity before handoff.
- [x] Map child runtime state and usage into durable invocation state.
- [x] Add workflow-scoped frozen-head Tape lineage.
- [x] Require a durable Tape-link receipt before replayable success.
- [x] Propagate workflow invocation context to the common tool boundary.
- [x] Add an explicit invocation-context registry at the common tool boundary.
- [x] Persist monotonic effect state before every bound child tool execution.
- [x] Fail tool execution closed when effect intent persistence fails.
- [x] Treat unknown or untrusted tool metadata conservatively.
- [x] Add crash-window, late-event, Tape-evidence, and lineage tests.
- [x] Complete the pre-commit child/effect review, focused validation, and commit.

Effect-boundary validation evidence (2026-07-31):

- 236 workflow and tool tests passed under Electron's Node ABI.
- `pnpm run typecheck:node`

Child-executor validation evidence (2026-07-31):

- 57 workflow, session-lifecycle, and session-projection tests passed under Electron's Node ABI.
- 159 session integration and existing subagent-orchestrator regression tests passed.
- `pnpm run lint`
- `pnpm run typecheck`

## Structured Output

- [x] Add bounded JSON Schema validation.
- [x] Add invocation-scoped structured-output tool injection for DeepChat-loop children.
- [x] Add same-child correction feedback and bounded attempts.
- [x] Remove the temporary output tool on every invocation terminal path.
- [x] Validate and bound plain JSON before persistence and guest settlement.
- [x] Cover normal providers and DeepChat-loop ACP compatibility.
- [x] Add valid, invalid, oversized, exhausted, cancelled, and direct-ACP tests.
- [x] Complete the pre-commit structured-output review, focused validation, and commit.

Structured-output validation evidence (2026-07-31):

- 531 workflow, tool, and DeepChat harness tests passed with native SQLite required.
- `pnpm run format:check`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

## Workflow Service

- [x] Add explicit launch approval bound to source hash and effective scope.
- [x] Add one-process-per-run lifecycle.
- [x] Add admission, execution, settlement, timeout, cancellation, and budget orchestration.
- [x] Add resume, retry, and retry-from-here behavior.
- [x] Add typed launch/status/cancel/resume/retry routes.
- [x] Add explicit workflow agent-tool actions.
- [x] Add typed workflow events and renderer projections.
- [x] Keep activation independent from reasoning effort and explicit-only in V1.
- [x] Add service, protocol-failure, recovery, and budget tests.
- [x] Add route and agent-tool tests.
- [x] Complete the pre-commit service-core review, focused validation, and commit.

Service-core validation evidence (2026-07-31):

- launch approvals bind the source and input hashes to a main-resolved workspace, allowlist,
  limits, and budget; pending approval count and bytes are bounded;
- one-process-per-run admission covers active, queued, overflow, cancellation, and shutdown paths;
- queued resume intent survives restart; replay, duplicate active paths, utility crashes, token and
  execution-time budgets, effect-aware retry, retry-from-here, and projection failure isolation
  are covered by focused tests;
- child usage is validated, correction-turn usage is accumulated, and terminal invocation usage is
  durable.
- 435 workflow, shared-admission, orchestrator, session-lifecycle, and DeepChat harness tests passed.
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

Control-surface validation evidence (2026-07-31):

- launch approval and every invocation dispatch revalidate the immutable workspace and effective
  target-agent capability scope, including MCP and Skill selections;
- typed routes and events expose bounded projections rather than stored script, input, prompt, or
  full result payloads;
- at this implementation stage, the Agent tool kept launch as a non-rememberable two-step
  permission action; the native launch UX below later removes launch from the model-facing
  contract entirely;
- 309 workflow, Agent-tool, and composition-boundary tests passed;
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

## Parent Result And UI

- [x] Persist one idempotent Workflow Result.
- [x] Deliver with `triggerTurn: false`.
- [x] Queue safely while a parent turn is active.
- [x] Add explicit parent synthesis action.
- [x] Add the workflow side-panel section and progress tree.
- [x] Add child-session navigation and interaction projection.
- [x] Add cancel, resume, retry, retry-from-here, and effect-warning controls.
- [x] Add loading, empty, interrupted, incompatible, and partial-result states.
- [x] Add vue-i18n copy and renderer tests.
- [x] Complete the pre-commit parent-result review, focused validation, and commit.
- [x] Complete the pre-commit UI review and focused validation.
- [x] Commit the validated UI slice.

Parent-result validation evidence (2026-07-31):

- a stable delivery/message identity closes the transcript-write/result-state crash window;
- result notices are bounded, searchable first-class facts but do not enter parent model history,
  compaction, or memory ingestion;
- explicit synthesis preserves the pending-input `pending`/`claimed` state, caps full-result input
  at 256 KiB, and carries a system-level untrusted-data guard;
- 490 workflow, persistence, transcript, context-builder, memory-ingestion, route, and DeepChat
  harness tests passed in the final focused run;
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

UI validation evidence (2026-07-31):

- the renderer consumes only typed bounded summaries and keeps terminal state main-owned;
- live admitted, running, and waiting-interaction transitions refresh the selected durable run;
- pending child interactions expose bounded labels and identifiers, never tool arguments, and link
  to the existing child permission/question surface;
- Workflow Result messages deep-link to the exact run even when it is older than the bounded list;
- retry controls mirror service legality, require explicit confirmation for write/unknown effect
  suffixes, and optimistically remove stale actions after a successful mutation;
- malformed transcript blocks fail closed, duplicate synthesis clicks are suppressed, and failed
  detail refreshes retain the last successful durable projection;
- 155 tests passed across the complete `test/main/workflow` directory;
- 1,922 tests passed across the complete renderer suite;
- the final focused UI and interaction-projection run passed 8 tests;
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

## Saved Workflows

- [x] Add safe user-readable named workflow storage.
- [x] Keep immutable run snapshots separate from editable source files.
- [x] Add bounded args and path/symlink validation.
- [x] Add named invocation UX.
- [x] Defer auto mode until explicit workflows pass recovery validation.
- [x] Complete the pre-commit saved-workflow review, focused validation, and commit.

Saved-workflow validation evidence (2026-07-31):

- named sources live under the main-resolved `<workspace>/.deepchat/workflows` directory with
  strict flat names, bounded UTF-8 source and JSON args, a 200-file catalog bound, deterministic
  ordering, and serialized creates;
- static and raced final-component symlinks are rejected with no-follow plus inode checks, while
  directory components are realpath-contained and cannot traverse outside the workspace;
- optimistic source hashes reject stale editor saves, and launch preparation re-reads the exact
  loaded hash and rejects a parent-workspace change before registering an approval;
- editable files remain authoring inputs only; every run continues to store and resume from its
  immutable source snapshot;
- slash suggestions hand off a durable renderer request to the side panel, prepare but never launch
  automatically, preserve dirty source, and fence stale catalog, document, save, prepare, and
  launch completions across session changes;
- `kind=deepchat + providerId=acp` remains supported, while direct ACP hides saved authoring and
  still retains access to any durable run history;
- authoring saves use portable optimistic concurrency rather than claiming cross-process filesystem
  compare-and-swap; exact execution remains protected by source-hash and workspace-bound approval.

## Final Validation

- [x] Run all focused workflow and affected regression suites.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run build`.
- [x] Verify packaged QuickJS loading on the current platform.
- [x] Perform the final cross-module review and fix findings.
- [x] Record actual validation evidence in this document.
- [x] Commit all validated work locally.
- [x] Do not push.

Final validation evidence (2026-07-31):

- all 23 files and 164 tests in `test/main/workflow` passed;
- all 241 renderer test files and 1,940 tests passed;
- `pnpm run format`
- `pnpm run i18n` validated 20 locales, 400 namespace registrations, and 4,124 source-message
  contracts with no missing keys or invalid translations;
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run build`, including the workflow utility host, main, preload, and renderer bundles;
- the current macOS arm64 packaged app contains the sync QuickJS WASM under
  `app.asar.unpacked`, and the earlier packaged Electron utility-process smoke returned a settled
  QuickJS result;
- normal prebuild refreshes were retained: 179 provider records and 38 ACP registry agents.

Final review findings, ordered by severity:

- Superseded: the first review reported no critical/high findings; the post-implementation audit
  below found material issues and reopened the feature before merge.
- Medium, fixed: saved-source approval could cross a concurrent parent-workspace change; direct ACP
  mounted an unusable saved-authoring surface; stale session operations, unsaved-draft navigation,
  and concurrent catalog creates had unsafe edge behavior.
- Low, fixed: symlink defense depended too heavily on `O_NOFOLLOW`, catalog ordering depended on the
  host locale, the UI silently truncated oversized Agent allowlists, and exact-source mismatch
  coverage was incomplete.
- At that review point, no additional findings were recorded. This conclusion is superseded below.
  Workflow side effects retain the documented non-exactly-once contract.

## Post-Implementation Audit And DimAgent Reconciliation

### SDD

- [x] Reconcile the external audit, local DimAgent runtime, and DimAgent renderer evidence.
- [x] Keep the QuickJS utility-process trust boundary and immutable run snapshots.
- [x] Adopt source outlines, journal-derived live projections, explicit tool exposure, and bounded
  fan-out as DeepChat-native concepts.
- [x] Record the corrected risk assessment and implementation order.

### Runtime And Recovery Blockers

- [x] Freeze guest-reachable native promise intrinsics and retain host-owned JSON conversion.
- [x] Make deferred settlement cleanup and pending-job draining failure-safe.
- [x] Add non-optional default run and invocation deadlines.
- [x] Arm invocation timeout only after global child admission.
- [x] Retain invocation context after cancellation resolve/rejection until child terminal evidence,
  then freeze failure Tape before release.
- [x] Reattach crash-window child sessions by stable logical lineage without reusing retry children.
- [x] Isolate malformed startup rows and add a capacity-aware queued-run pump.
- [x] Add focused sandbox, deadline, cancellation, lineage, and startup recovery tests.

Runtime/recovery audit validation evidence (2026-07-31):

- the complete 178-test main workflow suite passed;
- 135 session integration tests and 17 session-lifecycle tests passed;
- `pnpm run format:check`, `pnpm run lint`, and `pnpm run typecheck:node` passed.

### Compatibility, Policy, And Performance

- [x] Keep workflow owner concurrency at four while preserving orchestrator five-way fan-out.
- [x] Hold one permit across sequential orchestrator chains and isolate parallel admission errors.
- [x] Start orchestrator overall timeout after first admission.
- [x] Make the model-facing workflow tool user-configurable and disabled by default.
- [x] Stop globally reserving the `workflow` MCP name.
- [x] Require write/unknown retry confirmation independently of a changed input hash.
- [x] Aggregate token usage without loading every invocation on each dispatch.
- [x] Remove avoidable per-block workflow invocation reads.
- [x] Add focused admission, exposure, retry, and performance-contract tests.

Shared-admission compatibility evidence (2026-07-31):

- the process-wide child pool defaults to six permits, workflow runs cap themselves at four, and
  orchestrator runs cap themselves at five;
- a sequential orchestrator chain holds one permit, while parallel admission failure is recorded
  only against the rejected task;
- orchestrator deadline serialization remains `null` until the first permit is acquired;
- 59 admission, orchestrator, and Workflow child-executor tests passed;
- `pnpm run typecheck:node`.

Policy/retry validation evidence (2026-07-31):

- schema version 56 adds `workflow` to the effective disabled-tool state of existing sessions while
  preserving the runtime-authoritative normalized rows, other disabled tools, revisions, and
  session ordering timestamps;
- Agent config migration version 4 applies the same default to new sessions, and forks preserve
  explicit per-session tool choices;
- configurable/runtime catalogs, same-name MCP precedence, and changed-input effect confirmation
  are covered by focused tests;
- 161 Agent settings, session lifecycle, tool, migration, memory migration, and Workflow service
  tests passed;
- `pnpm run typecheck:node`.

Hot-path validation evidence (2026-07-31):

- dispatch-time token budget checks return one SQL aggregate scalar without materializing
  invocation payloads, while rejecting malformed documents, invalid keys or values, duplicate
  keys, non-integral token accounting, and safe-integer overflow;
- child block updates perform no invocation read and write only when interaction state changes;
  correction turns preserve the prior tracker state;
- 75 focused persistence, child-executor, and service tests passed, followed by all 181 Workflow
  tests;
- `pnpm run typecheck:node`.

### Projection And Authoring UX

- [x] Add bounded typed invocation-delta events.
- [x] Merge invocation deltas in the renderer without full `inspect` reads per progress event.
- [x] Avoid detail refreshes while the workflow panel is hidden or collapsed.
- [x] Preserve bounded in-memory dirty drafts across panel/session lifecycle changes.
- [x] Clear expired approvals and retain unhandled saved-workflow requests.
- [x] Add focused renderer lifecycle, stale-event, and projection tests.

Incremental projection evidence (2026-07-31):

- invocation events carry the bounded renderer projection and reject envelope/projection run
  mismatches;
- selected details merge invocation deltas by durable identity without progress-driven `inspect`
  calls, while successful terminal transitions perform one result refresh;
- collapsed panels avoid detail reads and load one current snapshot when expanded;
- service cancellation and interruption reconciliation emit terminal invocation deltas;
- 113 focused contract, projection, service, child-executor, and renderer tests passed;
- `pnpm run typecheck`.

Authoring lifecycle evidence (2026-07-31):

- dirty source and transient arguments survive panel unmounts in a session/workspace-scoped,
  memory-only LRU bounded by both eight entries and 4 MiB;
- stale completion fences remain in place across session changes, and saving or discarding clears
  retained state;
- slash invocation requests are acknowledged only after the exact saved source is loaded and a
  launch approval is prepared; dirty, missing, and failed requests remain pending;
- expired approvals are actively removed instead of remaining as disabled launch controls;
- 23 focused saved-authoring, draft-store, and workflow-panel tests passed;
- `pnpm run typecheck:web`.

### Outline And Bounded Fan-Out

- [x] Derive an advisory `exact | partial` static outline from workflow source.
- [x] Include the outline in approval and run-detail projections without persisting a second
  runtime graph.
- [x] Add stable keyed `mapLimit()` with declared-order results and bounded concurrency.
- [x] Add validator, call-path, replay, and out-of-order completion tests.

Bounded fan-out evidence (2026-07-31):

- `mapLimit()` creates only the configured worker count, validates all item keys before work, and
  returns keyed results in declared item order;
- the host rejects concurrency outside `1..maxPendingInvocations`, while normal child admission
  continues to enforce the smaller workflow-owner and process-wide limits;
- mapper call paths include the map key and stable item key, so out-of-order completion does not
  change replay identity;
- raw host validation callbacks are removed before user source runs;
- 30 focused runtime and source-validator tests passed;
- `pnpm run typecheck:node`.

Static-outline validation evidence (2026-07-31):

- approval derives the bounded outline from the same strict-mode AST used for source validation,
  counts it against pending approval memory, and never exposes prompts, input, source snippets, or
  results;
- aliases, scoped helper APIs, computed properties, spread collections, dynamic metadata, and
  truncation conservatively produce `partial`; direct root helpers retain source ordering;
- run details independently derive the advisory outline from immutable source, fall back to an
  empty partial outline for invalid or future source, and continue to use the durable invocation
  journal as the only runtime graph;
- the renderer displays at most 256 source nodes before the first durable invocation and switches
  to journal-derived progress once execution begins;
- 221 Workflow and affected Agent-tool tests passed, followed by 23 focused renderer tests;
- `pnpm run format:check`;
- `pnpm run i18n`;
- `pnpm run typecheck`.

### Terminal-State And Approval Closeout

- [x] Bound utility creation, readiness, and forced-kill settlement even when spawn or exit events
  never arrive.
- [x] Kill a utility handle that becomes available after its run has already terminated.
- [x] Reject root completion with unobserved or pending agent calls without exposing the native
  Promise constructor.
- [x] Derive run-level waiting state transactionally from all concurrent waiting invocations.
- [x] Preserve successful JSON `null` results through replay and renderer projection.
- [x] Reject retry requests against superseded invocation attempts.
- [x] Show the full approved source hash, pending limit, budget, and capability summary.

Closeout evidence (2026-07-31):

- utility-host tests cover unresolved spawn, late spawn cleanup, READY timeout, missing forced-kill
  exit, and duplicate late exit delivery;
- QuickJS tests cover unobserved calls before and after settlement, pending-root rejection, native
  Promise constructor removal, and normal `await`/`Promise.all` behavior;
- persistence tests cover multiple waiting children, continued sibling creation, and restoration
  to running only after the last waiting child leaves;
- service and projection tests cover JSON `null` replay/projection and superseded retry rejection;
- saved-workflow renderer tests cover the exact source hash, pending limit, budget, capabilities,
  and advisory outline;
- 105 focused main and renderer tests passed;
- `pnpm run i18n`;
- `pnpm run typecheck:node`;
- `pnpm run typecheck:web`.

### Reopened Final Validation

- [x] Run all focused workflow and affected regression suites.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run build`.
- [x] Perform the final cross-module review and record findings by severity.
- [x] Commit every validated slice locally.
- [x] Do not push.

Final validation evidence (2026-07-31):

- 29 affected main and renderer files passed with 239 tests;
- the full renderer suite passed with 242 files and 1,950 tests;
- the production Electron build passed and emitted the workflow utility-process entry point;
- format, i18n contract generation, lint, and node/web typechecks passed;
- the repository-wide main suite was also attempted: its one Workflow-induced migration-test
  isolation failure was fixed. The remaining 11 failures are confined to three pre-existing or
  stale baseline files (`mainDatabase`, `schedulerService`, and `sessionDataMigrations.sqlite`).
  The workflow-focused suites are green; those baseline failures are recorded rather than hidden
  or expanded into this feature.

Final cross-module review findings, ordered by severity:

- critical/high: no remaining workflow finding after terminal process lifecycle, guest settlement,
  deadline, recovery, tool-policy, and child-association hardening;
- medium, fixed before commit: unresolved utility spawn/kill lifecycle, unobserved or pending child
  completion, non-transactional run interaction state, JSON `null` replay/projection, superseded
  retry selection, and incomplete approval-contract display;
- low, fixed before commit: dead direct waiting-state setters and unnecessary interaction-state
  synchronization on unrelated invocation transitions;
- known validation debt: the three repository-wide main test files above remain outside this
  feature's implementation scope and must be resolved or refreshed before treating the entire
  repository test gate as green.

## Session Workflow Mode And Native Launch UX

> Historical implementation record. The mutually exclusive mode and bare `/workflow` activation
> items below are superseded by `docs/architecture/proactive-multi-agent-orchestration/`. Checked
> boxes record what landed at the time; they are not the retained product contract.

- [x] Persist `orchestrationMode: adaptive | workflow` for sessions and new-session drafts.
- [x] Migrate existing sessions to `adaptive` without inferring intent from disabled tools.
- [x] Remove Workflow from the generic configurable-tool surface.
- [x] Expose `subagent_orchestrator` and `workflow` mutually exclusively by session mode.
- [x] Add one main-owned typed workflow-capability result with exact unavailable reasons.
- [x] Add the two-section composer execution popover and non-color-only active indication.
- [x] Add `/workflow` mode activation without sending a model message.
- [x] Keep named saved-workflow launch independent from session mode.
- [x] Move low-frequency generation overrides out of model selection without deleting session
  override capability or persisted values.
- [x] Render model-generated preparation as a native approval card with direct exact-ID launch.
- [x] Keep generated source behind an advanced disclosure and regenerate plans from feedback.
- [x] Persist a launch-time model/generation snapshot and split it from the live security scope.
- [x] Verify an active run survives session reasoning changes while later runs use the new value.
- [x] Complete a severity-ordered pre-commit review and focused validation for every slice.
- [x] Run final format, i18n, lint, typecheck, focused tests, build, and packaging checks.

Native launch approval BEFORE/AFTER:

~~~text
BEFORE: [generic workflow tool pill]
        -> expand raw params / JSON response
        -> model calls operation=launch
        -> generic tool permission

AFTER:  [native exact-snapshot approval card]
        [outline + agents + limits + budget + capability warning]
        [Launch workflow] [Modify plan]
        [Generated workflow source ▸]
        -> UI launches the exact approvalId
        -> main revalidates parent + full source + live safety scope
~~~

Native launch approval validation evidence (2026-08-01):

- finalized tool blocks persist the runtime-owned `agent | mcp` source; native parsing requires the
  Agent source, exact built-in tool/server identity, successful `prepare_launch` parameters, and a
  strict bounded result contract, so a same-name MCP remains a generic tool result;
- main validates the exact pending approval against the parent session and complete displayed
  source before enabling launch; launch still performs the existing live workspace and capability
  checks, while the model-facing tool no longer accepts or advertises `operation=launch`;
- approvals stay outside collapsed activity groups, source is absent from the DOM until expanded,
  duplicate launch clicks are suppressed, expiry and navigation fence stale completions, and an
  unconfirmed launch blocks immediate regeneration until the user checks durable run history;
- “Modify plan” revokes the exact live parent-scoped approval before appending bounded feedback as
  explicit TipTap paragraphs; it neither overwrites an existing draft nor submits a model turn;
- all 244 renderer files passed with 1,980 tests; 44 Workflow, Agent-tool, dispatch, prompt, and tool
  service files passed with 471 tests;
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run build`
  passed; i18n validated 20 locales, 400 namespace registrations, and 4,145 source contracts;
- `electron-builder --dir` completed native dependency rebuild and app assembly, then reproduced
  the pre-existing `afterPack` failure because
  `app.asar.unpacked/runtime/node/bin/node` is absent in this worktree. The failure is outside the
  native approval path and is recorded rather than hidden.

Native launch approval review findings, ordered by severity:

- critical: no remaining finding;
- high, fixed before commit: the executable model-facing schema still accepted `operation=launch`,
  leaving a second launch/approval path alongside the native card; launch is now UI-only;
- high, fixed before commit: trusting only a tool/server display name allowed a same-named MCP to
  imitate first-party presentation; runtime-owned tool provenance plus main-held source validation
  now form the trust boundary;
- medium, fixed before commit: a lost launch response could be followed by immediate regeneration
  and duplicate side effects; unconfirmed outcomes and failed revocation now stop that path;
- medium, fixed before commit: approvals could be hidden in collapsed activity, stale async
  completions could cross session changes, revision could leave a still-runnable old approval, and
  text insertion could collapse multiline feedback or corrupt draft boundaries;
- low, fixed before commit: repeated large JSON parsing, eager source DOM materialization,
  unscoped/expired revoke behavior, DOM-only revision-length enforcement, incomplete cache
  invalidation, and a large no-op template diff increased performance or maintenance risk;
- known limitation: approval-to-run identity is not persisted, so an old card cannot prove a launch
  outcome after its approval TTL and a later remount. The card remains fail-closed while live; users
  must inspect durable Workflow history before intentionally preparing another plan.

Mode/control-surface validation evidence (2026-08-01):

- session schema version 57 persists `adaptive | workflow`, migrates every existing session to
  `adaptive`, and removes the retired generic Workflow disabled-tool override without inferring
  user intent;
- runtime tool catalogs expose exactly one orchestrator by mode, include mode in the cache
  fingerprint, reserve a same-name MCP Workflow tool only while the built-in is active, and add
  Workflow prompt guidance only for the built-in Agent tool;
- main-owned capability checks distinguish missing sessions and Agents, direct ACP, child
  sessions, unavailable policy, and disabled Subagents; draft and active-session requests fence
  stale completion across navigation;
- the composer keeps reasoning effort and Workflow mode independent, uses icon plus semantic
  accent and `aria-pressed`, and consumes bare or namespaced Workflow commands locally from both
  keyboard and toolbar submission paths;
- saved `workflow.js` remains reachable as `/workflow workflow`, existing `/name` launch remains
  compatible, and Direct ACP retains its own command namespace.

Mode/control-surface review findings, ordered by severity:

- high, fixed before commit: an MCP tool named `workflow` could otherwise win name deduplication in
  Workflow mode and receive generated source intended for the built-in approval boundary;
- medium, fixed before commit: toolbar submission could send `/workflow` to the model, saved
  `workflow.js` collided with the bare mode command, and stale async capability or mutation
  receipts could update the wrong draft/session after navigation;
- low, fixed before commit: unsupported reasoning models could render a misleading reasoning
  section, the inactive/active icon changed trigger geometry, and same-revision local mode updates
  were not covered against stale session reads;
- remaining known work is limited to the native approval and final feature-wide validation items
  below.

Generation-settings surface BEFORE/AFTER:

```text
BEFORE: [Model v] -> Search + model list + per-row settings arrow -> model side panel
AFTER:  [Model v] -> Search + model list
        [Sliders] -> Advanced settings -> Current model settings (collapsed) + tools
```

Generation-settings surface validation evidence (2026-08-01):

- the model picker now contains only search and model selection, and selecting a model remains the
  only action that can change the active model;
- the unified DeepChat session-settings popover owns a collapsed current-model section that reuses
  the existing capability checks, numeric validation, debounce, and draft/session persistence;
- reasoning effort remains exclusively in the execution control, while temperature, Top P,
  context length, maximum output, timeout, reasoning visibility, verbosity, thinking budget,
  media generation, and compatibility overrides retain their existing behavior;
- direct ACP keeps its separate MCP/config surface and never receives the DeepChat generation slot;
- focused renderer validation passes 82 tests across `ChatStatusBar` and `McpIndicator`, and the
  complete renderer suite, format, i18n, lint, and node/web typechecks pass.

Generation-settings surface review findings, ordered by severity:

- no high-severity findings remained after review;
- medium, fixed before commit: retaining the per-model settings arrow would have allowed opening
  advanced settings to switch the model as a hidden side effect; the advanced surface is now bound
  only to the effective current model;
- medium, fixed before commit: rendering reasoning effort in both the execution control and the
  advanced surface would have created two competing controls for one setting; the duplicate was
  removed without changing the persisted value;
- low, fixed before commit: a generic named slot could have exposed DeepChat generation controls in
  direct ACP; the child surface renders the slot only in DeepChat context and regression tests cover
  both branches.

Execution-snapshot validation evidence (2026-08-01):

- schema version 58 stores a bounded, immutable provider/model/generation snapshot and best-effort
  backfills pre-v58 runs from their DeepChat parent without allowing oversized legacy settings to
  block database startup;
- launch approval binds the canonical execution-snapshot hash, rejects settings changed between
  prepare and launch, and accounts snapshot bytes against the bounded pending-approval budget;
- active-run checks use a dedicated live security-scope resolver that excludes model and generation
  settings, while child creation reads provider, model, and generation settings only from the
  persisted run snapshot;
- tests cover approval invalidation, active-run continuity, later-run adoption of changed settings,
  ACP-backed DeepChat compatibility, immutable persistence, v57 backfill, and recovery scope checks.

Execution-snapshot review findings, ordered by severity:

- high, fixed before commit: the v58 backfill initially ran while the immutable-run trigger was
  armed, which would abort application startup for databases containing existing Workflow runs;
- medium, fixed before commit: active security revalidation still depended on resolving mutable
  generation settings, and raising the shared Workflow schema constant would have replayed the v55
  queued-timeout migration at v58;
- medium, fixed before commit: unbounded legacy prompts or media options could have made migration
  fail atomically; bounded best-effort fields now preserve startup and leave unsupported values out;
- medium, fixed before commit: an unbackfilled legacy placeholder could otherwise reach provider
  resolution if a colliding provider identifier existed; unavailable snapshots now terminate before
  utility or provider startup with a non-retriable durable error;
- low, fixed before commit: migration and schema-repair column SQL could drift, null generation
  fields were accepted too permissively, and the migration test assumed the session schema was
  always the repository-wide latest version.
