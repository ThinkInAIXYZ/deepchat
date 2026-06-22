# Tasks

- [x] Core: make extraction parse failures retryable.
- [x] Core: exclude assistant reasoning from extraction spans.
- [x] Core: prevent stale embedding drains during reindex/reset.
- [x] Core: gate restore and clean vector sidecar on archive/forget.
- [x] Core: improve memory FTS tokenized search.
- [x] DB: preserve/rebuild indexes and triggers during encrypted copy.
- [x] DB: version/rebuild agent memory FTS tokenizer.
- [x] DB: stabilize tape search FTS replacement/deletion.
- [x] DB: harden clear/reset and new DB schema version initialization.
- [x] UI: add MemorySettings error handling.
- [x] UI: guard MemoryManagerPanel refresh and search errors.
- [x] UI: clarify archive vs permanent delete and advanced settings.
- [x] Tests: update memory extraction tests for `parseMemoryCandidates` union return.
- [ ] Validation: `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck` passed under Node v26 warning; `pnpm test` was stopped per user instruction after memoryPresenter failures surfaced.
