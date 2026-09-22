# Execution plan

- [x] Converge regular/detached creation inside SessionLifecycle, retaining entry-specific behavior.
  Review and verify lifecycle contracts, including persisted fields and snapshot fallback; commit.
  Lifecycle/Scheduler/Remote: 61 tests pass; node typecheck passes. Baseline ablation with the new
  lifecycle tests fails exactly the two persisted-timestamp cases (25 others pass).
- [x] Share pending action eligibility and identity across runtime, Remote and renderer.
  Review boundary differences and verify positive/negative eligibility plus adapter behavior; commit.
  Runtime/Remote/ACP/renderer: 64 tests pass; full typecheck passes. Removing needsUserAction
  exclusion in the isolated worktree fails both the contract test and existing renderer test.
- [ ] Share ChatService cleanup operations without merging timeout/result policies.
  Review failure and cancellation behavior, verify cleanup contracts; commit.
- [ ] Complete whole-change P0–P3 review and adversarial checks. Fix in-scope findings and use
  targeted ablation/mutation experiments to demonstrate regression checks detect removed behavior.
- [ ] Run format, i18n, lint, typecheck and relevant main/renderer suites; remove temporary probes.
  Record outcomes and leave local commits only. Do not push or create a PR.

Implementation precedes new test selection per repository guidance. Existing tests can run at any
point. Each slice is independently usable and reversible.
