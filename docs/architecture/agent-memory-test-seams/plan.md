# Agent Memory Test Seams Plan

## Implementation Approach

- Add a small test-local helper in `memoryPresenter.test.ts` that exposes service-level runtime
  states through `getMutableRuntimeStateForTests()`.
- Replace facade-level runtime casts with helper calls against `embedding`, `vectorStore`,
  `maintenance`, `reflection`, `persona`, and `workingMemory`.
- Replace facade wrapper calls with direct service calls:
  - `embedding.warmEmbeddingConnection(...)`
  - `vectorStore.clearReady(...)`
- Delete the `MemoryPresenter` private compat accessor method, private runtime getters, and private
  wrapper methods.

## Compatibility

No production behavior, persisted data, public route DTO, IPC contract, or memory runtime behavior
changes. The only intended contract change is test-only: facade private runtime shims are no longer
available.

## Test Strategy

- Run `memoryPresenter.test.ts` to verify the moved seams preserve existing coverage.
- Run node typecheck to catch private-member cast type drift.
- Run format, i18n, lint, and diff whitespace checks before handoff.
