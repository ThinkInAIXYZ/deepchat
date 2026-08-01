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

- [ ] Omit unsupported `undefined` values from execution snapshots.
- [ ] Validate source before resolving launch scope.
- [ ] Add a single versioned authoring contract with signatures and examples.
- [ ] Add semantic helper-shape diagnostics before approval.
- [ ] Add regression tests for host snapshot and foreign-dialect scripts.
- [ ] Review, validate, and commit the preparation slice.

## Policy And Routing

- [ ] Replace `adaptive | workflow` with `explicit | proactive`.
- [ ] Add migration and compatibility normalization.
- [ ] Remove live-delegation and Workflow mutual exclusion.
- [ ] Add developer-level explicit/proactive policy instructions.
- [ ] Keep reasoning settings independent in Session and draft flows.
- [ ] Update typed routes, preload, renderer stores, commands, and tests.
- [ ] Review, validate, and commit the policy slice.

## Live Delegation V2

- [ ] Add lifecycle spawn, message, follow-up, list, wait, and interrupt contracts.
- [ ] Persist child thread and turn identity before handoff.
- [ ] Add bounded parent mailbox completion.
- [ ] Reconcile interrupted live delegation after restart.
- [ ] Preserve compatibility for the batch orchestrator without duplicate model tools.
- [ ] Share child invocation capabilities without merging state machines.
- [ ] Add concurrency, cancellation, permission, Tape, and recovery tests.
- [ ] Review, validate, and commit lifecycle slices.

## UX

- [ ] Rename Workflow mode copy to proactive collaboration.
- [ ] Preserve reasoning-only button text and branch-icon accent.
- [ ] Change `/workflow` from a mode switch to Workflow navigation/preparation.
- [ ] Project live and durable work in one activity surface.
- [ ] Add i18n, accessibility, and renderer tests.
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
