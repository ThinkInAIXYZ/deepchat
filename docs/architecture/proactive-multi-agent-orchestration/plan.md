# Proactive Multi-Agent Orchestration Implementation Plan

## 1. Correct The Workflow Preparation Boundary

- Normalize execution snapshots so optional settings are omitted rather than stored as
  `undefined`.
- Introduce source compilation before Session binding and approval registration.
- Add semantic validation for statically visible Workflow helper calls.
- Generate concise model-facing Workflow signatures and examples from the versioned runtime API
  contract.
- Return bounded structured diagnostics and retain runtime validation for dynamic shapes.

## 2. Replace Executor Mode With Orchestration Policy

- Replace `SessionOrchestrationMode` with `OrchestrationPolicy` across shared schemas, Session
  records, drafts, lifecycle, assignment, routes, preload clients, renderer stores, and tests.
- Add a forward-only database migration that maps `adaptive` to `explicit` and `workflow` to
  `proactive` and renames the physical column to `orchestration_policy`.
- Keep the default `explicit` and never infer proactive intent from disabled-tool configuration.
- Keep generation settings and policy writes independent.

## 3. Route Capabilities By Availability, Not Executor Choice

- Remove the mutually exclusive Subagent/Workflow catalog conditions.
- Expose the live-delegation surface whenever the regular DeepChat parent has a valid Subagent
  capability.
- Expose durable Workflow whenever its typed capability is available.
- Use DeepChat-specific function names and keep legacy native parsing so always-available built-ins
  do not shadow generic same-name MCP tools.
- Inject one explicit/proactive policy section that also explains when to select each executor.
- Make Workflow tool copy policy-neutral and provide the complete authoring contract.

## 4. Add Live Delegation Lifecycle Control

- Add typed lifecycle operations for spawn, message, follow-up, list, wait, and interrupt.
- Keep child Sessions as the stable identity and expose bounded child status/result DTOs.
- Deliver completion into a parent mailbox without forcing a turn.
- Preserve the existing batch orchestrator as a compatibility adapter while hiding overlapping
  model-facing definitions.
- Keep recursion disabled and apply shared-workspace writer safeguards.

## 5. Persist And Reconcile Live Delegation

- Add durable live-delegation thread/turn records through the main database migration framework.
- Persist correlation before child handoff and terminal Tape receipts before declaring replayable
  completion.
- Reconcile queued/running records on startup against child Session and Tape evidence.
- Preserve child Sessions after terminal runs and allow later explicit continuation.
- Bound retained summaries, mailbox events, active runs, waiters, and history projections.

## 6. Extract Shared Child Invocation Capabilities

- Move common child creation, tracking, cancellation, settings snapshot, usage, effect, and Tape
  lineage behavior behind narrow ports.
- Keep live and Workflow orchestration repositories and state machines separate.
- Route both paths through the existing owner-fair global admission service.
- Add regression coverage for concurrency, cancellation, crash windows, late events, and permission
  interactions.

## 7. Update Composer And Activity UX

- Rename user copy from Workflow mode to proactive multi-Agent collaboration.
- Keep the reasoning label unchanged and use the branch icon/accent for policy state.
- Change `/workflow` to open or prepare Workflow functionality without changing policy.
- Project live delegation into the existing activity surface without conflating legal Workflow
  actions with child-thread actions.
- Keep trusted live-delegation spawn cards visible in the parent transcript with semantic task
  titles, live status, bounded previews, interrupt controls, child navigation, and raw tool
  disclosure.
- Share one revision-aware renderer projection between inline cards and the Agent activity panel;
  seed it from validated tool results and reconcile it through typed list/change contracts.
- Tighten model-facing task-title guidance while retaining opaque delegation and Session IDs as the
  only routing identities.
- Add accessibility and i18n coverage.

## 8. Validation And Compatibility

- Add migration tests from databases before and after the unreleased Workflow mode schema.
- Add policy and catalog tests for explicit/proactive sessions, unavailable capabilities, direct
  ACP, child Sessions, and MCP name collisions.
- Add Workflow preparation tests for optional generation settings and invalid helper shapes.
- Add lifecycle, restart, Tape lineage, effect, budget, and result-delivery tests.
- Run focused tests after each slice, then format, i18n, lint, typecheck, build, and affected main
  and renderer suites before handoff.

## Commit Discipline

Each commit is preceded by a review ordered by severity covering hidden side effects,
compatibility, boundary conditions, performance, security, naming, test sufficiency, and future
maintenance cost. Material findings are fixed before committing. Commit subjects describe the
behavioral change and never describe the commit as a review fix. The branch is not pushed.
