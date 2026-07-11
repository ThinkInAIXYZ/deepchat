# Memory Quality Gates and Observability — Implementation Plan

> This document describes the implemented architecture. Requirements and acceptance criteria are defined in
> [spec.md](./spec.md), completed work is recorded in [tasks.md](./tasks.md), and metric ownership is defined in
> [metrics.md](./metrics.md).

## 1. Architecture Strategy

The implementation follows four layers in dependency order:

1. Establish one authoritative Memory test scope and make Native capability failures explicit.
2. Add deterministic retrieval evaluation around real storage and production ranking behavior.
3. Add bounded, content-free diagnostics through narrow recorder ports and existing resource observations.
4. Expose the typed snapshot in the existing Health UI and migrate facade-scale tests to service suites.

Runtime observation remains a side effect of business operations. Recorder wrappers catch collector failures,
and no operation changes its success, fallback, cancellation, or error behavior because diagnostics failed.

## 2. Test Scope and CI

### 2.1 Single Scope Manifest

`test/memory-test-scope.json` is the only ownership list for Memory tests. It classifies concrete paths into
`behavior`, `native`, `eval`, and `perf` sets and allows explicit exemptions with mandatory reasons.

The scope validator:

- discovers candidates through Memory-owned directories, filenames, and direct imports;
- treats missing `exemptions` as an empty list;
- rejects missing paths, duplicate classifications, unclassified candidates, and Native harness tests in the
  portable set;
- accepts injected file contents or a `readFile` function so tests never fall through to the real filesystem;
- avoids broad text markers that would classify unrelated application suites.

The shared Vitest base contains common aliases and setup. Behavior, Native, eval, and performance configs only
override their path set, worker policy, timeout, or environment requirements.

### 2.2 Workflow Order

The existing Memory job runs in this order:

1. Install dependencies under Node 24 with the repository-pinned pnpm version.
2. Run the scope guard and portable Memory behavior before changing any native binding.
3. Rebuild the SQLite binding for the Node ABI.
4. Run the encrypted SQLite smoke check.
5. Run the Native config with `DEEPCHAT_REQUIRE_NATIVE_SQLITE=1`.
6. Run deterministic retrieval evaluation once under the same required-Native environment.
7. Run the dedicated Memory performance configuration.
8. Upload `test-results/memory/retrieval-v1.json` with `if: always()`.

There is no `test:memory:native` package script. The workflow owns Native invocation so local development does
not accidentally replace the Electron ABI binding.

## 3. Retrieval Evaluation

### 3.1 Fixture and Embedder

The fixture schema stores a profile declaration, synthetic corpus rows, and queries with subsets and relevant
IDs. It deliberately stores no vectors.

The test-local embedder applies the following deterministic pipeline to both corpus and query text:

1. Normalize with NFKC and lowercase ASCII text.
2. Extract ASCII words, code tokens, path segments, and CJK trigrams.
3. Add features from a fixed, versioned synonym concept table.
4. Hash token and concept features into 128 dimensions.
5. L2-normalize the vector.

The implementation accepts only text and configuration. Query identifiers, subset labels, and relevance data
are unavailable to the embedding function, preventing answer leakage.

### 3.2 Evaluation Data Flow

For each query, the runner:

1. Loads synthetic corpus rows into a real `AgentMemoryTable`.
2. Executes real SQLite FTS through the production repository path.
3. Generates deterministic corpus and query vectors with the same profile.
4. Converts vector distance through the production similarity helper and removes candidates below the
   production similarity threshold.
5. Uses production keyword extraction, authoritative row projection, stable ordering, and `fuse` for hybrid
   results.
6. Calculates FTS-only, vector-only, and hybrid Recall@5, MRR@10, and nDCG@10.
7. Writes the complete JSON report before applying assertions.

Hybrid results own the fixed gates. FTS-only and vector-only remain diagnostic baselines. Lexical subsets also
enforce a bounded hybrid-versus-FTS regression check. A concept-ablation run confirms that semantic success is
caused by the deterministic semantic signal rather than accidental lexical overlap.

## 4. Diagnostics Runtime

### 4.1 Collector State

`MemoryDiagnosticsCollector` separates Agent and process ownership:

- Agent state: at most 64 entries, 24-hour TTL, LRU ordering, and 256 samples per distribution.
- Process state: extraction queue, embedding backlog, vector resources, and provider admission; it is never
  evicted with an Agent.

