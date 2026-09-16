# Execution plan

- [x] B: share vector readiness, degradation and row filtering within RetrievalService; preserve
      the distinct read/write control flows, review and verify before committing.
- [x] C(1): share the management archive transition with unchanged hook and audit contracts;
      review and verify before committing.
- [x] A: remove ConflictService's scheduling dependency; cover user and automated success paths
      including partial failure, review and verify before committing.
- [x] A: extract MergeService without changing fence, budget or lifecycle ownership; review and
      verify before committing.
- [x] Review the combined diff for side effects, compatibility, boundaries, performance, security,
      naming, verification gaps and maintenance cost; retain only useful contract regression tests.
- [x] Run format, i18n, lint, typecheck and the memory suite; retain no temporary probes. Commit
      locally after review; pushing remains prohibited.

## Validation outcome

- `pnpm run test:memory`: 54 files, 932 tests passed, including four new regression tests and the
  strengthened batch-timeout recovery assertion.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`: passed.
- The initial merge extraction preserved the original method bodies. Subsequent ablation only
  inlines predicate wrappers; transaction, scope, fence and budget checks remain unchanged.
- `pnpm run test:main:memory-perf`: four tests passed; six required the Electron SQLite ABI.
  Re-ran with `ELECTRON_RUN_AS_NODE=1 DEEPCHAT_REQUIRE_NATIVE_SQLITE=1 pnpm exec electron
  node_modules/vitest/vitest.mjs --config vitest.config.memory-perf.ts --run`: all ten passed.
- The same Electron runner with `--config vitest.config.memory-native.ts --run
  test/main/memory/memoryUpdateNative.test.ts`: all four native mutation tests passed.

The initially proposed end-of-pass scheduling would miss an earlier applied resolution if a later
pair throws. The implementation instead reports each applied resolution to the runner, preserving
follow-up scheduling on partial failure without restoring a constructor dependency cycle.

## Ablation

- [x] Remove the archive audit options union; derive the fixed event from the actor. Existing
  management/tool tests: 80 passed.
- [x] Remove the seven-argument vector traversal helper; keep shared row predicates and explicit
  decision/recall loops. Existing retrieval/diagnostics/write tests: 97 passed.
- [x] Inline the single-use terminal-seed and neighbor wrappers without unifying their different
  liveness predicates. Existing maintenance/lifecycle/conflict tests: 123 passed.

Retain MergeService's transaction/scan ownership, shared readiness/degradation rules, and the
per-applied challenge notification. Removing those boundaries would either mix responsibilities,
duplicate recovery policy or lose partial-failure scheduling. No tests or public contracts removed.
