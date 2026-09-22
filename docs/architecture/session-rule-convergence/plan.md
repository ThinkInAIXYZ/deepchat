# Execution plan

- [x] Converge regular/detached creation inside SessionLifecycle, retaining entry-specific behavior.
  Review and verify lifecycle contracts, including persisted fields and snapshot fallback; commit.
  Lifecycle/Scheduler/Remote: 61 tests pass; node typecheck passes. Baseline ablation with the new
  lifecycle tests fails exactly the two persisted-timestamp cases (25 others pass).
- [x] Share pending action eligibility and identity across runtime, Remote and renderer.
  Review boundary differences and verify positive/negative eligibility plus adapter behavior; commit.
  Runtime/Remote/ACP/renderer: 64 tests pass; full typecheck passes. Removing needsUserAction
  exclusion in the isolated worktree fails both the contract test and existing renderer test.
- [x] Share ChatService cleanup operations without merging timeout/result policies.
  Review failure and cancellation behavior, verify cleanup contracts; commit.
  All 15 ChatService tests pass. Removing deferred invocation of permission cleanup in the isolated
  worktree fails Stop and timeout-cleanup regression cases; the production helper retains it.
- [x] Complete whole-change P0–P3 review and adversarial checks. Fix in-scope findings and use
  targeted ablation/mutation experiments to demonstrate regression checks detect removed behavior.
  Reviewed initialization/abort rollback, snapshot fallback, interaction ordering, permission
  boundaries, synchronous failures, timeout/late completion and repeated cancellation. No unresolved
  product findings. Four integration tests now use the existing stateful persistence fixture instead
  of returning an unrelated fixed row; snapshot test data uses the typed runtime status contract.
- [x] Run format, i18n, lint, typecheck and relevant main/renderer suites; remove temporary probes.
  Record outcomes and leave local commits only. Do not push or create a PR.
  Format, i18n, lint and main/web typecheck pass. Expanded regression covers 51 files / 1260 tests:
  Session, Scheduler starter, Remote runner, interaction projection, run lifecycle coordinator,
  DeepChat harness, direct ACP and renderer tool-interaction composable. No visual changes or live
  provider/network integration are claimed. Temporary mutations are isolated from this branch.

Implementation precedes new test selection per repository guidance. Existing tests can run at any
point. Each slice is independently usable and reversible.
