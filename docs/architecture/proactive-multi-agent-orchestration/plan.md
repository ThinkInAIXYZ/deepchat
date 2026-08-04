# Proactive Multi-Agent Orchestration Implementation Plan

## 1. Establish The Single-Plane Contract

- Replace the dual-executor architecture text with the live-delegation-only contract.
- Record the verified release fact: versions 57 and 59 never reached a tag, `dev`, or `main`.
- Define Workflow JavaScript, replay, saved assets, and pipeline persistence as non-goals.
- Keep `explicit | proactive` as internal policy and reserve `Ultra` for optional presentation.

## 2. Extract Retained Orchestration Contracts

- Move orchestration policy and capability schemas from `shared/workflow` to
  `shared/orchestration`.
- Move the useful untrusted-result safety rule into a Workflow-independent orchestration module.
- Remove Workflow child metadata and ports while retaining live-delegation metadata.
- Update Session, runtime, route, preload, renderer, and test imports before deleting the old
  namespace.

## 3. Remove The Durable Workflow Execution Plane

- Remove `src/main/workflow`, the Workflow utility entry point, Workflow Agent tool, and Workflow
  composition wiring.
- Remove shared Workflow domains, routes, events, authoring/runtime contracts, and saved assets.
- Remove Workflow renderer clients, panels, approval cards, commands, mentions, and stores.
- Remove Workflow-specific tests and feature SDD documents.
- Remove `@jitl/quickjs-wasmfile-release-sync`, `quickjs-emscripten-core`, `acorn`, and `ajv`, then
  regenerate the pnpm lockfile through a clean install.
- Remove Workflow utility build input, ASAR unpacking, and CI memory changes that are no longer
  justified after the deleted test load.

## 4. Preserve Forward Database Compatibility

- Remove the unreleased version-57 `orchestration_mode` migration.
- Make version 59 add `orchestration_policy` directly with the `explicit | proactive` constraint.
- Keep live-delegation versions 60 through 62 unchanged.
- Add version 64 as the Workflow decommission migration.
- At version 64, drop every `trg_workflow_*` trigger, then `workflow_invocations`, then
  `workflow_runs`.
- Remove Workflow catalog definitions and table implementations while retaining the version-64
  migration owner in the orchestration domain.
- Cover fresh databases from released version 52, intermediate feature fixtures, and already-63
  feature databases.

## 5. Enforce The Live Delegation Safety Contract

- Add one shared untrusted child-result envelope and inject its interpretation rule at the parent
  system/developer prompt boundary.
- Enforce orchestration consent in the host: explicit `spawn`/`follow_up` require confirmation;
  proactive policy is standing authorization; non-generating operations remain confirmation-free.
- Carry an execution-bound explicit-user receipt from the permission broker to the service and
  revalidate the current policy at the mutation boundary.
- Compose cross-Agent authority through one pure function for assignment, catalog, and execution:
  union disabled tools, intersect MCP allowlists, and fail closed when child lineage policy cannot
  be resolved.
- Persist immutable Session-kind context with the ToolService catalog state, remove the standalone
  regular-Session cache, and reject an unresolved identity unless it was already proven regular.
- Run an authority preflight before effect evidence and revalidate after the observer before actual
  dispatch.
- Validate the host-generated child-result envelope at the ToolService boundary before it can enter
  model-facing normalization.
- Claim explicit consent around repository mutation so a failed transaction releases rather than
  consumes the one-shot receipt, and return the created projection from that same transaction to
  avoid ambiguous post-commit failures.
- Enforce UTF-8 pending-message capacity at `send` and make legacy overflow recovery convergent.
- Reject an over-budget follow-up transaction without consuming pending messages when neither the
  messages nor a recovery notice can fit beside the complete task.
- Replace character-only bounds where the repository promises byte limits.
- Separate per-turn generation snapshots from continuously validated permissions, workspace,
  deletion, and capability state.

## 6. Make Admission State-Aware

- Change the global admission lease so host-owned permission/question waiting suspends capacity.
- Reacquire with cancellation before protected continuation resumes.
- Make suspend, resume, interruption, shutdown, and terminal settlement idempotent under late
  events.
- Keep the parent active-child limit distinct from global running capacity and enforce it inside
  the repository transaction for both `spawn` and `follow_up`.
- Add a per-parent mailbox-wait ceiling beneath the process-wide safety ceiling.
- Add cross-Session starvation, cancellation, restart, and rapid waiting/resume regressions.

## 7. Remove The Second Subagent Executor And UI Coupling

- Delete the unreachable `SubagentOrchestratorTool` runtime and its state-machine tests.
- Retain only historical `subagent_orchestrator` transcript parsing/rendering needed for released
  data.
- Remove stale native call routing, but keep the legacy name reserved as a documented trust
  tombstone while name-only historical rendering remains.
- Evict live-delegation renderer projections when their parent Session is removed.
- Gate reasoning controls by model reasoning capability rather than orchestration availability.
- Remove the Workflow-dependent composition closure; this also removes its initialization-order
  hazard.

## 8. Validate The Net Product

- Run focused migration, tool-policy, permission, mailbox, admission, deletion, restart, and result
  handoff tests after each slice.
- Exercise database import and encryption-copy ordering against the live-delegation foreign-key
  graph, not only isolated table migrations.
- Run complete main and renderer suites, format, i18n, lint, typecheck, and production build.
- Run a clean `pnpm install --frozen-lockfile` path before final handoff.
- Check exact retired identifiers and dependencies rather than generic uses of the word
  `workflow`.
- Review each commit for side effects, compatibility, boundaries, performance, security, naming,
  test sufficiency, and maintenance cost before committing.
- Keep all commits local until the user separately authorizes a push.

## PR Strategy

Continue using PR #2082 and remove the obsolete subsystem from the current HEAD by final ownership,
not by reverting historical commits. GitHub's files view will show the live-only net diff, and the
normal squash merge keeps deleted implementation history out of `dev`.

Before merge, retitle and rewrite the PR around proactive multi-Agent orchestration. If the PR will
not be squash-merged, create a clean live-only branch from `dev` instead of preserving the temporary
QuickJS commit history.
