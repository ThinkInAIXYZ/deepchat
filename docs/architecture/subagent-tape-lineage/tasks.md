# Subagent Tape Lineage - Tasks

- [x] T1: Specify true fork merge versus production subagent link semantics.
- [x] T2: Specify immutable child-head cutoff, direct-child authorization, and legacy compatibility.
- [x] T3: Make true fork merge atomic, idempotent, and head-bounded.
- [x] T4: Replace production merge/discard ports with typed subagent Tape links.
- [x] T5: Add authorized linked-source resolution and cross-Tape search/context reads.
- [x] T6: Extend the existing Tape tools and runtime routes without changing default behavior.
- [x] T7: Add persistence, rollback, retry, lifecycle, authorization, performance-boundary, and
  non-interference tests.
- [x] T8: Complete cumulative severity review and resolve all actionable findings.
- [x] T9: Run focused and full validation required by this architecture slice.
- [x] T10: Update retained Tape contracts with only validated behavior.

Validation repeated on 2026-07-16 after lifecycle retry, source-scaling, projection-freshness,
fork-boundary, and Tape-incarnation hardening: focused lineage suites, native SQLite cases under
the repository Electron ABI, main-process tests, typecheck, i18n, lint, format, and format check
passed. The full build was intentionally not run because this slice must not refresh unrelated
provider or ACP registry artifacts.