Existing Agent entries are touched in O(1) by deleting and reinserting their `Map` entry. TTL scans run only
when creating an Agent at capacity, reading a snapshot, or performing explicit cleanup. Snapshot calculation
copies and sorts each distribution, then computes nearest-rank p50, p95, and max without mutating retained
samples.

Recorder ports accept only typed numeric samples, booleans, timestamps, and shared closed enums. Safe wrappers
catch all collector errors. Cleanup removes the relevant Agent entry; disposal clears both state scopes.

### 4.2 Retrieval Operations

Each retrieval entry point creates one execution context with purpose, start time, source counters, terminal
outcome, and a set of degradation causes. A single `finally` block settles the operation exactly once.

Terminal outcomes and degradation causes are intentionally independent. Disabled and empty-query operations
are normal terminal outcomes, while FTS unavailability, vector cold state, embedding timeout/error, unusable
stores, store errors, revision changes, and unknown failures are degradation causes. Multiple causes can be
retained for one operation.

Decision retrieval records one aggregate batch operation rather than one latency sample per candidate.
Repository, FTS, embedding gateway, vector store, revalidation, fusion, and assembly boundaries classify their
own failures without changing existing propagation or fallback behavior.

### 4.3 Background Operations

- Extraction records absolute process queue depth and oldest queued timestamp. Session teardown removes its
  bookkeeping entry. Chunk outcomes distinguish completed, cancelled, and failed; CAS retry increments only
  immediately before a real second apply.
- Embedding uses a required global pending-count repository query and a partial SQLite index. Drain results
  carry control outcome, batch size, and actual repository transition IDs/counts for embedded, error, and
  FTS-only rows.
- Maintenance reports cheap and heavy phase duration/outcome, calls, input tokens, and a count for every denied
  budget step. Missing model selection produces a heavy skipped sample.
- Vector diagnostics adapt the existing resource observer so one absolute observation updates current and
  high-water values. Warmup distinguishes succeeded, deferred, and failed.
- Provider diagnostics keep the true admission-waiting gauge separate from admitted, rate-limited,
  capacity-rejected, deadline, aborted, and late-settled counters. Admitted is recorded only after both remote
  admission and local capacity reservation succeed.

Repository instrumentation uses a Proxy only when an external performance observer exists. Diagnostics alone
does not add a repository Proxy to production hot paths.

## 5. Health Contract and UI

The required `MemoryHealthDto.runtime` field contains:

- `agent`: retrieval-purpose distributions and counters, extraction results, embedding transitions, and
  maintenance results.
- `process`: extraction queue, embedding backlog, vector current/high-water resources, warmup outcomes, and
  provider admission/race data.

Every `Record` keyed by a closed enum is complete in both populated and empty snapshots. An unmanaged or
unsampled Agent receives a zero Agent snapshot while process data remains live.

The Diagnostics panel uses the existing Health refresh. It displays an em dash for absent latency samples,
labels process-wide data, shows queue depth and oldest age, and renders provider queued state separately from
cumulative admission and race counters. No stack, SQL, provider error, or user content reaches the renderer.

## 6. Test Architecture

Service suites own service behavior directly. Shared support provides only reusable capabilities:

- repository state with read, mutation, embedding, lifecycle, health, and transaction fragments;
- controlled promises and condition waiters;
- vector, provider, clock, and diagnostics probes;
- common synthetic fixture builders.

The facade suite covers composition and cross-service behavior only. Structural guards reject centralized
`register*` suites, production mutable test accessors, and harness builders that have no real suite consumer.
Generation changes, cooldown, malformed dimensions, reset-failure cleanup, warmup convergence, cancellation,
and CAS contention are verified through controlled asynchronous behavior and observable snapshots.

## 7. Compatibility and Rollback

- No persisted user data format or public Memory decision behavior changes.
- The SQLite partial index is idempotent derived infrastructure and requires no versioned migration.
- The runtime Health field is required; empty factories and typed routes provide complete defaults.
- The CI additions can be reverted independently, but doing so removes required evidence for Native storage and
  retrieval quality.
- Diagnostics can be disabled at composition without affecting business behavior because all recorder ports
  are observational.

## 8. Validation Strategy

Local validation covers type checking, the full main suite, focused Memory scope and behavior, deterministic
eval primitives, performance bounds, the renderer suite, formatting, localization parity, and linting.

The updated `memory-native-validation` workflow is the final external gate. It must demonstrate that required
Native storage, FTS, retrieval evaluation, and performance paths run without skip or fallback after the change
is submitted to CI.
