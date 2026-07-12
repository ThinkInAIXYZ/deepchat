# Agent Memory Test Seams Spec

## User Need

Agent memory tests should keep their lifecycle and race coverage without forcing `MemoryPresenter`
to retain facade-level private accessors that exist only for tests.

## Superseded by the Quality Gates Architecture

The temporary service-level mutable seams described here were removed by
[Memory Quality Gates and Observability](../memory-quality-gates-and-observability/spec.md). Lifecycle and race
tests now use controlled promises, fake clocks, public behavior, and the immutable runtime diagnostics
snapshot. This document remains only as historical context and is no longer a maintained testing contract.

## Acceptance Criteria

- `MemoryPresenter` no longer contains `retainRuntimeCompatAccessorsForTests()` or private runtime
  getter wrappers.
- `memoryPresenter.test.ts` no longer casts the presenter facade to read `vectorStoreReady`,
  `embeddingDrains`, `personaLocks`, or related compat getters.
- Existing lifecycle, cleanup, cold-path, cooldown, and dispose tests remain present and pass.
- Production memory behavior and public APIs are unchanged.
- The six service/infra `getMutableRuntimeStateForTests()` accessors and vector resource-state accessors are
  absent from production source.

## Constraints

- Do not create a GitHub issue, branch, or commit.
- Keep tests on service capability harnesses or public behavior; do not reintroduce mutable production seams.

## Non-Goals

- Do not address native SQLite environment setup.
- Do not remove valuable lifecycle tests.
- Do not broaden memory service APIs or export new production types only for tests.
