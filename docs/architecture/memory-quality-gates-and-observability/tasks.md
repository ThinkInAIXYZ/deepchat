# Memory Quality Gates and Observability — Tasks

> The requirements are defined in [spec.md](./spec.md), the implemented design is described in
> [plan.md](./plan.md), and metric ownership is recorded in [metrics.md](./metrics.md).

## Test Scope and CI

- [x] Establish one behavior, Native, eval, and performance test-scope manifest.
- [x] Reject unclassified tests, duplicate ownership, stale paths, Native/portable mistakes, and unexplained
  exemptions.
- [x] Make file-content access injectable so scope tests cannot fall through to the real filesystem.
- [x] Add shared and specialized Memory Vitest configurations.
- [x] Add stable `test:memory:scope`, `test:memory`, and `test:memory:eval` commands.
- [x] Preserve the dedicated `test:main:memory-perf` configuration and command.
- [x] Keep Native invocation workflow-owned with no local Native package script.
- [x] Run scope and portable behavior before the Node ABI rebuild.
- [x] Run required Native storage, eval, and performance paths after rebuild.
- [x] Upload the retrieval report even when evaluation fails.

## Retrieval Evaluation

- [x] Define and validate the versioned retrieval fixture schema.
- [x] Add at least 200 synthetic corpus rows and 60 queries.
- [x] Cover exact, CJK, path, code, semantic, mixed, multi-relevant, and cross-Agent cases.
- [x] Generate corpus and query vectors with the same 128-dimensional deterministic embedder.
- [x] Prevent the embedder from reading query IDs, subsets, or relevant IDs.
- [x] Use real SQLite FTS and production similarity conversion, threshold, keyword extraction, fusion, and
  ordering.
- [x] Implement Recall@5, MRR@10, and nDCG@10 with duplicate and multi-relevant semantics.
- [x] Gate hybrid quality and report FTS-only and vector-only baselines.
- [x] Add semantic concept ablation as a negative control.
- [x] Write the JSON artifact before threshold assertions.

## Bounded Diagnostics

- [x] Add fixed-capacity sample rings and nearest-rank percentile helpers.
- [x] Implement 64-Agent LRU retention, 24-hour TTL, and 256 samples per distribution.
- [x] Keep process gauges outside Agent retention and eviction.
- [x] Remove full TTL sweeps from record hot paths.
- [x] Add safe narrow recorders that cannot affect business results.
- [x] Segment retrieval by purpose, terminal outcome, and multiple degradation causes.
- [x] Count embedding terminal results from actual repository transitions.
- [x] Distinguish extraction cancellation and increment CAS retries only for real retry applies.
- [x] Report maintenance phase outcomes, calls, tokens, and every denied budget step.
- [x] Distinguish vector warmup success, deferred convergence, and failure.
- [x] Separate provider admission decisions, race events, and the absolute waiting gauge.
- [x] Reuse one vector/provider resource observation for current and high-water state.
- [x] Add the required global pending-embedding count and its idempotent partial index.
- [x] Avoid repository Proxy instrumentation when no external performance observer exists.
- [x] Cover Agent eviction, TTL, ring overflow, cleanup, disposal, immutable snapshots, and content markers.

## Typed Contract and UI

- [x] Make `MemoryHealthDto.runtime` required with separate Agent and process snapshots.
- [x] Define shared closed constants for retrieval purpose, terminal outcome, degradation cause, and maintenance
  step.
- [x] Populate every closed-enum record with zero-value defaults.
- [x] Return an empty Agent snapshot and real process snapshot for unmanaged or unsampled Agents.
- [x] Display retrieval latency, degradation, queue age, embedding backlog, maintenance, vector resources, and
  provider pressure in the existing Diagnostics panel.
- [x] Display an em dash for missing latency samples.
- [x] Keep provider gauges separate from cumulative counters.
- [x] Mark process-wide values explicitly and exclude content or error detail.
- [x] Localize all added user-facing strings for every supported locale.

## Test Architecture and Documentation

- [x] Split service behavior out of the facade-scale suite.
- [x] Keep facade coverage limited to composition, public delegation, cross-service workflows, cleanup, disposal,
  and regression smoke.
- [x] Replace centralized suite registration with actual service and infrastructure suites.
- [x] Consolidate repository capability fragments and remove duplicate harness implementations.
- [x] Ensure every retained harness builder has a real service-suite consumer.
- [x] Remove production mutable test accessors.
- [x] Preserve generation, cooldown, reset-failure, warmup, cancellation, and CAS contention coverage.
- [x] Publish the maintained metric dictionary and update the Agent Memory architecture reference.

## Local Validation

- [x] `mise exec -- pnpm run typecheck`
- [x] `mise exec -- pnpm run test:main`
- [x] `mise exec -- pnpm run test:memory:scope`
- [x] `mise exec -- pnpm run test:memory`
- [x] `mise exec -- pnpm run test:memory:eval`
- [x] `mise exec -- pnpm run test:main:memory-perf`
- [x] `mise exec -- pnpm run test:renderer`
- [x] `mise exec -- pnpm run format`
- [x] `mise exec -- pnpm run i18n`
- [x] `mise exec -- pnpm run lint`
- [ ] GitHub Actions `memory-native-validation` completes with required Native SQLite and no skip or fallback.

The external Native workflow remains pending because the updated job has not yet run against a submitted
revision. Local validation must not rebuild or replace the Electron ABI binding to simulate this evidence.
