# Memory Query Embedding Circuit Breaker

Status: implemented and validated.

GitHub issue: [#2118](https://github.com/ThinkInAIXYZ/deepchat/issues/2118)

## Issue

Warm Memory recall always starts query embedding when the vector store is ready. The provider
gateway and retrieval service bound that call to 800 ms and correctly degrade to FTS, but neither
owner retains provider health across turns. A repeatedly slow embedding path therefore adds the
same pre-stream delay to every Agent turn even though FTS candidates are already available.

## Impact

- Every affected turn pays a predictable first-token delay before the existing FTS fallback.
- Requests that are already known to be unhealthy add provider load and repeated warnings.
- Agent and benchmark latency includes avoidable query-embedding deadlines rather than useful work.
- The successful final answer hides the failure mode from users and makes it difficult to diagnose.

## Root Cause

- `MemoryProviderGateway` owns per-request deadlines, cancellation, admission, and capacity, but it
  intentionally has no cross-request policy and serves all Memory provider purposes.
- `RetrievalService` owns query-embedding de-duplication and FTS degradation, but its retained state
  records only in-flight requests. A settled timeout is forgotten before the next turn.
- Runtime diagnostics count individual deadlines and retrieval degradations but expose no current
  query-embedding health state or circuit skips.

## Fix Plan

Keep the circuit in `RetrievalService`, immediately before query embedding starts. This is the
narrowest owner that can skip only query vectors while preserving the already-computed FTS path.
Do not put the policy in the shared provider gateway, where it could suppress embedding batches,
warmup, dimension discovery, extraction, decisions, or maintenance.

For each Agent, retain at most the current effective embedding provider/model state:

- open after two deadline or transport failures in a 30-second window;
- while open, skip new query embedding and continue with FTS immediately;
- after a 30-second cooldown, admit one half-open probe and skip concurrent turns;
- close and reset the failure window after a successful probe;
- reopen after a failed probe without exponential or unbounded cooldown growth.

Memory cancellation, generic `AbortError`, and local capacity rejection do not count as provider
health failures. Shared in-flight requests settle circuit health only once. Configuration changes,
Agent cleanup, and service disposal remove stale circuit and in-flight state.

Expose only the closed/open/half-open state and cumulative failure, open, and skip counts through
the existing bounded Agent diagnostics. Add a closed retrieval degradation for circuit skips so an
injection manifest can report that vector recall was intentionally bypassed. Do not retain query
text, memory content, vectors, provider/model identifiers, responses, errors, or other free text in
the circuit or diagnostics.

## Compatibility And Non-Goals

- Preserve healthy FTS/vector scoring, candidate limits, adaptive refill, and access accounting.
- Preserve the 800 ms per-request absolute and soft deadlines.
- Do not change provider retry or rate-limit policy.
- Do not persist circuit state or add a database migration.
- Do not share failures across Agents, provider/model identities, or non-query provider purposes.
- Do not add an external telemetry or polling path.

## Acceptance Criteria

1. Two qualifying failures open the circuit, and later turns return existing FTS results without
   starting or waiting for query embedding.
2. Exactly one probe is admitted after cooldown; success closes the circuit and restores vector
   recall, while probe failure reopens it.
3. Agent/provider-model isolation is preserved, and provider changes, Agent cleanup, and disposal
   invalidate stale state.
4. Cancellation and local control errors do not increment failure counts or open the circuit.
5. Health diagnostics expose current closed/open/half-open state and content-free failure, open, and
   skip counts; skipped retrieval records a closed degradation cause.
6. Deterministic fake-timer tests cover threshold, cooldown, recovery, isolation, cleanup, and
   cancellation without changing healthy retrieval results.

## Task Checklist

- [x] Validate the issue against the production recall, provider, diagnostics, and lifecycle paths.
- [x] Implement the bounded query-embedding circuit and lifecycle invalidation.
- [x] Extend typed content-free diagnostics and maintained Memory documentation.
- [x] Add focused fake-clock regression coverage.
- [x] Run formatting, i18n, lint, type checking, and relevant Memory/renderer tests.
- [x] Review the staged commit for side effects, compatibility, boundaries, performance, security,
  naming, coverage, and maintenance cost before committing.

## Validation

Completed on 2026-08-10:

```bash
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run format:check
pnpm run test:memory
pnpm run test:main
pnpm exec vitest run --config vitest.config.renderer.ts \
  test/renderer/components/MemoryDiagnosticsPanel.test.ts
```

- Memory suite: 54 files, 888 tests passed.
- Main suite: 541 files and 6,622 tests passed; 28 files and 371 tests skipped by the existing
  suite configuration.
- Renderer diagnostics panel: 1 file, 22 tests passed.
- Formatting, i18n validation, lint, and Node/Web type checking passed.
