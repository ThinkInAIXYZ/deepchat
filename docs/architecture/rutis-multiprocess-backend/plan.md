# DeepChat Harness and Capability Migration Plan

## Objective and completion rule

Extract a reusable Harness, Memory and peripheral capabilities through Rutis, then move selected
owners/computations to Rust where correctness, deployment or measured resource savings justify it.
Work on `dimagent/rutis-harness-bootstrap`, one complete module at a time. Replace actual app wiring,
run matching end-to-end baseline and migrated workloads, and remove the old path after parity.
There is no retained implementation switch or local fallback.

Current scope: staged implementation in
[Draft PR #2465](https://github.com/ThinkInAIXYZ/deepchat/pull/2465), targeting `dev`. Admission is
committed as `ffcd98770` and the roadmap as `f35adff34`. G3 is complete at `7ee99619b`; G4 is active.
Later goals start only after their dependencies and the preceding selected goal pass validation.

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

Correctness, persistence, ownership, bounded resources and lifecycle behavior remain blocking.
Shared-CI wall-clock overruns are reports, not failed checks. Each slice needs relevant tests and
matching application E2E; a complete performance capture is conditional on material process, IPC,
batching or storage-path changes, or an explicit performance objective. Ordinary async port
extraction does not automatically need another process-tree benchmark. Select affected workloads
and a bounded measurement/confirmation budget first. Treat noise-level differences as inconclusive,
keep all samples, and block adoption only on a reproducible material regression rather than an
isolated timing overrun. Do not rerun CI or unchanged benchmarks to obtain a passing timing sample.

## Live goals and dependencies

| Goal | State | Dependencies | Completion condition |
| --- | --- | --- | --- |
| G0 Admission | Complete, `ffcd98770` | Existing branch baseline | Default Rutis wiring, matching real-app E2E and old path removed |
| G1 Whole-capability roadmap | Complete; documentation only | G0 and source research | Capability map, Memory boundary, Rust ranking, ordered goals and honest evidence |
| G2 Baselines and first service contract | Complete, `84e3e0ead` | G1 | Reproducible resource baselines and frozen operation/ownership budgets |
| G3 Memory vector resources | Complete, `7ee99619b` | G2 | Actual vector operations through Rutis, preserved native lifecycle and old factory wiring removed |
| G4 Store commands and desktop ports | Store, settings and selected desktop-port slices locally validated; remaining contracts in progress | G2 | Explicit durable operations, writer inventory and asynchronous host capabilities |
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

Shared PR runners report timing overruns with `DEEPCHAT_MEMORY_PERF_REPORT_ONLY=1`; correctness,
runtime/ABI identity, finite measurements, workload/queue bounds and test timeouts remain blocking.
There is no `continue-on-error` around the suite. The command enforces timing budgets by default.
The completed G3 comparison uses strict operation measurements and paired application runs on
this fixed machine. Its numeric budgets below remain the recorded G3 acceptance policy, not a
mandatory benchmark matrix for every later slice. Select later measurements by the execution rule
above. A documentation or test-only commit with verified identical runtime artifacts does not
require another complete resource capture. Do not repeat shared-runner benchmarks merely to
obtain a green timing sample.

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

The Float32 transport passes local operation budgets. Shared Linux runner timings vary enough
to pass and fail the same implementation; they are reported separately from fixed-device adoption.
G3 is accepted at checkpoint `7ee99619b`. The selected implementation sends bounded raw
upload bytes from Main to Rust. Rust stages one bounded upload and acknowledges each received
chunk; commit dispatches a native atomic upsert through Rutis `Value::Bytes`. Internal native parts
are bounded to eight MiB so encoded messages fit Rutis's 16-MiB limit; all parts belong to one batch
and only the complete batch reaches the existing transaction. This preserves
64-KiB first chunks, 240-KiB continuation chunks, one outstanding chunk acknowledgement, the 16-MiB/50-record logical
limit, atomic writes and control priority. The native owner keeps resource and file authority;
application transfer state belongs to the Rust gateway. Raw forwarding alone shows little local
latency improvement and does not justify retaining a second per-chunk native acknowledgement.
Pinned provider SDK patches validate a finite numeric array and clone it once, preserving response
validation and raw-response isolation without allocating a Zod parsing payload per component.
All 27 real SDK response contract checks pass across OpenAI, compatible, Azure, Google single/batch,
and Vertex Node/edge endpoints. Exact-head required CI, all six package checks and complete
matching resource comparisons pass before the next goal.

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

The immutable baseline uses G2 admission source with the same current Provider/ACP catalogs and
shared E2E fixtures. The selected application implementation is `6a2544ddb`; later validation-only
changes preserve its complete output hash. Each disposable-profile vector scenario indexes
1k/10k/50k canonical memories with dense 1536-dimensional Float32 embeddings, checks vector-only
recall, deletion and native row counts, then relaunches and clears every memory plane.

Six pairs at 1k exclude the first pair as warmup; five pairs at 10k and 50k alternate variant order.
All 32 vector application runs pass. The first launch observes unused Memory. The active launch
includes an unchanged 30-second post-work idle; settled footprint is the median in its final ten
seconds, then the median across five runs. This window does not establish a stationary heap.
Use the G2 macOS/M5 observer and hardware; builds are unpackaged with the Playwright inspector.
Sampled CPU excludes shutdown and processes that live entirely between samples.

| Rows | Settled baseline / migrated (MiB) | Delta (MiB) | Sampled active peak baseline / migrated (MiB) | Sampled CPU baseline / migrated (s) |
| --- | --- | --- | --- | --- |
| 1,000 | 943.18 / 961.20 | +18.02 | 1110.96 / 1122.17 | 7.27 / 6.50 |
| 10,000 | 700.82 / 722.83 | +22.00 | 1226.11 / 1272.08 | 21.31 / 11.18 |
| 50,000 | 1036.09 / 1023.17 | -12.92 | 1883.62 / 1538.78 | 121.12 / 71.79 |

Every scale passes the unchanged 64-MiB settled and 128-MiB sampled-peak allowances. Reopen/clear
phases also pass their resource checks. All unused launches have the same process-name counts;
no vector worker starts before vector use. Across vector cases, the largest positive readiness
median delta is 17.72 ms and the largest footprint delta is 3.38 MiB, within their frozen limits.
These figures include SDK/native-buffer changes and do not establish a Rust query speedup.

The original five loaded-control pairs all pass queue/cancel/release and Memory completion, but
unused-startup readiness fails the original independent-median rule: 2271.99/3376.21 ms gives
1104.22-ms extra against a 326.42-ms allowance. Both variants slow during that group; the median
of adjacent paired differences is 59.42 ms. This result is retained, not relabeled as a pass.

One independent five-pair control confirmation was declared before collecting more samples. It
requires both the new group and all ten pooled control pairs to meet the original rules, with
all original samples retained. Both pass. Confirmation unused readiness is 2183.80/2105.51 ms;
pooled readiness is 2227.89/2178.13 ms. Pooled Main loop-p99 medians are 99.16/42.39 ms, satisfying
the unchanged loaded-control allowance. Pooled active peak/window footprint deltas are
+25.86/+27.01 MiB. All 20 loaded-control application runs pass. The nine vector phase comparisons
and two pooled control comparisons meet their gates; the independent control group also passes.
Do not use the original 42-run test pass count alone as resource acceptance evidence.

Frozen inventory and evidence:

- Baseline: 1,159 output files, SHA-256
  `ce5ddbad74d68dd7745bda91dcf35dc871930e6eebfb094dc5de6d1d6d00c7f4`.
- Migrated: 1,531 output files, SHA-256
  `2970d4a9178ffb4c9ece8959487695d797e68c573510028d7af5851e58faa74a`.
- `.deepchat/rutis-g3-acceptance/artifacts.json` records outputs, external SDK consumers,
  shared catalogs/scenarios, patches and lockfiles. Both variants freeze 344 files across the
  six SDK consumers, using original baseline and selected patched schemas respectively.
- Sort output path-component tuples, then hash the path including `out/`, a NUL and each raw file
  SHA-256; the manifest preserves that exact order. Verify every file and external SDK/caller dependency before and after application runs.
  Complete output, SDK, catalog, scenario and metadata hashes match after capture.
- `paired/state.json` and `paired-summary.json` retain the original 42-run data and its failed
  readiness comparison. `control-confirmation-design.json` fixes the one confirmation and pooled
  acceptance rule; `control-confirmation-summary.json` records both passes. Excluded sleep,
  startup and incomplete-indexing attempts remain separate from completed resource samples.
- `resource-acceptance.json` combines the nine vector and two pooled control comparisons with
  the independent confirmation, all 52 successful application runs and evidence hashes.

### Native transport, lifecycle and distribution validation

Checkpoint `7ee99619b9b21b27339322b36d0cfcce57ea4abe` passes required run `40262089127`:
static, Main, renderer, build, native Memory and the required barrier all succeed. Native job
`121376436278` passes 985 behavior, 306 Tape, 12 OCR, 362 native Memory, seven retrieval-quality
and 13 performance checks; two platform-specific native cases are skipped on Linux.
Its explicit report mode records the 1k write overhead of 5.421 ms against the unchanged 5-ms
allowance as a warning. Finite measurements, operation correctness and bounded work remain hard
checks. Five independent strict local runs below establish the fixed-device operation budgets.

Package run `40262089169` passes all six macOS/Windows/Linux x64/arm64 verification jobs and
the package-required barrier at the same checkpoint. Every target executes the production
Memory runtime smoke against its packaged host and Electron executable. The application
implementation remains `6a2544ddb`; the selected checkpoint adds validation policy and evidence
without changing the measured runtime output.

Shared-runner variation remains visible: the same implementation's earlier required run
`40245677754` fails the 1k write gate at 7.948/14.684 ms (6.737-ms extra against the unchanged
5-ms budget), while 10k/50k writes and all query/first-use gates pass.
Numeric budgets, the first 20 write samples and cold-worker
behavior are unchanged. Required run `40254813435` at `89a5a4ff6` again passes all deterministic
checks but fails only the 1k timing threshold (7.958/14.899 ms; 6.941-ms extra). Shared-runner
timing limits now use explicit reporting; the full suite still fails on invalid measurements,
wrong runtime/ABI, failed operations, unbounded work or timeout. Strict repeated fixed-device
measurements below satisfy the unchanged adoption budgets. Run `40248084214` at `07e3f688a`
passes the original shared-runner timing assertions on the same implementation, with write
overheads of 3.338/2.201/1.626 ms at 1k/10k/50k. No production fix is attributed to this variation.

Five local comparisons of a Float32 exponent-bit finite check show no improvement (median extra
latency 1.864/1.900 ms for current/prototype). A standard native base64 decoder reduces median
extra latency from 1.902 to 1.786 ms locally, insufficient evidence for another compatibility
branch. Neither prototype is selected. Cold-worker native phase timings and V8 sampling leave no
measured justification for further native scalar or decoder changes. Temporary first/last sample,
phase and CPU probes are removed; formal adoption samples, runtime/ABI equality and all 13
performance checks remain.

The selected implementation keeps first chunks at 64 KiB, continuation chunks at 240 KiB and stages one 16-MiB/50-record
upload in Rust. Only commit dispatches the native upsert. Native parts are at most eight MiB,
so base64 and bounded metadata fit Rutis's 16-MiB internal message limit. The native owner
validates the complete batch before one transaction and reserves per-resource order from the first
native part. Subsequent reads/mutations wait; abort/close settles an incomplete reservation without
performing a write. Failed partial dispatch aborts its known
native upload; abort cannot abandon a committing write. Contiguous native dispatch sequences are
independent of locally acknowledged application chunks. Existing generation, resource, lease,
quarantine and control-priority rules remain in force. The direct binding dependency is the exact
version already shipped with the Node API; no additional native payload or implementation switch
is introduced.

Five Rust boundary/lifecycle checks pass and run in required CI alongside Clippy for all targets.
The transport correction passes 362 native checks, with two Windows-only skips on macOS;
123 focused Harness/store/package-contract checks pass, including two runtime byte contracts.
The codec checks cover malformed padding/unused bits, whitespace/non-base64 rejection, exact
independent backing buffers and byte equality through the eight-MiB native-part limit.
The native runtime scope
also passes a valid 45-record,
49,152-dimensional batch spanning internal parts, persistence after close, incomplete-upload and
non-finite rejection, maximum-16-MiB failure cleanup, abort/close cleanup, admission continuity
and strict child exit. Retrieval evaluation passes seven cases. Scoped test types, app types,
format, i18n and lint pass. The full Main/renderer suites and six native package jobs pass
on the selected checkpoint `7ee99619b`.

Five independent strict operation runs pass all three characterized scales: 15 checks with
matching Electron Node 24.22.0 / ABI 148. The complete seven-file/13-check suite separately passes
in both default strict and explicit report-only modes. The numeric budgets are unchanged.

| Rows | 50-row write overhead range (ms) | Maximum query p95 overhead (ms) | Maximum first-open median / p95 (ms) |
| --- | --- | --- | --- |
| 1,000 | 1.811-1.967 | 0.489 | 137.098 / 201.337 |
| 10,000 | 1.336-1.424 | 1.059 | 135.859 / 137.561 |
| 50,000 | 1.180-1.263 | 2.346 | 135.841 / 137.134 |

Focused timing-policy, workflow, scope and entrypoint contracts pass 22 checks. Invalid timing
values still fail in both modes; only the explicit reporting value disables a wall-clock budget
assertion. No job/step uses `continue-on-error`. Format, lint, i18n and app/scoped test types pass.
Evidence logs use `.deepchat/rutis-g3-acceptance/{strict-transport-*,policy-*}.log`.

Remote timings include encoding, gateway copies and native work. Thirty queries transfer
280,650-280,710 application gateway bytes including replies; pending calls drain to zero.
Five new workers per scale meet the 500-ms median and one-second p95 first-use limits.
Typical 300-KiB writes use only begin and commit; observed pending calls remain at one.
Persisted native checks cover packed batches with
unaligned source offsets, Float32 extremes/negative zero, ordinary/packed writer reuse, whole-batch
duplicate-key rollback and pre-effect rejection of malformed or non-finite input. Shared mutable
buffers are rejected at the native command boundary.

Seven actual application checks pass: launch and plugin-host failure recovery, streaming chat,
delegation queue/cancel/release, Memory recall/deletion/restart/clear, nine-Agent cache convergence,
model/dimension changes, native-worker loss, FTS/chat continuity and explicit rebuilding. The
clear-after-loss case targets an evicted Agent so deleted vectors cannot reappear after restart.
Complete paired resource evidence above supersedes single diagnostic preflights. Both isolated
application trees pass the same actual Memory E2E. The selected runtime must retain its unchanged
artifact hash for this evidence to apply.
The 50k fixture reserves one minute of its unchanged 300-second test budget for recall,
30-second idle, shutdown and relaunch; smaller fixtures retain their 120-second completion wait.
Two incomplete baseline attempts ended at 120/180 seconds with 2,650/2,300 rows pending and are
excluded. Trace samples show continuous indexing progress through the latter wait. The 31
completed runs retain their original source-manifest hashes: their successful execution did not
reach either timeout. Comparable protocol records preserve both scenarios/manifests and failed
attempts. Workloads, observer, production deadlines and all numeric adoption budgets are
unchanged; the final sample and all control runs complete under that recorded protocol.

The six native package jobs execute `smoke:harness:memory` against the packaged Rust host and
Electron executable, using production clients for native CRUD, fractional values, restart/reset,
admission continuity and strict child shutdown. All six pass on the selected checkpoint
`7ee99619b` in run `40262089169`; copied layout checks alone cannot establish distribution parity.

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
- [x] Commit and push G3 checkpoint `7ee99619b`; exact-head required run `40262089127` and all
      six platform package checks in `40262089169`, including packaged Memory smoke and both
      required barriers, pass before G4.

Completion: a real Memory resource module uses Rutis with one file owner and proven cleanup.
A standalone query demo or reduced main-process heap does not complete this goal.

## G4. Define durable Store commands and desktop capability ports

G4 starts from the accepted G3 application and its immutable candidate artifact. The first actual
cutover is the scheduler's independent shared-database connection. The full goal also includes
Session/Tape/Memory commands, configuration snapshots, maintenance and desktop capabilities;
removing the scheduler connection alone does not complete G4.

### Audited ownership entrypoints

| Connection or persistence owner | Current entrypoints | Required boundary |
| --- | --- | --- |
| Shared application database | `MainDatabase`; Session, Tape, Agent, Memory, Provider, MCP, settings, Project, delegation, scheduler and sync facades use its connection | Keep domain transactions together; move the normal writer and its business owners together in G5 |
| Scheduler utility process | Timer and heartbeat only; `CronJobsRepository.queueDueRuns` observes and advances due work in one transaction at the current Store owner | No database path/password/SQL crosses the helper port; preserve request correlation, generation fences and owner-side dispatch |
| Shared-file maintenance | `databaseSecurity.ts`, `mainDatabase.ts`, sync import/config import and backup helpers open active, source or staged files | Fence normal work, explicitly own each file and connection, preserve rekey/import/backup/reopen recovery; main loses these writable paths at G5 cutover |
| Import sources | Provider import, legacy chat import and browser profile import use source/snapshot connections; `DataImporter` currently opens both source and target with writable-capable configuration | Distinguish source ownership from the active target; keep target mutations inside the authoritative maintenance operation |
| Schema catalog | `schemaCatalog.ts` opens an in-memory database for schema inspection | Keep this temporary local connection internal to the Store owner |
| OCR artifacts | `ocrArtifactStore.ts` owns a separate encrypted derived-cache database | Preserve its explicit independent file owner; this is not a second writer of the shared application file |
| Vector stores | The G3 Memory worker and Knowledge's existing DuckDB owner use separate files | Preserve their existing resource authorities and maintenance fences |
| Configuration | `SettingsStore` starts from `app-settings` and attaches `AppSettingsDbBackedStore`; Provider/MCP/ACP/model settings also have legacy file adapters | Audit actual injected adapters and desktop readers; use acknowledged mutations and versioned read snapshots, with explicit bootstrap and machine-local file ownership |
| Credentials and desktop state | Main supplies async crypto/unlock; DatabaseSecurity, SecretStore, Sync, MCP and Codex/Grok own explicit private persistence; remaining native/window/plugin settings still require extraction | Keep authorized crypto/native operations separate from persistence; retain existing plugin consent and settings ownership |

### Ordered implementation slices

1. Replace the scheduler worker's database access with bounded commands at the current Store
   authority. Preserve the existing 100-job due-scan bound, schedule reconciliation, unique run
   insertion, run claims, manual execution and idle/restart behavior. Timer requests cannot carry
   a database path, password, SQL or callback. Committed run dispatch belongs to the owner, so a
   lost timer reply cannot strand or replay a durable mutation. Keep at most one scan in flight
   per worker generation and fence stale requests/replies before mutation or status publication.
2. Define the Session/Tape/Memory operation boundary around existing atomic business work:
   transcript mutation and projection heads, pending-input settlement, Memory cursor/CAS and
   maintenance. Keep synchronous repository helpers and transaction closures inside their owner;
   do not convert every row method to RPC or split one atomic observation into separate reads.
3. Retarget configuration consumers through versioned snapshots and acknowledged mutations.
   Inventory legacy/file adapters before choosing ownership; preserve machine-local bootstrap
   settings and keep secrets outside general configuration snapshots.
4. Extract real crypto/unlock, OAuth, helper/native UI and power-event consumers behind narrow
   async desktop ports. Preserve sender/principal checks, cancellation identity and maintenance
   fencing. Complete the remaining writer/host audit before moving the cohesive core in G5.

Characterize scheduler behavior on the accepted G3 build before its caller cutover. Reuse existing
scheduler tests and add only the matching real-application migration fixture needed to compare
the two implementations; this baseline characterization is the migration exception to
implementation-first validation. After the cutover, select durable tests for transactional
claims, generation loss and shutdown, then compare the same app workload and process resources.
Keep the existing timer cadence and process count; freeze any additional numeric resource
allowance from the matching baseline before judging the selected implementation.

The scheduler slice retains G3's fixed-device resource envelope: no extra process while unused;
unused readiness/footprint median deltas within `max(100 ms, 2 x baseline MAD)` and
`max(32 MiB, 2 x baseline MAD)`; active settled/peak footprint deltas within 64/128 MiB;
Main loop-p99 median delta within `max(10 ms, 2 x baseline MAD)`. Use five alternating paired
application runs with the same 30-second quiet-worker window and observer. These unchanged
allowances are selected before implementation; no Rust speed or CPU saving is claimed. Preserve
the existing timer cadence and functional deadlines. The immutable G3 candidate output and SDK
graph form the new baseline, with the same scheduler fixture installed in its separate G4 tree.

The existing scheduler service and run-session starter suites pass all 28 checks under Electron
Node mode with native persistence enabled and no skipped check. The actual application fixture
`47-scheduler-store.smoke.spec.ts` passes on the accepted G3 runtime: manual and timed runs,
unique scheduled-run identities, persisted outputs, relaunch, disabling and scheduler shutdown.
Its three launches complete in 8.8 seconds without resource instrumentation.
Logs: `.deepchat/rutis-g4-acceptance/baseline-scheduler-{tests,e2e}.log`.

The scheduler now uses the Store command by default. The helper holds one correlated scan
request, coalesces reconciliation and fences a missing acknowledgement at the existing 30-second
maximum scan interval. The manager validates messages and generation identity before mutation;
committed runs are dispatched before replying to the helper. Scheduled-run insertion and head
advancement roll back together. The independent worker connection, database-password environment
and unused worker-side manual-run command are removed. Existing public routes and manual-run
execution keep their owners. The two native suites pass 36 checks with no skips, including atomic
rollback, catch-up/skip policy, the 100-job scan bound, missing/empty error replies, coalescing,
duplicate/stale requests and a spawn superseded by shutdown. The matching actual app scenario
also passes on the migrated build. Format, lint, i18n, app types and scoped scheduler/E2E types
pass. The normal build refresh of the Provider catalog is retained.

### Scheduler slice resource evidence

Five alternating baseline/migrated pairs pass the same application scenario: ten successful runs
and 30 launches with isolated profiles. Every active phase includes the same 30-second quiet
worker window, with no forced GC. Use G2's hardware and 500-ms process-tree physical-footprint
observer; settled values are per-run final-ten-second medians, then medians across five runs.
All three phase comparisons pass the unchanged allowances selected above.

| Phase / metric | Baseline | Migrated | Delta |
| --- | ---: | ---: | ---: |
| Unused UI ready, ms | 1932.24 | 1927.26 | -4.98 |
| Unused sampled peak footprint, MiB | 1032.93 | 1025.47 | -7.47 |
| Active sampled peak footprint, MiB | 1038.36 | 1039.72 | +1.36 |
| Active settled footprint, MiB | 855.95 | 847.97 | -7.98 |
| Active Main loop p99, ms | 12.45 | 12.33 | -0.12 |
| Reopen sampled peak footprint, MiB | 1061.75 | 1054.50 | -7.25 |

Unused process-name counts match in every pair. These measurements establish the cost of the
scheduler ownership change in this fixture; they do not establish a Rust or CPU speedup.
The baseline has 1,531 output files with SHA-256
`2970d4a9178ffb4c9ece8959487695d797e68c573510028d7af5851e58faa74a`; the migrated build has
1,530 files with SHA-256 `0176d47a0a4b26d05def1677fa418cf55400b5763f61b0566fcbf8a440580947`.
Both use the same current catalogs, scenario/observer and 344 frozen files across six SDK
consumers. Full file, dependency and metadata hashes are verified before/after every run;
Root's source and runtime still match the measured candidate after capture. Durable evidence:
`.deepchat/rutis-g4-acceptance/{artifacts.json,paired/state.json,paired-summary.json,outcome-counts.json}`.
Scheduler checkpoint `0add1c1ee` passes required run `40268252480` and all six platform packages
in `40268252495`, including both required barriers. The remaining G4 contracts are still open.

### Credential crypto port slice

Extract the real `SecretStore` native dependency behind an async, data-only desktop port. The
pinned Electron runtime exposes `isAsyncEncryptionAvailable`, `encryptStringAsync` and
`decryptStringAsync`; use those operations in the main-process adapter. Keep wrapped values in
their existing storage format and verify that the async decryptor reads legacy synchronous
ciphertext. Reads do not rewrite credentials automatically.

Retarget all actual consumers together: Sync settings/routes/cloud-service construction, MCP
variable bindings and connection startup, user-plugin configuration, Nowledge connections and
both exporters. Keep existing plugin mutation serialization and Nowledge's update exclusion.
Serialize cloud-config writes across the new awaits; preserve credential rollback if configuration
publication fails. Recheck MCP connection attempt identity after awaited binding resolution.

The credential owner fences async operations by its lifecycle generation. Capture that generation
before work and check it immediately before returning sensitive reads or committing wrapped
values. Pause/invalidate pending work at database maintenance and shutdown; resume only after
the profile is usable. Existing owner-local guards remain local functions, never wire callbacks.
Do not add a decrypted credential cache or an alternate native implementation.

Reuse the existing real-app Nowledge/REST/MCP/key-protection scenario. Add only legacy-ciphertext
compatibility and cloud credential persistence characterization before this migration. Existing
Nowledge E2E passes on `0add1c1ee` in 4.7 seconds with real native wrapping and the local MCP
fixture. Native async compatibility passes on Electron 43.8.3, including legacy ciphertext.
Cloud credential persistence passes across three launches, an unrelated configuration update and
relaunch in 6.1 seconds. These characterize the baseline before the production cutover.

The default application now injects `CredentialCryptoPort` through the main-process native
adapter. `SecretStore` no longer imports Electron or handles native buffers. Every actual Sync,
MCP variable-binding, user-plugin, Nowledge and export consumer awaits credential operations;
no synchronous crypto fallback remains in this owner. Cloud writes are serialized across awaits,
merge the latest committed base, and retain wrapped-secret rollback. The acknowledged view is
computed before publication so a later native read failure cannot turn a successful write into
an apparent failure. Existing plugin serialization and Nowledge update exclusion remain active.
MCP startup rechecks cancellation/attempt identity after credential resolution and OAuth setup;
a stale attempt cannot clean up a newer attempt's transport or timer.

Maintenance and shutdown synchronously invalidate pending credential operations. Maintenance
resumes the owner only after database reopen/reconciliation; shutdown cannot resume it.
Reads also reject a wrapped credential replaced or removed during native decryption. Consumer
guards run immediately before sensitive return or synchronous persistence, including after a
successful wrapping result. Plaintext is not cached and reads do not rewrite wrapped values.

Local acceptance passes 251 checks in 12 affected test files, including native failures,
maintenance/resume fencing, pending/queued cloud writes, publication rollback, a maintenance
transition after wrapping, Nowledge mutation exclusion and MCP cancellation during credential
resolution. Scoped credential/E2E types, app types, format, lint, i18n and the normal build pass.
The matching actual application scenarios pass after cutover: Nowledge REST/MCP/key protection
in 5.1 seconds, native legacy compatibility in 2.1 seconds and cloud persistence in 6.1 seconds
(three tests, 13.5 seconds total). Evidence is under
`.deepchat/rutis-g4-crypto-acceptance/`, including baseline/migrated E2E and affected-test logs.
The normal build's Provider catalog refresh is retained.

This slice adds no process and moves no storage ownership; the data-only port remains in-process
until G5 moves the cohesive backend. No full process-tree recapture or performance improvement
claim is required for this extraction. Native credential compatibility is verified on macOS arm64;
Windows/Linux credential-store behavior remains unverified locally. Credential checkpoint
`c80d36b69` passes required CI `40271838825`, including its barrier; package run `40271838879`
passes all six platform verifications and its required barrier. `DatabaseSecurityService`,
Provider/OAuth credential stores, power events
and the remaining Store/configuration contracts are still G4 work.

### Scheduler system-resume input slice

Keep the native `powerMonitor` subscription in the main composition and deliver system resume
through a data-only Scheduler service operation. Remove Electron imports, native event objects
and asynchronous fallback attachment from the Scheduler business owner. Main owns one listener
until shutdown and ignores events during maintenance or shutdown; Scheduler ignores events while
stopped and fences in-flight resume reconciliation across stop/start generations before durable
updates or timer dispatch. Preserve the existing schedule reconciliation and due-run semantics.

Characterize the existing application with two native-emitter resume notifications in the current
scheduler E2E before changing this consumer. This is migration characterization, not test-first
implementation. Compare the same manual/timed execution and relaunch scenario after cutover;
select durable lifecycle tests after implementation. This port extraction adds no process and
does not require another whole-process performance capture. Actual OS suspend/resume remains
separate from delivery through Electron's native emitter.

The default main composition now owns one native resume listener and removes it through the
shutdown coordinator. It filters maintenance/shutdown delivery and observes reconciliation
failures. `SchedulerService.handleSystemResume` receives no Electron object or callback. Its
start/stop generation rejects stale reconciliation before schedule writes and timer dispatch,
including an event whose Agent lookup finishes after a stop/start cycle. The business owner
has no Electron import or asynchronous fallback subscription.

Local acceptance passes 38 native-enabled scheduler checks without skips, plus 18 existing
composition checks. The actual application receives two resume notifications through Electron's
native emitter with exactly one listener, then completes manual/timed execution, durable run
identity checks, relaunch, disabling and shutdown. The matching scenario passes before/after
cutover in 8.6/7.9 seconds. App/scoped types, build, format, lint and i18n pass. Evidence:
`.deepchat/rutis-g4-resume-acceptance/`. This establishes event delivery and lifecycle fencing;
physical device suspend/resume and Windows/Linux native delivery remain unverified locally.

### Session transcript Store command slice

Select Session transcript clearing as the next actual durable command. `createSessionDataFromDatabase`
already composes the transcript, pending inputs, settings and Tape against one database. Move the
clear transaction assembly into that owner and connect `SessionTranscriptMutations` to the coarse
operation. Remove main composition's `runInTransaction` callback dependency. Retry truncation
already owns its transaction inside `SessionTranscript.deleteFromOrderSeq`; retain that atomic
operation rather than introducing another generic transaction port. Preserve runtime preparation
before the mutation, post-commit invalidation, clear rollback, Tape incarnation/projection cleanup
and retry behavior. This does not turn internal row APIs or transaction callbacks into RPC.

Baseline characterization passes 46 existing native-enabled transcript/Tape/runtime checks.
The real local-streaming scenario now also drives the existing renderer Clear Messages action,
then verifies an empty pending queue and empty transcript after graceful relaunch; it passes in
6.4 seconds before this Store cutover. That renderer action awaits the durable acknowledgement
and reloads its message cache. This migration characterization is the exception to implementation-first
validation; no production renderer behavior changes are needed.

The default composition now connects `SessionTranscriptMutations` to the Session data owner's
`clearTranscript(sessionId)` operation. That owner assembles the one transaction across pending
inputs, transcript projections and Tape reset. The mutation coordinator retains runtime
preparation and post-commit cleanup; it receives no generic transaction callback or separate
settings/pending-input writers. Retry truncation directly uses the transcript owner's existing
atomic range operation. No schema, file location, transport or process placement changes.

Local acceptance passes 430 native-enabled checks across five affected files without skips.
The real data owner is exercised with a SQLite trigger that rejects Tape deletion: transcript,
queued input, Tape incarnation/head and Memory ingestion projection all survive rollback, and
runtime cleanup is suppressed. Successful clear removes all corresponding rows and creates a
fresh Tape incarnation. A later retry-retraction failure also rolls back earlier Tape writes and
all transcript changes; runtime invalidation occurs only after a successful retry commit.

The actual renderer Clear Messages action and graceful relaunch pass after cutover in 7.2 seconds
against the 6.4-second matching baseline. The scheduler resume/manual/timed/relaunch scenario
also passes on the combined runtime in 7.5 seconds (two E2E tests, 14.9 seconds total). These are
functional checks. Scoped transcript/E2E types, all 81 scoped Memory test types, app types, build,
format, lint and i18n pass. Evidence is under `.deepchat/rutis-g4-session-store-acceptance/`.
The selected business transaction uses the same database and writes as its baseline; no full
performance recapture or speed claim is required. Other Session/Tape/Memory command boundaries,
configuration snapshots and remaining desktop capabilities still belong to G4.

The combined resume/Session checkpoint `826b3af16` passes required run `40274014870`, including
`pr-required` job `121414464019`, and package run `40274015002` with all six platform jobs and
`package-required` job `121418838344`. Both workflows completed before the next settings push.

### Versioned settings snapshot and desktop mutation port

Keep the existing `settings.getSnapshot`/`settings.update` fields and routes, backed by one
application settings service. That service supplies explicit data-only snapshot/update operations
to routes and acknowledged display mutations to Agent tools. Retain native effects, normalization,
activity recording and existing per-field batch failure behavior; do not introduce a second
persistent settings owner or a generic settings RPC. Configuration entry routes and other
configuration domains remain separate G4 work.

Use one Main presentation revision sequence for settings snapshots, mutation replies and
`settings.changed` publications. This sequence is scoped to Main's lifetime, which also owns its
renderer contexts; backend-generation checks remain mandatory at the future private transport.
Preserve revisions in the renderer client. Apply values by per-key revision so a delayed initial
read, update reply or partial event cannot revert a newer value or discard unrelated fields.
This is not a durable database revision. At G5, portable preferences must be written directly at
the backend configuration owner and native device effects must stay at Main; avoid a
Core-to-Main-to-Core mutation loop. Refresh the selected snapshot after database maintenance. Reject new owner operations while
maintenance or shutdown is active. Keep secret values outside this allowlisted projection.

Replace the Agent display port's synchronous native getters/setters with one async validated
mutation request and a data-only acknowledgement containing the owner's previous/applied value.
Skill authorization and dispatch-journal commitment stay at the Agent owner before the mutation.
The default routes and Agent tools now use this service; the replaced route-local implementation
and eight synchronous Agent display getters/setters are removed. The renderer client retains only
bounded per-key revision metadata. Existing stores and OCR controls retain ownership of UI values;
OCR releases its event listener and ignores late successful or failed mutations after unmount.
Launch-at-login applies the owner's accepted value, without a second assignment from the request.

Local acceptance passes 217 checks across eleven affected files. Durable cases cover delayed
snapshot hydration, mixed partial events, reversed mutation acknowledgements, invalid revisions,
native-owner receipts, strict display requests, fenced operations, failed writes and teardown.
The actual privacy/system-settings scenarios pass before cutover in 4.5/3.6 seconds and after
cutover in 4.1/3.6 seconds. A separate real-app check passes in 6.7 seconds with Main's clock
frozen and then moved backwards: snapshots, events and acknowledgements share a monotonic
sequence, the other window updates, and graceful relaunch preserves the preference. These are
functional results, not performance claims.

The runtime build, app typechecks, format, lint and i18n pass. Scoped owner/Agent/E2E and renderer
store/OCR test types pass. The broad API-client test fixture has existing unrelated type diagnostics;
its runtime tests pass. Evidence is under `.deepchat/rutis-g4-settings-acceptance/`. No process,
schema, transport, layout or style change requires a full performance recapture. The service remains
in-process; other configuration domains, native capabilities and Store boundaries remain open.

### Skill host paths and native directory capability

Move Skill, Skill settings and external-import path acquisition out of Electron-dependent business
code. Main supplies explicit home/temp/user-data/bundled-skill directories and one asynchronous
native directory-open capability. Keep discovery, imports, scoped authorization, operation leases,
plugin source validation and filesystem rollback inside their existing owners. Preserve development
and packaged resource fallback order. Do not add a runtime fallback to Electron or duplicate the
Skill service in Main. This removes a G5 host dependency; it does not create a separate Skill plugin.

Keep the pure watcher request-ID helper independent of native watcher construction. Shared console
diagnostics must not import Electron through a toolkit package: Main initializes the existing
development debug gate explicitly, while captured console sinks remain console-only. Standalone
Node hosts default to quiet debug output and may set the same data-only flag at their own startup.

Characterize the existing Skills and scan-worker application scenarios before the cutover, with
the fixture's managed Skills directory isolated in its disposable profile. This characterization
is a migration exception to implementation-first verification.

The default composition now supplies those paths and the native directory capability to the same
Skill service. Skill settings and import routes receive their required home/temp directories.
The three business modules no longer import Electron; the request-ID helper is available without
constructing a watcher, and shared logger imports no Electron toolkit. Main preserves its existing
`!app.isPackaged` console-debug gate at startup. Existing captured diagnostics still bypass file
persistence. No new dependency, process, database writer or native watcher owner is introduced.

Local acceptance passes 781 checks across 36 files covering the full Skill group, watcher and
logging suites, routes and composition. New durable cases hold a native directory acknowledgement
through shutdown on both success and failure, reject unsafe Agent scopes before native dispatch,
and verify the explicit console-debug gate and captured sinks. Scoped settings/import/logging/E2E
types, app types, the runtime build, format, lint and i18n pass.

A separate ordinary Node 24.22.1 run bundles the three selected modules with Electron, electron-store
and Electron toolkit imports rejected. It exercises actual files, ZIP extraction and byte equality,
ordered bundled-directory fallback, external import conversion/cleanup, persisted assignments after
service recreation and real discovery workers. Native directory and watcher capabilities are supplied
by the embedding host in that run; watcher closures drain twice. This proves the selected Skill
owner can run without Electron, not that the Harness or headless Session Host has moved.

The matching actual application scenarios pass before/after migration: Skills catalog/file/extension
reads in 3.1/3.2 seconds and scan-worker events in 2.9/2.7 seconds. Disposable profiles now seed
their own managed Skills directory, and the catalog check requires delivered builtins. These are
functional checks. Evidence is under `.deepchat/rutis-g4-skill-host-acceptance/`; actual OS file-manager
presentation is not exercised. Process placement, native watcher ownership and storage behavior
are unchanged, so no full resource recapture or speed claim is required. G4 remains open.

The preceding settings checkpoint `03ebe520b` passes required run `40277920388`, including
`pr-required` job `121426387843`, and package run `40277920393` with all six platforms and
`package-required` job `121430324373`. Both workflows finished before the Skill slice push.

### Sync host and peer credential ports

Replace the remaining synchronous Sync host/peer token wrapping and reveal callbacks with
acknowledged asynchronous crypto operations through the existing credential adapter. Preserve
machine-local private files, legacy ciphertext, the Linux basic-text refusal, pairing consent and
one-time-code checks. Do not cache plaintext or route these private tokens through general settings.
Fence cancelled pairing before persistence, cancelled transfers before authenticated requests and
stale connection reads across pairing replacement, forget and shutdown. Retain host transition
serialization and prevent a stopped generation from launching a connector after crypto returns.

Characterize native peer token persistence and legacy wrapped-token reuse through the actual app
before the cutover, with intercepted fixture-host responses and an isolated profile. This is a
migration compatibility exception to implementation-first verification. The existing full loopback
host scenario remains the matching application comparison; no transport/process/storage-path
change calls for a full performance recapture.

The default host/peer composition now awaits the existing async native credential adapter. Opaque
unwrap operations use the same maintenance/shutdown generation fence as other SecretStore work.
The private files, encoding, connector-token environment delivery and Linux basic-text policy stay
unchanged. Peer cancellation is checked after crypto and immediately before atomic pairing-file
replacement; connection reads reject changed credential generations. Host stop advances its
generation so pending wrap/unwrap replies cannot start a stale connector; normal restart remains
supported. Replaced synchronous encryption/decryption wiring is removed.

Local acceptance passes 91 checks across eight files. New durable cases cover cancelled preflight
and token wrapping, saved-pairing preservation, credentials superseded by re-pair/forget/stop,
cancelled transfer unwrap, native failures and maintenance fences. Real loopback sockets/private
files remain in the transfer tests. A controlled local connector starts and restarts through the
async ports; stop during wrap/unwrap never launches its binary or enables its listener.

The full actual-app host/backup/consent/restart scenario passes before/after cutover in 8.3/9.8
seconds. A native peer-credential app scenario passes in 4.8/5.0 seconds: pairing responses omit
token material, private persistence is wrapped, an older synchronous ciphertext authenticates
after graceful relaunch without being rewritten, and forget removes pairing. Only the fixture host's
network replies are intercepted; application routing, private persistence and OS crypto are real.
These are functional checks, not a performance claim. Native OS crypto is verified on macOS arm64;
Windows/Linux vault behavior and real Cloudflare account connectivity remain unverified locally.

Runtime build, app types, scoped crypto/peer/connector/E2E types, format, lint and i18n pass.
Evidence is under `.deepchat/rutis-g4-sync-crypto-acceptance/`. The preceding Skill checkpoint
`e739f5810` passes required run `40280089324`, including `pr-required` job `121432996814`, and
package run `40280089473` with all six platforms and `package-required` job `121437226872`.
Both workflows finish before this slice's push. G4 remains open for other Store/config/native ports.

### Database security native boundary and migration commit

The default bootstrap supplies the database path, owner-local metadata facade and asynchronous
native crypto. DatabaseSecurity imports neither Electron nor ElectronStore; unlock presentation and
quit remain desktop-owned. Native encryption remains available to authorized maintenance while
ordinary SecretStore operations are paused. The metadata facade moves with this owner at G5,
without synchronous cross-process settings RPC or another writable instance in Main.

The per-file lock covers native preparation and commit. Wrapped target metadata is prepared before
closing the writer; rollback remains until target reopen and metadata persistence both succeed.
Runtime failure restores the original writer and metadata. Shutdown fences pending native results
before validation, secret return or mutation; pending preparation excludes another migration,
metadata repair or constructor recovery for that profile. SQLCipher copying, validation, physical
paths, metadata shape and startup file recovery remain compatible. Cross-file crash atomicity is
not established by this slice and remains conditional G10 work.

Enable/legacy-unlock/change-password/disable was characterized in a disposable application profile
before cutover; this compatibility characterization is an implementation-first exception. The same
two actual-app scenarios pass before/after: database settings/native status in 4.2/4.2 seconds, and
encryption, legacy synchronous ciphertext unlock, wrong-password rejection, rekey, disable and four
graceful launches in 10.8/10.8 seconds. Portable settings survive every transition, encrypted file
headers differ from plaintext SQLite and disable restores a plaintext header. These are functional
comparisons without timing gates or a speed claim.

Local acceptance passes 122 checks across four behavior files and seven real SQLCipher checks.
Durable regressions cover stopped decrypt/wrap, valid manual unlock with native failure, desktop
quit ownership, native wrap failure before closing the writer, unavailable native storage, per-file
exclusion, original-key recovery after target reopen failure and rollback of both database and
metadata after enable/rekey/disable metadata writes fail. The native file is classified in the
existing required SQLite lane; it uses actual temporary files, filesystem/path modules and
SQLCipher, without Electron or mock SQL.

Runtime build, app/scoped types, native scope/type gates, format, lint and i18n pass. Evidence is
under `.deepchat/rutis-g4-database-security-acceptance/`. No process, IPC, database path or data-volume
change requires a full resource recapture. Actual OS crypto is exercised on macOS arm64; real
Windows/Linux vaults and power-loss recovery are unverified locally. G4 remains open.

The preceding Sync checkpoint `7c04844a1` passes required run `40282974786`, including
`pr-required` job `121442092801`, and package run `40282974887` with all six platforms and
`package-required` job `121448087538`. Both workflows finish before this slice's push.

### Scheduler native launch boundary

The default Scheduler requires its existing local manager factory, and the manager requires an
asynchronous cancelable launch capability. Main resolves the approved helper entry and creates
the Electron utility process. The manager receives a plain facade for typed commands, data events,
PID observation and termination. It imports no Electron, filesystem or path API. The native module/
path fallback and both optional service-constructor fallbacks are removed. Factory callbacks stay
local to the business composition; G5 transports capability requests, not these functions.

A local abort signal cancels pending startup when the manager stops; epochs also reject late
completion from a non-cooperative launcher. Native failure settles once, removes startup listeners
and requests child termination. A post-launch ownership check prevents stale reconciliation after
stop. The timer helper, private protocol, native arguments/environment marker/service label,
packaging paths, Store authority, process count and restart/idle behavior remain compatible.

Local acceptance passes 63 checks across the complete Scheduler group, native launch and
composition suites. Seven durable launch cases cover the plain command/event facade, pre-canceled
launch, stop during pending native startup, cancellation while fork returns, native exit/error
before spawn and stop superseding a completed launch. Existing real SQLite due claims, dispatch,
restart, stale completion and resume checks remain active with typed host fixtures.

The same actual-app manual/timed execution, unique run identities, system resume, relaunch,
disable and shutdown scenario passes before/after in 9.3/7.9 seconds. Runtime build, app and scoped
Scheduler/launch/E2E types, format/check, lint and i18n pass. Evidence is under
`.deepchat/rutis-g4-scheduler-launch-acceptance/`. These are functional comparisons. No process,
IPC, storage-path or workload-volume change calls for a full resource capture or speed claim.
Native app execution is verified on macOS arm64; actual Windows/Linux startup and forced native
startup-failure delivery are unverified locally. Other helper/native/config boundaries keep G4 open.

The preceding database security checkpoint `9e8fa2762` passes required run `40286578817`, including
`pr-required` job `121453178038`, and package run `40286578821` with all six platforms and
`package-required` job `121458134091`. Both workflows finish before this slice's push.

Integrated baseline: `dev` at `207685009` retains upstream OAuth issuer/redirect compatibility and
Provider/default-MCP additions. Both Baizhi example lifecycle cases use the async credential port;
malformed-issuer OAuth fixtures retain otherwise valid token fields. The integrated tree passes
464 affected checks across 26 files, including all Scheduler, MCP, plugin lifecycle and changed
Provider suites. The final fixture subset passes all 31 checks. Actual-app cloud-browser credential
lifecycle and Scheduler scenarios pass together in 20.4 seconds (9.7/10.4 seconds). Only the local
synthetic MCP server is contacted by the cloud-browser fixture. Build, app/scoped fixture/E2E
types and required quality checks pass; no resource recapture or speed claim is introduced.

### MCP OAuth native credential and browser boundary

The default MCP credential store, interactive SDK provider/manager and enterprise identity owner
receive explicit private paths, asynchronous secure crypto and browser-open capabilities from Main.
Their native imports and default Store construction are removed. The actual service, client,
connection-error and diagnostics consumers await these contracts. Replaced synchronous wiring is
removed; the Store remains the same private file owner until G5.

One bounded mutation queue serializes acknowledged writes and atomic interactive binding-key moves.
RAM publication follows persistence; native encryption and atomic-rename failures retain both old
RAM and disk, and encrypted temporary files are cleaned. Initial decrypt is single-flight. Twenty-four
normal writes leave eight reserved control slots; stop bypasses the queue and rejects pending native
results. Existing v1/v2 formats, size/record limits, Linux basic-text refusal, memory-only fallback
and settings-window credential permissions remain compatible. No extra plaintext cache is added.

Public discovery metadata supplies the synchronous loopback issuer validator. Discovered identity
is finalized through one settings-owner compare-and-set against server ID, generation, binding hash
and endpoint. Profile mutation rereads current metadata after credential cleanup, preserves other
profiles and rejects replacement of the same profile. Server/profile leases fence delayed SDK,
refresh, browser, status and runtime effects after logout, configuration changes or shutdown. Plugin-owned stops use the existing supervisor;
its auth-scoped leases survive probe waits, integrity/recovery checks, adapter/native starts and
symmetric stops, with cleanup after canceled startup. Connection failures await OAuth classification and suppress late notifications after a stopped
startup. Legacy issuer and registered-callback behavior remain active.

The disposable-profile compatibility characterization precedes the cutover as an implementation-first
exception. Matching real-app read-only MCP snapshots pass before/after in 6.8/8.7 seconds. Private
machine-credential save, legacy native ciphertext read without file rewrite, settings-window
isolation, graceful relaunch and durable removal pass in 9.4/10.3 seconds. The cloud-browser private
HTTP credential lifecycle passes in 10.7/14.8 seconds around the supervisor change. The final three
scenarios pass together in 34.2 seconds. Only a local synthetic MCP server is contacted; no external
account is used. These are functional comparisons without timing gates or speed claims.

Local acceptance passes 657 checks across 33 affected MCP, plugin, native-adapter, composition,
route and CLI files. Durable protection covers serialized partial updates, single-flight decrypt,
encryption/rename rollback, atomic key moves, queue reserves, stopped crypto/browser results,
stale runtime stops, pending identity reads, profile-edit conflicts, settings CAS and Linux secure
backend policy. Five supervisor regressions cover canceled launch verification, adapter/native
startup, authentication restart and a stop waiting for another start. Existing SDK issuer,
registered-callback, enterprise refresh/subject and plugin lifecycle checks remain active. App and
scoped test/E2E types, normal and final runtime builds, format/check, lint and i18n pass. Normal
Provider and ACP registry refreshes are retained.

A broader supplemental E2E selection runs 16 cases: 13 pass, two skip and the unmodified Provider
headers fixture times out waiting for `disabled-providers-toggle`, a selector absent from the
current renderer. Its failure and artifacts remain recorded in `plugin-baseline-e2e.log`; it is not
reported as a passing OAuth acceptance check. Final OAuth/plugin validation uses the three explicit
files above, without retrying that unrelated fixture.

Evidence is under `.deepchat/rutis-g4-mcp-oauth-acceptance/`. No process, IPC, workload-volume or
storage-path change calls for a full resource capture or speed claim. G5 must frame legal large
native envelopes through bounded transfers without truncation. Native credential compatibility is
verified on macOS arm64; real Windows/Linux vaults and external identity-provider/browser flows
remain unverified locally. Remaining Store, configuration and desktop ports keep G4 open.

The preceding integrated checkpoint `6a43b8f70` passes required run `40290640902`, including
`pr-required` job `121467164668`, and package run `40290641026` with all six platforms and
`package-required` job `121472173105`. Both workflows finish before this slice's push.

### Provider OAuth credential and browser ports

Main supplies explicit private paths, the existing async credential crypto port and browser-open
capabilities to both Codex and Grok credential/auth owners. Their Electron imports and default
native Store construction are removed. Existing v1 encrypted/plain-file envelopes, corrupted-file
backup, fsync/rename commits, load errors and file fallback remain compatible. These provider-specific
formats retain their existing policy, which differs from MCP's memory-only fallback.

Actual status/events, refresh, logout, global initialization, SDK/direct requests and shutdown await
the selected owners. Grok's synchronous runtime-provider construction carries public configuration;
its synchronous token peek is removed. Both trusted direct requests and SDK requests use the existing
async fetch adapter. Original auth scopes span token acquisition, dispatch and single 401 refresh;
request cancellation or owner replacement cannot become API-key fallback. Ordinary refresh failure
retains API-key fallback. Endpoint restrictions, refresh sharing and account binding remain active.

Delayed native, browser, discovery, refresh and status results are fenced across logout, account
replacement, canceled attempts and shutdown. A login completing while an old refresh is pending
invalidates that refresh before persisting the new account. Status queries may retry once after an
observed account transition; publication tickets suppress delayed older events. Each auth owner
admits at most 32 HTTP requests, with an 8 MiB declared/streamed body bound. Existing request
deadlines and cancellation cover response bodies as well as headers.

Each private file owner serializes at most 24 normal and eight reserved control mutations; stop
bypasses admission. Files/envelopes are bounded to 16 MiB and normalized/decrypted token payloads
to 8 MiB before native transport or parsing. Only pending reads coalesce; no plaintext token cache
is retained. Read revisions reject results superseded by admitted writes. Failed deletion or
directory enumeration still attempts known artifact cleanup and rejects logout acknowledgement.
G5 must frame legal payloads within the existing bounded transfer contract.

The disposable-profile compatibility characterization precedes cutover as an implementation-first
exception. The same real-app scenario passes before/after in 11.4/11.7 seconds (11.6/12.0 seconds
total). Four graceful launches verify plaintext and legacy native ciphertext without rewriting,
public status without tokens, authenticated cancel, durable logout and signed-out relaunch. Discovery
and revocation responses are synthetic; no external account is contacted. These functional results
have no timing gate or speed claim.

The affected suite passes 1,213 checks across 79 files. Final contract acceptance passes 150 checks
across nine selected files. Shared actual-file regression cases replace two duplicate
mock-only Store suites: encryption/fsync/rename rollback, corrupt backups, unreadable-file recovery,
private permissions, serialized save/clear/save, coalesced decrypt invalidation, queue reserves,
failed logout cleanup, late refresh wrapping, stalled HTTP bodies and upstream size limits remain
covered for both providers. Account replacement, canceled discovery/polling, request-adapter
cancellation and current OAuth headers on each direct catalog request retain separate regressions.
App and scoped test/E2E types, normal and final
runtime builds, format/check, lint and i18n pass. Normal Provider registry refreshes are retained.

Evidence is under `.deepchat/rutis-g4-provider-oauth-acceptance/`. No process, IPC, workload-volume or
storage-path change requires a full resource capture. Native credential compatibility is verified
on macOS arm64; real Windows/Linux vaults and external identity-provider/browser flows remain
unverified locally. Other provider/browser-window, configuration, shared maintenance and Store
boundaries keep G4 open.

The MCP OAuth checkpoint `ae0475a65` passes required run `40307676246`, including `pr-required`
job `121523620575`, and package run `40307676364` with all six platforms and `package-required`
job `121530148783`. Both workflows finish before this slice's push; no rerun is requested.

The Provider OAuth checkpoint `bc4ad41db` passes required run `40317513595`, including
`pr-required` job `121556618773`, and package run `40317513761` with all six platforms and
`package-required` job `121562643275`. No rerun is requested.

### Shared database maintenance commands

Main's maintenance entrypoint accepts six explicit data commands for backup-file import, named
local/cloud-backup import, encryption enable/change/disable and live schema repair. Actual peer,
local/cloud import and security-route consumers use these commands; their supplied operation
callbacks are removed. Existing result contracts, route permissions and credential policy remain
active. Commands carry operation arguments, never SQL, a database handle or a transaction closure.
Live repair now uses the same exclusive admission as import and encryption; startup recovery
remains a separate pre-owner operation.

The owner retains pause, drain, operation, reopen, reconciliation and resume. It admits one operation
at a time, rejects entry during backup or shutdown and rechecks shutdown after draining before
dispatch. Preparation failures enter the existing recovery path. Move this complete owner with the
writer in G5. Internal Session/Tape/Memory transactions stay local to their business owners;
their closures are not candidates for individual RPC methods. Sync snapshot locks, staged-copy/
config import connections and imported-source reads also stay inside the cohesive Store owner.
This contract does not create another normal writer.

Matching disposable-profile application workloads pass before/after cutover: encryption, legacy
unlock, failed-password recovery, rekey, disable and four graceful launches in 12.5/11.2 seconds;
backup, rejected import, incremental restoration, overwrite removal, schema repair and durable
session restoration after relaunch in 4.8/5.2 seconds. Empty sessions use the real public creation
route without a Provider request. A final concurrency case holds native encryption preparation,
verifies repair/import are rejected, then releases native work and verifies repair succeeds.
All three migrated scenarios pass together in 19.6 seconds. No external account is contacted.

Nine directly affected suites pass 158 checks under Electron Node mode with required native SQLite
and no skips. Before cutover, four native suites pass all 37 checks. Existing SQLCipher rollback,
backup snapshot consistency, imported data normalization, route and composition contracts remain
active. App and scoped E2E types, the normal build, format/check, lint and i18n pass. Evidence is
under `.deepchat/rutis-g4-maintenance-acceptance/`; normal generated catalogs remain retained.
No process, IPC or storage-path change requires a full resource capture, and timings are functional
observations without a speed claim. Physical shutdown/power-loss faults and full native workloads
on Windows/Linux remain unverified. Remaining configuration snapshots, normal-writer maintenance
fences and native/window owners keep G4 open.

The maintenance-command checkpoint `5c7efdc1e` passes required run `40340119446`, including
`pr-required` job `121636236992`, and package run `40340119785` with all six platforms and
`package-required` job `121645123643`. No rerun is requested.

### Ordinary request admission and maintenance drain

`DatabaseRequestGate` owns the existing running/maintenance/failed admission state. Main consumers
read that one state; the independent boolean and partial route-prefix checks are removed. Ordinary
requests are refused by default during maintenance. Explicit native window controls, private security
status, static CLI status/version/capabilities and identity-validated CLI approval answers remain
available. Permission and caller checks still run in their existing owners.

All finite renderer/CLI routes, CLI authorization, audio/OCR RPC, uploads, compute streams and
programmatic-tool dispatch participate in request ownership. Admission is checked again when
startup-scheduled work actually executes, using the original task cancellation signal. A running
handler has its own lifetime: the startup coordinator may reject its reply immediately on cancel
while that handler still runs. Its lifetime remains counted until actual completion. The gate
retains only an active count and one drain waiter, without payload or credential snapshots.

After session/background cancellation, maintenance drains ordinary requests before any command
can close or replace the writer. The drain has a 30-second failure deadline. If work does not settle,
maintenance fails before dispatch and recovery retains the current database. Rejected requests release
ownership; failed maintenance stays closed to ordinary requests. Native presentation cannot reopen
ordinary admission.

Maintenance command routes are excluded from their own drain. Cloud download and verified-peer
imports still use the exclusive operation owner. CLI `events.subscribe` counts only its initial
database snapshot; subsequent `TypedEventHub` forwarding holds no database lease. Authenticated
callers, approval settlement and the original cancellation identity remain intact. All request
lifetime callbacks stay local to the owner and are not transport payloads.

The accepted maintenance scenario is extended with actual built-CLI Provider-list requests before
backup and after relaunch. It passes before/after in 5.0/4.9 seconds; encryption/legacy unlock,
wrong-password recovery, rekey and disable retain parity in 11.2/11.0 seconds. Native preparation
also verifies configuration/Provider and CLI requests are refused while window/security/CLI status
still works. A delayed cloud-secret write must settle before encryption dispatch; its interrupted
result never commits a secret. All four real-app scenarios pass together in 21.5 seconds in owned
disposable profiles, without contacting an external account.

The affected CLI/route/app suites pass 616 checks across 36 files. Durable regressions cover
rejection cleanup, maintenance self-deadlock, native presentation, bounded drain/retry, queued
execution, a canceled
reply with an uncooperative running body and an open watcher after its initial snapshot drains.
App types, scoped new gate/dispatcher regressions, CLI and E2E types, normal/final runtime builds,
format/check, lint and i18n pass. The existing large legacy dispatcher fixture has unrelated type
drift outside these scoped type checks; its runtime suite remains passing.

Evidence is under `.deepchat/rutis-g4-request-drain-acceptance/`. There is no process, IPC,
storage-path or workload-volume change requiring a full resource capture; timings remain functional
observations without a performance claim. This slice owns ingress. Background work detached after
an acknowledged request, remaining configuration snapshots and native/window dependencies still
need explicit ownership/lifecycle contracts before G4 closes. Physical shutdown/power-loss and full
native Windows/Linux application workloads remain unverified locally.

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
