# Execution plan

- [x] B: share vector readiness, degradation and row filtering within RetrievalService; preserve
      the distinct read/write control flows, review and verify before committing.
- [x] C(1): share the management archive transition with unchanged hook and audit contracts;
      review and verify before committing.
- [x] A: remove ConflictService's scheduling dependency; cover user and automated success paths
      including partial failure, review and verify before committing.
- [ ] A: extract MergeService without changing fence, budget or lifecycle ownership; review and
      verify before committing.
- [ ] Review the combined diff for side effects, compatibility, boundaries, performance, security,
      naming, verification gaps and maintenance cost; retain only useful contract regression tests.
- [ ] Run format, i18n, lint, typecheck and the memory suite; remove temporary probes and confirm a
      clean local branch without pushing.
