# Agent Memory Test Seams Spec

Status: implemented; maintained test-boundary contract

## User Need

Agent memory tests should keep their lifecycle and race coverage without forcing `MemoryPresenter`
to retain facade-level private accessors that exist only for tests.

## Goal

Remove the legacy `MemoryPresenter` runtime accessor shims and migrate affected tests to the
existing service-level `getMutableRuntimeStateForTests()` seams.

## Acceptance Criteria

- `MemoryPresenter` no longer contains `retainRuntimeCompatAccessorsForTests()` or private runtime
  getter wrappers.
- `memoryPresenter.test.ts` no longer casts the presenter facade to read `vectorStoreReady`,
  `embeddingDrains`, `personaLocks`, or related compat getters.
- Existing lifecycle, cleanup, cold-path, cooldown, and dispose tests remain present and pass.
- Production memory behavior and public APIs are unchanged.

## Constraints

- Keep this as a localized test-boundary refactor; do not rewrite tests into broader behavior-only harnesses.
- Preserve the existing service-level test seams for this change.

## Non-Goals

- Do not address native SQLite environment setup.
- Do not remove valuable lifecycle tests.
- Do not broaden memory service APIs or export new production types only for tests.
