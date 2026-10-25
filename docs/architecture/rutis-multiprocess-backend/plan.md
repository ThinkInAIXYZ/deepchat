# DeepChat Harness and Capability Migration Plan

## Objective and completion rule

Extract a reusable Harness, Memory and peripheral capabilities through Rutis, then move selected
owners/computations to Rust where correctness, deployment or measured resource savings justify it.
Work on `dimagent/rutis-harness-bootstrap`, one complete module at a time. Replace actual app wiring,
run matching end-to-end baseline and migrated workloads, and remove the old path after parity.
There is no retained implementation switch or local fallback.

Current scope: staged implementation in
[Draft PR #2465](https://github.com/ThinkInAIXYZ/deepchat/pull/2465), targeting `dev`. Admission is
committed as `ffcd98770` and the roadmap as `f35adff34`. G3 is active; later goals start only after
their dependencies and the preceding selected goal pass validation.

Use this file as the only tracker. [The RFC](spec.md) defines capability ownership, Memory
dependencies, Rust hypotheses, process placement and Everywhere contracts. Keep status and evidence
here as slices land; do not create a second task ledger. No GitHub issue sync is requested;
review status is maintained in the linked Draft PR.

For each goal, finish the selected implementation and real default wiring, run the relevant tests
and baseline/migrated application comparison, review ownership/failure/resource behavior, and
remove replaced wiring. Run format, i18n, lint and typechecks before committing. Push each validated
goal separately to this same Draft PR, then update its status before starting the next goal.
Failed checks must be resolved or recorded as a concrete external blocker; they cannot be silently
skipped to advance. Keep the PR in draft and do not merge it as part of this execution.

## Live goals and dependencies

| Goal | State | Dependencies | Completion condition |
| --- | --- | --- | --- |
| G0 Admission | Complete, `ffcd98770` | Existing branch baseline | Default Rutis wiring, matching real-app E2E and old path removed |
| G1 Whole-capability roadmap | Complete; documentation only | G0 and source research | Capability map, Memory boundary, Rust ranking, ordered goals and honest evidence |
| G2 Baselines and first service contract | Complete, `84e3e0ead` | G1 | Reproducible resource baselines and frozen operation/ownership budgets |
| G3 Memory vector resources | CI corrections in progress | G2 | Actual vector operations through Rutis, preserved native lifecycle and old factory wiring removed |
| G4 Store commands and desktop ports | Planned | G2 | Explicit durable operations, writer inventory and asynchronous host capabilities |
| G5 Cohesive TS Harness backend | Planned | G4 | Run/loop/Session/Tape/Provider composition operates under one backend authority |
| G6 Full Memory capability | Planned | G3, G4, G5 | Recall, ingestion, management and maintenance use the one Memory service |
| G7 Rust control owner | Planned | G2, G5 | Admission and cohesive run/interaction settlement preserve all fences |
| G8 Rust batch computations | Conditional | G2, G4, G5; G6 for Memory work | Measured CPU/allocation improvement with output and quality parity, or a recorded no-go |
| G9 Peripheral capabilities | Conditional per selected module | G4, G5 | Independent useful lifetime, real consumer cutover and no duplicate supervisor |
| G10 Rust durable Store | Conditional compatibility project | G4, G5, G6, G7 | One compatible encrypted writer and proven migration/recovery/maintenance behavior |
| G11 Headless Session Host | Planned | G4, G5 and host-port audit | Real CLI execution without Electron and without a connected desktop |
| G12 Multiple clients and devices | Planned | G11 and explicit grants | Reconnect-safe clients and separately authorized, revocable device operations |

G3 is selected for its bounded file/resource ownership, not an assumed native query speedup.
G2 may reject its process placement if transport or aggregate memory costs are unacceptable.
G4 and G5 remove the shared-storage and synchronous-call blockers for the full Memory service.
G7 and G8 are different objectives: a coherent Rust control owner can have architectural value
without a speed claim; CPU-oriented rewrites require measured gains. G11 does not wait for G8/G10.

## G0. Admission migration: complete

### Establish the baseline and contract

- [x] Inspect all admission callers, leases, diagnostics, startup/shutdown, packaging and E2E fixtures.
- [x] Run existing admission and delegation tests on the original app wiring: 82 tests passed.
- [x] Build and run the original application with isolated profiles and a local model fixture.
      Preserve baseline build artifacts outside the source tree for the same migration E2E workload.
- [x] Define ordering, cancellation/late-grant cleanup, per-owner limits, correlation, disconnect,
      bounded framing, observation and shutdown requirements in the RFC.

### Replace the module and its application wiring

- [x] Move the existing admission queue owner into the TS runtime; preserve its behavior and tests.
      Keep shared contracts and caller lease state explicit; remove the main-process queue owner.
- [x] Provide the complete admission operations through Rutis, including owner limits, correlation,
      cancellation, release reasons, close and diagnostic flushing.
- [x] Replace the one-shot Rust probe with the application host and a declared admission gateway.
      Preserve request order, bound transport resources and close pending work on generation loss.
- [x] Connect the main composition and actual LiveDelegationService to the Rutis client by default.
      Stop new admission after runtime failure; keep one shutdown owner.
- [x] Integrate normal builds and packaged artifacts, including the unmodified runtime closure and
      correct native host target. Remove the separate developer-only module path.

### Compare actual execution and remove old wiring

- [x] Run the same real-app E2E delegation workload against baseline and migrated builds: child
      execution, admission queueing, cancellation/interrupt, completion, diagnostics and shutdown.
- [x] Verify process loss rejects pending work and cannot silently create another admission owner.
- [x] Add only durable lifecycle/contract regression coverage after implementation; reuse the
      existing owner and delegation suites, avoiding mock implementations of Rutis.
- [x] Remove old composition wiring, obsolete probe code, unused dependencies and temporary
      comparison artifacts from the deliverable. Retain no fallback or implementation toggle.

### Whole-change review and validation

- [x] Review ownership, public compatibility, queue fairness, lease races, diagnostics gates,
      transport validation, resource limits, failure behavior, deployment and shutdown.
- [x] Update directly affected maintained architecture and logging contracts.
- [x] Run format, i18n, lint, typecheck, relevant Vitest suites, Cargo checks and the actual E2E
      comparison. Record measured results and unexecuted targets without claiming performance gains.

## G1. Source-backed roadmap: complete

- [x] Commit the existing admission migration before broader planning: `ffcd98770`.
- [x] Inspect the actual Harness composition, synchronous ownership/fences, Memory facade and
      vector resources, shared database, scheduler writes and existing helper processes.
- [x] Define coherent capabilities separately from process placement and implementation language.
      Keep internal helpers internal and preserve desktop/external-plugin trust boundaries.
- [x] Specify Memory as one capability, its vector-resource first slice, shared-storage and
      execution-token dependencies, ingestion consistency, maintenance and prompt-trust rules.
- [x] Rank Rust candidates by structural value or measured CPU/allocation/idle-runtime savings.
      Account for existing native engines, bounded recall and existing resource eviction.
- [x] Define dependencies, acceptance and stop conditions for Harness, peripheral and Everywhere
      goals. Reuse existing perf/quality diagnostics and make no unmeasured gain claims.
- [x] Review doc consistency, local references and scope; run repository format, i18n, lint and
      typecheck. This goal changes only this RFC and plan; no new application code or tests.

## G2. Establish baselines and freeze one extraction contract

- [x] Preserve immutable pre-admission and `ffcd98770` artifacts, runtime versions and isolated
      fixtures. Reproduce baseline workloads before using an old build as performance evidence.
- [x] Profile idle/startup, streaming and delegation, large context/Tape, native Memory recall and
      background maintenance. Use at least five paired runs and fixed local Provider fixtures.
- [x] Measure CPU, native operation time and process-tree memory; distinguish Provider fixture
      waits from local work and freeze the transport/resource envelope from actual callers.
      Record allocation/GC and data-copy risks from source. Collect allocation-stack traces and
      vector IPC byte counters with G3/G8 before attributing a measured performance gain.
- [x] Freeze numeric target and allowed regressions before judging the selected implementation;
      record hardware, variability, workload sizes and whole-app measurement method here.
- [x] Freeze the selected service's versioned schemas, bounded batches/results, caller identity,
      generation/operation IDs, cancellation, unknown outcomes, readiness and shutdown contract.
      Keep the admission gateway allowlist unchanged until a deliberate service protocol exists.

Completion: one concrete module and its placement have a measurable purpose and an executable
end-to-end comparison. Missing measurements do not justify a claimed Rust speedup or extra process.

### G2 measurement evidence

Environment: macOS 27.0.1, Apple M5, 10 CPU cores, 24 GiB RAM, Node 24.22.1, pnpm 10.34.5,
Electron 43.8.3, DuckDB Node API 1.5.5-r.4 and Rust 1.95.0. Use fixed exports of `3e9948b72`
(pre-admission) and `f35adff34` (admission code `ffcd98770` plus documentation), linked to the same
installed native dependencies. Build both with `pnpm exec electron-vite build`; include the locked
host/runtime closure in the admission artifact. Both are unpackaged builds with the Playwright
inspector, not signed-release or user-profile footprint measurements. The complete `out` tree hashes were unchanged
before and after all application comparisons:

- Baseline: 1,054 files, SHA-256 `16c1efc66372897e4d3cb0814dc86c15073b0234f8cd0dfe6ea160e156119ee8`.
- Admission: 1,159 files, SHA-256 `acd0bdc1e65d37ded30f56b49cf14dbcc189cbe7f326b03657b007f8ec58f156`.

Run the same current E2E harness against both immutable builds with
`DEEPCHAT_E2E_MEASURE_RESOURCES=1`, selecting `01-launch`, `36-chat-streaming` and
`44-admission-delegation` through `test/e2e/playwright.config.ts`. Alternate baseline/admission order
over five pairs. Every launch uses the fixture's disposable profile, except intentional relaunches
within the existing recovery cases. These are fresh-profile tests with a warm OS file cache, not
disk-cache-cold startup. All ten runs pass the same five checks: 50 E2E passes.

The opt-in resource helper attaches numeric JSON reports without changing production code. It
samples all descendants every 500 ms using the public macOS `proc_pid_rusage` v0 layout, recording
resident size, physical footprint, process identity and cumulative CPU. Convert CPU Mach ticks with
`mach_timebase_info`; calibration matches a 0.2-second CPU-clock workload. Readiness is visibility
of the app root and sidebar. Event-loop histograms begin after inspector attachment. Short-lived
children and between-sample allocation peaks may be missed; sampled CPU excludes shutdown after
the last sample. Physical-footprint sums and RSS sums are separate process-tree measures, not a
claim about unique system-wide physical pages. The observer is identical for both builds.

Event-loop delay does not attribute GC or allocations. G2 does not claim allocation-stack, GC-pause
or current wire-byte measurements. Vector IPC does not exist in this baseline; G3 instruments its
actual byte counts, and performance-driven Rust work needs stage-specific CPU/allocation profiles
before selection. This keeps the first isolation contract separate from an unproven optimization.

The following are medians of five runs. Footprint/RSS are sampled per-run peaks; event-loop values
are medians of each run's p99. Provider work uses the existing local fixtures.

| Case | Build | UI ready, ms | Footprint, MiB | RSS, MiB | Sampled CPU, s | Main loop p99, ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Startup | Baseline | 1988.70 | 1012.96 | 1475.91 | 4.76 | 44.96 |
| Startup | Admission | 2058.19 | 1036.56 | 1545.00 | 4.68 | 68.81 |
| Streaming | Baseline | 1999.99 | 1372.99 | 1677.64 | 7.74 | 47.78 |
| Streaming | Admission | 2067.01 | 1395.93 | 1759.14 | 7.78 | 54.10 |
| Delegation | Baseline | 1995.45 | 1067.48 | 1482.30 | 6.76 | 45.15 |
| Delegation | Admission | 2069.24 | 1093.26 | 1565.52 | 6.77 | 50.86 |

Current startup has a 1975-2336 ms range and 82.72 ms median absolute deviation (MAD). Streaming
readiness MAD is 80.01 ms; delegation readiness MAD is 66.13 ms. Current footprint MADs are 12.87,
0.73 and 58.09 MiB respectively; delegation loop-p99 MAD is 2.16 ms. The Rust host and admission TS
runtime have median individual sampled footprints of 2.70 and 28.75 MiB at startup. Admission adds
about 23-26 MiB to the measured application footprint and 67-74 ms to readiness in these cases.
This is a structural migration with a measured cost, not an observed performance improvement.

Native SQLite/Memory performance checks pass at 1k/10k/50k rows, with Tape cases through 100k
entries. A temporary native-vector scale fixture calls the production `MemoryVectorStore` with
real DuckDB, deterministic 384-dimensional vectors, 50-row upserts and 11 warm query samples.
For row `r` and component `c`, use `((r * 31 + c * 17) % 65521) / 65521`; query row 17 with top 20
and report the first query separately. Run the existing perf config with native SQLite required
and `--disableConsoleIntercept` to preserve its numeric reports.
Together, 7 performance files/11 checks pass with native SQLite required and no skipped check.
The temporary scale fixture stays outside the deliverable; existing performance suites and the
production adapter supply the repeatable operations.

| Native operation | Scale | Median, ms | p95, ms |
| --- | ---: | ---: | ---: |
| FTS recall | 1k rows | 0.56 | 0.65 |
| FTS recall | 10k rows | 0.87 | 1.00 |
| FTS recall | 50k rows | 2.89 | 3.20 |
| Vector query, 384 dimensions, top 20 | 1k rows | 0.83 | 0.94 |
| Vector query, 384 dimensions, top 20 | 10k rows | 3.92 | 4.17 |
| Vector query, 384 dimensions, top 20 | 50k rows | 29.01 | 29.14 |
| Tape bounded range | 100k entries | 0.04 | 0.05 |
| Tape full view | 100k entries | 108.22 | 131.52 |

These are fixture/native-adapter timings, not end-to-end application recall or a JS/Rust comparison.
The Tape result justifies checking range use and materialization before rewriting a fold; it does
not prove the normal turn takes the full-view path. Native DuckDB time is not a JS bottleneck.
Whole-app Memory-active, greater-than-eight-Agent and upload-saturation comparisons belong to G3's
actual module cutover, before deleting its old wiring. No raw history/vector IPC exists in G0;
G3's protocol byte, queue and native-concurrency caps are frozen in the RFC.

### G3 adoption budgets

These are policy targets, frozen before G3 implementation. Repeat at least five paired runs with
the same build/runtime, profiles, local fixtures and observer. Use the admission build as the next
module's baseline and preserve G2's pre-admission comparison for aggregate architecture cost.

| Gate | Required result |
| --- | --- |
| Unused Memory | No additional process; UI-ready medians add at most `max(100 ms, 2 x baseline MAD)` per case; sampled footprint medians add at most `max(32 MiB, 2 x baseline MAD)` |
| Memory-active resource cost | After drain, at most 64 MiB extra process-tree footprint; sampled active peaks at most 128 MiB extra for matching vectors/rows; one staged upload of at most 16 MiB; store leases and queues converge |
| Warm native query | p95 overhead at most `max(5 ms, 20% of native baseline p95)`, including every transport/copy; establish the matching real-app baseline before replacing the module |
| Upsert | Mean overhead at most `max(5 ms, 25% of baseline mean batch time)` per logical 50-row batch at the characterized sizes; preserve one atomic native transaction |
| First vector use | Runtime plus native open has median at most 500 ms and p95 at most 1 second; preserve the existing retrieval fallback/deadlines rather than extending them |
| Loaded control loop | Delegation loop-p99 median adds at most `max(10 ms, 2 x baseline MAD)`; bulk transfer cannot starve acquire/release/cancel |
| Correctness and isolation | Same recall selection/quality and durable data; atomic interrupted uploads, known-ID late-open cleanup, stale-generation rejection, FTS degradation and no replacement admission owner |

Do not accept a rewrite for noise-level gains. Later performance-driven Rust work requires at least
20% lower total CPU for the selected local workload or 15% lower settled aggregate footprint,
including serialization and all participating processes. End-to-end gains must exceed measured
variance, with no readiness/response regression above 5% beyond that variance. A structural owner
migration can instead satisfy its declared lifecycle objective within its frozen resource budget.

- [x] Repair the two complete-suite CI contracts for the required Harness build and Cargo steps;
      both contract files pass locally (9 checks). Full main validation passes: 677 files passed,
      2 skipped; 9,827 tests passed and 4 skipped.
- [x] Typecheck the E2E fixture and measurement helper directly in addition to app typechecks.
- [x] Complete final format/i18n/lint/typechecks, all 29 local references and scope review.
      The uninstrumented five-case application E2E also passes; no production module changed in G2.
- [x] Push G2 as `84e3e0ead` to Draft PR #2465. Required CI run `40193664779` passes on exact head
      `84e3e0ead952d9ea769246c4ca2851a2338c7eca`: static, main, renderer, native Memory, build and
      the required-check barrier all succeed before G3 starts.
- [x] Exact-head package check run `40193664778` passes all six macOS/Windows/Linux x64/arm64
      verification packages and the package-required barrier. This evidence covers G2 artifacts.

## G3. Extract Memory vector resources through Rutis

First characterize real native Memory search/management on the preserved application build.
This migration requires a matching executable baseline before replacing the factory, so the
shared application E2E fixture is written before implementation as contract characterization.

Current evidence:

The Float32 transport passes local adoption budgets, but aligned Linux CI still rejects write
latency. G3 remains unaccepted and G4 has not started. The selected correction sends bounded raw
upload bytes from Main to Rust. Rust stages one bounded upload and acknowledges each received
chunk; commit dispatches a native atomic upsert through Rutis `Value::Bytes`. Internal native parts
are bounded to eight MiB so encoded messages fit Rutis's 16-MiB limit; all parts belong to one batch
and only the complete batch reaches the existing transaction. This preserves
64-KiB application chunks, one outstanding chunk acknowledgement, the 16-MiB/50-record logical
limit, atomic writes and control priority. The native owner keeps resource and file authority;
application transfer state belongs to the Rust gateway. Raw forwarding alone shows little local
latency improvement and does not justify retaining a second per-chunk native acknowledgement.
Pinned provider SDK patches validate a finite numeric array and clone it once, preserving response
validation and raw-response isolation without allocating a Zod parsing payload per component.
All 27 real SDK response contract checks pass across OpenAI, compatible, Azure, Google single/batch,
and Vertex Node/edge endpoints. Require exact-head required CI, six package checks and complete
matching resource comparisons before the next goal.

- Actual recall, indexing, deletion, reset and maintenance use one lazy native TS vector runtime
  under the existing Rust host. Admission retains its separate runtime and identity. Main keeps
  the typed facade, Memory policy and canonical database; Knowledge still uses DuckDB in Main.
  The replaced native factory and recovery wiring are removed.
- The vector worker holds the private kernel-owned database lock before recovery or file mutation.
  Persistent Agent leases fence uncertain writes, late opens and disposal. Main can synchronously
  append quarantine intent, including after worker loss, but only the locked native owner consumes
  it. Native quarantine terminates the vector process before uncertain cleanup or GC; admission
  survives, vector retrieval degrades to FTS, and restart requires explicit rebuilding.
- Typed native column buffers preserve atomic writes and Float32 values while avoiding per-component
  native scalar allocation. Only the vector worker uses eight-MiB V8 semi-spaces. The admission heap
  policy remains unchanged; there is no forced GC or retained implementation switch.

### Matching application resource comparison

Use the G2 admission source with identical current Provider/ACP catalogs and shared E2E fixtures.
The real-app scenario indexes 1k/10k/50k canonical memories with dense 1536-dimensional Float32
embeddings, checks vector-only recall, deletion and native row counts, then relaunches and clears
every memory plane. Run six pairs at 1k with the first pair excluded as warmup, then five pairs at
each larger scale; alternate baseline/migrated order. All 32 vector application checks pass,
including warmup. The first application phase measures unused Memory; the active phase includes a
fixed 30-second post-work idle interval. Settled footprint is the median of samples in its final
ten seconds, then the median across five runs. This observation window does not establish a
stationary heap. Use the G2 observer and hardware; builds are unpackaged with the Playwright
inspector. Sampled CPU excludes shutdown and processes that live entirely between samples.

| Rows | Settled footprint baseline / migrated (MiB) | Delta (MiB) | Sampled active peak baseline / migrated (MiB) | Sampled CPU baseline / migrated (s) |
| --- | --- | --- | --- | --- |
| 1,000 | 966.32 / 966.01 | -0.31 | 1107.17 / 1118.90 | 6.24 / 5.59 |
| 10,000 | 704.00 / 723.47 | +19.47 | 1271.50 / 1253.92 | 19.75 / 10.40 |
| 50,000 | 1049.51 / 1050.36 | +0.84 | 1792.23 / 1607.12 | 116.05 / 71.81 |

All scales pass the unchanged 64-MiB settled and 128-MiB sampled-peak budgets. Values are rounded
independently. Unused Memory starts no extra worker in any measured run, including the control
scenario; its largest positive median deltas are 56.17 ms for UI readiness and 6.61 MiB for
sampled footprint, within the frozen 100-ms/32-MiB minimum allowances. Five matching pairs with
10k-row indexing active preserve delegation queue/cancel/release outcomes; all ten checks pass.
Main loop-p99 medians are 79.63/37.49 ms (baseline/migrated), satisfying the loaded-control budget.
All 11 phase comparisons pass their gates. These fixture measurements include the native column
buffers and SDK validation changes; they do not establish a Rust speedup or production Provider
latency. Allocation sampling identifies about 5.5 GiB of cumulative provider numeric-array parsing
allocation per 50k workload without the finite-array schema optimization, motivating the SDK
patches within the migration's resource envelope.

Frozen artifact inventory:

- Baseline: 1,159 `out` files, SHA-256
  `9c7a05a8d8e59e817bfccdd6551e4fe9e33a36a2aecc19f6e94c3198b41589ab`.
- Migrated: 1,531 `out` files, SHA-256
  `549eb4f4fb6582c33a3e43184710f546ab874c5eb7b98cdf261f93ad2614a22c`.
- Hash sorted repository-relative paths including `out/`: UTF-8 path, NUL, then raw SHA-256 of each
  file's bytes; SHA-256 the concatenation. Both variants share catalog and scenario hashes.
- External SDK dependencies are frozen separately. The manifest records their versions and all
  distributed JavaScript hashes, plus the selected patch and lockfile hashes; an `out` hash alone
  does not identify the provider implementation. Manifest: `/tmp/deepchat-rutis-g3-sdk-artifacts.json`.
- Paired reports: `/tmp/deepchat-rutis-g3-sdk-paired`; summary:
  `/tmp/deepchat-rutis-g3-sdk-summary.json`. After-run verification confirms both complete `out`
  trees, external SDKs, catalogs, shared scenarios, patches and lockfile remain unchanged.

### Native transport, lifecycle and distribution validation

G3 remains unaccepted. Pushed checkpoint `e076345bc` passes static, build, Main and renderer
checks in run `40237446829`. Its native storage scope passes 361 checks and retrieval quality
passes seven, but aligned Linux 50-row write gaps remain 8.28/6.45/5.18 ms at 1k/10k/50k,
above the unchanged allowance. Fresh full paired resource capture has not started because this
implementation still fails the Linux gate. The single resource preflight below is diagnostic evidence.

Post-measurement phase timings and a separate V8 CPU-sampling run diagnose the native commit path
without warming or replacing adoption samples. These temporary diagnostics must be removed after
fixing the bottleneck and before G3 acceptance. A local codec microprobe saves only about 0.2 ms;
that evidence does not justify a new dependency or a changed wire codec.
The selected implementation keeps application chunks at 64 KiB and stages one 16-MiB/50-record
upload in Rust. Only commit dispatches the native upsert. Native parts are at most eight MiB,
so base64 and bounded metadata fit Rutis's 16-MiB internal message limit. The native owner
validates the complete batch before one transaction and reserves per-resource order from the first
native part. Subsequent reads/mutations wait; abort/close settles an incomplete reservation without
performing a write. Failed partial dispatch aborts its known
native upload; abort cannot abandon a committing write. Contiguous native dispatch sequences are
independent of locally acknowledged application chunks. Existing generation, resource, lease,
quarantine and control-priority rules remain in force. No dependency or implementation switch is added.

Four Rust boundary/lifecycle checks pass and run in required CI alongside Clippy for all targets.
The selected correction passes 62 Harness/package checks and 361 native checks, with two
Windows-only skips on macOS. The nine-check native runtime scope also passes a valid 45-record,
49,152-dimensional batch spanning internal parts, persistence after close, incomplete-upload and
non-finite rejection, maximum-16-MiB failure cleanup, abort/close cleanup, admission continuity
and strict child exit. Retrieval evaluation passes seven cases. Scoped test types, app types,
format, i18n and lint pass. The full Main/renderer suites and six native package jobs must pass
on the pushed revision.

All 13 performance checks across seven files pass under matching Electron Node 24.22.0 / ABI 148:

| Rows | Native / remote query p95 (ms) | Native / remote 50-row write mean (ms) | First remote open median / p95 (ms) |
| --- | --- | --- | --- |
| 1,000 | 3.162 / 3.568 | 2.432 / 4.808 | 130.841 / 145.729 |
| 10,000 | 14.787 / 15.220 | 2.856 / 4.852 | 130.428 / 130.931 |
| 50,000 | 65.879 / 65.816 | 4.531 / 6.365 | 131.493 / 135.298 |

Remote timings include encoding, gateway copies and native work. Thirty queries transfer
280,650-280,710 application gateway bytes including replies; pending calls drain to zero.
Five new workers per scale meet the 500-ms median and one-second p95 first-use limits.
First/last five write samples are reported for CI diagnosis without changing the adoption gates.
Report: `/tmp/deepchat-rutis-g3-staged-ordered-perf.log`.

Seven actual application checks pass: launch and plugin-host failure recovery, streaming chat,
delegation queue/cancel/release, Memory recall/deletion/restart/clear, nine-Agent cache convergence,
model/dimension changes, native-worker loss, FTS/chat continuity and explicit rebuilding. The
clear-after-loss case targets an evicted Agent so deleted vectors cannot reappear after restart.
A fresh dense-50k resource preflight passes with a 1457.00-MiB sampled active peak and
1045.89-MiB settled footprint. This single run does not establish five-pair resource acceptance.
Complete matching paired resource acceptance and aligned Linux timing remain required before G4. Frozen application trees use
`/tmp/deepchat-rutis-g3-staged-ordered-artifacts.json`, with baseline output SHA-256
`9c7a05a8d8e59e817bfccdd6551e4fe9e33a36a2aecc19f6e94c3198b41589ab` and candidate
`a29ae185cac80197725a89d624d8910c1570b074d8e8ed75736876f8df4308fd`.
Reports use the `/tmp/deepchat-rutis-g3-staged-ordered-` prefix.

The six native package jobs execute `smoke:harness:memory` against the packaged Rust host and
Electron executable, using production clients for native CRUD, fractional values, restart/reset,
admission continuity and strict child shutdown. All six pass on packaging checkpoint `b550ddaba`
in run `40231700259`. The selected transport implementation must pass these actual package checks
on all six targets; copied layout checks alone cannot establish distribution parity.

- [x] Retain DuckDB v2 in TS; move native handles and file-owner lifetime into one Rutis service.
      Keep existing lease/embedding policy coherent; adapt synchronous health/quarantine and
      object-returning factories through generation-bound resources and acknowledged operations.
- [x] Connect actual Memory recall, embedding writes, deletion, rebuild and maintenance callers.
      Keep dense vectors near their resource owner and bound transfer without enlarging the
      admission JSON protocol indiscriminately. Start one vector TS runtime lazily under the
      existing Rust host; native poison must not force admission-runtime replacement.
- [x] Compare real app recall/FTS degradation, model/dimension changes, more-than-eight-Agent
      resource convergence, clear/delete, native quarantine and shutdown against baseline.
      Preserve migration/WAL and new-process recovery rules; vector runtime loss must preserve
      admission and degrade only vector retrieval to the existing FTS behavior.
- [x] Review and validate the whole slice, including real native operations and relevant Memory
      performance/quality checks. Remove old native factory/lifecycle wiring after parity.
- [ ] Commit and push the locally validated G3 checkpoint; require the exact-head required CI
      and all six platform package checks, including the packaged Memory smoke, before G4.

Completion: a real Memory resource module uses Rutis with one file owner and proven cleanup.
A standalone query demo or reduced main-process heap does not complete this goal.

## G4. Define durable Store commands and desktop capability ports

- [ ] Inventory all writable database connections, synchronous repositories/config readers,
      transaction callbacks, scheduler run claims and maintenance consumers.
- [ ] Replace cross-boundary closures/row APIs with bounded transactional business commands for
      Session/Tape/Memory/config and scheduler claims. Preserve atomic head observations and CAS;
      leave exactly one writer authority throughout each cutover.
- [ ] Define versioned read snapshots and acknowledged mutations for desktop consumers. Extract
      crypto/unlock, OAuth, helper launch, native UI and power events behind narrow async ports.
- [ ] Preserve route sender validation, permissions, secret handling and cancellation identity.
      Compare real operations and maintenance, remove only replaced dependencies and validate
      directly affected storage/host contracts.

Completion: the core can depend on serializable operations and host ports without synchronous IPC,
generic SQL, duplicated writer state or privileged Electron objects crossing the boundary.

## G5. Move the cohesive Harness and shared core into the TS backend

- [ ] Move the actual Harness composition and its Run/loop/interaction/pending-input feedback
      cluster together. Keep Provider streaming and prompt/tool integration local initially.
- [ ] Move the shared database facades, Session/Tape projection/recovery, configuration authority
      and scheduler claim transactions with their business owners. Fence/drain old ownership
      before opening the backend writer; remove main's writable shadow access.
- [ ] Retarget existing renderer/CLI domain handlers without changing public behavior. Keep
      authenticated ingress and native capability presentation in the desktop adapter.
- [ ] Compare real streaming, delegation, pending-input settlement, approvals, cancel/resume,
      restart recovery, backup/rekey/import and shutdown. Validate lost replies, stale callbacks,
      runtime loss and all supported native/package targets before distribution.
- [ ] Review resource deltas and whole-change contracts; retain only durable regression coverage,
      run required checks and remove replaced main composition/lifecycle paths after parity.

Completion: one backend owns active/durable business state, Electron main remains responsive under
the agreed workload, and ownership loss cannot create two profile owners or duplicate execution.

## G6. Extract the complete Memory capability

- [ ] Move the existing facade and internal retrieval/extraction/reflection/persona/directive/
      maintenance services into one TS plugin. Preserve policy, Provider execution and Store ports;
      keep Harness ingestion scheduling and execution fences explicit.
- [ ] Replace synchronous cross-boundary assumptions with versioned reads and authoritative
      epoch-validated operations. Retarget prompt injection, memory tools, management routes,
      Agent lifecycle, cursor settlement and maintenance as one complete service migration.
- [ ] Compare scope/temporal/tombstone filtering, recall quality, mixed-language budgets,
      directive approval/trust, FTS/vector degradation, CAS/audit/lineage, background drain,
      config changes, Agent delete and database maintenance in the real app.
- [ ] Review resource/quality evidence, run native/evaluation and relevant E2E checks, and remove
      the old Memory facade construction and manual lifecycle wiring after parity.

Completion: all consumers use the one capability; plugin unload/recovery cannot advance an
unsettled cursor, reuse a revoked execution token or resurrect forgotten data.

## G7. Migrate the control owner to Rust

- [ ] Move admission queue/permit authority to Rust as a complete slice, preserving ordering,
      cancellation/late grants, fairness and diagnostics. Delete the TS queue owner after E2E parity.
- [ ] Move Run transitions, interaction parking/cancellation and pending-input settlement as one
      cohesive control owner. Preserve instance/run/operation/message fences and durable claimed
      dispositions; do not proxy individual checks or create two run registries.
- [ ] Keep loop/Provider/tool effects behind bounded operation-level calls. Define revalidation
      around awaited durable operations and deterministic event ordering back to TS consumers.
- [ ] Compare all control/recovery workloads and resource budgets, validate with the actual app,
      and remove replaced TS control ownership. Report architectural gains separately from speed.

Completion: the Rust owner is authoritative, lifecycle semantics match, and the agreed resource
envelope holds. This phase need not eliminate the TS runtime used by Provider/protocol adapters.

## G8. Select measured Rust batch work

- [ ] Select one profiled batch from Tape/context projection, bounded tool-output processing or
      Memory computation. Record its expected CPU/allocation mechanism and numeric target first.
- [ ] Co-locate work with its data or pass a bounded batch; preserve Unicode/canonical ordering,
      provenance, retractions, token/quality policy and cancellation. Reuse native engines.
- [ ] Connect the actual consumer, compare complete output and real-app resource results, then
      remove old wiring only after adoption. If it fails the budget/variance gate, record no-go
      and retain the simpler TS implementation instead of retaining a permanent experiment flag.
- [ ] Review, select durable regression protection and run appropriate checks before completion.

Completion: a measured successful module migration or an explicit evidence-backed no-go.
Rust line count and microbenchmarks that exclude transfer costs are not success criteria.

## G9. Extract peripheral services with independent useful lifetimes

- [ ] Select one actual ownership group: process jobs/scheduler/watchers, documents/OCR/search,
      Knowledge/RAG, MCP/ACP connections, Skills/hooks or remote channels. Do not create all proposed plugins
      merely to match the capability map.
- [ ] Reuse current native helpers and supervisors, preserve tool/route/registration permissions,
      and connect actual consumers through one generation-bound lifecycle owner.
- [ ] Compare the module's real workload, unload/lost-reply/restart/revoke cases and resource
      envelope; account for idle Node processes removed or added.
- [ ] Review, validate and remove the replaced manual wiring. Repeat only for another selected
      module with a concrete lifecycle or measured resource benefit.

## G10. Decide and migrate durable Store to Rust

- [ ] Establish compatible encryption/SQLite extension/collation/native packaging support before
      selecting a driver. Inventory every writer and maintenance/recovery contract again.
- [ ] Preserve durable schemas and atomic Session/Tape/Memory/scheduler operations with one writer;
      compare migration, import/export, rekey, backup, recovery and poisoned/partial failure cases.
- [ ] Measure end-to-end resource savings and deployment cost. If the evidence supports cutover,
      connect real consumers, validate signed/platform packages and remove old storage ownership.
      Otherwise retain the TS/native Store and record the compatibility or benefit limit.

This goal is conditional; an independent Harness or headless product does not require it.

## G11-G12. Deliver Everywhere from the extracted core

- [ ] G11: provide non-Electron configuration, credentials, filesystem/process and approval ports;
      boot a declared headless Node/Rust distribution with actual CLI submit/query/cancel/recovery.
- [ ] G11: verify offline startup, no Electron imports/installation, native packages, storage
      ownership, shutdown and service policy after all clients disconnect.
- [ ] G12: add authenticated application ingress and reconnect-safe bounded events/snapshots;
      demonstrate desktop and browser clients observing the same authoritative Session.
- [ ] G12: enroll device capabilities with explicit resource grants and revoke/disconnect semantics;
      exercise a real approved operation, stale reply rejection and no implied sync authority.
- [ ] Review each horizon separately, run its actual E2E comparison and platform/security/resource
      checks, and delete replaced wiring when that horizon cuts over.

## Validation evidence

G0 baseline: Node 24.22.1, pinned pnpm 10.34.5, macOS arm64. The existing admission and
LiveDelegationService suites passed together: 2 files, 82 tests. Full application build passed;
normal provider/ACP registry refreshes are retained.

- Baseline Electron startup/streaming E2E: 4 tests passed. The shared delegation migration workload
  separately passed against the baseline build.
- The delegation workload uses two parent Sessions and 8 child turns against a local model fixture:
  6 execute, 2 queue, one queued turn is interrupted, a released slot starts the other queued turn,
  and the final state is 7 completed turns and 1 interrupted turn. Graceful shutdown and admission
  diagnostics are checked through the actual app, public IPC and stored log.
- Updated owner, delegation, runtime, route, composition/shutdown and package-contract suites pass:
  8 files, 143 tests. Runtime coverage uses the real Rust host and Electron Node mode; one test copies
  the artifact closure outside the checkout and verifies launch without repository resolution.
- Runtime cases cover owner limits/fairness, pre-aborted and queued cancellation, lease
  suspend/resume/release races, asynchronous observer failures, shutdown, forced runtime loss, and oversized-frame rejection with child teardown.
  Runtime loss rejects pending work and leaves no live replacement host.
- Baseline and final migrated application each pass the same 5 Electron E2E checks: 3 startup/
  recovery checks, 1 streaming-chat check and 1 delegation-admission check. The final migrated run
  completes all checks with graceful app shutdown.
- Repository format, typecheck, i18n, lint and locked Cargo fmt/clippy checks pass.
- Only the Rutis TS plugin constructs `AgentInvocationAdmission` in application source. Main uses
  the typed client; there is no local queue fallback, separate probe command or implementation flag.
  The normal build's provider/ACP registry refreshes are retained.
- G0 execution results are local macOS arm64. Signed release packages and native Windows/Linux app
  execution remain unverified. G2 records the paired resource baselines; no performance gain is claimed.

G1 validation: only this RFC and plan changed after the admission commit. All 28 local document
references resolve; diff whitespace checks and repository format, i18n, lint and Node/web typechecks
pass. No new source, dependency, build configuration or test changes were made. G0 tests/E2E were
not rerun for this documentation-only goal; no profiling, Rust comparison or Memory native benchmark
was executed for G1. Implementation evidence is recorded under the corresponding live goal.
