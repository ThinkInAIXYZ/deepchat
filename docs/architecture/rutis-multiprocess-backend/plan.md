# DeepChat Harness and Capability Migration Plan

## Objective and completion rule

Extract a reusable Harness, Memory and peripheral capabilities through Rutis, then move selected
owners/computations to Rust where correctness, deployment or measured resource savings justify it.
Work on `dimagent/rutis-harness-bootstrap`, one complete module at a time. Replace actual app wiring,
run matching end-to-end baseline and migrated workloads, and remove the old path after parity.
There is no retained implementation switch or local fallback.

Current scope: staged implementation in
[Draft PR #2465](https://github.com/ThinkInAIXYZ/deepchat/pull/2465), targeting `dev`. Admission is
committed as `ffcd98770` and the roadmap as `f35adff34`. G4 is complete at `356143755`;
G5 is complete at `1719f8075`; exact-source required checks, all six native verification
packages and the original integrated Native foreground case pass. G6 is complete at `bd64c2d53`;
G7 is complete at `f1b425e4b`: Rust admission and cohesive Run/interaction/input control pass
local functional acceptance, required CI and all six actual native package targets. G8 is the
completed selection no-go; G9 product Hooks passes local functional acceptance and awaits
publication/platform verification. Further performance
sampling is not selected.
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
If conflicts prevent CI from starting, compare against a freshly fetched target branch; cached PR
base metadata and local remote-tracking refs may describe an older target.

Publication for verification is distinct from distribution. Finish a goal's complete source wiring,
local behavior comparisons and review before its coherent commit/push to the Draft PR. Run required
checks and the six native package targets on that exact published head; the goal stays active and
the next goal cannot start until those checks pass. PR verification packages deliberately have no
Apple distribution credentials or installers. Preserve signing/notarization and signed-package
acceptance as mandatory distribution gates in the release pipeline; they are not prerequisites for
pushing the source that CI must validate. This ordering governs G5 checkpoint publication notes.

A documentation-only decision may reuse accepted runtime/package evidence when the complete diff
is limited to non-executable documentation excluded from application packaging. Record that code
source and the checked diff; run the documentation/static checks. This exception cannot cover a
source, test, dependency, resource, build or packaging change.

Correctness, persistence, ownership, bounded resources and lifecycle behavior remain blocking.
Shared-CI wall-clock overruns are reports, not failed checks. Batch adjacent internal composition
changes and their verification within the selected goal. Reuse existing coverage; keep only durable
behavior, persistence, ownership or recovery tests and remove disposable implementation scaffolding.
Matching application E2E is required for the complete capability cutover and affected public or
lifecycle behavior, not each internal file move. Functional delivery takes priority. Resource
observations are informational; do not add sampling or investigate timing variance as a condition
of a structural migration. Investigate an observed user-visible regression when there is concrete
evidence. A module selected specifically to claim a performance gain needs supporting evidence;
without it, retain the current implementation and record no-go. Shared runners may enforce
correctness and deterministic work, payload and queue limits, but timing noise must not trigger
unchanged CI or benchmark reruns.

After acceptance, remove obsolete source/build copies, disposable profiles and test media. Retain
compact receipts, raw measurements and only the immutable baselines still needed for pending work.
Reuse the retained baseline instead of accumulating a complete output tree for every checkpoint.

## Live goals and dependencies

| Goal                                    | State                             | Dependencies                   | Completion condition                                                                              |
| --------------------------------------- | --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| G0 Admission                            | Complete, `ffcd98770`             | Existing branch baseline       | Default Rutis wiring, matching real-app E2E and old path removed                                  |
| G1 Whole-capability roadmap             | Complete; documentation only      | G0 and source research         | Capability map, Memory boundary, Rust ranking, ordered goals and honest evidence                  |
| G2 Baselines and first service contract | Complete, `84e3e0ead`             | G1                             | Reproducible resource baselines and frozen operation/ownership budgets                            |
| G3 Memory vector resources              | Complete, `7ee99619b`             | G2                             | Actual vector operations through Rutis, preserved native lifecycle and old factory wiring removed |
| G4 Store commands and desktop ports     | Complete, `356143755`             | G2                             | Explicit durable operations, writer inventory and asynchronous host capabilities                  |
| G5 Cohesive TS Harness backend          | Complete, `1719f8075`             | G4                             | Run/loop/Session/Tape/Provider composition operates under one backend authority                   |
| G6 Full Memory capability               | Complete, `bd64c2d53`             | G3, G4, G5                     | Recall, ingestion, management and maintenance use the one Memory service                          |
| G7 Rust control owner                   | Complete, `f1b425e4b`             | G2, G5                         | Admission and cohesive run/interaction settlement preserve all fences                             |
| G8 Rust batch computations              | Complete: selection no-go         | G2, G4, G5; G6 for Memory work | Measured CPU/allocation improvement with output and quality parity, or a recorded no-go           |
| G9 Peripheral capabilities              | Active: product Hooks             | G4, G5                         | Independent useful lifetime, real consumer cutover and no duplicate supervisor                    |
| G10 Rust durable Store                  | Conditional compatibility project | G4, G5, G6, G7                 | One compatible encrypted writer and proven migration/recovery/maintenance behavior                |
| G11 Headless Session Host               | Planned                           | G4, G5 and host-port audit     | Real CLI execution without Electron and without a connected desktop                               |
| G12 Multiple clients and devices        | Planned                           | G11 and explicit grants        | Reconnect-safe clients and separately authorized, revocable device operations                     |

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

| Case       | Build     | UI ready, ms | Footprint, MiB | RSS, MiB | Sampled CPU, s | Main loop p99, ms |
| ---------- | --------- | -----------: | -------------: | -------: | -------------: | ----------------: |
| Startup    | Baseline  |      1988.70 |        1012.96 |  1475.91 |           4.76 |             44.96 |
| Startup    | Admission |      2058.19 |        1036.56 |  1545.00 |           4.68 |             68.81 |
| Streaming  | Baseline  |      1999.99 |        1372.99 |  1677.64 |           7.74 |             47.78 |
| Streaming  | Admission |      2067.01 |        1395.93 |  1759.14 |           7.78 |             54.10 |
| Delegation | Baseline  |      1995.45 |        1067.48 |  1482.30 |           6.76 |             45.15 |
| Delegation | Admission |      2069.24 |        1093.26 |  1565.52 |           6.77 |             50.86 |

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

| Native operation                     |        Scale | Median, ms | p95, ms |
| ------------------------------------ | -----------: | ---------: | ------: |
| FTS recall                           |      1k rows |       0.56 |    0.65 |
| FTS recall                           |     10k rows |       0.87 |    1.00 |
| FTS recall                           |     50k rows |       2.89 |    3.20 |
| Vector query, 384 dimensions, top 20 |      1k rows |       0.83 |    0.94 |
| Vector query, 384 dimensions, top 20 |     10k rows |       3.92 |    4.17 |
| Vector query, 384 dimensions, top 20 |     50k rows |      29.01 |   29.14 |
| Tape bounded range                   | 100k entries |       0.04 |    0.05 |
| Tape full view                       | 100k entries |     108.22 |  131.52 |

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

| Gate                        | Required result                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unused Memory               | No additional process; UI-ready medians add at most `max(100 ms, 2 x baseline MAD)` per case; sampled footprint medians add at most `max(32 MiB, 2 x baseline MAD)`                                   |
| Memory-active resource cost | After drain, at most 64 MiB extra process-tree footprint; sampled active peaks at most 128 MiB extra for matching vectors/rows; one staged upload of at most 16 MiB; store leases and queues converge |
| Warm native query           | p95 overhead at most `max(5 ms, 20% of native baseline p95)`, including every transport/copy; establish the matching real-app baseline before replacing the module                                    |
| Upsert                      | Mean overhead at most `max(5 ms, 25% of baseline mean batch time)` per logical 50-row batch at the characterized sizes; preserve one atomic native transaction                                        |
| First vector use            | Runtime plus native open has median at most 500 ms and p95 at most 1 second; preserve the existing retrieval fallback/deadlines rather than extending them                                            |
| Loaded control loop         | Delegation loop-p99 median adds at most `max(10 ms, 2 x baseline MAD)`; bulk transfer cannot starve acquire/release/cancel                                                                            |
| Correctness and isolation   | Same recall selection/quality and durable data; atomic interrupted uploads, known-ID late-open cleanup, stale-generation rejection, FTS degradation and no replacement admission owner                |

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

| Rows   | Settled baseline / migrated (MiB) | Delta (MiB) | Sampled active peak baseline / migrated (MiB) | Sampled CPU baseline / migrated (s) |
| ------ | --------------------------------- | ----------- | --------------------------------------------- | ----------------------------------- |
| 1,000  | 943.18 / 961.20                   | +18.02      | 1110.96 / 1122.17                             | 7.27 / 6.50                         |
| 10,000 | 700.82 / 722.83                   | +22.00      | 1226.11 / 1272.08                             | 21.31 / 11.18                       |
| 50,000 | 1036.09 / 1023.17                 | -12.92      | 1883.62 / 1538.78                             | 121.12 / 71.79                      |

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

| Rows   | 50-row write overhead range (ms) | Maximum query p95 overhead (ms) | Maximum first-open median / p95 (ms) |
| ------ | -------------------------------- | ------------------------------- | ------------------------------------ |
| 1,000  | 1.811-1.967                      | 0.489                           | 137.098 / 201.337                    |
| 10,000 | 1.336-1.424                      | 1.059                           | 135.859 / 137.561                    |
| 50,000 | 1.180-1.263                      | 2.346                           | 135.841 / 137.134                    |

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

| Connection or persistence owner | Current entrypoints                                                                                                                                                                                                                   | Required boundary                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared application database     | `MainDatabase`; Session, Tape, Agent, Memory, Provider, MCP, settings, Project, delegation, scheduler and sync facades use its connection                                                                                             | Keep domain transactions together; move the normal writer and its business owners together in G5                                                        |
| Scheduler utility process       | Timer and heartbeat only; `CronJobsRepository.queueDueRuns` observes and advances due work in one transaction at the current Store owner                                                                                              | No database path/password/SQL crosses the helper port; preserve request correlation, generation fences and owner-side dispatch                          |
| Shared-file maintenance         | `databaseSecurity.ts`, `mainDatabase.ts`, sync import/config import and backup helpers open active, source or staged files                                                                                                            | Fence normal work, explicitly own each file and connection, preserve rekey/import/backup/reopen recovery; main loses these writable paths at G5 cutover |
| Import sources                  | Provider import, legacy chat import and browser profile import use source/snapshot connections; `DataImporter` currently opens both source and target with writable-capable configuration                                             | Distinguish source ownership from the active target; keep target mutations inside the authoritative maintenance operation                               |
| Schema catalog                  | `schemaCatalog.ts` opens an in-memory database for schema inspection                                                                                                                                                                  | Keep this temporary local connection internal to the Store owner                                                                                        |
| OCR artifacts                   | `ocrArtifactStore.ts` owns a separate encrypted derived-cache database                                                                                                                                                                | Preserve its explicit independent file owner; this is not a second writer of the shared application file                                                |
| Vector stores                   | The G3 Memory worker and Knowledge's existing DuckDB owner use separate files                                                                                                                                                         | Preserve their existing resource authorities and maintenance fences                                                                                     |
| Configuration                   | Bootstrap constructs legacy app/MCP/ACP settings; runtime settings use database adapters; Provider model stores are required; attached ACP retains only an isolated legacy snapshot                                                   | Use acknowledged mutations and versioned read snapshots; hand off the complete legacy-file authority with the cohesive configuration owner at G5        |
| Credentials and desktop state   | Main supplies async crypto/unlock; DatabaseSecurity, SecretStore, Sync, MCP and Codex/Grok own explicit private persistence; native configuration readers use a committed projection; the plugin owner uses its independent Conf file | Keep authorized crypto/native operations separate from persistence; preserve consent, one complete file writer and the final handoff inventory          |

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

| Phase / metric                     | Baseline | Migrated | Delta |
| ---------------------------------- | -------: | -------: | ----: |
| Unused UI ready, ms                |  1932.24 |  1927.26 | -4.98 |
| Unused sampled peak footprint, MiB |  1032.93 |  1025.47 | -7.47 |
| Active sampled peak footprint, MiB |  1038.36 |  1039.72 | +1.36 |
| Active settled footprint, MiB      |   855.95 |   847.97 | -7.98 |
| Active Main loop p99, ms           |    12.45 |    12.33 | -0.12 |
| Reopen sampled peak footprint, MiB |  1061.75 |  1054.50 | -7.25 |

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

### Startup work completion before maintenance

The request-ownership checkpoint `99fdb0710` passes required run `40352516093`, including
`pr-required` job `121679711290`, and package run `40352516371` with all six platforms and
`package-required` job `121689282632`. No rerun is requested.

The startup coordinator separates cancellation acknowledgement from actual callback completion.
`cancelAndDrainTarget` uses the existing in-flight inventory, including canceled older runs, and
waits for actual callbacks. Canceled pending tasks never execute and release their deduplication
entries. Immediate replies and the existing CPU/IO lane limits remain intact. There is no additional
task registry or transport protocol.

Main maintenance awaits that operation for its startup target before pausing/recreating services or
changing the writer, then rechecks shutdown. A 30-second preflight failure restores ordinary
admission before any service teardown or database replacement. It cannot duplicate an active
startup owner. Successful maintenance schedules background migrations again; a failed preflight
does not reschedule unfinished work. The old cancellation-only maintenance wiring is removed.

Eight affected coordinator, request, route, composition, logging and migration/usage files pass
139 checks under Electron Node mode with native SQLite required and no skips. Durable regressions
cover an old canceled run and its replacement, late callback failure, unrelated-target isolation,
queued cancellation and a bounded failure followed by another drain. The deadline uses fake time;
these checks enforce lifecycle behavior rather than a shared-runner timing budget.

The same four real-app scenarios pass before/after in 21.6/21.3 seconds in owned disposable profiles.
Encryption, legacy unlock, wrong-password recovery, rekey and disable take 11.1/10.8 seconds;
CLI Provider-list, backup, incremental/overwrite import, repair and relaunch take 4.9/4.8 seconds.
Concurrent maintenance rejection and delayed native credential drain retain parity in 2.8/2.8 and
2.6/2.6 seconds. No external account is contacted. App/scoped types, the normal build, format/check,
lint and i18n pass. Normal build-generated Provider/ACP catalog refreshes are retained separately.
Evidence is under `.deepchat/rutis-g4-startup-drain-acceptance/`. There is no process, IPC or
storage-path change requiring a full resource capture, and no speed claim is made.

Held startup callbacks and timeout behavior are verified at the real coordinator boundary; the
application comparison exercises its default maintenance wiring without a held-startup fault.
Other background effects after acknowledgement, shutdown ownership, configuration snapshots and
remaining native/window dependencies keep G4 open. Physical shutdown/power-loss and full native
Windows/Linux application workloads remain unverified locally.

The branch incorporates `dev` at `5128430a9`. Its business files merge without conflicts; the two
generated catalog conflicts are resolved by the normal build scripts. The integrated tree passes
217 main checks across ten files and 291 related renderer checks across seven files, app types,
normal build, format/check, lint and i18n. The same four real-app scenarios pass in 23.7 seconds
(12.3/5.3/3.0/2.9 seconds). All samples remain recorded as functional observations, without a timing
gate or speed claim. Integration evidence uses the `dev-integration-*` logs in the same directory.

### Shutdown ownership before writer close

The startup-drain integration checkpoint `ec74d772c` passes required run `40437135796`, including
`pr-required` job `121970616884`, and package run `40437135856` with all six platforms and
`package-required` job `121975288948`. No rerun is requested.

`DatabaseRequestGate` owns stopping admission and a completion-only promise for the actual maintenance
operation. The six typed commands, including verified-peer imports, use that owner; results and
credentials are not retained. Ordinary admission may resume before the final asynchronous setup
returns, but another maintenance owner cannot overlap it. CLI authorization retains its ordinary
lifetime. Only the two device dispatches that await shutdown before restart/reset are excluded from
their own drain; validation and the exclusive terminal-action claim remain unchanged.

Shutdown closes request admission and background availability synchronously, invalidates native
security/credential work and cancels startup replies. Actual startup callbacks then drain after CLI
and OAuth ingress stop, before their service dependencies are disposed. Ordinary requests and the
actual maintenance operation drain before writer close. These critical waits are not best-effort
destroy steps: a bounded failure rejects teardown before closing the database or granting an action.

Interrupted maintenance checks shutdown before reopen/reconciliation and before resuming services.
A remote initialization that finishes after shutdown is compensated before completion. Failed
recovery starts cleanup only after releasing the maintenance lifetime, avoiding teardown waiting on
its own caller. The cancellation-only shutdown path and recovery-side reopen during shutdown are
replaced by these default paths, without a feature flag or fallback.

Forty-one affected main/CLI/security/route files pass 722 checks under Electron Node mode with native
SQLite required and no skips. Durable contracts cover concurrent request/maintenance completion,
restart/reset self-waiting, authorization lifetime, bounded failure/retry and final maintenance
exclusivity. App and scoped gate/E2E types, normal build, format/check, lint and i18n pass. The branch
includes `dev` at `2a8a36b3a`; its Provider integration is covered by the selected suites. Normal
build-generated Provider catalog refreshes are retained.

The baseline launch/close and encrypted-reopen scenarios pass in 14.8 seconds (3.7/10.9 seconds).
The final seven-scenario application matrix passes in 39.1 seconds: launch/close 7.7 seconds;
encryption/legacy unlock/rekey/disable 10.7 seconds; CLI backup/import/repair/relaunch 5.0 seconds;
concurrent maintenance rejection 2.9 seconds; native credential drain 2.7 seconds; shutdown with a
held native credential 4.7 seconds; shutdown with held maintenance 5.0 seconds. Native quit closes
the window while work remains owned, permits release through the still-live Main connection, exits
with code zero, and reopens without an interrupted secret or encryption commit. All profiles are
owned/disposable and no external account is contacted. These whole-scenario durations include
startup and presentation; they are functional observations without a timing gate or speed claim.

The E2E fixture retains the launched child handle across debugger disposal and recognizes an already
completed exit-zero process as graceful. Resource-measurement errors and forced-close behavior still
fail or report their existing outcomes. Accepted app evidence is `final-e2e.log` and `final-results`
under `.deepchat/rutis-g4-shutdown-acceptance/`; earlier driver probes remain there for diagnosis.
No process, IPC or storage-path change requires a complete resource recapture. Remaining detached
background owners, configuration snapshots and native/window dependencies keep G4 open. Full
Windows/Linux native application and physical power-loss/suspend scenarios remain unverified.

### Provider configuration authority

Provider model facts and user overrides require their database adapters at construction. The
runtime helpers have no legacy JSON defaults or mutable store-factory setter, and Provider settings
no longer discovers paths, creates a legacy model directory or reads the Electron version. Main
owns the native settings factory and supplies its version to both migration and Provider
initialization. Legacy import still completes before settings attach to the one writer; no
configuration writer, per-key IPC, schema or public route has been added.

- [x] Replace the actual helper defaults and mutable store-factory wiring, then remove direct
      Electron/path discovery from Provider settings and native-store construction from the
      shared settings wrapper.
- [x] Validate affected configuration/migration/Provider contracts and compare actual application
      model save, override, reset and reopen behavior against the accepted application artifact.
      Process placement, IPC and storage layout are unchanged; no full performance recapture is
      required. Catalog bootstrap and the other native/configuration owners still keep G4 open.

Validation: 83 affected files/1,125 checks pass under Electron Node with native SQLite required;
the modified configuration fixtures and E2E pass scoped types. Normal build, app node/web types,
format, lint and i18n pass. A temporary bundled-import probe loads the settings wrapper and
Provider model helper with both `electron` and `electron-store` forbidden. This does not establish
that the complete Provider graph is portable: catalog bootstrap still imports Electron.

The immutable `38306fcda` application artifact passes the new model-store E2E in 6.9 s. The migrated
application passes the same case in 6.6 s: atomic custom-model/override save, graceful exit/reopen,
persisted values, reset/removal, another reopen, and unchanged legacy JSON contents throughout.
All five selected application cases pass in 43.8 s, including launch, obsolete-plugin repair,
plugin-startup failure and encrypted legacy unlock/rekey/disable. These are functional observations,
not a speed claim. Evidence and original diagnostic attempts remain under
`.deepchat/rutis-g4-provider-config-acceptance/`. Full native Windows/Linux application behavior
remains unverified locally. G4 remains active for the remaining configuration and host contracts.

### MCP and ACP configuration bootstrap

Both settings classes require storage at construction. Main creates the existing named files
from pure default builders. These retain
platform-specific MCP defaults, secret-operation dependencies, startup normalization, legacy
import and database attachment order. ACP's live Agent mutations already use the unified database
repository. Capture registry/manual/install legacy data into an isolated read-only snapshot at
attachment and remove unused legacy mutation entrypoints. Enabled/version/shared MCP selections
remain database-backed. G5 transfers configuration and its database owner together without a
writable Main shadow or per-key IPC.

- [x] Replace default construction and all real callers, fixtures and exports; preserve MCP
      configuration transactions and ACP migration behavior.
- [x] Compare actual MCP and ACP configuration changes across graceful exit/reopen, validate
      affected settings/migration/plugin contracts, and verify the settings modules load without
      Electron. No process, IPC, layout or storage schema change requires a full resource capture.

The attached ACP adapter copies legacy input, returns isolated read values and rejects legacy
writes/deletes. A rejected mixed-key batch fails before changing database settings. Seven unused
legacy mutation/access helpers have been removed; actual Agent mutations continue through the
unified repository. Normalization still runs before database attachment and its migration snapshot.
Legacy config import reads the extracted source files and applies database payloads, so it does
not require an active writable JSON adapter.

Validation: 30 native affected files/380 checks and the separate config-import file/six checks pass
under Electron Node with native SQLite required. Nine plugin files/201 checks pass under normal
Node, matching their child-process fixtures. Modified settings/plugin/E2E scoped types, app node/web
types, normal build, format, lint and i18n pass. A temporary bundled probe constructs both settings
classes and defaults with `electron` and `electron-store` forbidden. The initial combined run used
Electron's executable for Node-only hook fixtures and failed six child-process cases; the correct
Node run passes. That diagnostic and the corrected snapshot-test fixture failure remain in the
acceptance directory. No runtime timeout or environment guard has been relaxed, and no owned hook
process remains.

The normal build refreshes the generated Provider catalog; three catalog files/50 checks pass.
The generated data is retained in its own commit so the configuration change can be reviewed
independently.

The immutable `ec82c12b4` application passes the same new configuration E2E in 6.6 s; the migrated
application passes in 6.9 s. It adds a disabled MCP server and manual ACP Agent, updates Agent
configuration and shared MCP selection/global availability, reopens and checks persistence,
removes/resets the configuration, reopens again and verifies absence. Legacy MCP/ACP JSON bytes
remain unchanged. All three selected app cases pass in 27.0 s, including encrypted database
legacy unlock/rekey/disable and native MCP credential/settings-window ownership. These are
functional results without a timing gate or speed claim. Evidence is under
`.deepchat/rutis-g4-mcp-acp-config-acceptance/`. Normal generated catalog refreshes are retained
separately. Catalog bootstrap, other native dependencies and the cohesive writer move keep G4/G5
open; full native Windows/Linux application behavior remains unverified locally.

### Provider catalog and request bootstrap

Remove native dependencies from Provider catalog/settings and HTTP execution bootstrap as one
dependency group. Main supplies the profile/catalog resource paths and default request headers;
the existing locale capability remains live. Package the one built-in catalog outside ASAR for
ordinary Node access. Separate Copilot token exchange from native device-login presentation.
Catalog import stays inert until explicit bootstrap. Retain existing cache ownership, privacy,
TTL, payload limits and request/error behavior. The existing Main idle Provider task owns automatic
refresh, so maintenance cancellation/drain also fences it. Stop and drain all refreshes at shutdown
and fence late writes/publications.

- [x] Replace actual bootstrap/header/token imports, every affected caller and fixture, and
      packaged resource wiring; remove the old native paths and header helper.
- [x] Validate catalog refresh/lifetime, HTTP metadata and token/security contracts, compare
      matching real-app operations, verify ordinary Node imports/resource access and run the
      affected application/static/package checks. No speed claim is part of this slice.

The affected Provider, Device, image-cache, package and startup/app-boundary suites pass 1,165
checks across 81 files with native SQLite required. Durable checks cover inert explicit bootstrap,
unchanged request metadata, token sanitization, absolute image-cache roots, three-platform catalog
resource validation, real refresh drain and late response/body fencing on shutdown or task
cancellation. Ordinary Node imports of Provider settings, Copilot HTTP and the AI SDK Provider pass
with Electron and electron-store forbidden. App/scoped types, normal build, format, lint and i18n
pass. Normal ACP registry refreshes remain in a separate generated-data commit.

The immutable `7fb11102f` application passes the matching catalog/request E2E in 2.4 s; the migrated
application passes in 2.1 s. Four migrated application checks pass: catalog/header bootstrap,
held-refresh graceful shutdown/reopen without late cache writes, model persistence without legacy
JSON writes, and encrypted legacy unlock/rekey/disable. Evidence is under
`.deepchat/rutis-g4-provider-bootstrap-acceptance/`. These are functional observations. No process
topology, cache schema or data-volume change requires a performance capture, and no performance
suite was repeated. The one built-in catalog moves outside ASAR; package/resource checks cover
ordinary Node access. The existing `7fb11102f` required and all six package CI checks pass; the new
checkpoint still needs its own CI results. G4 remains active and G5 has not started.

### ACP execution bootstrap

Remove native version/home/temp lookups from ACP process, terminal and session-persistence owners
as one dependency group. Supply plain bootstrap through the actual lazy runtime composition; make
the existing path-expansion/default-path helper pure and retarget its ACP and MCP callers. Keep
the current launch, containment, protocol, persistence and process cleanup behavior.
The complete Provider import graph also requires passing Ollama's existing TLS debug policy from
Main through its environment port; retain the existing host decision and secure production default.

- [x] Replace actual bootstrap/helper wiring and remove direct Electron dependencies and unused
      native helper methods; do not retain an implicit native construction fallback.
- [x] Compare matching real-app ACP execution on immutable and migrated builds, validate affected
      execution/session/terminal/MCP contracts and ordinary Node imports, then run required static
      and package checks. No process/IPC/data-volume change or performance claim is selected.

Main supplies application version and absolute home/temp roots through the existing lazy ACP owner,
client and process manager. Terminal and persistence owners receive their roots explicitly. The
shared helper now exports two pure path functions; its singleton and two unused native methods
are removed. Windows process hiding depends on the target platform rather than Electron presence.
Ollama receives the unchanged host TLS decision through the Provider environment. A host-denied
pull stays secure even if the backend's ambient debug flag is set; an explicit host grant allows
the existing debug behavior. The app's native TLS policy helper remains with Main.

The final affected Electron suite passes 1,454 checks across 108 files with native SQLite required;
the real PTY auth case separately passes under ordinary Node, for 1,455 checks across 109 files.
The generated catalog suites also pass 59 checks. App types, normal build, final app build,
format/check, lint and i18n pass. Bootstrap validation, supplied terminal roots, protocol version,
session restoration, PATH precedence and TLS host-policy checks retain durable coverage. Four
ACP/core imports and the complete ProviderRuntime module graph load under ordinary Node with
Electron and electron-store forbidden. This proves import portability, not a composed headless host.

The immutable `a217ff4e5` app passes the matching ACP protocol/structured-answer E2E (7.1 s); the
final app passes (7.7 s). The final group passes three cases in 14.6 s: ACP owning-prompt/child-output
behavior, Provider catalog/header bootstrap, and held-refresh shutdown/reopen without late writes.
ACP settings routes and encrypted legacy unlock/rekey/disable also pass in the preceding app
selection. Timings are functional observations. No performance suite or resource capture was run.
Evidence is `.deepchat/rutis-g4-acp-runtime-acceptance/`; immutable baseline hashes are verified.
Initial failures retain their logs: two tests spied on the deleted helper, and the exact-environment
PTY case needed its ordinary Node executable. No production timeout or security rule was relaxed.
The broader Provider import probe exposed the native TLS helper; passing its host policy removes
that dependency. Normal generated catalog data is retained separately. G4 remains active, and
native Windows/Linux full-app behavior and the cohesive G5 backend/writer move remain unverified.

### ACP registry ownership and bootstrap

Main supplies the registry's explicit profile/resource directories and native icon-fetch capability.
AgentSettings receives that owner directly. Load local catalog data without detached network work;
automatic refresh belongs to the existing Main startup task, and manual refresh retains route
ownership. Stop, cancel and drain before database disposal; fence late cache/icon writes, repository
updates, Provider refresh and events. Package one registry/icon snapshot outside ASAR.

This migration characterizes actual refresh/icon persistence on the immutable application before
implementation, because its network, cache and repository effects must retain one owner.

- [x] Replace actual registry construction, asset paths, startup/shutdown ownership and refresh
      cancellation; remove native imports, cwd fallback and detached initialization.
- [x] Compare real refresh/icon/reopen behavior, validate late replies and task/shutdown fencing,
      preserve privacy/TTL/URL/SVG contracts and run affected static/native/package checks.

Main constructs the registry with absolute profile/built-in roots and a URL-checked, cancelable
native icon-text capability. The service and AgentSettings import no Electron or electron-store;
there is no cwd resource fallback. Initial loading is local. The existing idle Provider task owns
automatic registry and model-catalog refresh concurrently and waits for both to settle before
ending. Registry refresh is single-flight through its service and repository/Provider/event
continuations. Shutdown aborts it and drains actual work; task cancellation fences every late
effect without stopping the owner needed after maintenance. A manifest becomes committed after
its icon work settles, and cancellation cannot prune icons or replace the acknowledged catalog.

The affected native suite passes 106 checks across eight files, including held headers/body/icon
responses, caller cancellation and fresh reuse, actual drain, late repository/Provider completion,
privacy/TTL, SVG/checksum normalization and three-platform package asset validation. App/scoped
regression types, normal build, format/check, lint and i18n pass. Registry, AgentSettings and the
complete ProviderRuntime module graph load in ordinary Node with Electron/electron-store forbidden.
The one bundled registry/icon snapshot moves outside ASAR; the package hook validates ordinary
files for the manifest and all declared registry icons. Unused implicit-resource constants are
removed. Normal builds introduce no generated-catalog diff in this slice.

The immutable `45cbdf4c0` app passes the matching refresh/icon/persistence E2E in 4.6 s; the migrated
app passes in 4.4 s. Four selected app scenarios pass in 27.6 s, including real registry refresh,
sanitized icon cache, graceful reopen, unchanged legacy JSON, held-refresh shutdown/reopen without
late catalog or Agent writes, ACP prompt/child-output behavior and encrypted legacy unlock/rekey/
disable. Timings are functional observations; no performance suite or resource recapture was run.
Evidence is `.deepchat/rutis-g4-acp-registry-acceptance/`. Full native Windows/Linux application
behavior is unverified locally, and the new packaging layout needs its exact-head CI evidence.
This slice owns registry refresh. ACP installation/prewarm jobs and remaining host/writer
dependencies remain G4 work before the cohesive G5 cutover; G4 is not complete.

### ACP installation and launch preparation ownership

Own explicit installation, enable-triggered preinstallation, repair, uninstall and binary launch
preparation through one installation resource. Coalesce identical work, serialize conflicting work
for one Agent, propagate cancellation through download/body/extraction boundaries and await real
settlement. Stage and validate a replacement before changing the installed directory. Track the
repository/Provider continuations, fence stale descriptors and preserve the previous acknowledged
install state on canceled work. The existing database admission gate also governs background work;
its local callback moves with the Store in G5 rather than becoming synchronous IPC.

Characterize actual binary install/reopen behavior on the immutable application before replacement,
because the same cache files and persisted install state must retain a single owner.

- [x] Connect installation/launch cancellation, actual drain and maintenance/stop admission to
      the existing service and callers; preserve prompt enable acknowledgement and archive guards.
- [x] Compare installation/reopen, canceled late bodies, failed repair and maintenance recovery in
      the app; run relevant native/static checks and remove the unowned background continuations.

Install, repair and implicit launch share the existing physical installer. It admits at most 32
physical installations, coalesces matching work and queues repair behind an ordinary install.
Uninstall reserves its Agent before awaiting canceled work. The Settings owner tracks actual
installation, launch, uninstall and derived Provider lifetimes; stop and database maintenance drain
them before writer teardown. Descriptor changes cancel prior work. Cancellation restores only an
unchanged pending SQL state and cannot publish a late installed/error result. Main supplies the
existing local database admission check; enable still acknowledges before background installation.
Replacements use validated staging and the existing directory activation/rollback helper. A failed
repair retains the original binary; ordinary interrupted activation can restore its `.prev` tree.

Validation: **244 checks across 20 files pass**, with native SQLite required for the 16-file
affected group (176 checks); four generated-catalog files add 68 checks. App/scoped types, normal
build, final application build, format/check, lint and i18n pass. Installer, AgentSettings and the
complete ProviderRuntime module graph import in ordinary Node with Electron/electron-store
forbidden. The build-generated Provider catalog is retained separately.

The immutable `3ede3013a` app passes the matching binary install/repair/reopen case (4.2 s); the
candidate passes (4.6 s). Six real-app cases pass in 34.8 s: acknowledged binary persistence,
held-repair graceful shutdown with no late replacement/state commit, database maintenance drain,
failed repair preserving the old binary, post-maintenance repair/reopen, registry refresh/shutdown
and encrypted legacy unlock/rekey/disable. The maintenance case also passes with public uninstall
and persisted `not_installed` verification (5.2 s). These are functional observations without a
timing gate or speed claim; no performance suite/resource capture was repeated. Immutable baseline
hashes match the accepted registry candidate. Evidence is
`.deepchat/rutis-g4-acp-installer-acceptance/`.

The preceding `45cbdf4c0` required run `40458182691` and all six packages `40458182714`, including
package-required `122042123850`, pass before the registry checkpoint is published. The published
registry head `3ede3013a` passes required `40462217782`/barrier `122051412704` and all six packages
`40462217827`/barrier `122055725559` before this checkpoint is published. This installer checkpoint
still needs its own CI results after publication. Full native Windows/Linux app
behavior, power loss across filesystem activation/SQL publication and moving synchronous archive
extraction out of Main remain unverified. Remaining configuration/host/writer contracts keep G4
active; G5 has not started.

### Background execution helper ownership

Replace the global Electron-aware proxy with one explicitly composed background execution owner.
Supply its typed helper command/event/lifecycle capability from Main, using the existing Scheduler
adapter pattern. Inject that owner into Bash, Tool and Skill consumers. Preserve the dedicated
helper, child/session leases, authority checks and output/Skill-tree cleanup. Fence pending startup
and post-authority continuations during shutdown, await real callbacks and reject terminal restart.
Do not add another process supervisor or generic launch endpoint.

Characterize the real app's exec/process feedback and child cleanup before replacing ownership,
because command dispatch and helper lifetime must remain identical across the cutover.

- [x] Compose the helper capability and one owner; replace all implicit singleton/native fallback
      wiring and retain process/session recovery contracts.
- [x] Verify ordinary exec/process feedback, cancellation, held startup/authority shutdown and
      restart boundaries; compare the actual app and validate affected callers and packaging.

Main composes one BackgroundExecService with an absolute approved helper entry and a cancelable
native launch adapter. Bash, process tools and Skill execution receive that same owner. The owner
retains actual startup, authority callbacks, RPC and rejected Skill-tree cleanup; terminal stop
cannot restart the helper. Late events from an old helper cannot affect its replacement. Root
shutdown first cancels hydrated Harness generations without reading the database, then stops
command admission. Actual helper/callback cleanup drains before Skill owners and the writer close;
a failed drain cannot become a logged-and-continued teardown step.

Validation: **988 checks across 36 affected files pass** under Electron with native SQLite required.
App and new regression/E2E types, normal/final application builds, format/check, lint and i18n pass.
The existing ported legacy fixtures retain 107 type errors on both an isolated immutable baseline
source tree and the candidate, with no new diagnostics; these are not represented as passing typed
fixtures. Runtime suites pass. No check, timeout or native-import guard was relaxed.

Background execution, Skill execution, ProviderRuntime and the actual Harness entry import in
ordinary Node with Electron/electron-store forbidden. The 350-module Harness graph has no native
imports; this verifies module loading, not a composed headless backend or a relocated writer.

The immutable `edfb8ab43` app passes matching exec/process completion and active-child shutdown/
reopen cases (5.1/4.8 s); the final candidate passes (5.3/5.0 s). Six final app cases pass in 34.3 s,
including held helper startup shutdown with no command or subsequent model round, child exit and
persisted message recovery, encrypted legacy unlock/rekey/disable and shutdown while native
credential/database maintenance work is held. The held-start case exposed and verifies the early
in-memory generation cancellation requirement. Timings are functional observations only; no
performance/resource suite was repeated and no speed gain is claimed. Evidence is
`.deepchat/rutis-g4-background-exec-acceptance/`.

The installer baseline `edfb8ab43` passes required `40464593274`/barrier `122059109164` and all six
packages `40464593265`/barrier `122065276883` before this checkpoint is published. Background head
`12a73394f` passes required `40467842999`/barrier `122069829980` and all six packages
`40467843051`/barrier `122075929024`. Native Windows/Linux full-app behavior, Code Mode and other
desktop capability ports, remaining Store ownership and the cohesive backend move remain open.
G4 is active; G5 has not started.

### Code Mode helper and callback ownership

Supply the existing Code Mode manager with a required approved helper capability. Keep native
launch configuration, events and bound RSS reads in Main; retain VM/protocol/journal bounds and
session state semantics. Reserve pending startup before any await, track actual callback lifetime
through cancellation and close/drain it before Store teardown. Coalesce RSS reads and fence old
cells without adding a generic process supervisor.

Characterize actual Code Mode nested execution and isolated VM globals before the
host boundary changes, because tool feedback and journal commitment must remain compatible.

- [x] Inject the host capability through ToolService; remove native defaults and own pending
      startup, sampling and nested callbacks across cancel/shutdown.
- [x] Compare real Code Mode execution/reopen and held readiness shutdown; verify concurrency,
      memory limits, lifecycle faults and affected Tool/Harness contracts.

Main supplies the approved absolute helper entry and a plain host channel through ToolService.
The adapter retains the restricted environment, 64 MiB heap and unsigned-library policy; RSS
reads are bound to that helper rather than an arbitrary PID. The manager retains the existing
READY deadline, heartbeat, source/output bounds, 512 MiB hard RSS limit, execution journal,
permission retry and frontend-specific state semantics. Native imports and path guessing are
removed from the manager.

Session startup is reserved before asynchronous effects. Cancellation returns promptly while
the owner retains actual startup completion and compensates a late host. Stop closes admission;
shutdown drains actual nested-tool and coalesced RSS callbacks before Skill/Store teardown.
Aborted callbacks cannot publish a late result. Main invokes this critical drain directly rather
than logging a failure and continuing to close the writer.

Validation: **547 checks across 10 affected native suites and 23 generated-catalog checks across
two files pass**. App and scoped native-adapter/manager/E2E types, normal/final application builds,
format/check, lint and i18n pass. Regression cases cover concurrent startup, canceled startup
reuse, late host compensation, uncooperative nested callbacks, actual RSS drain/coalescing and
the unchanged READY and RSS limits. The touched manager fixtures also pass strict typechecking.

The immutable `12a73394f` app and candidate pass the same nested execution, cell-global isolation
and persisted-message reopen scenario; the final exact-assertion comparison passes in 6.4/5.2 s.
Seven candidate app cases pass in 33.9 s, including held Code Mode READY shutdown with helper exit
and no subsequent tool/model round, background execution completion/shutdown/held startup and
native credential/database-maintenance shutdown holds. The function frontend is exercised in
the app; Codex store/yield/permission semantics remain covered by the VM/manager suites, without
claiming an authenticated Codex account E2E.

The manager, actual 350-module Harness entry and ProviderRuntime import in ordinary Node with
Electron/electron-store forbidden and no native imports. This establishes module loading, not a
composed headless backend or a relocated writer. Evidence and artifact hashes are in
`.deepchat/rutis-g4-code-mode-acceptance/`. The normal generated Provider catalog refresh is retained
separately in `f560f941e`. No performance/resource suite was repeated, no timing gate was added and
no speed gain is claimed. The preceding `12a73394f` CI completed before publication. Code Mode head
`32f457ff7` passes required `40473854228`/barrier `122089643930` and all six packages
`40473854200`/barrier `122095514524`.
Remaining desktop/Store boundaries keep G4 active; G5 is unstarted.

### Agent Tool host inputs

Supply AgentToolManager's existing desktop port with explicit absolute temporary/profile-temporary
roots and an asynchronous image-dimension capability. Keep nativeImage and app paths in Main;
remove native imports from the business manager. Preserve the existing runtime directory allowlist,
default-workspace creation/fallback, file/symlink checks, image metadata and vision selection.
Recheck cancellation after the host result and before cache/Provider effects. Native image objects
and generic path/root discovery must not cross the boundary; do not introduce a second supervisor.

- [x] Replace native defaults with required host inputs at the actual ToolService composition.
- [x] Compare real image metadata/text-read/reopen behavior against the accepted app; validate
      injected roots, metadata failure, cancellation and affected Tool/Harness contracts.

Main supplies the existing system/profile temporary roots and native image-size probe through the
required desktop port. The manager validates absolute roots and uses them for the unchanged read
allowlist and default-workspace fallback. It awaits dimensions, preserves unknown-metadata failure
behavior and checks cancellation before preview caching or vision work. The probe returns only
numeric dimensions. The settings-window consumer keeps its original three-method subset rather than
receiving image/filesystem capabilities. Seven obsolete native mocks are removed from pure Tool
suites; ToolService still imports the separate plugin policy Store and is not claimed portable.

Validation: **689 checks across 14 affected native files and 23 generated-catalog checks across
two files pass**. App and new E2E types, normal/final application builds, format/check, lint and
i18n pass. Durable cases cover supplied roots, default workspace, approval for unrelated files,
metadata failure and cancellation of a delayed image result before cache/Provider effects. The
existing vision preference, journal, symlink and permission suites remain green. No production
guard or timeout was relaxed.

The same actual image metadata, workspace read and persisted-message reopen scenario passes on
immutable `32f457ff7` and the final candidate (both 5.3 s). Four final app cases pass in 21.0 s,
including background process feedback, Code Mode nested execution and held-READY helper shutdown.
All profiles are disposable and the Provider fixture is local. Artifact hashes and evidence are in
`.deepchat/rutis-g4-agent-tool-host-acceptance/`.
The normal generated Provider catalog refresh is retained separately in `c4f306e01`.

AgentToolManager's 126-module graph, the actual 350-module Harness entry and ProviderRuntime import
in ordinary Node with Electron/electron-store forbidden. This proves module loading, not a composed
headless backend or relocated writer. Native image decoding retains its current synchronous Main
placement. No performance/resource suite was repeated and no latency or memory gain is claimed.
The preceding `32f457ff7` required and six-platform CI completed before publication. This target
retains the accepted CI evidence below. Remaining configuration and native/Store ports keep G4
active. G5 has not started.

Agent Tool head `f0ca555fe` passes required `40478827867`/barrier `122106538990` and all six
packages `40478827913`/barrier `122113041876` before the policy checkpoint is published.

### Portable application settings file owner

Make the existing application settings file constructible by the future backend without Electron.
Keep its storage engine, defaults, filename, migration behavior and database attachment contract.
Main supplies required absolute profile/home paths and the current application version.

- [x] Connect the portable factory to actual Main startup and remove the old app-settings native
      factory. Keep the same SettingsStore instance and database-backed routing after attachment.
- [x] Validate legacy JSON, unknown fields, dot paths, corrupt-file rejection, defaults, database
      routing and real configuration/credential persistence across graceful relaunch.

The factory uses `conf@15.1.0`, the exact engine already resolved beneath ElectronStore 11.0.2.
It is now an explicit dependency; the lockfile adds only its root importer entry and resolves no
new engine/package version. `configName`, absolute `cwd` and `projectVersion` replace the native
wrapper's name/path/version mapping. The same defaults remain in the existing settings module.
No replacement JSON serializer, file format, watcher, cache, writable shadow or generic Store RPC
is introduced. Other desktop-owned ElectronStore files retain their existing owners.

Sensitive and portable settings still route through AppSettingsDbBackedStore after the existing
migration and database attachment. Machine-local keys retain the same file adapter. Main remains
the active writer in G4; the portable constructor does not establish the G5 exclusive handoff or
allow Main and the backend to write different keys concurrently. DesktopSettings/AppSettingsService
still need native observation/effect and acknowledged snapshot/mutation contracts. OS login state
comes from the native API; it is not a persisted preference to copy into a second settings store.

Validation: **184 checks across 16 affected native files, eight renderer icon checks and 14
generated-catalog checks across two additional files pass**. Native SQLite is required for the
affected native group. Coverage includes
the six real-file/bootstrap contracts, config migration, attached settings/metadata, private crypto,
database security, public settings, onboarding and Sync settings. App and modified unit/E2E types,
the normal build, format/check, lint and i18n pass. The new file-contract suite explicitly uses the
real filesystem instead of the repository's default fs mock.

The immutable `cd7cc392f` app and integrated candidate pass the same final legacy/bootstrap/credential/relaunch
workload (5.8/4.8 s). Both use the current package version and resources. It uses an owned profile with an old version, custom workspace and unknown
extension data, updates file-backed language/UI/limits and a database-backed preference, then
reopens with each value retained in its original store. A disabled loopback cloud configuration
keeps its secret wrapped on disk and readable after relaunch without rewriting the ciphertext.
No external service/account or OS login registration is modified. The comparison restores and
hash-verifies the candidate output after the frozen-baseline run; no output swap remains active.

The settings factory graph (three modules) and database adapter (two) load with Electron and
electron-store forbidden at build/runtime. A real factory creates and writes the legacy file in
ordinary Node. This establishes a portable configuration owner, not a composed headless Harness
or relocated writer. No performance/resource capture or speed claim is added. The branch includes
`dev` at `b62eb0d2b`, including CloudGPU and `1.1.4-beta.7`. Its new Provider fixtures receive the
same required host environment as existing providers; no production fallback is added. App/scoped
types, build and matching application evidence validate this integrated source. The normal build's
Provider catalog refresh is retained. Evidence is `.deepchat/rutis-g4-settings-owner-acceptance/`.

This checkpoint needs its own exact-head CI after publication. The Hook baseline `cd7cc392f`
passes required `40623544678`/barrier `122604697934` and all six packages `40623544682`/barrier
`122608652902` before this settings-owner checkpoint is pushed. G4 remains active; G5 is unstarted.

### Hook metadata and command lifetimes

Keep Hook configuration, subscriptions, enrichment and command ownership together. Supply the
application version from Main for both normal and test payloads. Diagnostic acknowledgement must
not release a native command that still owns open stdio or an accepted Session lookup.

- [x] Remove HookService's Electron dependency and wire its required application version in the
      actual Main composition, preserving the version-1 payload and command environment.
- [x] Retain child ownership through native close, including after timeout/error diagnostics;
      stop admission and await accepted enrichment and child completion before Store teardown.
- [x] Compare the existing configuration/test/relaunch workload and verify actual shutdown with
      a real model-triggered Hook whose descendant keeps the command's stdio open.

The existing owner keeps per-session event eligibility/order and concurrent command execution.
Stop sends the existing shell termination signal and waits for actual child/stdio closure and
accepted enrichment. A 30-second drain failure rejects maintenance/shutdown; restart rejects while
prior work remains owned. New explicit test commands reject after stop. Main awaits Hook stop
directly before later teardown, so its failure cannot be swallowed by best-effort cleanup and
permit database closure. Command timeout diagnostics, output bounds/redaction, configuration
persistence, accepted subscriber identity and stopped-event suppression remain compatible.

Validation: **530 distinct checks across five affected files pass**, with native SQLite required
for the affected group. The final four-file group passes 515 checks, and the RuntimeHookSink's
15 checks pass on the same production sources. App and modified Hook/unit/E2E types, the normal
build, format/check, lint and i18n pass. Durable cases cover both supplied-version payloads,
timeout/error acknowledgement before native close, blocked late test commands, failed drain/restart,
late enrichment suppression and successful restart after prior work finishes.

The immutable `b7a50e3aa` app and candidate pass the same configuration/test/version/relaunch
workload (6.7/7.0 s). A separate baseline characterization reproduces premature shutdown: the
application closes while the real Hook descendant remains alive and holds stdio. The candidate's
same native-lifetime regression passes in 4.8 s: actual loopback Provider execution emits a
SessionStart payload with the native application version, shell termination leaves the descendant
holding stdio, the app remains alive until the fixture releases that child, shutdown is graceful,
and relaunch does not replay the Hook. Both candidate cases pass in 11.9 s. The baseline failure
and traces are retained. The existing direct-shell signal policy is unchanged; this cutover adds
no detached process group or descendant-tree termination guarantee. Missing close fails the drain.

HookService (one module), HookSettings (two) and routes (85) load in ordinary Node with
Electron/electron-store forbidden at build/runtime; a plain Hook owner also starts/stops there.
This is module-loading/owner evidence, not a composed headless backend. No schema, public route,
process placement, dependency, layout or performance claim changes. No performance/resource suite
is repeated. Evidence and immutable build hashes are in `.deepchat/rutis-g4-hooks-acceptance/`.

Published Hook head `cd7cc392f` passes required `40623544678`/barrier `122604697934` and all six
packages `40623544682`/barrier `122608652902`.
The Project baseline `b7a50e3aa` passes required `40621219551`/barrier `122597419315` and all six
packages `40621219651`/barrier `122602071741` before the Hook checkpoint is pushed. G4 remains
active and G5 is unstarted.

### Project bootstrap and native capabilities

Keep Project snapshots, settings revisions and environment transactions with their existing owner.
Supply native system/profile roots, optional Documents/Home roots, directory selection and path
opening from Main. Do not introduce awaited native discovery inside a synchronous snapshot.

- [x] Wire the required host into the actual ProjectService constructor and remove its Electron
      import/native directory discovery. Retain the existing shared database and settings owner.
- [x] Validate managed-workspace fallback, native failures, environment mutations, Session clearing,
      persisted revisions and the matching baseline/candidate application workload.

Main resolves the native directories once at bootstrap and preserves diagnostics for unavailable
Documents/Home paths. Project rejects relative host roots and captures normalized candidates;
later host-object changes cannot alter the roots of a versioned snapshot. Candidate order remains
Documents, Home, then the profile's managed workspace. Existing custom defaults, lazy preparation,
directory-creation fallback and temporary-path classification remain compatible. Main supplies the
same DeviceService and shell operations through required asynchronous capabilities. Native picker
cancellation/failure does not commit a selection; shell error strings still reject the operation.

Project removal still clears Session assignments, project/preferences and the environment projection
in one database transaction. Snapshot/settings reads remain in one uninterrupted turn, revisions
persist through the same SettingsStore, and no second writer/cache, public route, process, IPC or
schema is added. G5 must move this owner with the shared database/configuration authority and carry
only native selection/open operations over the desktop capability boundary.

Validation: **249 checks across nine affected files and 41 generated-catalog checks across four
files pass**, with native SQLite required. App and modified unit/fixture/new E2E types, the normal
build, format/check, lint and i18n pass. Durable host cases cover absolute roots, unavailable native
directories, stable captured candidates and selection failure without a mutation. Existing snapshot,
transaction, concurrent selection, Session lifecycle and authenticated route checks remain green.

The immutable `c6758fe56` app and candidate pass the same Project/native-boundary/persistence
workload (5.0/5.8 s). It uses only an owned disposable profile, seeds a custom default before first
launch and creates the managed workspace beneath that profile. Cancellation, selection, open-path
error propagation, reorder/archive/restore, removal clearing a Session/default, graceful shutdown
and exact snapshot/revision persistence on relaunch pass. Native dialog/shell results are supplied
at the Electron API boundary; physical picker interaction and launching a file manager are not
exercised. The fixture's profile preparation is restricted to its owned profile before first launch.
Project (three modules) and its route graph (86) load in ordinary Node with Electron/electron-store
forbidden at build/runtime. This is module-loading evidence, not a composed headless backend.

No performance/resource suite is repeated and no speed gain is claimed. Normal generated Provider
and ACP registry refreshes are retained separately. Artifact hashes and evidence are in
`.deepchat/rutis-g4-project-acceptance/`. Published head `b7a50e3aa` passes required
`40621219551`/barrier `122597419315` and all six packages `40621219651`/barrier `122602071741`.
Remaining Store/configuration and desktop boundaries keep G4 active. G5 is unstarted.

The MCP App baseline `c6758fe56` passes required `40498105485`/barrier `122171636540` and all six
packages `40498105509` attempt 2/barrier `122594009042` before this Project checkpoint is pushed.
The single failed-job retry resolves a runner DNS failure downloading pinned Rust; production
checks, timing budgets and source remain unchanged.

### MCP App registry and desktop adapter

Keep one registry for instance/source/consent authority. Move native protocol, window observation,
link opening and session permissions to the Main adapter. Require owner observation before creating
an App; bound creation reservations with the existing instance limits and invalidate them on owner,
server and maintenance revocation. Keep authorization and source validation beside the registry.

- [x] Connect the native-free registry/host to required desktop capabilities and asynchronous
      native policy/permission commands; remove the old native registry wiring.
- [x] Compare real App hydration, sandbox policy, consent, tools, source changes, window closure
      and relaunch; validate lifecycle/security limits and ordinary Node loading.

One native-free registry retains instances, source validators, pending consent and pending creation.
Reservations count against the existing 64-instance and 32-per-owner limits. Owner/server revocation
and maintenance clear cancel them and abort observation/metadata waits; the SDK resource request
receives the same owner signal. Late results cannot publish a view. Shared MCP connection startup
and execution remain with the existing server owner. Creation always releases its reservation.

Main's protocol adapter observes the actual native owner before App hydration and revalidates its
window identity before protocol responses, permission callbacks and approved links. It receives
only policy, browser-permission and owner-revocation business operations. Protocol policy is a
plain isolated projection; browser permission decisions remain with the one registry and require
current source/owner state after consent. Native callbacks settle once even if the caller disappears.
First-party/default-session behavior, separate sandbox origin, CSP, consent bounds/timeouts and
the absence of standing browser grants remain compatible. The old native registry imports,
observer and session-permission implementation are removed; their native adapter is wired by default.

Validation: **964 checks across 34 affected files and 23 generated-catalog checks across two files
pass**, with native SQLite required. App and all affected MCP unit/new E2E types, normal/final app
builds, format/check, lint and i18n pass. Durable cases cover pending-creation capacity and release,
owner/server/maintenance cancellation, resource reads whose SDK ignores cancellation, revoked
approval, isolated policy, late native policy responses and single native callback settlement.

The immutable `ef4e8052a` app and final candidate pass the same real model/MCP/persistence/native
protocol/consent/relaunch workload (6.7/6.3 s). A model tool call creates the saved App source;
actual protocol responses retain CSP and permission headers. App tool calls, settings-window
rejection, explicit link allow/deny, graceful shutdown with pending consent, reopening saved sources
and deletion making a saved App inert all pass. The native browser launch is recorded at the shell
boundary; external browser navigation and physical camera/microphone access are not exercised.
The three final policy, stdio and App cases pass in 28.1 s. Timings are functional observations,
without performance gates, resource recapture or speed claims. The normal generated Provider
catalog refresh is retained separately in `5a79f205d`.

Registry (one module), AppHost (five), the full McpService module graph (34), ToolService (204),
actual Harness entry (350) and ProviderRuntime (131) import in ordinary Node with Electron and
electron-store forbidden at build/runtime. The native protocol adapter remains in Main. This
establishes module loading, not a composed headless backend or a relocated writer. G5 must move
the registry with its source and permission authority, keeping source closures/signals local and
transporting desktop policy/permission/ownership operations through the private gateway with
generation fences. Artifact hashes and evidence are in `.deepchat/rutis-g4-mcp-apps-acceptance/`.
G4 stays active and G5 is unstarted. Published head `c6758fe56` passes required `40498105485`/barrier
`122171636540` and all six packages `40498105509` attempt 2/barrier `122594009042`.

The preceding MCP environment head `ef4e8052a` passes required `40493590061`/barrier `122156301597`
and all six packages `40493590206`/barrier `122162440119` before this App checkpoint is published.

### MCP runtime environment

Supply the existing MCP client and registry probe with required host values and capabilities.
Keep one toolchain owner, preserve live command/PATH selection, home expansion, client identity,
environment isolation and child cleanup. Remove runtime Electron/proxy imports and singleton lookup;
keep native discovery and proxy resolution at composition. Process placement is unchanged.

- [x] Connect explicit home/version/toolchain and proxy capabilities to every production caller.
- [x] Compare real stdio MCP initialization, command/environment/cwd, calls, restart and cleanup;
      validate existing MCP, toolchain and lifecycle contracts and ordinary Node loading.

Main supplies the absolute home directory, application version and existing ToolchainService owner
to McpService and every client. Commands, configured runtime roots and PATH still read that owner's
current state. Registry probes use the current host proxy URL, including configured credentials,
through a required callback. The client no longer imports Electron or obtains a global toolchain;
the server manager no longer imports the native proxy module. Obsolete native/singleton test mocks
are removed. Native discovery and proxy resolution remain at composition.

Validation: **976 checks across 36 files pass**, covering MCP transport/auth/settings/policy,
toolchains, plugin lifecycle, ToolService, Harness, composition, runtime bindings and generated
catalogs, with native SQLite required. App and affected MCP unit/E2E types, the normal build,
format/check, lint and i18n pass. Durable cases cover supplied home/version and absolute-path
validation plus live registry-proxy replacement. Environment restrictions, protocol deadlines,
process identity and cancellation tests remain enforced.

The immutable `3b3890dad` app and candidate pass the same real stdio workload (7.3/7.5 s): public
custom-Node selection, home expansion, client identity, configured working directory and PATH
precedence, minimal-environment secret exclusion, tool calls, stop/restart, graceful close and
persisted relaunch. Every observed child exits. Normal candidate HTTP plugin-policy and stdio
cases pass in 20.9 s; both Code Mode helper cases separately pass. These are functional observations
without timing gates. The normal generated ACP registry refresh is isolated in `08ddc763f`.

McpClient (18 modules), ServerManager (19), ToolchainService (13), full ToolService (204), actual
Harness entry (350) and ProviderRuntime (131) import in ordinary Node with Electron/electron-store
forbidden at build and runtime. This establishes those loading graphs; MCP AppHost presentation,
a composed headless backend and relocated persistence owners remain open. No process placement,
performance capture or speed claim changes. Evidence and artifact hashes are in
`.deepchat/rutis-g4-mcp-runtime-acceptance/`. G4 stays active and G5 is unstarted; publication and
exact-head CI remain separate acceptance evidence.

### Plugin tool policy owner

Move plugin policy reads and mutations into one required, native-free owner. Main constructs the
existing `plugin-tool-policies` file adapter; PluginService, MCP ToolManager/AppHost and ToolService
receive the same owner. Remove module-level native construction and global policy functions.
Preserve file shape, replacement/removal by owner, explicit allow/ask/deny, undeclared-tool closure,
ambiguity and disabled-owner behavior. Policy decisions remain local with the execution owners;
G5 moves this state with them and gives retained desktop writers acknowledged commands.

- [x] Replace the global policy Store and retarget every production reader/writer to one owner.
- [x] Compare real MCP policy persistence, denied tools, ambiguous owners and disabled policies;
      validate mutation failures, owner isolation and Tool/MCP/plugin contracts.

Main supplies the existing named file adapter after profile selection. One native-free
PluginToolPolicyStore serves activation/migration/disable/shutdown writes and ToolService, MCP
ToolManager and MCP AppHost reads. The owner retains current backing-store reads without a second
decision cache. Owner/server replacement, owner-wide deletion, allow/ask/deny, undeclared closure,
ambiguity and disabled-record behavior remain unchanged. Legacy global functions and ToolService's
obsolete Electron mock are removed. Synchronous operations remain owner-local; G5 must provide
acknowledged mutations for any desktop writer retained outside the moved policy authority.

Validation: **744 checks across 12 affected native files, 23 generated-model checks across two
files and 16 ACP registry checks across two files pass**. App and new owner-fixture/unit/E2E types,
the normal application build,
format/check, lint and i18n pass. Coverage includes persistence-error propagation, independent
owners, replacement/removal, policy ambiguity, existing plugin lifecycle/MCP App contracts and
current-policy `ask` enforcement even with full access. No production check or timeout is relaxed.

The frozen `f0ca555fe` app and candidate pass the same real HTTP MCP fixture, stored policy file,
tool catalog filtering, permitted calls, ambiguous-owner rejection, disabled policy and relaunch
workload (13.2/13.3 s). Both comparison runs set the owned E2E profile before loading the unchanged
app entry: the old module-level native constructor ran before the application's profile override.
The driver restores the exact entry bytes afterward. This is test-profile isolation, not a policy
implementation or a performance comparison. Normal candidate startup additionally passes all
four app cases in 29.3 s, including Code Mode complete/held READY, Agent image/workspace reads and
the policy workload without that driver. No real user policy file is modified by the fixture.

The policy owner, full 204-module ToolService graph, actual 350-module Harness entry and
ProviderRuntime import in ordinary Node with Electron/electron-store forbidden. MCP runtime and
native AppHost dependencies remain outside that claim; no composed headless backend or relocated
writer is established. Artifact hashes and evidence are in
`.deepchat/rutis-g4-plugin-policy-acceptance/`. No performance/resource capture or speed claim is
added. The new checkpoint needs its own exact-head CI. G4 stays active; G5 is unstarted.
The normal generated Provider catalog refreshes are retained in `1952466fd` and `8cabd095e`; the
latter also retains the ACP catalog's website update.

The branch includes `dev` at `830745fec`, merged as `996efc3b0`. This preserves the upstream Code
Mode subagent contract fix: nested children retain their current authority under the frozen parent
entrypoint ceiling. Its two frontend fixtures use the branch's required public helper capability
and RSS method, with no private factory replacement. The merged app, contract/Tool suites and
matching policy workload are the final validation source; new CI must inspect this integrated head.

### Desktop appearance and native settings commands

- [x] Require plain bootstrap locale and asynchronous theme/login/UI capabilities; remove
      Electron imports and native listener ownership from DesktopSettings.
- [x] Route public appearance changes, display receipts and settings snapshots through the same
      bounded owner queue; wait for native completion before success and change events.
- [x] Fence/coalesce system-theme observations and drain actual host work during maintenance
      and shutdown. Compare the matching application behavior and preserve existing sender checks.

AppSettingsService serializes appearance commands, display mutations, settings updates and reads.
Normal admission stops at 64 outstanding commands. A coalesced system observation has a reserved
position so saturation cannot lose the latest OS color; an event during active observation can
schedule one following observation. Previous-value display receipts are read inside that ordering
boundary. Native theme and login operations return observed values. Selected snapshots query login
only when requested; a stored login preference cannot replace the OS result. Invalid/fenced/full
commands reject before work, and failed commands do not acknowledge success or wedge the queue.

Main supplies the Chromium application locale after readiness, NativeTheme operations, observed
login registration and awaited UI refresh. Floating UI receives the resolved locale/color directly,
avoiding a callback into the core command waiting for that host. Tab context menus retain the
resolved locale for new tabs. Main owns the NativeTheme listener, fences it during maintenance and
reconciles after startup/resume. Shutdown removes the listener and directly awaits settings stop
before event/storage teardown. Stop rejects queued/new commands and waits for active host work;
the unchanged 30-second lifecycle deadline leaves the owner fenced and prevents restart while
work remains. It is not a performance budget. There is no additional process, file writer, native
fallback, broad configuration snapshot or public protocol/schema change.

Validation: **180 distinct checks across 14 files pass**: 165 in 11 affected native-enabled files
and 15 in three renderer state suites. Durable checks cover awaited effects, concurrent display
receipts, OS-observed login values, selected reads, failures, saturation including system events,
coalescing, shutdown and a timed-out native drain. The floating host applies resolved appearance
without reentering pending core work. App and selected owner/native-settings/floating/E2E types,
normal application builds, format, lint and i18n pass. The legacy dispatcher fixture runs in the
native group; it is outside the additional selected test typecheck.

Immutable `592d32b92` and the final candidate pass the same three real-app cases (18.8/16.7 s):
settings revisions under frozen/rolled-back clocks, legacy file/database/credential persistence,
and desktop appearance/login/relaunch. Theme and Persian/English language changes update both
chat and settings windows. The locale manifest preserves `rtl` for Persian and `auto` for English.
The login setter is replaced at the native SDK boundary inside an owned disposable process:
requesting true can still observe false, and the unrelated stored true remains untouched. No real
OS login registration is written. Both variants close gracefully and preserve restored values on
relaunch. Times are functional observations; no performance/resource capture or speed claim is
added. Baseline and candidate use the same fixture, package version and runtime resources.

The DesktopSettings graph (three modules) and AppSettingsService graph (87) compile, import and
execute in ordinary Node with Electron/electron-store forbidden at build/runtime. The probe
constructs both owners and exercises bootstrap, language/theme commands, a full settings read and
stop. This proves that boundary, not a composed headless Harness or relocated shared writer.
Immutable hashes, diagnostics and acceptance logs are in
`.deepchat/rutis-g4-desktop-settings-acceptance/`; the final output is restored and hash-verified.

The settings-file baseline `592d32b92` passes required `40627565171`/barrier `122617966427` and all
six packages `40627565315`/barrier `122622838387` before this slice is published. This slice needs
its own exact-head CI. G4 remains active: font enumeration, logging/restart and other native/config
consumer contracts still require audit/extraction before G5's exclusive profile/writer handoff.
G5–G12 retain their full scope and conditional adoption rules.

### Font, logging and content-protection capabilities

- [x] Move font enumeration and logging-directory access behind required asynchronous native
      capabilities; keep normalization, cache and preference persistence with configuration.
- [x] Route font/folder requests and native content-protection/logging changes through the shared
      settings queue. Publish success only after the corresponding native operation completes.
- [x] Give Main one restart intent for logging and content protection; remove both unowned timers
      and the obsolete WindowPresenter restart callback. Exercise the actual application restart
      teardown and preserve settings on relaunch.

DesktopConfigurationHost uses the existing font-list implementation, the required absolute private
profile path and the Main logging gate. LoggingService and FontSettings no longer import native
platform packages. The existing font normalization, case matching, catalog cache and empty-catalog
failure behavior remain compatible. Public font lookup and folder opening enter AppSettingsService,
so actual native work belongs to its bounded command queue and drain. Main creates only the private
logs directory and checks the native folder-launch result; no renderer path is accepted.
Content-protection and logging mutations await their native effects before events and receipts.

The native configuration host starts paused. One pending restart intent coalesces logging and
content-protection changes with the existing one-second delay. Main activates it after startup,
pauses it before maintenance drains, and resumes it after successful recovery, including the early
maintenance-rejection path. Shutdown closes it before any awaited teardown step, preventing a
pending timer from taking over a quit. A fired restart transfers to the existing shutdown
coordinator; closing the host never waits on its own restart. Closed hosts reject new work.
WindowPresenter now applies window flags without owning a restart timer or callback. There is no
additional process, supervisor, file writer, dependency, fallback or public schema change.

Validation: **208 distinct checks across 17 files pass**: 179 native-enabled checks in 12 affected
files, 15 renderer state checks in three files and 14 generated-catalog checks in two files.
Selected owner/native-host/window/unit/E2E types and normal application builds pass. Durable cases
cover native completion and errors, fixed directory ownership, a close during directory creation,
font normalization/cache and actual pending-query drain, queued folder fencing, content/logging
acknowledgements, startup/maintenance pause-resume, shared restart coalescing, close cancellation,
failed restart reporting and transfer without self-deadlock. The legacy dispatcher fixture is
runtime-tested; its wider existing type debt remains outside the additional selected test typecheck.
Format, lint, i18n and app typechecks pass.

Immutable `5635e8b14` and the candidate pass the same three real-app cases (22.0/21.9 s): settings
revision/clock behavior, desktop appearance/login/relaunch and the native font/logging restart
workload. Actual installed fonts populate the normalized cache and preserve selected families.
The logging-folder SDK boundary records the private path without opening an external folder.
Content-protection calls apply real window flags. The real delayed restart drains the application
and reaches relaunch/exit; the fixture observes those final native calls without spawning a second
app, then completes the intended process exit with code zero. Manual relaunch restores font,
content-protection and logging preferences and the native protected-window flag. Logging produces
the application shutdown record in the owned profile. These are functional observations, not a
performance claim; no performance/resource suite is repeated.

DesktopSettings, FontSettings, LoggingService and AppSettingsService graphs (3/1/1/87 modules)
compile, import and execute in ordinary Node with Electron, electron-store and font-list forbidden
at build/runtime. The probe constructs all four owners and executes font discovery, canonical
selection, logging/content changes, folder access and stop through explicit host implementations.
This proves these boundaries, not a composed headless Harness or relocated shared writer.
Evidence and verified baseline/candidate hashes are in
`.deepchat/rutis-g4-font-logging-acceptance/`; the candidate output is restored after comparison.
The normal generated Provider catalog refresh is retained separately from the implementation.

Baseline `5635e8b14` passes required `40630680323`/barrier `122628063550` and all six packages
`40630680405`/barrier `122632459124` before this checkpoint is published. The checkpoint requires
its own exact-head CI. G4 remains active: finish the concrete configuration/native-image/runtime
consumer and writer/reader audit before G5's exclusive profile handoff and cohesive backend move.
G5–G12 retain their full scope and conditional adoption requirements.

### File preparation and native image actions

- [x] Require an absolute profile root for FileService and remove its Electron dependency.
      Preserve document/image adapters, validation, relative-read containment and generated-name
      temporary image writes; await directory creation before the first write.
- [x] Keep save-dialog selection, clipboard decoding/writes and native HTTP image retrieval in
      DesktopImageActions. Wire existing renderer routes directly to this Main capability.
- [x] Remove unused arbitrary profile write/delete and generic temporary-write methods. Keep
      adapter creation private; the business port returns data rather than adapter instances.

FileService owns Node-capable preparation and existing size/token/PDF/image behavior. Its explicit
profile root replaces app.getPath, and temporary writes no longer race constructor-side directory
creation. DesktopImageActions owns the existing data-URL, raw base64, image-cache and HTTP image
flows. Main retains Electron net.fetch and native image decoding, including existing MIME/filename
rules and fallback behavior. A canceled dialog performs no save; successful saves write the
original bytes to the selected target. NativeImage values remain inside Main. Existing public
schemas, sender checks and Main request admission/drain remain in place. No extra process, image
engine, dependency, generic filesystem route or fallback is added.

Validation: **139 distinct checks across 10 files pass**: 125 native-enabled file/dispatcher/image
checks in eight files and 14 generated-catalog checks in two files. Durable image cases cover
dialog cancellation and selected-target byte preservation, encoded cache traversal, failed native
downloads and invalid clipboard decoding. App and selected file/image/unit/E2E types, normal build,
format, lint and i18n pass. The large legacy dispatcher remains runtime-tested; its existing wider
fixture type debt is outside the additional selected test typecheck.

Immutable `36583fcfe` and the candidate pass the same real-app file/image workload (5.5/4.9 s).
The owned profile supplies actual text/PNG files. Real public routes prepare text and image
thumbnails, persist generated temporary image bytes, read relative files and reject traversal.
All four image source forms save identical bytes and reach actual native decoding. A local HTTP
server exercises Electron's network path. The fixture controls only native dialog selection and
clipboard output, so it writes no system clipboard or user-selected external file. Cancel and
decode failures retain their existing results; graceful close and relaunch preserve profile reads.
These times are functional observations; no performance/resource suite or speed claim is added.

The full FileService graph (21 modules) compiles, imports and executes in ordinary Node with
Electron/electron-store forbidden at build and runtime. Actual text preparation, sharp image
compression/thumbnail generation, first temporary-directory write, relative reads and symlink/
traversal fences pass. This proves the file boundary, not the cohesive headless Harness or the G5
writer handoff. Evidence and verified/restored artifact hashes are in
`.deepchat/rutis-g4-file-boundary-acceptance/`. The normal generated Provider catalog refresh is
retained separately from the implementation.

Baseline `36583fcfe` passes required `40644539422`/barrier `122672429696` and all six packages
`40644539477`/barrier `122677486296` before this checkpoint is published. This checkpoint needs its
own exact-head CI. G4 remains active: remaining configuration/runtime consumers and the final
writer/reader/desktop inventory precede G5's exclusive profile handoff. G5–G12 keep their full
scope and conditional adoption rules.

### Storage roots and native folder acknowledgement

- [x] Remove Electron path discovery from SyncService, SyncSettings and LegacyChatImportService.
      Supply required absolute profile/temporary/home/source paths from actual Main composition.
- [x] Await the native sync-folder launch and reject both SDK errors and failed native results.
      Keep directory selection and backup/import policy with the business owner.
- [x] Supply Knowledge's existing unpacked extension directory explicitly to the service and
      every database create/open path. Keep its DuckDB/VSS engine and file ownership intact.

Sync retains its existing filenames, archive paths, configuration filtering, snapshot/read locks,
encrypted backup behavior and incremental/overwrite rollback. Source and staged files remain
owned by the existing maintenance operations; this slice adds no writable Main shadow and does
not perform G5's handoff. Legacy startup import uses the same profile chat.db as an explicitly
read-only source and the same shared target facades. Knowledge removes its module-level native
lookup, retains existing VSS loading/fallback and keeps independent file/task state. Main supplies
runtime facts and the asynchronous shell capability. There is no additional process, engine,
dependency, fallback, public schema, generic path-discovery route or permission expansion.

Validation: **97 distinct checks across nine files pass**: 83 native-enabled sync/Knowledge/import/
composition checks in seven files and 14 generated-catalog checks in two. New durable cases cover
the supplied home default, waiting for actual native folder completion and propagating returned
errors/rejections. Existing native backup consistency cases retain encrypted snapshot, WAL and
concurrent-copy coverage. An obsolete source assertion requiring an undefined import path is
removed; actual application import/relaunch checks verify the explicit source. App and selected
sync-settings/new-E2E types, normal build, format, lint and i18n pass.

Immutable `9c67d7431` and the candidate pass the same six application cases (24.4/24.7 s): five
maintenance/backup/rekey/credential/shutdown cases and the storage-root workload. A disposable
chat.db is populated through native SQLite before launch, imported from the expected source,
preserved byte-for-byte and restored on relaunch. Sync creates and opens the configured private
backup directory through the actual route; the fixture observes the final shell SDK call without
opening an external folder. Knowledge loads the existing native VSS extension, creates its file
under app_db/KnowledgeBase, closes gracefully and reopens after relaunch with configuration intact.
No model/provider network call is needed. These are functional observations, not a performance
claim; no performance/resource suite is repeated.

The full SyncService/SyncSettings/LegacyChatImportService/KnowledgeService graphs (33/1/16/13
modules) compile and import in ordinary Node with Electron/electron-store forbidden at build and
runtime. The probe executes default/custom sync folder operations and actual native Knowledge
initialization, VSS loading, file listing, close and reopen. It does not claim a native SQLite
backup/import under ordinary Node or a composed headless Harness. Evidence and verified/restored
artifact hashes are in `.deepchat/rutis-g4-storage-roots-acceptance/`. Normal generated Provider
catalog changes are retained separately. G4 remains active for remaining native/configuration
consumer contracts and the final writer/reader/desktop inventory; G5–G12 retain their full scope.

Baseline `9c67d7431` passes required `40649481834`/barrier `122738133598` and all six packages
`40649481736`/barrier `122746406102` before publication. Initial static/macOS x64 jobs stopped
during dependency downloads, before application checks. Their diagnosed SheetJS connection reset
and npm registry timeout are retained with the retry evidence. Latest required/platform jobs and
both barriers pass. The storage checkpoint requires its own exact-head CI; the documentation-only
native-boundary audit reuses the accepted runtime artifacts without another build or E2E capture.

- [x] Complete the writer, synchronous-reader and desktop-consumer inventory.
  - [x] Enumerate SQLite/DuckDB construction and wrapper entrypoints, inherited shared facades,
        staged/import/snapshot connections and independent derived-cache/vector owners.
  - [x] Map Session/Tape/pending-input, Memory, Agent deletion, delegation, Scheduler, Project
        and Sync transactions to indivisible business operation groups.
  - [x] Classify remaining synchronous configuration consumers and desktop effects, including
        mixed database/file settings, plugin trust state and native image/runtime inputs.
- [x] Replace cross-boundary closures/row APIs with bounded transactional business commands for
      Session/Tape/Memory/config and scheduler claims. Preserve atomic head observations and CAS;
      leave exactly one writer authority throughout each cutover.
- [x] Define versioned read snapshots and acknowledged mutations for desktop consumers. Extract
      crypto/unlock, OAuth, helper launch, native UI and power events behind narrow async ports.
- [x] Preserve route sender validation, permissions, secret handling and cancellation identity.
      Compare real operations and maintenance, remove only replaced dependencies and validate
      directly affected storage/host contracts.

Completion: the core can depend on serializable operations and host ports without synchronous IPC,
generic SQL, duplicated writer state or privileged Electron objects crossing the boundary.

### Shared-writer inventory evidence

The source audit at `32f457ff7` finds 11 direct SQLite constructors in seven files and six DuckDB
instance creation sites in four files. The RFC records each constructor family, wrappers,
production callers and file role, including the G3 vector worker's directory-lock database and
Knowledge's independent files. `openSQLiteDatabase` configures WAL and creates a writable-capable
handle; snapshot/read intent alone does not make its callers read-only. `DataImporter` opens
both source and path-based target through writable-capable constructors. Production incremental
import uses these paths while the normal application writer is closed under maintenance.

The existing data facades inherit the startup `MainDatabase`; they are not independent connection
owners. Atomic groups include Agent deletion plus Memory namespace retirement and audit removal,
Project removal plus Session assignments, Sync conflict/trigger/cursor settlement, pending-input
receipts and Tape/transcript projections. Shared connection readers also include Session references,
history search, the built-in MCP conversation-search server and Tape inspector head subscriptions;
debug mock-session creation remains a writer operation. Memory's current-range query observes its
projection and Tape head in one SQL statement; replacing it with independent remote reads would lose that
guarantee. Existing local transaction closures can move with this cohesive backend without new
row-level RPCs.

`AppSettingsDbBackedStore` mixes sensitive/portable database keys with machine-local legacy-file
keys; its merged `store` getter remains owner-local. Native consumers use the committed private
allowlist and acknowledged mutations, while general config routes execute beside their settings
authority. Plugin installation/safety and tool-policy persistence retain separate complete file
owners. A full merged Store snapshot is not a public backend payload. Different-key writes still
race because the pinned Conf adapter serializes the whole object before atomic replacement.
G5 hands the complete profile-file authority to the configuration owner after exclusive bootstrap;
Main keeps snapshots/commands, including for UI keys. The RFC's final profile-file inventory also
covers native key files, credentials, caches, bootstrap migration and offline reset. This inventory
does not claim the actual G5 writer handoff or a composed headless backend.
Constructor inventories and source-search evidence are in
`.deepchat/rutis-g4-code-mode-acceptance/`.

The audit also records 34 direct SettingsStore import consumers and validates all 24 explicit
inventory source references. Format/check, lint, i18n and app typechecks pass. This documentation
checkpoint changes no application code; the accepted `32f457ff7` runtime evidence remains
applicable without repeating builds, application E2E or performance/resource captures.

### Remaining native-runtime boundary audit

Complete the remaining native/runtime/configuration contracts and final ownership inventory as
one G4 completion batch. Locally finish each affected owner and its relevant tests/application
comparison before advancing; publish the completed batch after normal quality checks and the
preceding CI barriers. Do not trigger another all-platform publication for each constructor fact
or documentation-only audit. Preserve the full contracts below, then verify the batch's actual
default composition before starting G5.

| Owner/call chain                                       | Current boundary                                                                                                                                                   | Required work before claiming the selected cutover                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| RemoteConversationRunner                               | Session/catalog/turn/projection and workspace-default queries are async; Main supplies the absolute profile root                                                   | Preserve file/workspace authorization and the existing cache/generated-asset paths at G5 handoff                                      |
| ChannelAdapter and five built-in factories             | Lifecycle/event adapter has no native import; actual downloads remain inside the clients/Runner                                                                    | Co-locate those business owners at G5; require a carrier only for an actual later host/device transfer                                |
| RemoteService Feishu/Weixin login                      | Main owns windows behind operation-ID commands/events; Core drains startup/polls/callback servers and fences late results                                          | Bridge this private port with authenticated G5 ownership and preserve actual cancellation/close/server settlement                     |
| Provider OAuthService/Copilot windows                  | Main owns presentation and validates new tokens; Core issues secret-free targets and atomically commits against current configuration                              | Preserve the private owner commands, maintenance invalidation and authenticated G5 caller grants                                      |
| Window/Tray/Notification/Shortcut/Floating             | Configuration readers use a private committed projection; floating bounds use acknowledged owner mutations; Agent/catalogue queries are already async              | Preserve the projection and existing async owner queries at G5 handoff                                                                |
| Upgrade settings and renderer diagnostics              | Core receives the explicit application version; Main reads projected channel/privacy/logging flags                                                                 | Preserve normalization under the configuration owner and Main's native updater/diagnostic lifetime at G5                              |
| Plugin installation, context Hooks and MCP supervision | One portable business owner keeps installation/safety persistence, Tape Hooks and synchronous supervisor decisions local; Main supplies async shell/window effects | Transfer this owner and its independent Conf file with the cohesive backend; preserve physical drain and private native caller grants |

Attachment I/O follows the actual clients/Runner call chain and stays local to that business
owner. The base adapter's uncalled download methods and their unused 20 MiB constant are removed;
no new size limit, desktop proxy path or native transfer operation is imposed on live downloads.
Any later selected host/device transfer must retain the RFC's bounded carrier/authority contract.
Native window extraction retains auth session and callback-server lifetime; its implementation is
recorded below. These boundaries preserve the full G5–G12 scope.

Native configuration consumers use resolved language, notifications, close-to-quit, content
protection, shortcut mappings, floating enablement/bounds, logging, privacy and update channel.
The private committed projection covers bounds writes and separate shortcut events explicitly,
including asynchronous error/drain handling for floating persistence. Update-channel normalization
belongs to the configuration owner. Plugin installation/safety metadata has an independent
plugin-settings file owner; tool-policy authority uses the separate plugin-tool-policies owner
already inventoried above. Keep activation, context Hooks/Tape and MCP supervision co-located with
their business consumers. Do not merge those files or retain a second writer during handoff.

### Native configuration projection

The actual Main composition supplies Window, Tray, Notification, Shortcut and Floating with a
private `DesktopConfigurationProjection`, replacing their direct DesktopSettings reads. The
configuration owner publishes explicit allowlisted values immediately after each stored mutation,
before native effects and public events. Nested shortcuts and bounds exclude unknown keys; the
projection rejects foreign owner identities, stale/invalid revisions and caller mutations of its
returned objects. It contains no credentials or merged Store state. Native theme reads stay in
Main, avoiding re-entry into a pending configuration command.

Floating bounds writes receive the existing serialized settings owner's acknowledgement and
publish committed values without optimistic cache changes. Drag mutation handlers validate the
current floating window and main frame. Floating enable/disable awaits actual native presentation
inside the same owner queue, preventing a queued disable or teardown from overtaking creation.
Maintenance/shutdown close native write admission, stop and drain the settings owner, then drain
outstanding native writes; successful recovery refreshes the projection before reopening writes.
The existing 64-command bound and stop deadline remain unchanged. Mutation routes return the
same command's receipt rather than enqueueing another read that a subsequent edit could overtake.

UpdateSettings receives the explicit application version and retains existing channel defaults and
normalization under the configuration owner. Upgrade reads the projected channel/privacy values.
Renderer diagnostics receives the projected logging flag and explicit profile directory; its file
rotation, sanitization and native lifetime remain Main-owned. The selected classes import without
Electron, electron-store or font-list in ordinary Node: DesktopSettings/FontSettings/Logging/
AppSettingsService/projection/UpdateSettings/renderer diagnostics contain 3/1/1/88/1/1/85 modules.
The probe executes owner mutations, committed cache publication and shutdown/drain. This does not
prove a composed headless Harness, cross-process owner replacement or G5's exclusive writer move.

Validation passes 330 checks across 29 files, app and selected test/E2E types, normal build, format,
lint and i18n. The same eight application cases pass on immutable `ae0be4fef` and the candidate:
five maintenance/rekey/credential/shutdown cases, desktop settings, font/logging and
the native projection workload. Actual floating-window drag persists/restores bounds after window
recreation; shortcut registration and updater channel selection observe committed owner values;
graceful profile relaunch preserves configuration. Only the final SDK registration/update check
is observed without registering a system shortcut or contacting the update service. These are
functional checks, with no performance capture or speed claim. Evidence and artifact hashes
are in `.deepchat/rutis-g4-native-projection-acceptance/`.

One interrupted, uninstrumented follow-up records a forced maintenance close. Both the targeted
two-case diagnostic and the full eight-case run with native process output complete gracefully;
the isolated failure remains an unexplained observation, with its evidence retained. Final G4
integration must recheck graceful maintenance/shutdown rather than classify it as timing noise.

The published `ae0be4fef` passes required run `40668735420`/barrier `122752954520` and all six package
targets in `40668735436`/barrier `122759825407`. The native projection belongs to the remaining G4
completion batch and is not independently published. The final native-consumer inventory
remain required. G4 stays active; G5–G12 retain their full scope.

### Remote native authentication and profile roots

RemoteService no longer imports Electron or retains BrowserWindow objects. Main owns Feishu and
Weixin login windows through the required `RemoteAuthWindowPort`: plain operation-ID open/close
commands and closed/error events. Core retains authorization state, nonce, expiry, HTTP callback
server and credential/pairing commitment. Window creation retains the existing dimensions,
brand/redirect navigation restrictions, popup denial and isolated web preferences. A native close
request cannot be retained by a page's beforeunload handler. Closing a loading window preserves
the cancellation outcome; navigation failures from an active window still reach the owner.

Authorization starts reuse the existing runtime-operation queue. Stop is idempotent, closes
admission before cancellation, marks current Feishu sessions terminal and awaits actual startup,
registration, polling and callback settlement. Initialization waits for that physical stop before
opening another lifetime. Late native startup is compensated by its known operation ID. Feishu
cleanup awaits response completion and callback work before closing partial-header connections
and releasing the loopback server. Weixin HTTP requests and poll sleeps carry owner cancellation;
canceled QR sessions retire and late confirmed results cannot recreate accounts or write secrets.
Main's final native-window close remains separate from Core's credential authority.

RemoteConversationRunner receives Main's explicit absolute profile directory for the existing
image-cache and fallback generated-asset locations. Its workspace default is queried asynchronously.
File/path authorization, workspace requirements, image promotion/deduplication and generated
filenames remain unchanged. The runner and Weixin SDK graphs compile/import in ordinary Node with
Electron/electron-store/font-list forbidden (10/1 modules); the complete Remote closure is verified
below. This is module portability evidence, not the composed G5 backend or G11 Session Host.

Validation passes 305 checks across 36 files, app and selected test/E2E types, normal build, format,
lint and i18n. The same six application cases pass on immutable `e2c97edac` and the candidate:
five maintenance/rekey/credential/shutdown cases and native Remote authorization. Actual windows
preserve disabled Node access, invalid nonce rejection, user-close cancellation and physical
closure. Weixin credentials survive graceful profile relaunch with the channel disabled. The
fixture intercepts only vendor HTTP and native loadURL destinations with disposable data; no real
account or external authorization is used. Evidence and artifact hashes are retained in
`.deepchat/rutis-g4-remote-native-acceptance/`. No resource capture or performance claim is added.

This work belongs to the unpublished G4 completion batch. The final writer/reader/native inventory
remains required before G5. Existing floating Agent/catalogue queries
already use async owner methods and need no extra synchronous-getter replacement. G4 remains active.

### Remote module closure

ChannelAdapter retains its existing lifecycle, event and send contract. Unused protected image/file
base64 download methods and their unreferenced 20 MiB constant are removed, eliminating the final
Electron import under `src/main/remote`. Repository consumers, built-in subclasses, plugin/schema
entrypoints and tests contain no calls to those helpers. Real attachment download/decryption stays
inside channel clients and RemoteConversationRunner; no body is sent over a new native/Rutis
operation. Existing transport/file-preparation policies, URL/base64/encrypted media behavior and
timeouts remain. There is no new carrier, download implementation, global cap or proxy substitution.

The complete RemoteService graph (54 source modules) bundles and imports in ordinary Node with
Electron/electron-store/font-list forbidden at build and runtime. The probe constructs the actual
service with explicit business/native ports, rejects unexpected network/native work, initializes
all disabled channels, applies a configuration mutation, shuts down, reinitializes and shuts down
again. This proves this module's portable composition and selected lifecycle, not live vendor
channels, a moved Store writer, the cohesive Harness or CLI execution.

The existing 305 Remote/native-window/composition checks across 36 files pass, along with app
typechecks, normal application bundling, format, lint and i18n. The unchanged actual-app Remote
login workload passes on accepted immutable `119a15949` and the candidate: nonce rejection,
user-close cancellation, window cleanup, Weixin account persistence and graceful relaunch. Accepted
baseline evidence from the identical fixture is reused; no unchanged baseline or performance
capture is repeated. Artifact hashes and evidence are in
`.deepchat/rutis-g4-remote-closure-acceptance/`.

### Provider OAuth configuration settlement

OAuthService uses required asynchronous Provider owner commands rather than synchronous settings
reads or full Provider writes. Core issues a target containing Provider ID, client ID and an opaque
configuration identity; the Native facade never receives the saved credential or unrelated
configuration. Device and browser login retain their existing presentation and GitHub token
validation, then await actual credential commitment before returning success. Persistence errors
propagate to the caller. Shutdown aborts token validation and fences pending target reads and late
validation results before they can start another effect or submit a write.

ProviderRuntime compares current identity and writes without an intervening await. The comparison
covers Provider ID, protocol, saved token and trimmed client ID with a private per-runtime key;
current name, enablement and custom headers survive unrelated changes. Concurrent logins cannot
overwrite a winning commit. Foreign-runtime, revoked, removed, reconfigured and malformed-token
requests reject. Maintenance invalidates captured targets before Store work; shutdown rejects
reads and writes. This is a stale-state fence, not authorization or a persisted database revision.
The unregistered generic OAuth method, callback server and window implementation are removed;
registered public route names, inputs and outputs remain unchanged.

Validation passes 79 checks across four files covering the real ProviderRuntime commands, Native
login facade, existing Copilot token/client behavior and composition. App and selected test/E2E
types, normal build, format, lint and i18n pass. The same owned-profile application workload passes
on immutable `3ddf2b657` and the candidate: actual device login instructions, GitHub verification,
credential receipt, rejection after concurrent configuration change and graceful persisted
relaunch. Vendor HTTP, clipboard and external browser launch are intercepted only in the disposable
app process; instruction windows are real and closed through Native APIs. The candidate also
passes all five existing maintenance/rekey/credential/shutdown cases. Their accepted baseline
remains available from the preceding integration. No resource capture or speed claim is added.
Evidence and verified hashes are in `.deepchat/rutis-g4-provider-oauth-acceptance/`.

### Plugin business owner and native presentation

The final G4 writer/reader/Native inventory includes the plugin boundary. It keeps
installation/consent, user-plugin activation, context Hooks and MCP supervision with the cohesive
core; its synchronous local transactions and integrity callbacks do not become row-level RPCs.

- [x] Replace implicit Electron paths/version and plugin-settings construction with explicit roots
      and the same Conf file format/defaults, retaining one installation/safety writer.
- [x] Require asynchronous native shell/settings-window capabilities and await actual native
      closure while retaining renderer ownership checks in Main.
- [x] Drain accepted context-hook work before maintenance/shutdown can release Tape; preserve
      active-run/update exclusion, cancellation, uncertain outcomes and restart behavior.
- [x] Verify default composition, portable import, relevant regressions and the same real-app
      plugin scenarios against immutable artifacts.
- [x] Finish the final writer/reader/native inventory and local completed-batch validation.
      The published batch's required and six-platform CI barriers pass at `356143755`.
- [x] Supply OCR's native cache-key provider explicitly from Main; preserve encrypted cache
      persistence, unavailable-key fallback and the same cache clear/relaunch application behavior.
- [x] Supply Codex/Grok auth owner commands to the OAuth facade. Keep their controllers,
      credential queues and synchronous storage observations with Provider consumers; Main must
      not initialize those owners or receive writable credential-store instances at G5 handoff.
- [x] Supply provider-existence results and committed MCP startup readiness to the native
      deep-link adapter; preserve latest-pending installation and sender/preview behavior without
      passing complete Provider settings or the MCP business owner into native actions.
- [x] Await the native resolved-proxy capability before the existing MCP registry probe; preserve
      proxy authentication, live selection, failure propagation and the three-registry batch.

Native SDK presentation remains Main-owned. These contracts do not move the cohesive backend or
authorize an additional settings writer. Publish the complete G4 batch after final validation.

PluginService requires absolute profile, home, working and application directories, resource
location, application version, the resolved command environment and native shell/window effects.
It uses Conf directly with the existing plugin-settings name/defaults/version; no file migration,
second installation/safety writer, generic persistence RPC or dependency is introduced. Runtime
supervision, tool-policy decisions, user-plugin update exclusion and Hook integrity callbacks
remain local to their business consumers. Main keeps the renderer ownership lookup.

Settings-window close destroys the owned window, waits for the actual closed event and retains
sender ownership until then; a page's beforeunload handler cannot veto disable or shutdown.
Failed loading drains its window before propagating; cancellation during loading settles cleanly.
A pending reopen cannot outlive close-all. Context Hooks reject new work on stop, cancel the
captured lifetime and drain the accepted queue, including actual child closure even when process
termination fails. A 30-second drain deadline rejects without releasing ownership; restart stays
blocked until the queue settles. Main directly awaits this stop before database maintenance or
shutdown can release Tape and resumes only after reconciliation. Existing invocation budgets and
uncertain-result/retry rules remain.

Validation passes **372 distinct checks across 16 affected files**: 231 plugin/native-window/
composition checks and 141 MCP/Tool/compaction consumer checks. The held-verification test
also passes all 26 checks in its file with a fake-clock drain deadline; unchanged tests are not
counted twice. Changed-test types, app node/web types, normal full build, format/check, lint and
i18n pass. Lint retains the preceding Remote finally warning.

The full PluginService graph imports in ordinary Node with Electron, electron-store and font-list
forbidden at bundle and runtime resolution: **18 source modules**. The actual owner initializes,
installs/enables a private user plugin, executes its Hook into Tape, stops/resumes, and reconstructs
from the same legacy-shaped Conf file. Enabled intent, unknown metadata and unrelated launch
evidence survive reconstruction. This verifies the portable owner, not a moved backend or headless
Session Host.

Immutable `d456426f7` and the candidate pass the same two application plugin cases: ZIP review,
disabled installation, MCP activation/tools/disable/uninstall, reviewed context reaching actual
Provider requests and host-owned credential rotation. The final candidate passes **eight app
cases**, adding actual official settings windows with beforeunload handlers, disable, isolated
renderer globals, persisted disabled intent, graceful relaunch and window cleanup at shutdown,
plus all five existing maintenance/credential/shutdown cases. The five cases' accepted baseline
is retained. No performance suite or resource recapture is selected and no speed gain is claimed.
Evidence and verified hashes are in `.deepchat/rutis-g4-plugin-owner-acceptance/`. This work stays
local with the remaining G4 completion batch; G5 and later goals remain pending.

### OCR native cache-key capability and final ownership inventory

OcrRuntimeService requires its existing asynchronous key-provider interface. Main constructs the
safeStorage implementation for the unchanged profile `ocr/cache-key.json` path; resource creation
uses that required provider for `ocr/ocr-cache.db`. The runtime imports only the provider's type.
Wrapped-key persistence remains a single native file owner, separate from the OCR cache database;
the native driver, memory fallback, unreadable-key recovery, clear and resource close are unchanged.
No new capability route, default provider, storage engine or process is introduced.

All **97 selected checks across eight files pass**: 85 runtime/key/asset/attachment/route/composition
checks and 12 native SQLite image/document artifact persistence checks, with SQLite required and no
skip. App and changed-test types, the normal build and the immutable-artifact check pass. Matching
`75-ocr-cache-key.smoke.spec.ts` passes on immutable `3eaf16a21` and the candidate: actual app routes
select the existing Node toolchain, clear the cache, close gracefully, relaunch and clear again.
The candidate reports persistent mode on both launches with native encryption available, an
encrypted database header and an unchanged wrapped-key file. This exercises cache ownership and
native key access; it does not claim a new OCR recognition or performance result.

The integrated candidate passes **16 application cases across ten files**, including plugin
install/Hooks/settings windows, maintenance and credential drains, MCP child lifecycle, desktop
configuration, font/logging, file/image effects, Remote authorization, Copilot credential commitment
and the OCR cache. Each selected owner's immutable baseline evidence remains available. No
performance/resource recapture or speed claim is selected. OCR-specific evidence and hashes are
in `.deepchat/rutis-g4-ocr-key-acceptance/`.

The source inventory checks **83 entries and 831 unique transitive inputs** without
Electron, electron-store, font-list or electron-toolkit runtime imports. Skill Sync's modulePath
reference is recorded separately and its actual worker source is checked as an additional entry;
the audit does not substitute a placeholder for runtime/package validation. All 63 direct native
import files have an explicit Main/device role, including UI/OS effects, ingress/bootstrap,
native crypto and key persistence, protocols, updater and OAuth presentation. Workspace's native
file/Git/preview owner has no shared database or settings import. Source graphs/classifications and
connection/configuration call sites are in `.deepchat/rutis-g4-final-inventory/`.

This is source-boundary evidence, not a composed backend or exclusive writer handoff. The Node
Codex/Grok auth owners and credential queues are constructed alongside Provider consumers; Main's
OAuthService receives acknowledged account commands. Native deep-link actions use provider-existence
and MCP startup observations in place of complete business-owner dependencies. MCP registry selection
awaits the native resolved-proxy capability. Local complete-batch inventory and validation pass;
G4's published-head required and six platform package CI barriers pass. G5's Core profile and
bootstrap composition is in progress.

### Provider account owner commands

Main's OAuthService requires ProviderAccountAuthPort: the existing nine public Codex/Grok account
operations and a private asynchronous stop command. Core composition initializes each existing
controller with its one credential store, publisher and native browser-opening capability. The
same global controller continues to serve Provider token/refresh consumers. Native presentation
receives status/login/callback/cancel/logout/stop commands, with no credential-store access or
business-controller initialization. GitHub's native SDK presentation and credential-owner commands
retain their existing behavior.

Stop first fences native Copilot work, submits account retirement and target invalidation, then
awaits their acknowledgements. A failed account stop cannot skip target invalidation. The account
receipt preserves the existing controller and credential generation fences; it does not redefine
callback-server or network closure. Credential commits remain synchronous after their owner-side
validation, with no await inside the file commit; backend teardown retains lifetime ownership.

Validation passes **116 checks across ten files**, including delayed/failed account-stop receipts,
Codex/Grok controller/credential/provider adapters and composition checks. Ordinary Node imports
and runs the actual two owners/stores: status, private persistence, cancel, stop fencing and reopen
preserve the file and expose no access token in public status. Their combined graph has **11
source modules**; Main's facade graph has **six**, with no Codex/Grok owner/store module. The probe
uses the existing unavailable-crypto file policy; real native wrapping and encrypted-file parity
are covered by the application fixture.

Immutable `c585dacf5` and the candidate pass the same two application cases: legacy file/native
credential status, cancel, durable logout/relaunch and Copilot commitment/stale-configuration
handling. The integrated candidate passes **17 cases across eleven files**, retaining the prior
plugin/maintenance/MCP/desktop/font/file/image/Remote/OCR cases. App and changed-test types, normal
full build, format/check, lint and i18n pass. No process/resource or performance comparison is
selected. Evidence and artifact hashes are in `.deepchat/rutis-g4-account-auth-acceptance/`.

### Native deep-link observations

Native actions require only an asynchronous provider-existence result. Core performs that lookup
under running-database admission and returns a boolean; Provider settings and saved credentials
stay at their business owner. Provider preview validation awaits this result before opening
settings. Incoming credentials remain preview data until the existing user confirmation.

MCP preview deferral observes successful Core startup in Main. The native adapter starts unready,
retains the latest pending URL, and consumes it once when readiness is observed. Repeated positive
observations do not replay it. Shutdown clears readiness, and a completed startup cannot publish
a positive observation after stopping or maintenance admission closes. This UI observation grants
no configuration or execution authority. Native actions receive no MCP business-service object.

All **38 selected checks across two files pass**, including delayed negative provider lookup,
latest-pending behavior and composition. Matching application cases pass on immutable `7009bb955`
and the candidate: pending-preview replay and an actual OS open-url event for an existing Provider,
with settings presentation and saved credentials preserved. The candidate additionally passes MCP
child lifecycle and all five maintenance/shutdown cases: **eight cases across four files**. The
OS fixture observes the window opened by the link, preserving its provider navigation.

App and changed-test types, normal build, format/check, lint and i18n pass. Evidence and verified
hashes are in `.deepchat/rutis-g4-deeplink-owner-acceptance/`. No performance/resource capture or
process change is selected. The shared writer and Harness have not moved.

### Resolved proxy and final G4 batch

Each existing three-registry probe batch awaits Main's current resolved proxy URL. Keep the native
system/custom resolution, authentication, cache/custom-registry short circuits and network failure
behavior. A failed host query propagates before any HTTP probe or registry-cache mutation. There
is no new proxy resolver, process, transport, cache or configuration writer. The focused MCP/native
proxy/composition suite passes **86 checks across four files**; the delayed-reply regression also
covers authenticated proxy options, a later direct selection and rejected host observation.

The final inventory covers all **34 direct SettingsStore consumers**: 31 owner-local Core
configuration/command modules and three explicit bootstrap/composition entrypoints. Those Core
constructors are included in the **83-entry, 831-input** source audit rather than inferred from
type-only consumers. All 63 direct native-import files retain explicit Main/device roles. The RFC
records physical file owners as well as connections, including complete settings files, plugin
safety/policy, credentials, native wrapped keys, derived caches, bootstrap migration and offline
data reset. This establishes G4's handoff inventory, not actual G5 process or writer ownership.

Final regression protection passes **807 distinct checks across 68 files**: 781 checks in 67 files
under Electron with native SQLite required, plus 26 child-script Hook checks under ordinary Node.
The Hook fixture uses process.execPath as its Node command; its seven failures under Electron are
retained in the initial log. Running that file with its intended Node runtime passes all 26 checks
without changing production code, test deadlines or assertions. Normal generated Provider catalog
checks contribute 44 of the 807 checks and the generated refresh remains a separate commit.

The final default application passes **19 cases across 13 files**, covering plugin installation,
Hooks and native windows, account/Copilot authorization, maintenance and credential drains, MCP
child lifetime, desktop/font/file/image effects, configuration projection, Remote authorization,
OCR key/cache relaunch and OS deep links. Each owner retains its matching immutable application
comparison; the MCP proxy boundary reuses the verified b16d31799 baseline runtime case. No fresh
19-case baseline or performance result is claimed. App/changed-test types, normal full build,
format/check including Markdown, lint and i18n pass. Source hashes, artifact hashes and receipts
are in `.deepchat/rutis-g4-final-inventory/`; focused proxy receipts are in
`.deepchat/rutis-g4-proxy-port-acceptance/`.

The complete batch is published at `356143755`. All 14 exact-head checks pass: required run
`40819020114` with `pr-required` barrier `123268789463`, and package run `40819020203` with all
six platform jobs and `package-required` barrier `123273186534`. The PR remains draft against
`dev` and is not merged. CI receipts are in the final inventory's `published-ci.json`. No timing
rerun was needed. G4 is complete; shared/configuration authority still moves physically in G5.

## G5. Move the cohesive Harness and shared core into the TS backend

Execution order: collect settings/security/database migration and recovery into the native-free
profile composition, then move the business composition with its existing owner-local repositories.
Connect that actual composition through the approved Rutis Core generation, replace Main's writer
and route/lifecycle wiring, then validate the complete cutover before publication. Main supplies
crypto, unlock/recovery presentation and native effects; it must retain no writable shadow.
Local bootstrap refactoring is preparation inside this goal, not a completed backend extraction.
Keep the full completion conditions below. Do not publish a partial G5 or add a fallback switch.

### Profile startup composition

The default desktop startup calls `initializeCoreProfile` for settings, private credential access,
encryption metadata, database recovery, attached adapters, legacy migration and tool-policy storage.
These constructors have no Electron dependency. Main supplies absolute roots/version, crypto,
logging, progress, unlock/recovery presentation and an acknowledged quit command. The database
initializer requires its explicit path. Legacy readers use the same pinned Conf engine with the
existing names, defaults, profile directory and application version. Migration still finishes before
adapters attach; an initialization failure closes its acquired database at the startup owner.

All **80 selected checks across seven files pass**, including delayed native quit acknowledgement,
schema recovery, migration, file settings and database security. Changed-test types and app types
pass. The actual profile/database graph constructs under the Electron Node ABI with native imports
blocked at build and load; persistence/reopen and database close after a failed legacy migration
pass. This is constructor/runtime compatibility, not a headless or exclusive-writer handoff.

Immutable `356143755` and the candidate pass the same four application cases: encryption/rekey,
legacy Provider model data, MCP/ACP settings and mixed legacy/database settings across relaunch.
The candidate additionally passes plugin install/Hooks/windows, credential persistence, all five
maintenance/shutdown cases, MCP child lifetime and OS deep links: **15 cases across nine files**.
Those additional cases retain their accepted `356143755` evidence; no new 15-case baseline is
claimed. Build, format/check, lint and i18n pass. Evidence and hashes are in
`.deepchat/rutis-g5-profile-bootstrap-acceptance/`. No process or transport change needs a resource
recapture at this preparation step. Main still invokes the local entry and holds its objects until
the complete Rutis Core composition and actual writer/route/lifecycle cutover below.

- [x] Move the actual Harness composition and its Run/loop/interaction/pending-input feedback
      cluster together. Keep Provider streaming and prompt/tool integration local initially.
- [x] Move the shared database facades, Session/Tape projection/recovery, configuration authority
      and scheduler claim transactions with their business owners. Fence/drain old ownership
      before opening the backend writer; remove main's writable shadow access.
- [x] Retarget existing renderer/CLI domain handlers without changing public behavior. Keep
      authenticated ingress and native capability presentation in the desktop adapter.
- [x] Compare real streaming, delegation, pending-input settlement, approvals, cancel/resume,
      restart recovery, backup/rekey/import and shutdown. Validate lost replies, stale callbacks,
      runtime loss and all supported native/package targets before distribution.
- [x] Review resource deltas and whole-change contracts; retain only durable regression coverage,
      run required checks and remove replaced main composition/lifecycle paths after parity.

Completion: one backend owns active/durable business state, Electron main remains responsive under
the agreed workload, and ownership loss cannot create two profile owners or duplicate execution.

The default application opens its profile through `CoreConnection.openProfile`, then assembles and
starts the actual SDK Kernel before exposing business readiness. Core owns the shared writer,
Harness, Provider, Memory, MCP, Session/Tape and scheduler composition. Main retains authenticated
ingress, read-only configuration projections and fixed Native effects; it constructs no writable
business shadow. Core retirement drains the Kernel, Browser, helpers, desktop effects, configuration,
Memory, admission and accepted callbacks before releasing profile ownership. Failed retirement
retains that ownership until physical process exit. The implementation items above are complete;
whole-goal acceptance is recorded below. Signed distribution remains release-gated.

### Profile ownership and retirement

The default profile entry acquires `.core-owner.lock` through an independent SQLite exclusive
transaction before any settings/crypto/recovery work. A pending startup and primary-database
maintenance retain that handle. Competing initialization fails before configuration or native
effects. No PID file, timeout takeover or live-lock deletion is used. The lock is outside `app_db`
and the named Sync backup/import entries, so maintenance never transfers its authority.

`closeProfile` retires security/credential generations, closes the primary database and then
releases ownership. A primary-close failure keeps the lock. Actual final teardown calls this
critical barrier directly after request drain; it cannot be swallowed as best-effort cleanup.
Startup failure uses the same close path. Main's failed-start cleanup also closes the whole owner.

All **95 checks across nine affected files pass under ordinary Node with native SQLite required**.
Five durable native cases cover pending startup, unchanged losing-owner configuration, maintenance
close/reopen, failed close, failed initialization, delayed credentials and real process death before
reacquisition. CI includes this native file in its required Store/Tape command. The native test
selector's return type includes Vitest's skip API; runtime selection and strict failure behavior
remain unchanged. Selected test types and the 82-file Memory type gate pass.

The real profile/SQLite probe also runs under ordinary Node with Electron imports forbidden,
preserving persistence/reopen and failure cleanup. The candidate passes the same eight application
cases already accepted on immutable `83e799258`: encryption, all five maintenance/shutdown cases,
MCP child lifetime and file/database settings across relaunch. App types, normal build,
format/check including Markdown, lint and i18n pass. Evidence and hashes are in
`.deepchat/rutis-g5-profile-ownership-acceptance/`. This preparation adds no runtime/process or
performance claim; full Rutis composition, authenticated ports and writer/route/lifecycle cutover
are still required before G5 publication.

### Route execution and native ingress

The default application registers renderer IPC through `app/routeIpc.ts`. It authenticates the
native document before invoking the business dispatcher and builds caller identity from the native
sender. The dispatcher and app/ACP/MCP business route factories have no Electron runtime dependency.
App debug routes receive explicit packaged-build identity. Public routes, preload contracts and
structured values are unchanged; no JSON conversion or caller-supplied authority is introduced.

Main-window/settings-window checks are acknowledged async queries. MCP authentication, credential
changes and app access await them before effects. Startup classification also awaits its query and
rechecks database admission before executing or scheduling work, preserving maintenance/shutdown
fences while a native answer is pending. Native registration consumes an invoke function, not the
business registry or database objects.

All **133 checks across six affected files pass**, including delayed allow/deny, trusted caller
derivation and maintenance during a pending native query. Selected test types, app types, full
build, format/check including Markdown, lint and i18n pass. A real profile plus app-route dispatch
runs under ordinary Node with native SQLite and
Electron imports forbidden: 225 source files plus its one probe entry. This proves that route
boundary, not the complete Core process or a headless Session Host. The immutable `11eb02a87`
baseline and candidate each pass the same five app cases for native IPC, ACP questions, MCP
credentials, MCP Apps and persistent settings. Evidence and artifact/source hashes are recorded in
`.deepchat/rutis-g5-route-owner-acceptance/`. Main still owns the business composition and writer;
the full Rutis cutover remains required before publication. No performance recapture is selected.

### Core execution composition

The default application calls `src/harness/core/execution.ts` to construct the Harness, ACP Runtime,
AgentManager, Session projection/turn/assignment/deletion/lifecycle, CLI Runs, export/translation and
delegation feedback together. Main no longer constructs those owners inline. Native renderer
lifetime and browser teardown are supplied callbacks; native tabs and the floating presenter stay
in Main. The existing Harness/Session/Tape ports and synchronous local transactions are preserved.

Interaction continuation, task-contract preparation, deletion safety and delegation summaries share
the factory's current delegation instance. Maintenance rebuilds it through the same factory and
updates that instance before resuming work. Live table resolution still follows database reopen.
The ownership guard also scans this Core directory, with no relaxed ownership rule or baseline.

The affected Session/Harness/CLI/delegation suites pass **653 checks across 12 files**; all nine
ownership-guard checks pass separately. App types, normal full build, format/check including
Markdown, lint and i18n pass. The Core execution graph builds and imports under ordinary Node with
Electron/electron-store/font-list/electron-toolkit imports forbidden: 420
source files plus the probe entry. This is an import-boundary check; actual factory construction
and execution use the real application comparison below, not a claimed headless backend.

Immutable `34fad0512` and the candidate pass the same nine application cases: streaming, ACP question continuation,
delegation queue/cancel/release, manual/timed scheduler settlement, import/repair/credential drains
and both shutdown drains. Evidence, source and runtime hashes are in
`.deepchat/rutis-g5-execution-owner-acceptance/`. Core still executes in Main and receives local
Provider/Tool/Memory/Store owners from the remaining composition. Moving those owners, authenticated
transport, the shared writer and actual process lifecycle remain required for G5 publication.

### Core data composition

The default application calls `src/harness/core/data.ts` to assemble Provider settings, Session/Tape,
Memory tables, Agent/Project/scheduler data, delegation contracts, lifecycle gates, prompt settings,
legacy import and usage statistics. It reuses the initialized profile connection and attached
adapters. Main's inline constructors are removed. Tape head delivery and renderer lifetime are
supplied callbacks; business data instances remain local composition dependencies, not an RPC
schema. Migration table getters and the Session-to-CLI Run resolver keep their existing behavior.

The relevant database, Agent, configuration, prompt, contract, watcher, migration and usage suites
pass **80 checks across ten files**, with native SQLite required. Existing composition assertions
follow the actual data owner. The real profile/data graph also constructs under ordinary Node with
Electron/electron-store/font-list/electron-toolkit imports forbidden: 233 source files plus its
probe entry. Actual checks preserve profile exclusivity, read/write after primary-database reopen
and prompt persistence after profile reopen. This constructs the data graph, not a complete
headless Session Host or a relocated Core process.

Immutable `deb35ba5b` and the candidate pass the same ten application cases covering delegation, encryption/rekey,
maintenance/shutdown, Provider facts and overrides, MCP/ACP settings and mixed file/database settings.
Evidence, source and artifact hashes are in `.deepchat/rutis-g5-data-owner-acceptance/`. The shared
writer still opens in Main; remaining business composition, Rutis transport and process lifecycle
must cut over before G5 publication. App and changed-test types, normal build, format/check including
Markdown, lint and i18n pass. The normal generated Provider catalog refresh is retained separately;
its 44 checks pass and both catalog hashes are recorded with the application artifacts. No
process/IPC change selects a performance recapture here.

### Core Provider and ACP composition

The default application calls `src/harness/core/providers.ts` for Codex/Grok controllers and their
credential stores, Agent settings, ACP catalog/auth/runtime/persistence, Provider execution and
catalog updates. Adjacent CLI compute/transcription, Agent defaults and command-shell construction
share this composition. These factories remain parts of one Core capability, not separate plugins.
Main retains the OAuth facade with current-target Copilot commands and secret-free account
commands; browser, crypto, icon fetch and renderer lifetime/delivery remain supplied effects.

The existing relevant suites pass **237 checks across 15 files**, without adding repository tests.
The immutable `de5c2fb63` baseline and candidate pass the same **14 application cases across seven
files** covering streaming, ACP questions, credential persistence/logout, current/stale Copilot
targets, ACP registry/install/repair and maintenance/shutdown drains. The actual profile/data/
Provider/Agent/ACP/account/CLI-service graph also constructs under ordinary Node with Electron,
electron-store, font-list and electron-toolkit imports forbidden: 431 source files plus one entry.
It initializes Agent settings, reads account status and retires the owned services; private Native
effects are not invoked by construction. This does not establish a complete headless Session Host
or a relocated backend process.

Evidence and hashes are in `.deepchat/rutis-g5-provider-owner-acceptance/`. The normal ACP registry
refresh is retained separately. App types, normal build, format/check, lint and i18n pass. Developer
requirements now match package engines and declare Rust/Cargo; the three README sponsor sections
and all content before their dependency sections remain byte-identical. Core composition still
runs in Main. Remaining business owners, private Rutis transport, the shared writer and process
lifecycle must cut over before G5 publication; no new performance capture is selected here.

### Cohesive Core runtime composition

The default application constructs Project, file preparation, Sync/replica, Knowledge, MCP,
Skills, Tool, Plugin, Hooks, Memory, execution, Remote and Scheduler through
`src/harness/core/runtime.ts`. The runtime owns the shared Plugin/Skill initialization barriers,
Skill scan and their initialization drain. Tool callbacks resolve the current delegation instance
after database maintenance. Existing transactions, live table getters and shutdown ordering remain.

Main owns the Rust supervisor and injects admission/vector clients. Core composition does not
start a second Rust host. Workspace preview grants/protocols, open-application detection and the
native watcher host remain in Main; Skills receives the existing watcher interface. Browser,
renderer, crypto, helper spawning, proxy readiness and native notification effects remain explicit
dependencies. These local dependency objects are not a Core RPC contract. Main still owns the
profile writer, public ingress and application shutdown authority.

The affected existing suites pass **540 distinct checks across 18 files**, including 29 Provider
catalog checks for the normal generated refresh. No repository test is added. The existing
composition checks share one source reader and follow the actual owners. The actual profile,
Provider and runtime graph constructs under ordinary Node with native SQLite and a live Rust
supervisor: **907 source files**, with Electron/electron-store/font-list/electron-toolkit imports
forbidden. The injected native watcher/desktop effects are not invoked. The Skill scan worker's
actual built module-path artifact is recorded separately and is not executed by this constructor
probe. This is not a complete headless CLI run or a relocated Core process.

The first application batch passes 16 of 19 cases across 12 files; two native-close observations
and one prematurely closed startup fail. Business teardown reports completion in 0.1–0.3 seconds
where those failed-close logs are available. The final candidate and immutable `f511c078b` each
pass the same four targeted workspace, plugin-window and maintenance/close cases across three
files, with unchanged assertions and deadlines. The initial failures remain recorded without a
causal or performance claim; the other first-batch cases are not relabeled as a fresh final-build
comparison. Full G5 acceptance must cover actual native close/reopen after the process cutover.

App types, normal full build, format/check, lint and i18n pass. The generated Provider catalog
refresh is retained separately. Evidence, source and artifact hashes are in
`.deepchat/rutis-g5-runtime-composition-acceptance/`. No performance/resource capture is repeated.
G5 remains active: remaining configuration/CLI/startup composition, business transport,
shared-writer transfer and Core/Native lifecycle cutover are required before publication.

### Private Core profile bootstrap

The Rust host can lazily mount a separate first-party Core Node worker through Rutis. Its private
bootstrap opens the actual profile and SQLite connection under the existing exclusive
ownership lease. Crypto and unlock/recovery presentation call Main through nine allowlisted Native
operations, bound to the actual Rutis caller and Core generation. Memory and Core reconcile through
one serialized layer owner so neither mount replaces admission or the other capability.

Control frames retain the 64-KiB limit. Four ordinary calls, one status slot, one stop slot and
sixteen Native calls have independent bounds; bulk Memory and admission acquisition reserve pipe
capacity for Core control and Native replies. V8 serialization preserves existing Node values.
Values above 16 KiB use authenticated generation-private encrypted carriers, bounded to 64 MiB
and four retained files per sender. Larger legal public results still need paging or transfer
adaptation before route cutover; this private link is not an Everywhere or CLI artifact protocol.

Stop awaits real initialization, Native effects and profile closure. Observation deadlines leave
missing outcomes unknown and do not free a call slot, retire the owner or permit replacement.
Failed primary close retains ownership. Core death retires its generation without automatically
adopting another one, and stale Core frames do not terminate admission. Cold profile/Kernel assembly
reports `businessReady: false`; acknowledged SDK Kernel activation reports readiness. The default
application still owns its profile and business routes in Main, does not start this lazy Core worker,
and has not transferred its writer or shutdown authority.

Acceptance passes **39 distinct checks across seven affected files** and **five Rust checks**.
Seven new durable checks in two files cover encrypted carrier fidelity/tampering/quotas, a standalone
artifact's actual child-held SQLite lease, simultaneous Memory/admission, pending Native startup,
lost stop replies, physical Core death, stale calls and no replacement. The existing failed-close
check also verifies the authoritative ownership receipt. The artifact resolves Node conditions and
ships its target native SQLite binding; no browser shim, new dependency or nested supervisor is
introduced.

Immutable `f511c078b` and the candidate each pass the same three application cases: streaming chat,
delegation admission and Memory eviction/model-change/worker-loss. This is a scoped default-path
regression comparison against the retained ancestor artifact, not a full Core business cutover.
App and changed-test types, normal build, format, i18n, lint and locked Rust format/clippy pass.
The existing Remote unsafe-finally warning remains. Normal generated Provider output is retained
separately. Evidence and source/artifact hashes are in
`.deepchat/rutis-g5-core-transport-acceptance/`. No performance/resource sampling is repeated and no
speed or memory saving is claimed. G5 stays active and unpublished until the actual default
composition, Native effects, public routes, writer and lifecycle handoff pass their acceptance.

### Configuration business and Native projection receipts

The default application and actual Core worker compose settings through
`src/harness/core/settings.ts`. Configuration owns desktop preferences, fonts, logging, OCR
preferences, Skill/trace settings, update channel, Agent defaults and command-shell preferences.
Main's inline constructors are removed. Provider composition no longer owns defaults or the
command shell; the cohesive runtime receives those existing instances from configuration.
Native theme/login/window/font/logging effects remain supplied ports with no writable shadow.

The private Core configuration command supports validated settings reads/updates, its allowlisted
Native snapshot and desktop initialization. Mutations use the actual child-owned profile connection
and existing settings service. Thirteen fixed Native configuration operations validate their
inputs; ordinary settings observations cross as a batch of at most 64 existing event envelopes.
This uses the same Core generation, four-call admission limit and encrypted carrier transport,
without an additional plugin, process, dependency or generic store/property RPC.

Configuration mutations now await the Native projection receipt before ordinary event publication
and caller acknowledgement. The owner queue retains that work through stop. A failed receipt
does not undo a durable write or authorize automatic mutation replay. Core stop fences queued
commands, drains active configuration and Native effects, then closes the actual profile lease.
The post-decode lifecycle check also fences work admitted before stop but not yet executed.

Acceptance passes **214 distinct checks across 15 affected files**, including five actual Core
integration checks and 13 generated ACP registry checks. Two durable checks are added within
existing files for delayed projection receipts and child-held ownership during shutdown. The
standalone Core case additionally executes desktop initialization, configuration read/update,
Native publication and persisted values after profile reopen. Existing public route, configuration,
logging, fonts/projection, defaults, shell, OCR and composition suites remain in use.

Immutable `f511c078b` and the candidate each pass the same five application cases for revision
ordering, legacy configuration persistence, desktop appearance/login observations, font/logging
restart and acknowledged Native projection/floating bounds. This is an ancestor-artifact
regression comparison; it is not a full Core business cutover. App and changed-test types, normal
build and refreshed affected artifacts, format/check, i18n, lint and locked Rust format/clippy pass.
Normal generated ACP output is retained separately. Evidence and source/artifact/resource hashes
are in `.deepchat/rutis-g5-configuration-acceptance/`; no performance sampling or gain is claimed.
G5 remains active and unpublished: the default profile writer, public routes and shutdown authority
still execute in Main. The actual cohesive runtime, CLI/startup/Toolchain composition, Native
effect/proxy/descendant authority and complete lifecycle handoff must pass before publication.

### Shared Core admission and lost-operation settlement

The actual Core worker obtains admission from the existing Rust/Rutis host through its SDK
connection. It reuses `RutisAgentInvocationAdmission` with a narrow transport, actual host limits
and existing lease/cancellation/error behavior. No second host, queue owner, Electron relay or
payload file carrier is introduced. Main and the one Core generation have separate bounded
command sequences while sharing the existing TS capacity, owner fairness and permit accounting.
This is a transport/ownership boundary; it does not implement the planned Rust control owner.

The Rust host authenticates the Core row/key and generation, allows only existing admission
methods and reserves sixteen of the 1,024 call slots for control work. Overflow fences Core
authority and new execution rather than continuing across an uncertain sequence. Core closes
admission before releasing its profile. Core loss closes the global quota and rejects queued work;
unknown active permits remain fenced until the supervisor retires. The control path remains
observable, without authorizing replacement or claiming pending Native effects have finished.
Explicit observation flags support the supervisor's observer without duplicate local callbacks;
internal retirement retains the current flag. Default desktop process placement is unchanged.

An actual in-flight Core-loss check exposes a transport reply that can precede the runtime-loss
notification. The Main client now treats that reply as an unknown posted-operation outcome and
fences the connection. It does not return a generic definite failure that could invite replay.

Acceptance passes **99 distinct checks across six files** and **five Rust checks**. Two durable
checks and one SDK contract fixture cover the real host/Core link: shared Main/Core capacity,
independent ordering, cancelled acquisition, generation rejection, diagnostic closure, actual
Core death while holding a permit and Native effect, queued-work rejection and unknown outcome.
The fixture is a bounded service contract workload, not a complete Harness execution. Existing
Core profile/configuration/Memory coexistence, admission and delegation checks remain in use.

Immutable `f511c078b` and the candidate pass the same three application cases for streaming chat,
delegation admission and Memory eviction/model-change/worker-loss. App and new-test types, normal
build and final affected artifacts, format/check, i18n, lint and locked Rust format/clippy pass.
No generated catalogs change. Evidence and source/artifact/resource hashes are in
`.deepchat/rutis-g5-core-admission-acceptance/`; no performance sampling or speed claim is made.
G5 remains active and unpublished. The actual cohesive Kernel, remaining
CLI/Toolchain/startup composition, public routes, Native effects/proxy/descendant authority and
default writer/lifecycle transfer still require their full acceptance before publication.

### Core Memory transport and native ownership

The private Core worker composes a lazy `RutisMemoryVectorStores` client using the same Rust
bootstrap, bounded upload gateway and native Memory worker as Main. Core calls the existing host
directly through authenticated SDK methods; vectors use SDK bytes and do not traverse Main or
encrypted payload carriers. This is not a zero-copy claim or the complete G6 Memory extraction.
Main or Core may own one Memory generation. A second owner is rejected, and Core retirement
preserves a Main-owned worker. Existing request, control, upload and native-part limits remain.

Core drains stores and asks Rust to fence startup and confirm native child exit before releasing
its profile. Accepted startup remains owned until settlement; expiry cannot authorize takeover.
The host also retires Core-owned Memory after physical Core loss. Native loss makes the Core
client unavailable without replay or restart while leaving the Rust control path responsive.
Bootstrap includes explicit application/package paths, with no Electron import in the Core port.
Absent binary metadata fields are omitted before SDK encoding because `undefined` crosses as null.

Acceptance passes **33 distinct checks across six files** and **six Rust checks**. Four durable
SDK/native cases and one fixture cover shared ownership in both directions, lazy worker reuse,
packed upload/list/delete fidelity, confirmed stop before native database reopen, physical Core
loss and physical Memory loss. One Rust contract covers startup retirement and late-start fencing.
Existing profile/configuration/admission and native vector regressions remain in use. Initial
fixture validation failures and the actual absent-field transport failure are retained in logs;
the final checks pass without increasing timeouts or weakening production limits.

The final application passes the Memory eviction/model-change/worker-loss case. Its scenario is
byte-identical to immutable `f511c078b`, whose verified matching baseline and artifact hashes are
reused from the admission acceptance receipt. Main output is byte-identical to `9eea00f56`; the
affected Rust/Core artifacts are rebuilt. No unchanged baseline or performance matrix is repeated.
App and new-test types, normal build, format/check, lint, i18n, Memory test scope and locked Rust
format/clippy pass. Normal generated Provider output is retained separately. Evidence and hashes
are in `.deepchat/rutis-g5-core-memory-acceptance/`.

Default Kernel, public routes, business writer and application lifecycle still execute in Main.
Full Core runtime/startup/CLI/Toolchain composition, Native proxy/descendant/effect authority,
stalled-startup shutdown and signed/all-platform lifecycle need acceptance before G5 publication.
G5 remains active and unpublished; G6-G12 retain their scope and dependency order.

### Local control, Toolchain and startup composition

The existing Core runtime now constructs the CLI server, request policy, shared approval broker,
command/file/settings permissions, programmatic dispatch and parent registry, audit and launcher.
Run/compute/audio/OCR/Skill dispatch uses its local services and the same database gate, Agent
token authority and artifact spool. Default Main wiring uses these objects and removes its inline
constructors. Trusted approval-target discovery and window request/close delivery remain native.
No additional plugin, process, abstraction, dependency or implementation switch is introduced.

Toolchain discovery/demand, OCR runtime and attachment routing also compose with their consumers.
Main supplies the existing native OCR cache-key provider. Core organizes ACP/Skill startup
migrations, deferred MCP/Remote/Skill initialization, Provider warmup, legacy import, usage and
normalization backfill, capability cleanup and Toolchain GC. Existing task IDs and scheduling
semantics remain; maintenance supplies its new run ID, and failure delivery retains that actual
run identity. Main awaits migration completion before initial window admission and retains its
native floating-window effect and structured logging adapter.

Acceptance passes **398 distinct checks across 20 affected files**, without new unit tests.
A disposable constructor check blocks Electron/native desktop imports at bundle and load time:
the graph of **915 source files** constructs the real SQLite-backed Core services, Rust
supervisor and local CLI listener under Node, then closes them. It establishes portability and composition,
not a complete Rutis Core execution or the headless CLI horizon.

Immutable `f511c078b` and the candidate each pass the **same ten distinct application scenarios
across six files**: streaming, delegation, five maintenance/shutdown cases, Agent tools, OCR
native-key/cache persistence and CLI security approval/persistence. One durable application case
uses the built CLI and actual app to reject and approve a logging-security change, verify its
effect and reopen the profile. The initial batch passes the other nine cases on both artifacts;
its new CLI assertion uses the wrong denial code. The corrected assertion matches the documented
`approval_denied` contract and that case passes on both unchanged artifacts. Those initial results
remain recorded; only the corrected case is repeated, with no deadline increase or timing gate.

App and new-test types, normal build, format/check, lint and i18n pass. Normal generated catalog
refreshes remain separate. Evidence and source/artifact hashes are under
`.deepchat/rutis-g5-core-control-acceptance/`. Default process placement is unchanged, so no
performance/resource capture is selected and no speed claim is made.

G5 remains active and unpublished. The actual worker supports profile/configuration, cohesive
Kernel activation and bounded business ingress. Complete production Native callback/event
binding, descendant/proxy authority, default public route and lifecycle/maintenance adoption,
default writer handoff and supported signed/native package acceptance remain required. All
remaining goals keep their scope and dependency order.

### Native settings navigation and theme observations

Agent settings navigation now awaits the typed Native delivery receipt, returning `open_failed`
on a negative or failed receipt. The unused generic window-channel capability is removed from
the Agent port and its callers. The actual Core worker accepts one coalesced system-theme
observation independently of its four work slots and two status/stop slots. One work slot is reserved
for audited business control routes. It queries Native
state through the existing configuration capability and uses the same configuration/event queue.
Notifications during an active observation trigger a fresh query after its acknowledgement;
stop fences new observations and drains accepted Native effects before releasing profile ownership.

Acceptance passes **160 distinct checks across 11 affected files**, including six actual Core
integration checks, plus six Rust tests and locked clippy. Durable coverage verifies navigation
acknowledgement/failure, observation coalescing, saturated ordinary calls and profile ownership
until actual Native completion. App/scoped test types, normal build, format/check, lint and i18n
pass. Normal generated catalogs remain separate.

Immutable `f511c078b` and the candidate each pass the same three application scenarios: Agent
image/workspace access and actual MCP settings navigation with reopen, desktop theme/login
observations, and CLI security approval/persistence. The initial Agent assertion used the wrong
window path; correcting it to the existing `#/mcp` route requires repeating only that scenario.
Initial results are retained. Evidence is `.deepchat/rutis-g5-kernel-native-acceptance/`.

Default process placement is unchanged, so no performance/resource capture is selected. Completed
acceptance copies, disposable profiles and media are pruned; compact evidence and the one needed
immutable baseline remain. G5 stays active and unpublished. The complete Kernel, writer, routes
and application lifecycle still require default Core adoption and acceptance.

### Workspace watcher ownership

- [x] Compose Workspace and its existing pooled watcher clients in Core, with required typed
      helper launch supplied by Main; remove implicit Electron startup/path discovery from clients.
- [x] Fence pending startup, retired events and restart work during terminal shutdown; await actual
      helper exit. Validate existing workspace/Skill consumers and matching application file/Git
      events, then prune disposable acceptance artifacts. Default process placement is unchanged;
      no performance capture or speed claim is selected for this boundary extraction.

The default Main composition obtains Workspace and its pooled watcher clients from the existing
Core runtime. Main supplies an absolute helper entry and a plain cancelable command/event/lifecycle
port. Implicit Electron imports and helper path discovery are removed from the client. Canceled
startup and terminal shutdown await actual process exit; stale-host callbacks cannot mutate a new
generation. Pool teardown drains both helpers before reporting either failure.

Workspace's four native file-open operations are acknowledged ports. Preview authorization stays
with the same business owner; scheme registration and response streams stay in Main. The protocol
queries the owner's asynchronous resolver and denies unavailable authorization. Shutdown fences new
work, waits for accepted desktop operations and revokes preview roots/exact files. File preparation
rechecks authorization after its await, preventing a late preview from restoring revoked access.

Acceptance passes **235 checks across 12 affected files**, including eight durable additions for
helper startup/exit/restart, aggregate shutdown, desktop-effect drain and preview revocation.
Existing Workspace, installed-app launch, Skill, migration and composition coverage remains in use.
The obsolete concatenated source-order assertion is reduced to the actual Core startup admission
barrier. Two fixture types are corrected without weakening their contracts. New-test types, app
Node/web types, normal build, format/check, lint and i18n pass. The build-generated Provider catalog
remains separate. Initial failing fixture/guard logs are retained.

Startup and desktop work register ownership before invoking Native effects. Synchronous shutdown
during fork cannot escape the drain, and queued effects cannot start after stop. The same accepted
contract selection and five candidate app cases pass after this lifecycle correction; the unchanged
baseline is reused.

Immutable `f511c078b` and the candidate each pass the same **five application cases**: Workspace
read/search/Git routes, actual file/Git watcher invalidations with graceful shutdown, HTML module
preview isolation, preload navigation isolation and unauthorized-document IPC rejection. No new
application case is added; the watcher case now requires graceful close. A Node import probe
blocks Electron/native desktop dependencies across 928 source files; it proves module portability,
not actual complete Kernel execution. Evidence is `.deepchat/rutis-g5-workspace-acceptance/`.

No new plugin, process, dependency or fallback is introduced. Disposable probe bundles are removed;
compact receipts, raw outcomes and the one needed baseline remain. G5 is active and unpublished:
actual SDK Kernel assembly, callback/event transport, default routes/writer/lifecycle adoption and
native package acceptance remain required before publication. G6-G12 retain their full scope.

### Native helper command and event transport

- [x] Implement fixed helper commands, Core proxies, a Native owner and the reserved event lane
      in the Core link. Retain Main launch/RSS ownership and existing helper protocols;
      preserve cancellation, callback ordering and actual process retirement with bounded queues.
- [x] Use these ports in actual SDK Kernel assembly and validate lifecycle, saturated ordinary
      calls, payload bounds and matching application behavior. Full G5 writer/routes/lifecycle
      adoption remains required; transport tests and constructors do not establish completion.

The actual Core worker owns its helper proxy and event endpoint. Main's helper owner accepts only
five approved kinds, validated protocol messages and owned-host RSS requests. Startup admission is
separate from the opened/failed event. Cancellation can retire pending startup; an uncancelable
late host is compensated. Native Exec retirement awaits the owned host's asynchronous kill
receipt, which covers actual exit and profile-scoped registered-command recovery. The former
arbitrary-PID recovery callback is removed. Unexpected exit stays owned until recovery settles;
the execution service waits for that same receipt before replacement startup or shutdown.
Complete descendant/fd authority still requires acceptance during Kernel adoption.

Native calls retain their sixteen-call bound with two retirement slots; ordinary work has a
64-request/64-MiB waiting bound. Queued values are snapshots and stop rejects queued ordinary work.
Helper commands/events have bounded queues, data snapshots and ordered batches; concurrent kills
coalesce into groups of at most 32. Unknown identities, malformed events, overflow and uncertain
delivery fence the generation. Retirement remains possible after logical failure, and accepted
Native effects receive their terminal outcome after actual settlement. No automatic replay occurs.

Background execution, Scheduler and Code Mode native startup adapters now wait for actual exit
before rejecting canceled/failed startup. Their matching existing tests require this receipt;
an already exited process needs no repeated kill. Existing launch flags, Code Mode's restricted
environment/heap/library policy and Main-owned RSS sampling are preserved.

Acceptance passes **169 distinct TypeScript checks across 15 affected files** and all six locked
Rust checks. Eight durable additions cover helper protocols and ownership, batched retirement,
late startup and descendant recovery, held RSS, queue bounds, Native-call admission and the actual
SDK event lane under saturated ordinary calls. The SDK fault case retains profile ownership until
an accepted Native effect settles, then proves real stop and reopen. Native SQLite is required.

Immutable `f511c078b` and the candidate each pass the same **six application cases** across three
files: manual/timed Scheduler work and persistence, background execution and held-start shutdown,
and Code Mode execution and held-ready shutdown. This is default-application regression evidence;
SDK Kernel activation separately exercises the helper link with in-process Native owners. Main's
complete production helper factory and attested
Exec-recovery binding remain required at that adoption point.

Normal build, Node/web and affected-test types, format/check, lint, i18n, Rust fmt and Clippy pass.
Evidence is `.deepchat/rutis-g5-native-helper-acceptance/`; no performance capture or claim is made.
No new build/profile copies are retained. G5 stays active and unpublished until complete Kernel,
writer, public-route and lifecycle adoption with old-path removal and native/package acceptance.

### Native Browser dispatch and authorization transport

- [x] Implement fixed Browser commands and callback receipts in the Core SDK link. Preserve
      normalized dispatch commitment, cancellation, recoverable errors and native retirement;
      serialize Browser/helper callbacks through the existing reserved event slot.
- [x] Bind this Browser port and Main's physical-retirement capability into the default SDK
      Kernel, including user-opened pages when no Agent Browser tool was called.

Core keeps the actual authorization callback and returns a distinct denial outcome without
fencing a healthy generation. Main retains native Browser objects and normalizes target arguments.
Canceled late admission is compensated; unknown callbacks and repeated authorization are fenced.
Only promised commits introduce an asynchronous wait. Native navigation and CDP dispatch recheck
cancellation and target lifetime after that wait. Current synchronous commit timing is retained.
Main's required retirement receipt must cover effects that survive a canceled caller wait.

The helper and Browser sources share one bounded snapshot queue for the reserved event lane.
Browser cancellation/close reuse the two Native retirement slots. Recoverable Browser-unavailable
payloads and the original Core commit errors survive transport; no uncertain operation is replayed.

Every assembled Kernel retires Main's Browser owner before profile release. Agent-tool usage does
not determine ownership of pages created by public desktop routes. Profile-only Memory/Admission
SDK operations do not acquire the desktop owner. Main caches each page's close receipt, fences new
page/preview allocation during shutdown and awaits the actual WebContents `destroyed` event without
a before-unload veto. Physical close failures remain failed and retain ownership; all pages are
attempted. Destruction callbacks address the same state object, so a late event cannot erase a
replacement with the same Session identity. No new capability, process or transport is added.

Current verification passes **77 distinct TS checks across seven files**: 59 Browser presenter,
handler, caller and transport checks plus 18 actual SDK profile/Memory/Admission checks with native
SQLite required. Two small durable additions protect held physical destruction with a neighboring
close failure, and profile writer exclusion until the Native Browser receipt settles without Agent
Browser calls. The latter still passes after moving its setup under guaranteed fixture cleanup;
the targeted confirmation is not added to the distinct case count. Normal build, Node/web and
scoped test types, format, lint and i18n pass. Rust/Cargo and catalog hashes are unchanged; retain
their existing eight Rust/fmt/locked-Clippy and catalog evidence rather than rerunning those matrices.

The current app passes **seven distinct scenarios**: the new Browser retirement case and six
first-message Workspace/Browser, image, OAuth and CLI regressions. The Browser case holds response
headers, response-body reads and a WebSocket, verifies they are still live before retirement, and
exercises explicit page destruction, normal quit and Core-owner failure. Each path physically
closes the three requests and reopens the persisted Session with a fresh uninitialized Browser.
The foreground focus case remains pending an unlocked Mac and is excluded from this selection.

The same immutable f511 fixture passes explicit destruction and graceful quit, with physical network
closure receipts. It fails at line 232 in the Core-failure phase: refused Native renderer registration
leaves the process alive under the unchanged 30-second observation deadline. Later failure-phase
network closure/reopen assertions do not execute. The result is 0/1 complete cases, not proof that
the baseline cannot close ordinary Browser requests. The real SDK receipt case separately proves
profile exclusion for the migrated ownership boundary. Current/frozen trees, fixture and external
dependency hashes are restored and verified in `browser-retirement-comparison.json` under
`.deepchat/rutis-g5-kernel-assembly-acceptance/`.

No new resource capture or performance claim is selected: the existing shutdown receipt changes
no process placement, transport or hot-path batch. Shared-CI timing remains report-only. Compact
raw reports and the one required immutable baseline remain; completed media and temporary configs
are pruned. G5 remains active/unpublished. Other Native/concurrent faults, lost ancestry/privilege changes, unlocked foreground and supported
signed/platform acceptance remain separate work before whole-G5 review, publication and exact-head
CI. G6-G12 remain unstarted.

The browser download manager, its unused presenter method/type and obsolete preferred-page selector
are removed. No typed route or Agent tool called them; their constructor installed a default-session
listener that could never match an admitted download. Browser-origin downloads retain their existing
Chromium/Main application ownership. Upgrade and image downloads are separate active capabilities.

Active Native views use one small `closeWebContents` implementation. Browser pages join it through
their existing owner; the temporary cookie-inspection view joins it in `finally`, including a
failed debugger detach. Application windows and floating UI belong to their Main application owners.
The old Tab presenter has no view-creation callers; its floating-window registration is a borrowed
capture/context lookup. It is not a second Native view owner or an additional Core teardown gate.
Its existing source and the Main composition retain their accepted hashes.

The cleanup passes 75 existing/new checks across five Browser/import/composition files. Two compact
cases protect temporary-view closure for successful reads and failed debugger detachment. The
import fixture models Electron's documented empty defaults for omitted cookie names/values;
scoped test types include this fixture. Normal build, Node/web types, lint/i18n and formatting pass.
The current application passes seven Browser, MCP/private account, image and Copilot cases. The
same Browser fixture and frozen artifact/dependency hashes reuse the accepted baseline report;
no unchanged baseline rerun or new resource capture is selected. Core and Rust artifacts are
byte-identical to the preceding Browser receipt. The normal ACP registry agent refresh is retained
and passes 16 registry/migration checks; Provider catalog hashes are unchanged. The retained
Browser baseline exercises an OpenAI Session and no ACP Agent operation, so its scope establishes
page/request retirement rather than refreshed ACP catalog parity.

### Cohesive Kernel root

- [x] Compose the existing data, Provider and runtime factories with one event hub, session event
      router, CLI token authority/artifact owner, startup coordinator and MCP Apps registry.
      Keep native presentation/helper ports explicit and maintenance/route controls owner-local.
- [x] Invoke this root in the actual SDK worker with the fixed Native desktop transport and
      standalone dependency closure; verify persistence and physical retirement before writer release.
- [x] Mount the owner-local route and maintenance controller. Reuse it in the default Main
      application; remove its inline route/maintenance construction and SDK placeholder errors.
- [x] Activate the actual SDK Kernel and route business requests through its local controller,
      with bounded queues, reserved control, Native caller revalidation and startup/shutdown fencing.
- [x] Adopt public ingress, shared writer and lifecycle in the default Core process. Whole-G5
      fault/resource/native/platform acceptance remains required before publication.

`createCoreKernel` owns the cohesive business graph and its terminal drain. The same settings
version source feeds configuration events; renderer-session ownership retains its `null` meaning.
Shutdown fences request admission before draining startup, services, helpers, Memory ingestion,
Providers and outstanding requests. Failure of a partially constructed owner requires physical
retirement; it cannot prove writer release. The profile owner still releases its lock only after
the caller has also drained the Native bridge and shared admission/Memory resources.

A native-free Node probe blocks Electron imports across **932 source files**. It runs real startup
migrations/Skill initialization, a CLI listener, detached-session creation/query/event delivery,
exclusive-writer rejection, terminal drain and persistent profile reopen using native SQLite and
the actual Rust supervisor. Native presentation is a controlled empty fixture, Skill watch launch
is unavailable, and no full route dispatcher is installed. This is composed-root evidence, not
successful SDK/default Kernel adoption, native-helper acceptance or headless CLI execution.

The probe exposed a real late write: login-shell PATH refresh recreated `toolchains/state.json`
after profile teardown. The runtime now fences that callback when stopping and drains its accepted
refresh. Concurrent environment reads share one shell; a timed-out shell is hard-stopped and its
promise settles only after actual process/stdio closure. Failed or invalidated results do not
replace the current cache. This keeps the existing timeout and platform fallback behavior.

The Sync token-storage guard now acknowledges an asynchronous Native check before wrapping a
token. Optional Computer Use preview eligibility can also await Native state while the completed
tool response remains independent; capture rechecks live policy and cancellation after the wait
and catalog validation. One existing preview test covers delayed eligibility and revocation;
one durable shell test covers shared startup and actual retirement after timeout.

Affected service checks retain **150 tests across four files**. The actual SDK acceptance passes
**26 checks across seven files**, including Kernel assembly from a harness copied outside the
checkout, configuration events through its general event hub, persisted settings and exclusive
writer ownership while Native retirement is held. Two desktop contracts cover reordered aborts,
released cancellation identities, shared renderer subscriptions and physical closure. The private
assembly phase keeps `businessReady: false`. Its local dispatcher and snapshot-import controller
are mounted; default cross-process ingress/startup adoption remains required.

The standalone build preserves Node package entry semantics, platform binaries, PDF assets and
dependency-specific versions. Its Skill scan entry runs successfully from a separate copied module
closure. Renderer client, Model store and Chat status-bar coverage passes **177 checks across three
files**, including one durable catalog-event regression. The existing MCP runtime application case
also passes. SDK assembly uses empty Native presentation and does not activate full startup or
default cross-process public ingress; these checks do not prove default adoption or headless CLI execution.
Evidence is `.deepchat/rutis-g5-kernel-assembly-acceptance/`. Complete default adoption,
helper/descendant and proxy authority, and native/signed packaging remain required. G5 is active
and unpublished; G6-G12 retain their full scope.

### Owner-local routes and database maintenance

The Kernel constructs one route dispatcher from its own data, settings, Provider and runtime
owners. The default application uses the same factory for its business routes and adds only its
native desktop/device/update/notification maps. Its inline business-route and maintenance bodies
are removed. Sync snapshot import now enters the local maintenance controller directly; no shared
database operation or mutable service callback is proxied through Main.

Maintenance retains admission fencing, backup exclusion, configuration/secret stop and drain,
session/ingestion shutdown, database checkpoint/import/rekey/repair, reopen and ordered service
recovery. Recreated delegation state stays at the execution owner's getter. Kernel stopping also
fences the SDK configuration ingress rather than leaving a writable configuration service alive.

Copilot credential-target selection, access validation and acknowledged commitment use the Core
OAuth facade. Native authorization presentation/token acquisition remains a typed Main capability;
its flows propagate cancellation and await owned-window, request and response-body retirement.
Complete production Core Native binding remains required before default adoption.
Plugin-window ownership checks await their Native query, while Main sender
authorization retains a synchronous registry and rejects promise/object results. Proxy mutations
await Native application and SDK dispatcher synchronization. The SDK preserves the existing
single-probe system policy, custom authentication and bypass rules; default-process adoption
still requires whole-goal acceptance.

Existing affected verification passes **65 Main checks across five files**, **26 SDK/Native
checks across seven files** and **13 request-gate checks**. The default application passes seven
real scenarios: encrypted legacy
unlock/rekey/disable, Provider credential compatibility/logout, incremental/overwrite restore,
concurrent-maintenance rejection, delayed Native credential drain and both pending-work shutdown
cases. Two durable cases fence an uncertain Native pause until failed-owner cleanup settles and
wait for both session backends even when one cleanup fails;
existing fixtures exercise asynchronous plugin ownership and reject malformed Native ownership
responses. Native pause/resume acknowledgement failures cannot leave ordinary requests admitted.
The accepted baseline evidence remains available;
no unchanged baseline or performance matrix is repeated. G5 stays active and unpublished until
complete default adoption, Native retirement/descendant/proxy authority and required packages pass.

### Core business ingress and activation

The private SDK link dispatches existing renderer route contracts to the Kernel's local registry.
It rejects CLI/internal identity injection, desktop-owned routes and incorrect control-lane use.
CLI and internal calls retain their business owner's existing local authorization. Main's Native
IPC entry supplies a revalidation closure for its original sender/document; the Core connection
uses it at admission and after carrier preparation before sending. The closure stays in Main.
Queued requests from a retired document fail without reaching the business owner.

The four existing work slots contain three ordinary slots and one audited cancellation/human-answer
slot. Status and stop retain their separate reserved slots. Waiting requests share a 64-entry,
64-MiB snapshot budget, and control pressure can reject unsent ordinary work explicitly. No accepted
operation is displaced or replayed. Startup accounting queries Native window roles only for its
tracked routes; approval and cancellation do not wait on unrelated window queries. Carrier limits
remain unchanged, and a legal 3-MiB request/result round trip retains the complete value.

`startKernel` activates migrations/Skills, Scheduler, Memory maintenance, local CLI/artifacts,
Sync and the existing deferred/background work. Optional service failures retain their existing
reporting behavior. Only completed activation reports `running`/`businessReady: true`; business
ingress rejects cold or stopping owners. Stop fences new work and drains activation, all accepted
route continuations and actual Native effects before releasing the shared profile lock.

Actual SDK verification uses a harness copied outside the checkout, native SQLite, and the existing
FileWatcher/Scheduler algorithms supplied as in-process Native fixtures. It exercises real Core
business handlers, full queue pressure, approval progress, stale-caller rejection, immutable queued
input, large data fidelity and persistence/reopen. One additional durable case holds an accepted
Native effect during activation, confirms status/stop progress and writer exclusion, then verifies
retirement without late CLI startup. These fixtures do not prove OS helper launch, external native
presentation, default Core adoption or the headless CLI horizon.

Validation passes **164 TypeScript checks across 12 files**, **six Rust checks**, Rust fmt/locked
Clippy, normal build, Node/web/affected-test types, format/check, lint and i18n. The existing Remote
unsafe-finally warning remains. Seven application cases across three files pass: first-message
Workspace/Browser behavior, five maintenance/shutdown scenarios and CLI security approval with
reopen. Accepted baseline evidence remains available. One durable activation-race case is added;
existing SDK routing and Native sender cases cover the remaining contracts. No new test file or
temporary application API is introduced. Evidence is
`.deepchat/rutis-g5-kernel-assembly-acceptance/`; completed media/profiles/bundles are pruned and the
one needed immutable baseline remains.

The default application still constructs its writer and runtime in Main. G5 remains active and
unpublished until complete production Native binding, default writer/routes/lifecycle handoff,
old-path removal, whole-goal acceptance and native/signed packages pass. No performance recapture
or speed claim accompanies this private ingress/startup work.

### Native Copilot authorization retirement

The default Main adapter creates one browser/device authorization operation per invocation. The
shared global device-flow instance and polling interval are removed. Each operation owns its
window, timers and HTTP work, propagates cancellation and waits for actual closure. Device polling
is serial, respects expiry and server slowdown, and cannot accept a token while an OAuth error is
present. The instruction page retains its layout and only opens the fixed GitHub URL or copies
its current code/link. Browser callbacks require the exact configured endpoint and nonce; callback
URLs and authorization codes are not logged.

Window-local navigation/script commands can lose their replies during destruction. The actual
closed event retires those frame-local effects; independent external-browser work still requires
its own acknowledgement. The shared bounded response reader coalesces and awaits underlying
stream cancellation before releasing its reader. Existing body limits and presentation/transport
deadlines remain unchanged.

The Core OAuth facade tracks accepted target reads, authorization, access validation and durable
credential commitment. Stop fences new work, aborts owned operations and waits for every accepted
login and sibling account/target retirement, including failure paths. It cannot acknowledge an
uncertain Native effect merely because another account stop failed. No new plugin, process,
dependency, persistent store or application debug route is introduced.

```text
BEFORE
Quit -> abort flag -> authorization may remain active

AFTER
Quit -> cancel request -> owned window closed + stream canceled -> owner drained
```

The same real-app acceptance scenario exercises credential commitment, stale-configuration
rejection, an open native authorization window during quit and persistence after reopen. The
immutable baseline requires forced exit with the pending window. Native unit contracts also hold
window closure, external browser acknowledgement and stream cancellation independently; a lost
frame reply is retired only by actual closure. Complete default Core writer/routes/lifecycle,
production helper/Browser bindings, descendant/proxy authority and native/signed packages remain
required. G5 remains active and unpublished.

Validation passes **122 TypeScript checks across ten files**: 108 Native/auth contracts, 11 SDK
ownership/desktop contracts and three renderer checks. Six durable Native cases extend the existing
file; private-method spies are replaced with real public flow behavior. Existing stop cases hold
accepted authorization, late headers and underlying stream cancellation through account failure.
The seven affected app scenarios pass: six credential/maintenance/shutdown cases and the current
Copilot case with its actual closed-window receipt, no post-stop token poll and persistent reopen.
The response-body/frame corrections retain the bounded failure contracts; no presentation deadline
or performance gate is increased. Normal/current builds, Node/web/affected-test types, format/check,
lint and i18n pass, with only the existing Remote warning. Rust is unchanged. Evidence is
`.deepchat/rutis-g5-kernel-assembly-acceptance/`; completed heavy artifacts are pruned while compact
receipts and the one needed baseline remain.

### G5 remote session window boundary

Remote `/open` uses Native selection, Core-owned activation and Native presentation. Main keeps
the focused-chat/first-chat/create-window behavior, checks shutdown and validates the current
window/renderer pair before showing it. The former `openRemoteSession(sessionId)` callback is
removed; no session identifier or business activation crosses into Main's window operations.
Desktop bindings own the existing renderer-destruction subscription, release it on unbind and
reject activation when registration observes destruction. A late lookup cannot clear a newer
session binding. No dependency, process, debug route, performance threshold or UI layout is added.

Validation passes **200 checks across six Main/SDK/session files**, including two new durable
renderer-lifetime cases in the existing file and extended Native result validation. Session test
fixtures match the current assignment and pending-queue contracts. One real application case
passes on both the immutable baseline and current build through public settings, pairing and
incoming Telegram commands: no-session rejection, existing-window activation, native destruction,
new-window creation, the same active session, independent settings-window binding and graceful
shutdown. Telegram HTTP is controlled by the test; no model request or external message is sent.
Normal build, Node/web/affected-test types, format/check, lint and i18n pass, with the existing
Remote warning only. Rust is unchanged and no performance matrix is repeated. Compact receipts
remain in `.deepchat/rutis-g5-kernel-assembly-acceptance/`; finished media are removed and the one
needed baseline is preserved. The default writer/routes/lifecycle still run in Main. Complete
Native/helper/Browser binding, descendant/proxy authority, default Core adoption and whole-goal
fault/native/signed package acceptance remain required; G5 stays active and unpublished.

### G5 desktop business route ownership

The existing Core settings map owns eleven language/theme/shortcut/floating-widget/update-channel
handlers. The Core Session map owns browser-focus and Computer Use preview admission, preserving
active-session/draft-owner checks and the inactive-preview stop exception. Main supplies three
fixed Native presentation methods, validates the current renderer/window pair and checks shutdown;
it does not read Session business state for these effects. Native desktop and upgrade maps hold
no AppSettings or Session owner. TabPresenter has no Session-binding dependency; renderer
destruction owns binding retirement. Existing desktop route names, processes and resource bounds
stay unchanged.

The floating widget consumes two typed Session routes and the existing ACP icon query through
the Core dispatcher. Its Native presenter has no AgentSettings, SessionQuery or Session-binding
dependency. Core filters and orders regular sessions and shares the existing desktop-session
activation operation with Remote. Main keeps geometry, appearance and expanded state; all widget
IPC reads/actions authenticate its exact owned top-level document. Ordinary renderer APIs remain
unavailable to that document. One in-flight snapshot read coalesces updates and rejects retired
window replies. Native initialization acknowledges creation/appearance without awaiting a Core
query; the window displays after its initial refresh, avoiding startup reentrancy.

Validation passes **144 checks across seven files**: 133 route/settings/SDK/Native checks plus eleven
window/binding checks. The actual standalone SDK exercises configuration writes/reads and preview
admission for owned drafts, active sessions, deactivation and cleanup. One durable Native identity
case extends the existing file; other coverage extends existing cases. Normal build including
Node/web types, affected-test types, format/check, lint and i18n pass with the existing Remote
warning only. Rust is unchanged. The real settings/shortcut/floating-widget persistence scenario
passes on the immutable baseline and current application. Foreground browser-focus acceptance is
pending an unlocked Mac: Native observation confirms a visible attached browser with a live
session while the OS reports the host window unfocused, and the desktop tool reports a locked
session. Both artifacts reject focus under that condition. The full foreground scenario and its
Native readiness check remain; no security guard or functional deadline is relaxed. Its receipt
is not counted as a pass. G5 remains active and unpublished, with default Core writer/routes/
lifecycle adoption, remaining production Native bindings and whole-goal acceptance still required.

Widget validation passes **129 checks across five existing files**, including actual standalone
SDK snapshot filtering, missing-session rejection, Core activation and the resulting binding. One
durable Native case verifies startup acknowledgement with a held Core read, no premature display,
replacement-window isolation and foreign-reader rejection. The latest Native/layout and SDK
selections pass fourteen and nine checks respectively. The same two real-app cases pass on both
the immutable baseline and current build: scoped widget IPC, snapshot/session opening/collapse,
plus settings/shortcut/floating-bounds persistence and reopen. Normal build, Node/web and affected
unit/E2E types, format/check, lint and i18n pass; Rust and generated catalogs are unchanged. No
benchmark matrix, timeout increase, new test file, dependency or process is introduced. Current
and baseline artifacts are restored and hash-verified after comparison; finished profiles and
bundles are pruned while the sole baseline and compact evidence remain.

### G5 MCP App protocol ownership

The Core runtime constructs the single MCP App registry used by its source/tool authorization
owners. Main's startup and protocol layer hold only two asynchronous policy/permission operations;
their registry construction, direct revocation and owner-subscription map are removed. Core owns
one renderer subscription while an owner has creations/views, cancels pending consent on retirement
and releases unused subscriptions. Maintenance clears the registry before database drain. Terminal
close also rejects new reservations, including a route admitted before shutdown that reaches view
creation later. Native owner validation and separate-origin protocol responses remain in Main.

The SDK exposes the same two operations through a fixed private, schema-validated protocol. They
share the existing bounded ordinary queue and business drain; Native owner destruction uses the
existing reserved event lane. Human answers/cancellation and status/stop keep their reserved slots.
No public route, process, dependency, queue limit or functional deadline changes.

Validation passes **49 affected checks across six files**, **75 catalog checks across five files**
and **six Rust checks**. One durable registry case covers shared subscription ownership, pending
consent retirement, synchronous owner destruction and terminal admission. Existing actual SDK
coverage verifies cold/unknown-instance denial and protocol progress after queued ordinary work,
while human control and status remain available. The same MCP App application scenario passes on
immutable `f511c078b` and the current build: saved sources, Native CSP/permission policy, consent,
revocation, graceful shutdown and reopen. Six current application regressions also pass: scoped
widget session opening and five maintenance/shutdown cases. Current/baseline Main and Rust hashes
are restored and verified. Normal build, Node/web and affected unit/E2E types, format/check, lint,
i18n, Rust fmt and locked Clippy pass, with the existing Remote warning only. Normal Provider/ACP
refreshes remain separate. Compact receipts and the one needed baseline remain; fixture profiles
and bundles retire automatically. Default writer/routes/lifecycle still run in Main. G5 remains
active and unpublished pending full Core adoption, remaining Native bindings and whole-goal
fault/native/signed acceptance; foreground browser focus still requires the unlocked Mac.

### G5 desktop host controls

Main's Workspace preview, Provider-deeplink and quit-preparation callbacks use the Core runtime's
host facade. Main no longer holds Provider settings, the three permission services or the approval
broker for these operations. Preview/Provider queries enter the database gate and existing bounded
ordinary queue. Two fixed host controls use the reserved Native event lane: permission clearing
and shutdown-confirmation data. Knowledge returns the existing dialog data and has no dialog
dependency or presentation method; Main presents it and interprets the response. The event lane
does not wait for user input. No public route, resource bound, process, dependency or deadline changes.

Quit/update preparation awaits permission retirement. Update installation records its shutdown
promise before the first await, preserving exclusion of concurrent requests. Failed quit preparation
is reported and leaves the shutdown claim uncommitted. Kernel retirement clears permissions before
the CLI server drains. Private host operations join accepted business work before writer release;
ordinary query denial does not invalidate an otherwise live Native bridge.

Validation passes **49 affected checks across five files**, including the actual SDK under full
ordinary load, plus **75 catalog checks** and **six Rust checks**. One durable Knowledge case covers
idle/pending confirmation data; SDK coverage extends its existing case. Eleven app scenarios pass
across Workspace/preload isolation, Provider deeplinks, CLI approvals, MCP Apps and five maintenance/
shutdown cases. The final app build passes the same two affected preview/deeplink scenarios as the
immutable baseline. Normal build, final app rebuild, Node/web and affected unit/E2E types, format/
check, lint, i18n, Rust fmt and locked Clippy pass, with the existing Remote warning only. Normal
Provider metadata refresh remains separate. Disposable profiles/bundles retire; compact evidence
and the one required baseline remain. Default profile/writer/routes/lifecycle still run in Main;
production helper/Browser retirement, default Core network adoption and
whole-goal acceptance remain required. G5 stays active and unpublished; locked-Mac foreground
acceptance is unchanged.

### G5 Core HTTP ownership

Main publishes its committed effective proxy URL, merged bypass rules and monotonically increasing
revision through one fixed Native operation. The SDK Kernel initializes its own Undici dispatcher
and proxy environment before constructing Provider/runtime owners. Proxy-setting acknowledgement
waits for that synchronization. Stale revisions are ignored, equal effective policies reuse the
pool, and failed Native resolution leaves the last committed policy intact. System resolution
preserves the existing single probe and first HTTP proxy result; per-destination PAC evaluation is
outside this change. Credential-bearing proxy URLs are no longer logged directly.

Replaced pools close gracefully while accepted requests finish. Kernel stop destroys both current
and draining pools at the beginning of retirement, then waits for closure before releasing the
writer. Existing library/native transport owners retain their own cancellation contracts. Main
uses the same pure dispatcher/environment helpers; its default process placement is unchanged.

Validation passes **25 checks across three existing files**, including the actual standalone SDK
with local HTTP endpoints: authenticated proxy requests, bypass, direct mode, live policy changes,
in-flight response completion, shutdown of current and draining connections, and profile reopen.
One durable SDK case covers this network/lifecycle contract. Existing Native tests cover snapshot
readiness, revision changes and last-good resolution. Normal build, Node/web and affected-test
types, format/check, lint and i18n pass. Rust and generated catalogs are unchanged, so their
unchanged suites are not repeated. No performance result is claimed.

The immutable `f511c078b` application selection passes configuration reads and two Provider
save/error flows. Its Provider probe scenario exposes the startup-route result-sharing defect
described below. The corrected current artifact has passing evidence for all four scenarios,
including the complete probe/credential/save-error flow. Compact reports and restored baseline
hashes are in `.deepchat/rutis-g5-kernel-assembly-acceptance/`. Source changes remain uncommitted
and unpublished.
Default Core adoption, production Native/helper/Browser retirement, descendant fd/environment
authority, foreground focus and complete fault/native/signed acceptance remain open. G5 is active;
G6 has not started.

### G5 startup route result isolation

Each tracked business request has its own startup-work identity. The coordinator retains shared
progress labels and the existing CPU/IO concurrency limits, while arguments and caller identities
cannot inherit another request's result or authorization. Query caching stays with the existing
clients. This fixes concurrent Provider catalog reads returning the first Provider's catalog and
incorrectly marking an empty model list ready. The shared route dispatcher applies the same rule
to the default Main runtime and SDK Kernel; no new public route, dependency or process is added.

Validation passes **102 distinct checks across five Main/SDK/Native files**, including a single
durable concurrency case using the real coordinator with different Provider IDs and caller IDs.
Existing checks retain maintenance revalidation, cancellation and accepted-handler drain. The
current application passes all four selected configuration/Provider scenarios. The complete
Provider flow covers model selection, denied/successful requests, saved credentials, disabled
Provider persistence, custom model filtering, rejected writes and retained input. Its fixture
explicitly disables the enabled-only filter before selecting an inactive model and uses current
localized save/error labels. Temporary read-only diagnostics are removed.

Normal build, Node/web and affected-test types, format/check, lint and i18n pass. The normal
Provider catalog refresh passes **75 checks across five files** and is held separately in
`fe4ea751e`; G5 source remains uncommitted/unpublished. No unchanged benchmark, deadline increase
or Rust suite is repeated. Compact reports/source hashes and the sole needed baseline remain;
completed profiles and media are pruned. Default cross-process adoption, production Native/helper/
Browser retirement, descendant authority, foreground focus and whole-goal fault/native/signed
acceptance remain required. G5 is active; G6 has not started.

### G5 registered execution retirement

The production Native Exec host owns an asynchronous kill receipt and replays exit to late
subscribers. Retirement is registered before synchronous exit callbacks can reenter it. It captures its helper PID
before exposing commands, waits for physical exit and performs profile-scoped recovery of that
helper's registered command roots using the existing start-time/command-line attestation. Unmatched
or unobservable identities are not killed. Unreadable/corrupted records and incomplete recovery
reject the receipt; live owned records cannot expire merely because they are old. Scoped recovery
requests serialize without sharing another owner's result, while startup recovery retains its
once-per-subsystem behavior.

The default Main execution service awaits this receipt during shutdown, canceled startup and
unexpected-helper recovery before allowing replacement startup. The Core proxy forwards it through
the existing termination command. Its Native helper owner retains exited Exec hosts until that
receipt settles and propagates failure. The separate arbitrary-PID recovery callback is removed.
Other helper kinds keep their existing contracts, resource bounds and reserved control capacity.

Validation passes **115 distinct checks across eight Main/SDK files**, including the actual SDK
Kernel. Three new durable unit cases cover scoped ownership/concurrency, unreadable records and
physical-exit/recovery failure; existing service/helper cases extend shutdown, replacement and late
startup coverage. Scoped unit/E2E types pass. The large 53-case manager fixture remains runtime
checked; its existing unrelated typing errors are recorded separately from source and scoped-test
checks. Normal build including Node/web types, format/check, lint and i18n pass. Normal Provider/ACP
metadata passes **75 checks across five files** and is held separately in `466791536`.

The current application passes four execution scenarios: completion/output/persistence, shutdown
with an active command, canceled pending Native startup and unexpected helper loss. The immutable
baseline passes the same first three; its helper-loss scenario leaves the owned command running.
The new durable fault case uses the public Agent/tool flow, kills only its owned Native helper and
checks command retirement before app shutdown and profile reopen. Test failure cleanup releases
the owned command through its fixture sentinel; it does not signal a potentially reused PID.
No deadline, performance gate or production debug API is added.

This proves registered-root recovery, not complete process containment. Failed registration,
legitimate exec identity changes, escaped descendants, process-group/fd retirement and supported
platform/signed behavior remain required for G5 acceptance. G5 remains active and unpublished. Compact reports and restored
artifact hashes remain in `.deepchat/rutis-g5-kernel-assembly-acceptance/`; completed bulk artifacts
are pruned and the sole needed immutable baseline is retained. G6 has not started.

### G5 default Core composition

- [x] Complete default Core acceptance: remaining streaming/delegation/interaction, Browser and
      helper faults, selected identity-bound process retirement, representative resource/responsiveness evidence and
      supported native package behavior. Complete local acceptance before publishing the coherent
      G5 source; keep G5 active until exact-head CI passes. Signed distribution remains release-gated.

The default process move selects one paired resource capture of the existing eight-delegation
workload on this fixed Mac, with identical local Provider fixtures, profiles and observer. Retain
all process-tree footprint/CPU samples, startup readiness and Main event-loop p95/p99. This is
structural-migration evidence, not a speedup adoption decision. Do not run a five-pair matrix or
turn an individual wall-clock difference into a gate; allow at most one confirmation batch for a
suspected material regression under the execution rule above.

Main starts the existing Rutis host and Core connection, opens the profile in Core and activates
its cohesive Kernel. It no longer constructs the profile writer, data, Provider, Harness, Memory,
MCP, synchronization or business route/controller roots. Native routes keep their sender guard and
fixed Main handlers; business routes use bounded Core ingress with the original caller guard
rechecked before dispatch. Activation holds that existing queue until business readiness is
acknowledged; cold SDK calls remain denied. Widget reads wait for the same acknowledgement.

Configuration snapshots remain read-only in Main; floating bounds use an exact private command.
Settings-window lifecycle and system resume reach the Core startup/scheduler owners. Resume
acknowledges dispatch without holding the Native event lane for helper replies; its finite work
joins the database lifetime gate. Core event targets and versions remain authoritative. Unsent full startup-progress snapshots and live-delegation projections supersede older queued
versions for the same target or parent/delegation identity. Projection revisions cannot regress.
Renderer publication does not retain a Promise waiter per superseded update; the owner retains
the actual Native delivery receipts. Other events keep their deliveries. Real eight-delegation
acceptance measured a 69-entry presentation peak, exceeding the preparation budget of 64. The
independent presentation budget is 256 entries/64 MiB; business ingress and Native callback/control
capacities retain their existing limits.

Shutdown pauses Native writes and requires the Core shutdown fence before closing windows. That
fence pauses secrets/security mutations and execution admission; final closure still awaits
accepted Native effects and actual helper/Browser/desktop retirement before host release. Failed
receipts prevent a terminal reset/restart action. Full reset creates its filesystem-only launcher
cleanup owner after Core retires. Core connection loss and internal helper/Browser/desktop/HTTP owner failures notify Main once
through a fixed component-only capability with reserved control capacity. The app generation
retires without replaying business operations or reopening the writer in Main. Shutdown fences
and lifecycle events remain admissible after failure, so physical helper exit receipts cannot
deadlock retirement. A retired connection ignores its expected host exit. Complete Native fault
and process-containment acceptance remains required.

Validation passes **58 checks across seven Main/SDK files**, including the actual Core worker,
and **six Rust checks**. Existing lifecycle cases cover activation queuing/cancellation, the
shutdown fence, physical retirement, configuration persistence and connection failure. One small
case verifies latest startup and delegation projections under a held Native operation, including
identity separation, stale revisions and independent business events. An actual SDK fault case
checks failure notification, continued shutdown control and writer exclusion until Native closure. Three source-order assertions for removed Main wiring are deleted.
Node/web and affected-test types, normal build with subsequent current harness/app rebuilds,
format/check, lint, i18n, Rust fmt and locked Clippy pass; the existing Remote warning remains.

The actual default app passes **14 scenarios across five files**: configuration reads, all three
Provider model/credential/save-error flows, encryption/rekey/reopen, five maintenance/drain cases
and four Exec completion/shutdown/canceled-start/helper-loss cases. A separate launch/exit case
passes. A temporary OS-handle probe confirms the profile lock is held by one SDK worker beneath
the Rust host with a different PID from Electron Main; it and the temporary diagnostics are
removed. Original failure receipts retain the progress-queue overflow and held-Native shutdown
findings. Corrected application behavior uses no deadline increase or fallback.

The immutable baseline passes **13 of the same 14 cases**; its helper-loss case leaves the owned
command alive. The current app passes that case and all 13 shared cases. Both artifact trees are
restored and hash-verified. Evidence is `.deepchat/rutis-g5-kernel-assembly-acceptance/`. Default adoption remains partial G5 evidence;
source wiring and these cases do not establish whole-goal completion. G6 has not started. Finished
bulk artifacts are pruned while reports, raw measurements and the sole needed baseline remain.

Default failure/flow acceptance also covers a refused Native renderer registration: Core reports a
fatal owner failure while its process is still present, Main ends the generation with status 1,
and a fresh app opens the same profile without replaying the uncertain creation. The current app passes all six selected flows: this owner-failure/reopen case, normal streaming,
first-message Workspace/Browser, eight-delegation admission/cancel/release, Memory lazy worker
allocation/model changes/loss and CLI approval/persistence. The original public flows remain in
use. The affected unit/SDK selection passes 58 cases across seven files; the projection case also
verifies explicit overflow at the 256-entry boundary. The immutable baseline passes four of
the same six cases: its refused-registration case keeps the app alive, and its first-message
case cannot select the newly added model. Streaming, delegation, Memory recovery and CLI approval
pass on both. The current and baseline trees are restored and hash-verified.
Memory verification tracks all pre-existing SDK workers and exactly one newly allocated Memory
worker instead of assuming the Rust host has only one initial child. The default controller no
longer accepts the obsolete Native route-map injection option. Validation outcomes and matching
baseline evidence are recorded with the application receipts; no timing threshold is raised.

Main owns interactive message dialogs and rejects pending responses during retirement, including
requests arriving after closure. The unused Core dialog invocation/response capabilities are
removed; shutdown confirmation crosses the boundary only as strictly validated data. The existing
CLI approval flow also verifies Core loss while approval remains unanswered: the generation exits
with status 1, the command does not succeed, and reopening preserves the last approved settings.
The current app passes; the immutable baseline leaves the app alive at the same injected Native
failure. Normal build refreshes retain the Provider catalog; its four focused suites pass 79 checks.

The selected eight-delegation resource pair passes its functional assertions on both builds and
records seven process-tree samples per build. Current/baseline total footprint medians are
1108.1/993.4 MiB, peaks 1146.5/1038.8 MiB and last samples 1146.5/1038.8 MiB. Main's last footprint
is 138.5/330.2 MiB; the current tree adds one Core SDK worker, with nine/eight final processes.
Observed process CPU is 6.42/5.86 seconds, readiness 1933/2049 ms and Main loop p95/p99
12.8/23.1 versus 33.8/57.4 ms. These short, single-pair observations establish the process/memory
tradeoff; they do not establish variance, sustained responsiveness, settled idle footprint,
input-to-paint latency or a performance gain. No confirmation batch or timing-gate change is
selected. Raw numeric samples and comparison receipts are retained; both artifact trees are
restored and hash-verified. Full G5 acceptance remains open.

Native directory/file, image-save and context-menu pickers share the existing Main DialogService.
Its bounded FIFO accepts at most 16 requests and opens one physical picker at a time. Parent
selection is captured per request; stopping or parent destruction denies unsent work. Main ends
the active macOS sheet after the Core fence, waits for actual Native completion and then destroys
the parent. Other platforms destroy the parent before the completion drain. The owner retains
outstanding receipts throughout; it creates no extra process or public API and returns no fake
cancellation acknowledgement.

One unit case protects FIFO results, the 16-request bound, unsent cancellation and physical-close
waiting. One macOS application case protects queued directory requests and an active image-save
picker during normal shutdown, with real OS dialogs. Project persistence, image/file actions and
CLI approval/failure recovery retain their public flows. The immutable baseline requires forced
exit with native pickers and stays alive after the Native failure while CLI approval is unanswered.
Both artifact trees are restored and hash-verified.
Native picker lifetime does not alter the delegation process layout or workload, so no additional
resource matrix is selected. Other supported platform behavior, foreground focus and
the remaining containment/fault/signed-package acceptance stay open. G5 remains active and unpublished.

- [x] Validate the existing Main image owner's shutdown signal against held HTTP headers/body,
      late Native effects and committed target writes. Connect it before Native settings-write
      drain, retain the existing Native call receipts and compare the public application flow
      against the retained baseline. No process, RPC method, timeout or resource matrix is added.

The existing DesktopImageActions owns one Main-lifetime abort controller. Shutdown stops it before
awaiting Native settings writes, so held image calls cannot occupy every ordinary Core slot while
quit preparation waits. The signal cancels actual HTTP headers/body and cache reads. Checks after
awaited reads and picker results deny late picker, clipboard or file-write effects. A target write
already started completes normally; the existing Native call and business receipts retain it
until completion. No separate request map or cross-process AbortSignal is introduced.

The selected Main/SDK suites pass 25 checks across five files. Image coverage retains byte/path
parity, rejects late data even when the Native stub ignores cancellation, and holds an accepted
target write across shutdown until its real file completion. All 46 existing Project checks pass,
including lazy preparation without getter side effects. The Project application case checks the
prepared directory and acknowledged version; live bootstrap/renderer callers can legitimately
create the directory before its explicit request, so transient-absence assertions are removed.

The default app passes all four selected cases across Project and file/image flows. Held-download
coverage fills all three ordinary Core slots during quit, holds both HTTP headers and response
body, observes physical connection closure and reopens the same profile with a fresh image owner.
It also verifies Core-owner failure during two held downloads. The frozen baseline passes ordinary
Project and image/file flows; picker and download shutdown require forced exit under the existing
ten-second deadline. Its download case fails on quit before reaching the later failure subcase.
Both artifact trees are restored and hash-verified. G5 remains active and unpublished; remaining
Native/concurrent interaction, process containment, foreground and native/signed platform gates
are not implied by these selected passes.

The unchanged CLI approval/failure-reopen case also passes on this same current app artifact.
Its matching frozen-baseline failure is retained with identical test source and baseline hashes;
no unchanged baseline retry is selected. Normal Provider catalog and Rust host inputs are unchanged.

### G5 execution registration and failed retirement

Exec startup waits for the existing registry's explicit recorded/exited/failed result before
acknowledging a live command. A failed registration terminates and removes the owned session,
then rejects startup. OS-observed exit waits for the existing completion receipt, so short commands
retain their output even when Node receives exit/close after the identity observation. MCP, ACP
and tunnel callers retain their existing behavior; no additional registry, RPC or process is added.

A failed process termination retains its registry recovery evidence and owned Skill package tree,
and rejects kill/removal/shutdown. Local output finalization cannot stand in for physical exit.
Shutdown drains every accepted session, aggregates failed retirement and refuses subsequent starts,
including startup suspended on identity observation. A late root close cannot clear a failed
tree-retirement receipt. This does not establish escaped-descendant containment or recovery after helper
loss during the initial registration window; those boundaries remain required for G5.

Validation passes **97 checks across five execution/registry/Native files**. Two durable manager
cases cover pending registration, failed physical retirement, retained package ownership, real
subprocess termination, fast-command completion and the shutdown start fence. One registry case
covers unavailable storage/identity and already-exited cleanup. The default-root fixture supplies
an owned identity instead of relying on an arbitrary live OS PID.

The current application passes all **five execution scenarios**, including the new public Agent
flow with an unavailable registry directory, visible tool failure, restored storage, graceful
shutdown and persisted failure after reopening. The same new scenario fails on immutable
`f511c078b`: it returns `running` and a session ID despite failed registration. The unchanged
baseline's earlier execution scenarios reuse their existing receipts; no unchanged benchmark or
baseline matrix is repeated. Source Node/web types, scoped registry/E2E types, app build, format,
lint and i18n pass. The large manager test fixture still has the previously recorded unrelated
TypeScript errors; all its runtime cases pass and no new-case typing error was reported.

Compact reports/raw receipts and the sole needed baseline remain; completed media and the
temporary test type configuration are removed. G5 remains active and unpublished. Exec identity
transitions, recovery across the initial-registration/helper-loss window, escaped descendants,
complete process-group/fd retirement, unlocked foreground focus and native/signed platform
acceptance remain required. G6-G12 retain their declared dependencies and scope.

### G5 macOS execution identity across exec

The existing Rust executable provides a read-only process-identity command before Tokio/Rutis
startup. Main supplies its absolute development/packaged artifact path to owned workers through
an internal environment value. On supported macOS, new launch records persist the boot-session
UUID and XNU process unique ID as an opaque string, preserving all 64 bits. The same identity
survives exec even though argv, executable UUID and pidversion can change. Observation replaces
the ordinary ps query for these records and creates no additional resident process or supervisor.

Native identities never downgrade to timestamp/argv attestation during recovery. Missing identity
refuses cleanup and retains evidence; a changed native birth identity refuses signaling and drops
the stale record. Legacy records and other platforms retain conservative start-time/argv checks;
an argv mismatch alone no longer claims PID reuse or deletes uncertain ownership. Existing
MCP/ACP/tunnel callers keep the same registration API and lifecycle behavior. The sole additional
Cargo dependency declaration is libc, already present in the locked dependency graph.

Apple defines the selected identity flavor in its private XNU header. Actual native/signed
platform acceptance remains required, and Windows/Linux process identity is not relaxed. This
selected change does not establish atomic identity-bound signaling, helper-loss recovery during
initial registration, escaped-descendant containment or complete process-group/fd retirement.
G5 remains active and unpublished; G6 has not started.

Validation passes **119 checks across eight execution/registry/Native/runtime files**, including
real Rust host startup, SDK Core and the copied runtime closure. The single new registry case
covers same native identity after exec, missing identity, PID reuse and refused signaling. The
existing legacy mismatch case now protects retained uncertainty. All **seven Rust checks** pass;
the native test observes shell-to-cat exec at one PID, stable identity and rejected post-exit lookup.
The artifact CLI accepts a live owned PID and rejects zero without output. Source Node/web and
scoped registry/E2E types, the normal full build, format, lint, i18n and locked Clippy pass. Normal
Provider/ACP refresh output is retained; **92 catalog checks across five files** pass.

The current application passes **seven Exec/MCP scenarios**. The new public Agent case first
registers a gated shell, releases exec into Node, verifies the same registered PID, loses its owned
Exec helper and observes command retirement before graceful shutdown and profile reopen. Its raw
record proves default native identity use. The matching new case on immutable `f511c078b` leaves
the command alive after helper loss. This is the observed failure, without attributing the entire
baseline's missing recovery behavior solely to argv comparison. Existing unchanged baseline
scenarios retain their earlier receipts. No unchanged benchmark or resource matrix is repeated;
this does not add a resident process or change the selected delegation process layout.

Compact native records, raw reports, hashes and the sole needed immutable baseline remain.
Completed test media, copied test closures and temporary configs are removed. G5 stays active and
unpublished. Initial-registration/helper-loss recovery, atomic checked signaling, descendants,
group/fd/environment authority, foreground focus and native/signed acceptance remain required.

### G5 explicit execution group retirement

Explicit POSIX termination retains its acquired process-group target through root exit, waits for
the group and physical stdio close, and escalates the same group when TERM leaves a member alive.
It never falls back to the old root PID after acquiring that group. Unknown liveness does not
prove exit. If the root is already gone when termination starts and a group remains, refuse a
successful receipt without signaling that unproven group. Windows taskkill and the existing
non-group descendant fallback keep their interfaces.

Exec records one termination promise before invoking the process helper. Kill callers join it;
root close, error and inherited-stdio watchdog paths cannot finalize output, remove registry
records or delete owned Skill packages ahead of the tree receipt. Failed tree retirement stays
failed after a late root close. Normal root completion is unchanged; descendants that detach,
root-loss recovery before termination admission and atomic identity-bound signaling still need
their separate ownership proof. G5 remains active and unpublished.

Validation passes **273 cases across fourteen shared execution/registry/Native, MCP, Sync,
Skill, foreground shell and plugin files**. The new real-process case exercises both termination
APIs with a root that closes while its child ignores TERM and owns separate stdio. The existing
manager case now closes the root before resolving failed tree retirement and verifies retained
registry/package ownership and refused shutdown, including a late root close. Existing mock
coverage verifies that a vanished acquired group never falls back to a potentially reused root.
Fixture teardown releases its own sentinel and waits for known child/root exit before deleting
its files; it does not signal a potentially reused PID.

The current application passes **eight Exec/MCP scenarios**. The new public Agent shutdown case
owns a parent and a TERM-resistant child, observes both gone before profile reopen and retains
the stored conversation. The same new case fails on immutable `f511c078b`: the app closes gracefully
and the root is gone, but the child remains alive. The raw failure points to the child-exit check;
fixture cleanup subsequently releases and drains that child through its own sentinel. Existing
unchanged baseline scenes reuse their receipts; no deadline or ownership assertion is weakened.

Both Core SDK and Main are rebuilt. Node/web source types, scoped process/registry/E2E types,
format, docs format, lint and i18n pass. The existing manager fixture still has the exact same
22 unrelated TypeScript diagnostics, with no additions/removals; all runtime cases pass. Rust and
catalog sources/artifacts are unchanged from their accepted checks, so no unchanged Rust, catalog
or resource matrix is repeated. Compact raw reports and the sole needed baseline remain; completed
media and temporary configs are removed. G5 stays active/unpublished, G6-G12 unstarted.

### G5 macOS pre-registration execution gate

New macOS background commands first enter the existing Rust artifact's execution gate before
Tokio/Rutis startup. The native helper records the gated root's identity before releasing a
length-prefixed environment frame over a dedicated fourth descriptor. User environment overrides
are withheld from the gate process, so dynamic-loader overrides cannot run before admission;
stdin/stdout/stderr retain their existing roles. The control frame is bounded at two MiB on both
ends, and the control descriptor closes before exec. The requested executable/args and environment
then run at the same registered PID, without an additional resident process or supervisor.

EOF or incomplete/malformed/oversized grants run no user command. Stop/timeout while registration
is pending cannot release the gate. Failed startup compensates through the existing single tree
retirement receipt; pending environment values are released when startup settles. New native
identity observation fails closed instead of downgrading a gated command to legacy argv/time.
Legacy records and other platforms keep their conservative observation path. The existing Rust
process module owns both inspection and the gate; no additional dependency, runtime queue, public
route or implementation flag is added. Complete physical retirement of unobserved gate roots,
escaped descendants, checked signaling and native/signed acceptance remain separate G5 work.

Resource selection: run exactly one current/baseline pair of the existing public Exec completion
scenario with its ordinary resource sampler, including profile reopen. Do not add a confirmation
batch, unchanged matrix or wall-clock adoption gate. This end-to-end pair includes the cohesive
Core migration and cannot isolate gate cost or prove a performance gain.

Registration binds native identity to the actual owned child object. It revalidates that child
after asynchronous inspection before persisting identity, so a reaped child cannot attest a reused
PID. PID-only callers retain their conservative legacy attestation. The existing pending-record
case adds child exit alongside clear/replace, without a separate test harness or ownership map.

Validation passes **275 cases across fourteen execution/registry/Native, MCP, Sync, Skill,
foreground shell and plugin files**, plus **seven Rust cases**. One durable real-gate case covers
release, parent-side EOF and oversized control frames; it verifies deferred environment values,
untouched stdin, unchanged PID and closed control descriptor. The final application passes
**nine Exec/MCP scenarios**. Its new public Agent fault case holds identity observation, kills the
owned helper before registration completes, observes gate-root exit with no user marker, and
reopens the persisted request without starting that command. The same new case fails on immutable
`f511c078b` with the command root still alive after helper loss. That baseline fails before the
later no-marker/reopen checks; do not claim those baseline steps ran. Test-only observer wrappers
hold both the old ps path and the native inspector, then release/drain through their own sentinels.

The predeclared Exec completion/reopen resource pair passes on both artifacts. The initial launch
retains six samples per build: current/baseline last total footprints are **1150.2/1038.7 MiB**,
Main last footprints **129.7/306.6 MiB**, and final process counts **10/9**. Observed cumulative
sampled CPU is **6.627/5.748 s**, UI readiness **1952/2026 ms**, and Main loop p95/p99
**12.45/30.98 vs 27.80/112.72 ms**. Reopen retains five/four samples, with last totals
**1083.9/980.1 MiB**, Main **126.2/298.0 MiB** and process counts **9/8**. All samples, including
startup, remain in the raw reports. This includes Core composition changes, cannot isolate the
gate or transient peaks, and establishes neither variance, settled idle nor a gain. The ordinary
sampler may miss short-lived processes. The local post-inspection child check is added after that
pair without changing its Rust gate, process layout or workload. No confirmation batch or further
measurement is selected.

Normal full build and final Core/Main rebuild, Node/web source types, scoped process/registry/E2E
types, format/docs, lint, i18n and locked Clippy/fmt pass. The existing manager fixture retains the
same 22 unrelated typing diagnostics with no additions/removals. Generated catalogs are unchanged
from their accepted checks and are retained. Current and frozen output hashes verify; completed
media/configs are removed while compact raw evidence and the sole needed baseline remain.
G5 stays active/unpublished. Unobserved pre-registration gate retirement, natural root loss,
escaped descendants, atomic checked signaling, remaining Native/fd/environment/proxy authority,
foreground focus and native/signed platform acceptance remain required before G6.

### G5 macOS identity-bound group recovery

Registered native recovery delegates its persisted birth identity to the existing Rust artifact.
A bounded group snapshot is accepted only while its root retains that identity and group. TERM
and force address each captured member through the system audit-token interface, which validates
PID/version in the kernel. Recovery never sends a numeric PID/group signal or reacquires members
after the root can have exited. Membership is checked between two observations of each member's
birth, preventing a reused PID in the listing from authorizing a different process. Unsupported
systems, uncertain snapshots, concurrent exec and new/surviving members retain failed ownership
evidence. Disappearance of both the captured births and group remains the receipt. No resident
process, dependency, supervisor or production switch is introduced.

Validation passes **334 execution/registry, MCP, ACP, Sync, Skill, shell and plugin cases across
sixteen files**, **eight Rust cases** and **104 catalog checks across seven files**. One real Rust
case refuses another birth identity without killing the command, then escalates an owned root
and child that ignore TERM. Fixture EOF and an actual parent wait drain the commands even after
a failed assertion. One adapter case protects the native receipt and refuses unavailable or
malformed responses without numeric-PID fallback. The normal generated Provider/ACP refreshes are kept.

The final application passes **ten Exec/MCP cases**, including the new macOS public Agent case
that loses its Exec helper while a child ignores TERM. The root and child exit before graceful
shutdown and profile reopen. The identical final-source selected case also passes independently;
its non-macOS skip guard does not change the ten-case macOS workload or application artifact.
Immutable `f511c078b` fails the new case with its root still alive after helper loss, before its
later child/reopen checks. This does not isolate the audit-token interface as the baseline's sole
cause. Owned release sentinels subsequently drain the fixture, and both trees are restored and
hash-verified. Earlier unchanged baseline results remain scoped evidence.

Normal full build, final Rust/Core rebuild, Node/web source types, scoped process/registry/E2E
types, formatting, lint, i18n, Rust fmt and locked Clippy pass. The unchanged manager fixture's
22 existing type diagnostics retain their earlier receipt. No new performance measurements or
gain claim are selected; the earlier resource pair binds its own artifact snapshot. Completed
media and temporary configs are removed while compact evidence and the sole baseline remain.
Natural root loss before recovery, escaped descendants, explicit utility-owned signaling,
supported native/signed compatibility and whole G5 acceptance remain open. G5 stays active and
unpublished; G6-G12 are unstarted.

### G5 shared native execution termination

Successful registration supplies its existing observed identity directly to the session owner.
Admitted macOS commands use the same Rust identity-bound group implementation for explicit stop,
timeout and shutdown as for helper loss. Group retirement and actual owned-child stdio close are
both required before registry/package cleanup. A gate without a native identity cannot release
user code. Native root exit also joins that retirement. Rust authenticates surviving group members
through captured parent-birth chains when their root has exited; uncertain ancestry refuses a
receipt. Native recovery retains records after root PID loss until this check settles.
Pre-registration compensation, missing ancestry and escaped descendants retain their separate
ownership requirements. Root exit keeps its exit code and output; list/poll remain running while
its physical receipt is pending. It cannot report successful
completion while physical retirement is pending or failed. Late close cannot clear that failure.

Validation passes **440 cases across twenty-three execution/registry/Native-host, MCP, ACP, Sync,
Skill, shell, plugin and catalog files**, including the normal generated Provider/ACP refreshes,
and **eight Rust cases**. One native completion case covers held and refused retirement, original
output/exit code, retained registry/package ownership, late close and refused shutdown. One
registry case verifies root disappearance cannot erase native group ownership and preserves a
custom attester's refusal. Existing gate/output-limit and process adapter cases cover identity
forwarding and actual stdio closure. The Rust real-process case covers both live and already-exited
roots, rejects another birth without killing its child, then forces its owned TERM-resistant child.
No exact incidental terminal-signal assertion or test-only production route is retained.

The actual application passes **eleven Exec/MCP cases**. The new macOS public Agent case exits
its root with a TERM-resistant child on separate stdio, observes both gone, polls full output and
exit code 0, closes gracefully and reopens the stored conversation. Immutable `f511c078b` exits
the root but leaves the child alive, failing before its later output/persistence assertions.
Owned release sentinels drain its failed fixture. Same source and current/frozen artifacts are
hash-bound and both trees are restored; unchanged baseline cases reuse their existing receipts.
The final-source selected case follows ordinary `running` feedback with another uniquely
identified public poll rather than assuming PID disappearance synchronously settles the Native
receipt. It is included in the eleven scenarios, not counted as another distinct workflow.

Full build, Node/web source types, scoped process/registry/E2E types, formatting, lint, i18n,
locked Rust Clippy and fmt pass. The manager fixture has exactly the same 22 type diagnostics
after normalized comparison, with no additions/removals; that probe is not called green.

Resource selection for the new completion path: exactly one ordinary Exec completion/reopen
current/baseline pair at the existing 500 ms sampling interval. Retain all startup samples and
report aggregate/Main memory, process count, CPU, readiness and Main-loop delay. The deterministic
requirement is no additional resident process after the command's physical receipt. Timing is
report-only; no confirmation batch, unchanged matrix or relative CI gate is selected. Both
functional resource runs pass. Initial current/baseline samples are **8/6**, post-ready **4/3**;
total median **1079.9/981.9 MiB**, peak **1146.6/1058.7 MiB**, last **1141.4/1058.7 MiB**, Main
**130.4/306.0 MiB**, process count **10/9**, observed sampled cumulative CPU **8.051/5.940 s**,
readiness **2112/2074 ms**, and Main-loop p95/p99 **14.62/24.72 vs 25.46/158.47 ms**. Reopen
samples are **5/4**, post-ready **2/1**; last total **1102.7/988.0 MiB**, Main **127.8/295.6 MiB**,
processes **9/8**, CPU **5.760/5.039 s**, readiness **1913/1981 ms**, loop **12.63/25.43 vs
37.26/112.85 ms**. All startup samples remain in the raw receipt. Aggregate last/peak memory is
higher. This includes Core migration, may miss short-lived native checks and cannot isolate this
completion path, settled idle, input-to-paint, variance or a gain. The resource receipt identifies
its own artifact snapshot separately from final behavior acceptance; Rust implementation, process
layout and workload are unchanged, but final-artifact performance is not established. The declared
budget is exhausted.

Compact evidence and the sole frozen baseline remain; ended media and temporary configurations
are removed. G5 remains active/unpublished, G6-G12 intact/unstarted. Missing ancestry, escaped
descendants, unobserved pre-registration gates, remaining Native/Browser/concurrent faults and
unlocked foreground/native/signed supported-platform acceptance still require proof.

### G5 descendants outside the original process group

Extend the existing Rust termination operation with bounded same-user birth snapshots. Keep
captured ownership across TERM/force, follow parent-birth chains across groups and verify a fresh
snapshot before success. Never signal a process merely because its UID or numeric PID matches.
Refuse unknown inspection, overflow, ambiguous ownership or surviving descendants. Keep the
existing registry and native caller; add no resident service or dependency. Unobservable ancestry,
privilege changes, pre-registration gates and supported native/signed compatibility remain open.

The native command is `--terminate-tree`. Each bounded snapshot covers the original group and
same-user candidates; captured parent-birth chains authorize targets across groups and sessions.
The operation retains captured births across at most three snapshots. Unknown inspection,
overflow or uncertain ancestry refuses retirement. Root PID reuse within the same boot and record
age cannot discard native ownership; a validated identity from a different boot clears obsolete
ownership without signaling a current numeric PID.

All 104 execution/registry/Native-host checks and eight Rust checks pass. The real Rust case
covers live/exited roots with children inside/outside the original group, rejects another birth,
proves stale-boot cleanup has no effect on a current child, and retires TERM-resistant members.
The normal build retains Provider/ACP refreshes. The refreshed ACP catalog passes 20 checks across
four files; unchanged caller/catalog evidence retains its own source snapshot. Node/web and scoped
process/registry/E2E types, format, lint, i18n, locked Rust Clippy and fmt pass. The unchanged manager
fixture retains its preceding 22 existing diagnostics; this is not a green whole-fixture type check.

The rebuilt app passes all 12 Exec/MCP scenes. The public Agent escaped-root-exit case observes
separate root/child process groups before releasing the root, then verifies root/child disappearance,
full output, exit code 0, graceful close and persisted conversation after reopen. The immutable
f511 baseline fails at line 488: its root is gone but its escaped child remains alive. Later baseline
feedback/reopen checks do not execute. Owned release files drain the fixture. Current/frozen trees
are restored and hash-verified in `escaped-comparison.json`; reports remain under
`.deepchat/rutis-g5-kernel-assembly-acceptance/`.

Exactly one declared ordinary completion/reopen resource pair passes at 500 ms, retaining all
startup samples. Initial current/baseline: 6/6 samples, post-ready 2/3; median 927.7/996.3 MiB,
peak/last 1152.5/1058.2 MiB, Main 131.8/308.4 MiB, processes 10/9, sampled cumulative CPU
6.815/5.913 s, readiness 2066/2041 ms, loop p95/p99 12.57/27.74 vs 23.82/138.94 ms.
Reopen: 5/4 samples, post-ready 2/1; median 926.9/843.5 MiB, peak 1083.8/992.7 MiB,
last 1083.8/981.5 MiB, Main 115.0/295.2 MiB, processes 9/8, CPU 5.608/4.990 s,
readiness 1953/1960 ms, loop 14.53/28.30 vs 34.73/112.85 ms. Aggregate last/peak memory
is higher. This sparse pair includes Core migration and can miss short-lived native checks; it
cannot isolate descendant-capture cost, settled idle, variance, input-to-paint or a gain. The budget
is exhausted. Shared-CI timing stays report-only; no confirmation batch or unchanged matrix.

G5 remains active/unpublished; G6-G12 remain unstarted. Unobservable/lost ancestry, privilege
changes, pre-registration compensation, remaining Native/Browser/concurrent faults and unlocked
foreground/supported native/signed-platform acceptance still require proof.

### G5 execution gates before command registration

The Main-owned Exec helper captures its native birth before exposing the command channel. On
helper exit, reuse the existing Rust termination operation in owner-descendant mode, without
assuming that an Electron utility process leads a process group. Retire observable birth-linked
descendants before reaping command records and acknowledging retirement. Missing helper identity
refuses native readiness; failed descendant retirement retains the failed receipt. Do not add a
resident supervisor, second registry, dependency or renderer API. Utility-side cancellation before
native identity closes the ungranted gate and waits for actual child closure; it must not fall back
to numeric PID/group signals for that unobserved launch.

The native `--terminate-owner` mode reuses the bounded birth-ancestry operation without observing
or signaling a numerically matching process group. Main reuses the existing identity observer,
validates the still-owned utility after inspection, and retains its birth in the existing host
handle. The native channel is unavailable until that attestation succeeds. Actual helper exit,
owner-descendant retirement and command-record recovery all precede the retirement receipt.
The session manager closes an ungranted gate through EOF and the existing physical-close wait;
there is no numeric PID/group mutation fallback while its native identity remains unknown.

All 112 relevant TS checks across six files and all eight Rust checks pass, with locked Clippy and
fmt. The existing real Rust case covers group and non-group owner roots, live/exited roots and
children inside/outside the original group. New Native boundary coverage holds attestation and
retirement, refuses missing/canceled identity and failed descendant receipts, and prevents late
readiness. The existing real-gate EOF case now cancels through the session API and verifies actual
Rust process exit without invoking tree signaling. No additional application scenario is added.
The final normal build, Node/web and scoped types, format, lint and i18n pass. The manager fixture
still reports the same 22 existing diagnostics, with zero normalized additions/removals. Provider
and ACP catalog hashes are unchanged from their preceding accepted refresh checks.

The final rebuilt app passes all 12 Exec/MCP scenes. The existing registration-loss case withholds
the gate executable and identity observer through helper loss, verifies both processes exit before
the fixture release, preserves the absence of user effects and reopens the persisted request.
This combines a stalled launch executable with real Rust gate/EOF regression protection; it is
not proof of arbitrary lost ancestry. The same immutable f511 baseline fails at line 324 with the
command root alive, before no-marker/reopen assertions. Owned release sentinels drain its fixture.
`gate-owner-comparison.json` binds current/frozen artifacts and the same final test source; both
artifact trees are restored. Evidence remains under the existing kernel-assembly acceptance root.

The single declared completion/reopen resource pair passes at 500 ms, retaining all startup
samples. Initial current/baseline: 7/6 samples, post-ready 3/3; median 1048.4/979.3 MiB,
peak/last 1150.2/1052.1 MiB, Main 129.9/306.0 MiB, processes 10/9, sampled CPU
6.919/5.941 s, readiness 2109/2066 ms, loop p95/p99 14.34/29.41 vs 32.34/111.08 ms.
Reopen: 5/4 samples, post-ready 2/1; median 931.4/853.7 MiB, peak 1114.3/1023.8 MiB,
last 1114.3/991.8 MiB, Main 125.4/296.0 MiB, processes 9/8, CPU 5.526/4.999 s,
readiness 1880/1968 ms, loop 14.68/28.49 vs 36.93/119.08 ms. Total last/peak memory is
higher. Samples bind their own artifact snapshot: final behavior additionally changes utility-side
ungranted-gate cancellation, a branch outside this ordinary workload. Rust implementation and
process layout are unchanged, but final-artifact performance is not established. Sparse startup
sampling cannot isolate owner-retirement cost, settled idle, variance, input-to-paint or a gain.
Budget exhausted; shared-CI timing is report-only, with no confirmation batch or unchanged matrix.

G5 remains active/unpublished and G6-G12 unstarted. Lost/unobservable ancestry and privilege
changes, remaining fd/environment/proxy authority and Native/Browser/concurrent faults, unlocked
foreground and supported native/signed-platform acceptance remain required. Compact raw evidence
and the sole immutable baseline remain; ended media and temporary configurations are removed.

### G5 command environment authority

Core resolves public command environment overrides into one complete launch snapshot before
Native dispatch. The reusable utility must not merge its older environment into that snapshot;
the Rust gate replaces its trusted bootstrap environment only after admission. Retain the existing
shell/PATH preparation, per-command overrides, separate stdin and same-PID exec. Clearing proxy
settings must remove old helper-inherited proxy variables; utility-only control markers must not
reach the admitted command.

The public Exec service resolves overrides against Core's string-valued process environment.
The Native manager uses that complete snapshot, with its existing UTF-8 preparation, as the target
environment. Rust calls `env_clear` before applying the admitted grant; the trusted gate bootstrap
still receives its existing environment before admission. The default service, utility and Rust
artifact are connected directly. No dependency, process, option, alternate route or registry is added.

Validation passes 223 TS checks across thirteen execution/registry/Native/helper, shell, command and
Skill files, plus all eight Rust checks, locked Clippy and fmt. One small service case protects
snapshot/override/deletion across helper reuse. The existing Native environment case refuses
utility inheritance, and the existing actual Rust gate case proves a bootstrap-only marker is
absent after admitted exec while stdin/PID behavior remains intact. Final normal build, Node/web
and scoped types, format, lint and i18n pass. The manager fixture retains the same 22 existing
diagnostic messages with zero normalized additions/removals; it is not a green fixture type check.
Provider and ACP catalogs match their preceding accepted refresh checks.

The actual app passes all 13 Exec/MCP scenes. The new environment scene runs two commands through
one helper: a background command observes its custom proxy, public settings clear the proxy, and a
foreground command receives neither the old proxy nor the utility-only control marker. Both commands
finish through ordinary public feedback; the conversation survives graceful close and reopen.
The fixture uses the normal foreground wait for the second command and preserves the existing
no-progress guard. The retained failure diagnostic records actual no-progress feedback and is
not a passing acceptance result. The final-source immutable f511 baseline fails at
line 515 with both the old proxy and utility marker still present in the second command. Later
baseline final-feedback/reopen assertions do not execute. Owned release files drain the fixture.
`environment-comparison.json` binds the same final fixture/current/frozen artifacts and restored
trees under `.deepchat/rutis-g5-kernel-assembly-acceptance/`.

No process placement or new transport is introduced; ordinary Exec callers already provide complete
prepared environments. No resource capture, unchanged benchmark matrix, timing gate or performance
gain is claimed for this correctness fix. Previous resource receipts retain their own source/artifact
scope and do not measure the current complete-environment launch cost. Shared-CI timing stays
report-only. Compact raw evidence and the sole immutable baseline remain; ended media, temporary
configurations and the diagnostic fixture instrumentation are removed.

G5 remains active/unpublished, with G6-G12 unstarted. Unobservable/lost ancestry and privilege
changes, remaining Native Chromium/fd lifetimes and Browser/concurrent faults, unlocked foreground
and supported native/signed-platform acceptance still require proof. Main's global-fetch dispatcher
ownership is covered by the acceptance below; other transports retain their separate ownership.

### G5 Main HTTP lifetime

Main owns its current and draining HTTP dispatchers in the existing ProxyConfig. Proxy replacement
allows accepted requests to drain. Shutdown fences new resolutions, aborts current/draining transports,
awaits any accepted Electron proxy resolution and rejects late installation/environment changes.
The existing Native desktop receipt joins this retirement before Core releases its profile. Keep
one Main-scoped instance and report physical failures through the existing Core invalidation path.

Undici 8.10.2 Agent clears its client map at the start of close. An owned held-header characterization
demonstrates that destroy can then return with its request and socket still alive. The existing pnpm
patch mechanism now preserves clients until graceful close settles, allowing forced retirement to
reach them in both Main and Core. The version is unchanged; frozen offline installation passes.
No new dependency, process, dispatcher wrapper or public option is added.

Validation passes 106 distinct TS checks across nine files: 45 proxy/composition/Core/desktop checks,
31 Copilot OAuth checks and 30 Provider catalog checks. Private account credentials, callbacks and
adapters also pass 76 existing checks across six files. The real installed Agent regression holds headers,
begins graceful close, forces destroy and verifies physical request/socket retirement. Proxy tests
also cover current/draining pools, accepted late resolution, rejected queued resolution and retained
retirement failures. Native SQLite is required for Core checks. Final normal build, Node/web and
scoped test types, format, lint, i18n and diff checks pass. The unchanged Rust matrix retains its
eight-check evidence; the manager fixture's 22 existing diagnostics remain outside a green type
claim. Normal Provider/ACP refreshes are retained.

The actual app passes all four selected OAuth/MCP scenarios, alongside 21 maintenance, Exec/MCP,
image and CLI regressions on the same application artifacts. One shared disposable HTTPS fixture
serves Copilot validation and private Provider discovery/revocation, with certificate verification
enabled and exact CONNECT host restrictions. It owns its sockets, temporary trust file and app-only
environment changes; no runtime OpenSSL dependency or OS trust change is needed.

The private Provider case preserves both plaintext and native-wrapped legacy credential files
byte-for-byte through reads/cancellation. Public logout sends each saved refresh token and client ID
to its actual HTTPS authority, including trusted xAI discovery; both files disappear and signed-out
state survives reopen. The MCP case preserves native ciphertext, settings-window authorization and
durable credential removal. The Copilot case preserves a newer saved credential against a stale
response and verifies instruction-window retirement/reopen. The HTTP shutdown case holds two real
Native requests in old/current pools, ignores caller cancellation deliberately and verifies transport
disconnection, graceful quit and unchanged credentials after reopen. No new test case is added.

With the same final fixture, the immutable f511 baseline passes 2/4: both credential compatibility
cases. Copilot instruction-window quit at line 179 and held-HTTP quit at line 276 require forced exit
under the unchanged ten-second deadline. Later retirement/reopen assertions do not execute. The
ordinary failure is not attributed solely to HTTP pools. Both Main builds externalize Undici and
use the same current patched install;
this comparison isolates Main ownership, not a pristine baseline dependency tree. The independent
pre-patch Agent characterization establishes the library defect.

Current/frozen artifacts, fixture sources and dependency hashes are restored and verified in
`oauth-fixture-comparison.json` under `.deepchat/rutis-g5-kernel-assembly-acceptance/`. The same app's
21 regression cases are recorded in `native-http-regression-current-app.json`. Ended media,
the editable package copy, certificate-generation scratch files and temporary type configuration
are removed; compact raw reports and the sole frozen baseline remain. No resource capture,
unchanged timing matrix, timing gate or performance gain is claimed. Shared-CI timing is report-only.

G5 remains active/unpublished; G6-G12 are unstarted. Native Chromium pools, remaining
fd/Browser/concurrent faults, unlocked foreground and supported signed
platforms remain separate acceptance work. Whole G5 review, commit/push and exact-head CI precede G6.

### G5 application coverage and fixture ownership

The selected local smoke inventory is fully accounted for: 117 of 122 cases pass and five are
skipped because they explicitly require live Provider configuration. The original Native foreground
focus case remains outside that inventory and unverified while the Mac is locked. Coverage is
assembled by case identity from terminal reports on the same unchanged application artifacts;
the two broad batches stopped at their failure limit and are not individually green.

Provider catalog, ACP registry/installation, Sync peer credentials and Remote login/Telegram
fixtures use real HTTPS requests from their current business owner through the public proxy
settings. The shared fixture restricts CONNECT authorities, scopes its public test CA to disposable
application processes, preserves certificate verification and owns transport/environment cleanup.
Native icon fetch and window presentation interception remain at their actual Main owner.
Obsolete Main-only business fetch and MockAgent interception are removed. No production source,
dependency or test case is added for this acceptance work.

The existing UI scenarios use the current Provider catalog and expand the sidebar before operating
on its rows. Attachment editing waits until the displayed input exists in the authoritative
Session projection; an optimistic bubble is not a persisted message receipt. Generated composer
screenshots use the test-owned output directory. The 17-case affected and remaining application
batch passes, including actual QR login, Telegram pairing/open/window replacement, legacy Sync
ciphertext, OAuth, held ACP refresh/repair, OCR and CLI approval. Scope, raw failures, final case
receipts and artifact hashes are retained under
`.deepchat/rutis-g5-kernel-assembly-acceptance/`.

The same 14 Provider/ACP, Sync, Remote, catalog and composer scenarios pass against immutable
`f511c078b`. The comparison uses the identical final fixtures and preserves the current patched
Undici install shared by both Main builds; it is not a pristine-dependency baseline. Current and
frozen application artifacts, dependencies and fixture hashes are verified after restoration.
No new build, Rust suite or unchanged performance matrix is selected for these fixture-only changes.

G5 remains active and unpublished. Remaining acceptance includes unlocked Native foreground
focus, sustained responsiveness/resource interpretation, supported native packages and whole-change
review. Signing/notarization remains a release gate. No performance improvement or G5 CI result
is claimed.

### Packaged default Core verification

The package workflows must launch the actual packaged app, rather than infer default Core startup
from the Admission/Memory subprocess check. Reuse the existing startup suite and settings case for
normal startup/graceful retirement, pending encrypted-startup quit, Core owner failure/profile reopen
and acknowledged settings persistence.
Run them on each of the existing six native targets with disposable fixture-owned profiles, no
retries and resource timing capture disabled. Linux uses Xvfb and the existing packaged launcher.
Do not introduce a separate mocked Kernel, test-only startup route or new smoke suite.

The local verification uses the accepted current build in an unsigned unpacked macOS arm64 package;
native target CI results remain unproven until the complete source is published. Developer acceptance
and screenshot directories must be excluded from the application archive. Keep compact raw results
and remove the disposable package after acceptance. Native focus and responsiveness requirements
remain separate; these packaged startup cases do not establish either.

Quit awaits the existing startup completion promise before resolving its shutdown owner.
Update-install preflight also waits before clearing permissions and retiring Core, preserving
lifecycle-log order. A visible main window must not expose a gap in which quit falls through
without a Core shutdown owner while the splash-close transition is pending.

Database maintenance fences credentials before awaiting Native configuration pause or
Provider/ACP preparation. A preparation failure restores credentials
and admission only after Native configuration acknowledges resume; shutdown during that wait keeps
the old generation fenced. An uncertain Native pause fails the owner and completes cleanup before
reporting failure.

Local macOS arm64 verification passes all three packaged application cases with zero retries and
resource capture disabled. Normal quit is graceful and preserves startup/shutdown JSONL order;
Core failure permits profile reopen, and settings revisions survive Main clock rollback and
relaunch. The ASAR contains neither `.deepchat` nor `.amp`; packaged Main, Exec utility, Core and
Rust host hashes match the normal build. Bundled Node integrity checks remain enabled.

The same Core/Rust artifacts pass 141 relevant checks across 11 files, including actual SDK/native
SQLite, and 21 development-app cases covering credentials, database encryption/maintenance,
ACP repair, streaming and Native resource retirement. The final Root startup wait is verified by
the packaged cases. Two recovery/stop cases are retained in the existing database ownership test;
no new suite or production control interface is introduced.

An outer macOS sandbox offline probe could not initialize Chromium's nested sandbox/SingletonSocket;
its three cases never reached application acceptance. It does not establish offline startup.
The successful package uses the standard launcher and retains normal web security. This unsigned
local package omits optional bundled plugins/helpers and does not establish complete distribution
or six-target CI acceptance.

The owned temporary package (1,361,376 KiB) and 21 ended media/trace files (1,915,826 bytes) are
removed after all readers exit. Raw reports, classified failure metadata and one immutable baseline
remain. The retained `.deepchat` evidence is approximately 318 MiB, including the 207 MiB baseline.

### Offline Core and failure boundary

The default application starts, persists a settings change, quits gracefully and reopens that
change while macOS denies external IP egress to the actual Rust host and its Core descendants.
Both launches record the Main parent PID and the host's pre-exec checks: a TEST-NET external
connection fails with `EPERM`, while loopback works. The temporary test entry imports the unchanged
normal Main build after wrapping only the Rust host spawn; it assembles the real profile and
Kernel, with no alternate backend or production switch. Native Main and Chromium retain normal
security and are outside this network restriction. This proves Core startup without external
egress, not whole-application or packaged offline distribution.

The application case passes once with zero retries and resource capture disabled. A preliminary
run using `NODE_OPTIONS` did not observe any restricted Core host; its three green ordinary smoke
cases are not offline evidence. Keep the explicit process receipts and raw results, then remove
the temporary entry, preload, sandbox profile, probe and test.

Boundary review confirms that business route snapshots retain bounded queues and recheck the
original caller guard before dispatch, while Main constructs no profile/database writer or business
Kernel. The default Core failure callback retires Native owners and exits the desktop generation;
the verified failure/reopen cases do not establish in-place Core restart. The RFC describes that
same failure policy. Whole-change review remains open.

### Sustained delegated-stream responsiveness

Select one current/frozen pair of the existing eight-delegation application scenario with six
active children and two queued. During the 30-second observation window, each active local Provider
stream emits one small content fragment every 20 ms. Enter 120 trusted CDP keyboard characters at
a 250 ms cadence into the visible composer, preserving its complete unsent text and all existing
admission/cancellation/completion/shutdown assertions. There is no new production path or retained
test suite. Reuse the sole frozen baseline and the same current dependency installation.

Record each input event through two animation frames as a paint-opportunity proxy, plus browser
Event Timing entries when available; report the latter's minimum-duration sampling explicitly.
Record Main event-loop delay for the observation window and process-tree footprint/CPU at the
existing 500 ms interval, retaining startup samples separately. First establish that trusted input
and animation frames are observable; do not interpret missing frames or Event Timing as zero
latency. The Mac's lock/foreground state remains a measurement limitation, and this capture does
not replace Native focus or physical keyboard-to-display acceptance.

This new sustained workload addresses the unmeasured interaction window; it does not repeat the
earlier short resource matrix. One pair is structural evidence, with no universal speedup claim
or CI wall-clock gate. Preserve every sample. A suspected material regression may select at most
one confirmation pair under the execution rule; inconclusive variance stops measurement rather
than triggering retries. Functional draft preservation, owned teardown and unchanged artifact
restoration remain blocking. Remove the temporary scenario and ended media after inspection.

The selected pair passes on both builds: all 120 trusted inputs remain in the unsent draft, seven
delegations finish, one queued delegation is interrupted and both app generations quit gracefully.
The active window spans 29.76 seconds per build, with 59 process-tree samples each; nine current
and seven baseline startup/outside samples remain in the raw reports. All current/frozen artifacts
and shared dependency hashes are restored, with no extra output copy retained.

| Active-window observation                      |       Current | Frozen baseline |
| ---------------------------------------------- | ------------: | --------------: |
| Input to two-frame proxy p95, ms               |          12.0 |            11.9 |
| Sampled browser keydown presentation p95, ms   |            24 |              24 |
| Main loop p95 / p99, ms                        |     12.1/12.6 |       12.5/13.1 |
| Main footprint median, MiB                     |         132.6 |           327.4 |
| Total footprint median / peak, MiB             | 1082.2/1198.6 |   1038.3/1160.7 |
| Process CPU delta over sampled window, seconds |          5.99 |            5.12 |
| Stable process count                           |             9 |               8 |

The browser observer returns 109/118 measured-window keydown entries with a 16 ms minimum and
rounded durations; omitted inputs are not zero-latency samples. All 120 inputs have a two-frame
proxy. DOM visibility/focus are true while IORegistry reports the Mac locked, so these observations
do not establish Native foreground or physical display behavior. Total footprint median/peak are
higher with Core, despite Main's lower footprint; the final active samples are 982.6/998.4 MiB,
which demonstrates why a last sample alone cannot establish settled idle cost. CPU is also higher
in this one pair. Input latency is similar here, and variance remains unproven.

This completes the selected sustained workload and resource interpretation for structural G5
review. No confirmation pair, unchanged benchmark rerun or performance gain claim is selected.
Native foreground focus and whole-change review remain open before coherent publication; exact-head
required/native-package CI must pass before G6. Keep the raw measurements and remove the temporary
scenario rather than adding a permanent benchmark suite.

### G5 startup quit and profile preservation

Application quit cancels pending and future database unlock/recovery requests before awaiting the
existing startup completion promise. The Core startup failure path still retires its generation and
releases the exclusive profile owner before exit. Intentional quit suppresses the startup error
dialog; ordinary startup failures retain their existing reporting. Ready-window quit and update
installation retain their startup/shutdown ordering.

A real encrypted-profile reproduction on the preceding normal build remained alive after the
existing 10-second lifecycle deadline: quit waited for startup while startup waited for a password.
The temporary reproduction is removed. One durable case in the existing startup suite requests quit
at the password prompt, checks exit code zero and absence of error dialogs, then unlocks the same
owned profile and verifies the persisted setting. The Splash display suite covers cancellation of
both pending and future unlock/recovery requests. Existing environment setup uses Vitest stubs and
restores the inherited environment after each case.

The normal build, format, i18n, lint and source types pass. Relevant lifecycle checks pass 42 cases
across three files. The affected development application run passes 24 cases; the new quit case
passes separately after its cleanup retains the original ChildProcess handle instead of reading a
released Playwright object. The initial cleanup failure remains in the raw report. No product
assertion or timeout is relaxed, and the other 24 cases are not repeated.

The actual unsigned macOS arm64 package passes all four selected startup/settings cases with zero
retries and resource timing disabled. Its Main, Exec utility, Core and Rust hashes match the normal
build; the ASAR excludes `.deepchat` and `.amp`, and bundled Node integrity checks remain enabled.
The four-case selection is wired into the existing six native package targets. Local package
acceptance does not establish their CI results or signed distribution.

After all package readers exit, the owned 1,351,404 KiB verification directory and eight ended media
files (1,032,437 bytes) are removed. Compact raw reports and the sole immutable baseline remain;
`.deepchat` occupies approximately 321 MiB, including the 207 MiB baseline. No process/resource
placement changed in this fix, so the accepted sustained comparison retains its original Main build
scope and is not repeated.

The corrected test explicitly selects the Splash document and bounds failure cleanup to processes
it owns. That selection passes on the current normal build. The immutable `f511c078b` build does
not display the password input after the same encrypted-profile setup, so its run never reaches the
quit action and is not a valid behavior comparison. The first attempt also exposed unbounded test
cleanup; both failed reports remain, with no baseline pass or product regression inferred. The
failed process is retired, the frozen output is returned to its original location, and current
artifact/dependency hashes are verified. No further unchanged baseline run is selected.

The source review covers default composition/profile ownership, maintenance and shutdown ordering,
renderer identity and revision fences, bounded dispatch, Native HTTP/Browser/Exec retirement and
package boundaries. It identifies the startup quit cycle and stale Main-only architecture text;
the lifecycle fix and the developer guide, architecture and flow descriptions now use the actual
Core/Native split. G5 remains active and unpublished. Original Native foreground acceptance still
requires manual Mac unlock. The extra frozen manual-password scenario remains unverified; the quit
fix uses its confirmed preceding/current normal-build reproduction rather than this additional
setup, and no further frozen manual-password run is selected. Required checks
and all six native packages must pass on the eventual coherent published head before G6.

### G5 Native foreground acceptance and publication

After manual Mac unlock, the unchanged original Browser route case passes on both the current
normal application and immutable `f511c078b` baseline, with zero retries and resource capture
disabled. It verifies actual Electron window visibility/foreground focus, active Browser content
focus, rejection after Session deactivation, status/events and destruction. Both runs use the same
source case and fixture-owned disposable profiles. Native focus is established by the actual
BrowserWindow; this acceptance makes no physical-keyboard/display latency claim.

The baseline is selected by directory rename, then returned to its original location. Current Main,
Exec utility, Core, Rust and dependency hashes match the accepted startup-quit build after restore;
there is no copied output tree or remaining application reader. The initial invocation selected no
tests because its start-anchored grep omitted Playwright's file prefix; it launched no application
and is excluded from acceptance. The corrected selector lists exactly one case before execution.

This closes the system-lock blocker. Selected local G5 behavior, ownership/resource interpretation
and source review are complete at their documented scopes. The extra frozen manual-password setup
remains unverified and has no further unchanged run selected; the quit fix uses its confirmed
preceding/current normal-build reproduction. Existing package and sustained resource evidence keep
their original artifact scopes and are not repeated.

Publish the complete G5 source and default wiring to the existing Draft PR after final routine
checks. Required checks and all six native verification packages must pass on that published head
before G6 starts. G6–G12 remain intact and unstarted; the PR is not merged. The published CI result,
not local macOS acceptance, establishes the remaining supported-platform verification.

### G5 current dev integration

The current `dev` adds centralized Provider Catalog ownership and subagent model-selection fixes.
Their composition stays inside Core: ACP catalog replacement and imported model invalidation use
`ProviderRuntime`; subagent selection receives the availability predicate and the sanitized
execution snapshot. Main retains the G5 Native composition and does not reconstruct these business
owners. Upstream providers, renderer projections and catalog contracts are preserved.

Detached catalog revalidation, config refresh and explicit refresh execute their entire fetch and
commit in the existing database request scope. Maintenance drains accepted refreshes before
rekey/import; shutdown starts HTTP retirement and drains requests before releasing the profile.
One existing catalog test covers a detached refresh holding maintenance until its write commits
and rejects a new refresh during maintenance. The catalog writer guard also scans `src/harness`.
The obsolete renderer catalog-cache invalidation calls are removed with the cache that `dev`
replaced; renderer subscriptions forward the authoritative backend notifications.

The integrated normal build, format, i18n, lint, renderer architecture baseline and generated-icon
checks pass. All 19 selected actual-app startup/provider/delegation/maintenance/ACP cases pass at
their recorded scopes: 18 in the initial run, with the remaining provider case passing after two
obsolete picker-toggle clicks are removed. The picker now correctly shows all catalog models
when only a custom model is enabled; credential, selection, persistence and error assertions remain.
The 18 successful cases are not repeated.

Catalog/Provider Runtime checks pass 57 cases across three files, including the detached-refresh
drain regression. A mock gains the new catalog-state method, and its unused ACP fixture follows
the current async ports. Targeted test types and lint pass. Model picker/store tests pass; renderer
API client tests pass 53 cases after deleting an obsolete test of the removed renderer catalog
cache. No production API is restored to satisfy that test. Earlier artifact evidence keeps its
original source scope; no unchanged performance matrix or package rebuild is selected.

Publish the conflict-free integration, then require exact-head checks and all six native packages
before G6. Merge-conflicted pull requests cannot start these pull-request workflows. The PR remains
Draft against `dev` and is not merged.

### G5 shared package dependencies and CI acceptance

The desktop package places the Harness dependency closure in the shared unpacked `node_modules`
directory. Native payloads are included once; Core and Memory resolve them through Node's parent
module lookup. Development and standalone output retain their complete local dependency closure.
The Rutis runner resolves from the first-party entry's package anchor. DuckDB native/API identity
validation remains mandatory. Package-size budgets are unchanged.

The portable dependency closure excludes package test fixtures, source maps, type declarations
and Windows debug symbols. Runtime JavaScript, native libraries/helpers, package metadata and
licenses remain. These files otherwise bypass electron-builder's normal dependency filtering when
copied through `extraResources`. The selected installed dependency payload falls from about
320 MiB to 259 MiB; this is disk usage, not a process-memory or latency result.

The existing native Memory integration fixture uses the actual electron-builder resource matchers
and exercises the shared dependency layout outside the checkout. Admission still exercises the
standalone closure. The Core failure acceptance identifies its owned settings window through the
Playwright BrowserWindow handle, avoiding URL equality while preserving failure, exit and profile
reopen assertions.

Main CI fixture corrections reset queued process mocks between cases, recognize the real working
directory on Linux, pass the explicit Provider environment, and use the current Tape port and native
workflow step name. Tape tool rejection still verifies no available query method is called. No
production compatibility API or platform skip is added. The eight selected test files pass 189
cases; the normal build and repository format, i18n and lint checks pass. The actual-app Core failure
and profile reopen case passes with zero retries. The unsigned local macOS arm64 package passes all
four selected application cases and native Memory read/write, restart, reset and physical shutdown.
Its archive excludes developer artifacts, and its Harness has no duplicate private dependency tree.
Bundled plugins are absent from this local verification; it establishes neither installer size nor
signed distribution. Supported-platform packages and original integrated Native foreground acceptance
remain pending; G6 cannot start until the exact published head passes.

Required PR checks pass on `4046f417c`, including 10,360 Main cases with the eight existing skips.
Its Windows x64 and Linux arm64 packages pass; Linux x64 and macOS arm64 still exceed the size
budgets. Runtime payload filtering passes the three affected suites, 47 cases, plus matching text
extraction for a 14-page PDF and a real PTY child exit. An unsigned macOS arm64 package outside the
checkout passes the four Core/settings cases, an additional actual-app PDF extraction case and the
native Memory smoke. The temporary PDF acceptance driver is removed. Bundled plugins are absent
from this local package, so installer-size and complete platform acceptance still require CI for
the published filtering source; this evidence does not establish G5 completion.

### G5 completion

Source `1719f8075bae3423dfd193166b56ccb024859896` passes required
[PR checks](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41300270510) and all six
[native verification packages](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41300270522).
Main reports 714 passing files, two skipped files, 10,360 passing cases and eight existing skips.
Every package target executes and passes DuckDB VSS, Memory, Core application, OpenDAL, offline
OCR and installer-size verification. No critical step is skipped and no size budget is increased.

The same source's normal output passes the original Browser route case after manual Mac unlock
on 2026-11-02: one case, zero retries, no resource capture. Its actual Electron BrowserWindow is
visible and focused; active Browser focus succeeds, inactive focus is rejected, and status/events
and destruction pass. The unchanged case also has accepted immutable-baseline evidence above.
This closes integrated Native acceptance; it makes no physical-input latency claim. The earlier
auto-locked failure remains in the raw record.

Default business composition and the sole shared writer are in Core; Main holds authenticated
ingress and Native ports. Functional, fault, lifecycle, package and selected resource evidence
meet the structural cutover requirements at their documented scopes. Main footprint is lower,
while aggregate footprint and sampled CPU are higher in the one sustained pair; no general speed
or memory improvement is claimed. Signing/notarization and complete offline distribution remain
release gates. G5 is complete, the PR remains Draft/unmerged, and G6 may start. Compact receipts
are in `.deepchat/rutis-g5-kernel-assembly-acceptance/`; ended packages have been removed.

## G6. Extract the complete Memory capability

Placement: one first-party `deepchat-memory` Rutis row in the existing Core worker, loaded before
the Core row. Preserve the lazy G3 native vector worker. Attach the current owner-local Store,
Provider, policy and change-event ports once; keep the ingestion coordinator in Harness and bind
its observer explicitly. Move Memory construction and pause/drain/resume/retirement into this
capability, then remove their manual Kernel/maintenance wiring. All domain consumers share its
one facade, preserving existing synchronous transaction and epoch checks without a new RPC.

Validation selection: compare the existing Agent CRUD, Memory lineage/impact, native vector
relaunch/loss and database-maintenance application cases on unchanged G5 output and the extracted
output. Run affected native Memory, evaluation, ingestion and SDK lifecycle coverage; retain only
missing unload/revoked-epoch regression protection. This owner-local extraction adds no process,
IPC or storage path and has no speed objective, so no additional resource capture is selected.
Verify unchanged worker placement in the actual app and retain all baseline/candidate receipts.

- [x] Move the existing facade and internal retrieval/extraction/reflection/persona/directive/
      maintenance services into one TS plugin. Preserve policy, Provider execution and Store ports;
      keep Harness ingestion scheduling and execution fences explicit.
- [x] Replace synchronous cross-boundary assumptions with versioned reads and authoritative
      epoch-validated operations. Retarget prompt injection, memory tools, management routes,
      Agent lifecycle, cursor settlement and maintenance as one complete service migration.
- [x] Compare scope/temporal/tombstone filtering, recall quality, mixed-language budgets,
      directive approval/trust, FTS/vector degradation, CAS/audit/lineage, background drain,
      config changes, Agent delete and database maintenance in the real app.
- [x] Review resource/quality evidence, run native/evaluation and relevant E2E checks, and remove
      the old Memory facade construction and manual lifecycle wiring after parity.
- [x] Publish the coherent G6 source and require exact-head PR checks and all six native
      verification packages before G7. Keep this goal active until those checks pass.

Completion: all consumers use the one capability; plugin unload/recovery cannot advance an
unsettled cursor, reuse a revoked execution token or resurrect forgotten data.

The Rust host loads the Memory and Core rows in one existing runtime. Only the Memory plugin
constructs the facade in application source. Core supplies the same live repository, policy,
Provider and vector ports; prompt contribution, ingestion, tools, routes and Agent cleanup share
that instance. Kernel startup/retirement and database maintenance call its coordinated lifecycle,
with no remaining manual facade construction or separate ingestion-disposal sequence.

Local validation passes the normal build, 986 Memory behavior cases across 56 files, seven
retrieval-quality cases, 372 native cases across 20 files (two existing Windows-only skips),
22 actual SDK/admission cases across three files, and eight Rust cases. The one new durable test
loads the actual Rutis plugin and holds extraction across unload: ingestion fences, the old
execution token is rejected, no late row is written, and the retired attachment cannot reopen.
Tokens bind the facade instance identity and Agent epoch; a reloaded plugin rejects an old token
even when its numeric Agent epoch matches, while accepting its own token. The existing unload
case provides minimal characterization of that recovery boundary without adding another case.
Existing tests retain scope, temporal, CAS/audit/lineage, cursor and maintenance coverage.

Both unchanged G5 output and the extracted application pass the same 12 selected scenarios:
Agent CRUD; Memory lineage/impact; native vector persistence/deletion/clear; nine-Agent store
convergence, model changes and worker loss; five database-maintenance/shutdown cases; prompt
policy/trust; and nonempty Agent namespace deletion across relaunch. The initial baseline Agent
launch closes its renderer session before actions; its raw failure is retained, and a targeted
diagnostic run passes. Nine other baseline scenarios and ten candidate scenarios pass in their
original batch. No product change is attributed to that initial failure.

The policy comparison preserves historical search evidence while current prompt recall excludes
expired states, foreign-project content and forgotten rows. Unapproved directives stay outside
the instruction lane; approval enables them. Fact text cannot forge the directive container.
Mixed-language budget/selection manifests match exactly: 234/256 total tokens, one selected fact
and one budget-dropped candidate. Agent deletion retires both claim and directive visibility after
restart. Temporary application policy/retirement drivers are removed after acceptance.

Actual SDK and application cases verify the shared owner and existing lazy vector lifetime; this
change adds no Node worker or data-path RPC and makes no speed/RSS claim. Baseline and candidate
outputs are restored by rename and all file hashes verified. Compact raw evidence and the sole
needed baseline are in `.deepchat/rutis-g6-memory-capability-acceptance/`. Normal Provider/ACP
registry refreshes are retained. Signed distribution remains release-gated.

Same-ID Memory row refreshes preserve the inline editor's draft and delete confirmation. The
reset watcher compares Agent, memory ID and mode as separate sources, so a freshly loaded row
object cannot reset those local states. The existing real-dialog regression also verifies a row
refresh preserves the draft, confirmation and subsequent progress/error behavior. DOM, layout,
preload and IPC contracts are unchanged.

The instance-fence validation passes 986 Memory cases, 372 native cases with two existing platform
skips, seven quality cases, 383 Harness/plugin cases and 11 focused context/plugin cases. Its
policy/selection/allocation receipt matches the unchanged G5 baseline exactly. The application
batch passes 11 scenarios and exposes the inline-reset race above in the remaining impact case;
affected lineage/impact acceptance then passes both original cases with zero retries, retaining
all original receipts. Together these establish the same 12 selected application scenarios;
the ten unaffected successful cases are not repeated for the local watcher change.
The Memory renderer selection passes 63 cases across three existing files. Only the one new
plugin lifecycle case is retained; existing component and token fixtures are extended in place.

G6 completion: published source `bd64c2d53a903cdcc6096ccab01848a6d3179e19` passes
[required checks](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41401181090) and all six
[native verification packages](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41401181085),
including both aggregate barriers. Main has 715 passing files, two existing skipped files,
10,361 passing cases and eight existing skips. Every platform executes and passes DuckDB VSS,
Memory, Core application, OpenDAL, offline OCR and unchanged installer-size verification.
The critical steps are successful, not skipped. The whole-goal audit confirms the sole facade
constructor is in the Memory plugin and replaced lifecycle wiring is absent. The PR remains
Draft against `dev`, mergeable and unmerged. Compact evidence includes
`six-platform-completion-audit.json` under the G6 acceptance directory. G7 may begin; signed
distribution remains release-gated and no performance improvement is claimed.

## G7. Migrate the control owner to Rust

Admission queues/permits belong to `crates/deepchat-harness/src/admission.rs`; scope, Run,
interaction and input control belong to the Rust control owner. The default-wired group is
published at `f1b425e4be3b28f496b446c5987fdf59363ae84e`. Its local functional acceptance and required
PR checks and all six actual native package targets pass, including both required aggregates.
G7 is complete; G8 records the selection no-go below.

The Core worker retains Provider/loop effects, AbortControllers, rich Run data and shared-database
transaction closures. Instance, Run, operation and message fences span `DeepChatAgentRuntime`,
`DeepChatAgentInstance` and `RunLifecycleCoordinator`; Rust grants and acknowledgements govern
interaction, input and effect transitions through their local drivers.

Source audit identifies a concrete distributed-settlement constraint: `DurablePendingInputClaim`
records a disposition even when post-persistence publication fails or durable verification is
unavailable. Preserve that fence across lost replies; do not translate an RPC rejection into an
automatic release/retry. Instance/controller identities, symbol drain leases, interaction locks,
resume exclusion and Provider resolvers must be classified as control authority or local effect
handles before defining the wire contract. `LoopRun` also contains messages, stream state and
prompt/tool resources that remain TS data, rather than moving the complete object through RPC.

The remaining caller audit also includes Provider permissions, transcript mutation, Session
settings, compaction, context-occupancy projections and stream-request identity. Input preparation
has separate send/steer acceptance lanes. Its per-Session queue limit is ten, distinct from the
delegation owner's six-active/256-pending limits. User-fact creation and claimed-row linking are
one local Store transaction. The synchronous pre-stream callback consumes a manually resumed
claim once before rate-gate waiting or Provider streaming; an async RPC cannot be inserted as an
unawaited callback. Rollback requires the current instance, while originating Run/controller
cleanup may settle after replacement. Provider permission callbacks also have expected-object
identity and may use an empty tool-call ID; do not apply a generic nonempty-ID rule to every field.
The loop's 128-tool execution limit does not prove a matching legacy interaction-hydration bound.

- [x] Inventory the complete cluster's writers, synchronous checks, awaited effects, durable
      claims/dispositions and recovery paths; define bounded operation-level transition commands
      and their accepted/stale/cancelled/unknown outcomes in the RFC before implementation.
- [x] Select the same public application control/interaction workloads for immutable G6 baseline
      and candidate comparison. Keep resource observations informational; do not add further
      performance sampling, a relative CI timing gate or a process per helper.

- [x] Move admission queue/permit authority to Rust as a complete slice, preserving ordering,
      cancellation/late grants, fairness and diagnostics. Delete the TS queue owner after E2E parity.
- [x] Move Run transitions, interaction parking/cancellation and pending-input settlement as one
      cohesive control owner. Preserve instance/run/operation/message fences and durable claimed
      dispositions; do not proxy individual checks or create two run registries.
- [x] Keep loop/Provider/tool effects behind bounded operation-level calls. Define revalidation
      around awaited durable operations and deterministic event ordering back to TS consumers.
- [x] Compare all control/recovery behaviors in the actual app and remove replaced TS control
      ownership. Preserve existing resource reports without additional performance sampling;
      verify architectural changes without claiming an unmeasured speed gain.
- [x] Publish the verified control group to the same Draft PR; verify required CI and all six
      actual native package targets on that exact source before G8.

Completion: the Rust owner is authoritative, public behavior and lifecycle/recovery semantics are
verified, required checks pass and replaced control wiring is removed. Existing resource reports
are informational; further performance sampling does not gate this structural migration. This
phase need not eliminate the TS runtime used by Provider/protocol adapters.

### G7 admission slice and acceptance

The admission slice moves its complete owner into the existing Rust host and removes the
dedicated admission TS runtime. Its acceptance is separate from the cohesive control-group
verification below; admission alone does not complete G7.

Use accepted source `bd64c2d53` and its verified normal output as the immutable G7 baseline.
Compare unchanged `01-launch`, `36-chat-streaming` and `44-admission-delegation` actual-app cases,
with disposable profiles, zero retries and the same local Provider fixture. Delegation exercises
two parent Sessions, six executing children, two queued children, queued interruption, release and
the final seven-completed/one-interrupted result. Existing actual-host suites also cover owner
fairness, owner headroom, suspend/resume, pre-abort/late grant, closure, host loss, caller ordering,
generation retirement and oversized-frame teardown. Retarget obsolete TS-owner tests to useful
Rust or actual-host behavior coverage; do not retain a second implementation solely for tests.

Process placement changes, so capture one baseline/candidate delegation resource pair using the
existing observer, including the whole process tree. The structural objective is one fewer idle
Node runtime and one Rust admission authority. Retain the existing 64-MiB settled/128-MiB active
peak footprint allowances and report startup, CPU and loop-p99 alongside the G3 reference limits
(`max(100 ms, 2 x baseline MAD)` readiness, `max(10 ms, 2 x baseline MAD)` loop-p99).
One pair cannot establish variance or a speed gain. Investigate a concrete suspected material
regression with at most one confirmation batch under the RFC's measurement rule. Shared CI timings
remain report-only. Production deadlines, queue and transport bounds remain unchanged.

Freeze and verify the G7 baseline before changing build output. Once that replacement baseline is
verified, remove the ended G6 source-`1719f8075` output tree and retain its compact manifest and
acceptance receipts. Do not accumulate completed acceptance packages or profiles.

The default admission implementation and its old-path cleanup are locally verified. Main and Core
share the Rust queue through separate ordered lanes. The dedicated TS admission runtime, its
plugin and queue implementation are removed. Readiness protocol 2 reports a Rust owner; actual
native workers retain independent executable/ABI checks. Service tests use the real Rust owner;
there is no retained TS queue solely for fixtures. Three Rust cases protect scheduling/cancelled
reply cleanup, plugin retirement and bounded diagnostics, while three client cases retain input,
hostile-correlation and known-ID late-grant protection.

Both immutable baseline and candidate pass the same seven actual-app cases: five launch/recovery
cases, editable streaming and the delegation workload. Zero retries. A normal full application
build and final host build pass. Local validation passes 11 Rust tests, 33 client/actual-host/package
cases, 294 delegation/tool consumer cases, 94 native-vector/tool-service cases and 16 Core/Memory
lifecycle cases. These scopes are separate; intermediate reruns are not additional coverage.
Format, i18n, lint, Node/web types and locked Cargo fmt/clippy pass; lint retains the existing
unrelated Remote `no-unsafe-finally` warning. Source `1b054b22a` passes
[PR Check](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41408347659) and
[Package Check](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41408347398), including both
required aggregates. Main has 714 passing files, two existing skipped files, 10,338 passing cases
and eight existing skips. All six macOS/Windows/Linux x64/arm64 packages actually execute and pass
the six critical native/installer-size steps; none are skipped. Compact audit:
`admission-six-platform-completion-audit.json`. This completes admission acceptance, and the next
The cohesive control group is accepted separately below; admission evidence remains valid.

The single delegation resource pair observes Rust-host direct runtime children decreasing from
two to one. Whole-tree sampled footprint median is 1036.26/964.03 MiB and sampled active peak is
1083.12/1153.15 MiB (baseline/candidate): the peak increases 70.03 MiB, within the 128-MiB allowance.
Observed process-lifetime CPU totals are 8.4167/6.4002 seconds, UI readiness 2624.04/1923.68 ms and
Main loop-p99 29.25/27.36 ms. There are 11/7 time samples across unequal fixture durations. These
are descriptive observations, not repeated-run variance, stable settled-idle evidence or a speed
gain. No material over-budget sample selects a confirmation batch. Raw reports and the calculation
method are retained in `admission-resource-pair.json`; no unchanged benchmark rerun is selected.

The G7 baseline is accepted source `bd64c2d53`, verified across 2187 output files. The ended G6
source-`1719f8075` baseline is removed after verification, freeing 353,330,090 bytes; its manifest
and compact receipts remain. The full G7 control acceptance is recorded below.

### G7 control owner implementation status

The accepted source `f1b425e4b` contains the Rust scope/operation/Run state machine, the private
generation-authenticated asynchronous Native command, the bounded Core command client and local
effect-handle driver. Default Core assembly passes this port into the Harness. Instance creation,
Run registration/replacement, cancellation, readiness, status and originating cleanup use Rust
receipts. Turn, interaction, compaction, settings, prompt/tool resolution and transcript-mutation
callers await the required grants. Retiring a scope fences local handles immediately; the Rust
record retains originating Run cleanup. Status carries an explicit originating owner, and local
finalization runs while applying its Rust receipt, before the next command can replace that owner.

The synchronous Rutis method was rejected after inspecting the SDK's unbounded session pump.
Finite asynchronous transitions use prepare, synchronous local fencing and commit acknowledgement.
Timeouts fail the Core generation; queued work and late replies cannot revive its effects. No
additional runtime, dependency, feature flag or alternative control owner is introduced.

Rust now owns interaction, resume and drain exclusion through exact originating leases, and
Session parking survives Instance replacement. Destruction revokes older scopes' parking authority.
The separate send/steer attachment FIFO lanes also belong to Rust: queued calls return tickets,
release receipts grant the next waiter, and cancellation retains predecessor order. Active
preparation holds its lane across scope replacement; its driver checks the originating scope
before input writes. Root ticket count/metadata are bounded at 1024/16 MiB. TS retains only waiter
resolvers and opaque granted lease handles. The Instance lock/resume sets, symbol drain slot,
attachment promise-tail map and separate `InteractionParkingRegistry` are removed. Session
destruction fences the originating Instance before awaiting Rust cleanup.

Provider permission selection and once-only resolution now belong to Rust. Callback objects stay
in TS under Rust-selected IDs, registration is acknowledged before stream notification, and
cancellation denies the originating callbacks. Deferred tool controllers are children of exact
interaction/Run leases; duplicate acquisition is busy and parent revocation fences the child.
The Instance resolver/controller owner maps are removed. Operation reuse carries an explicit Run
identity for status and local cleanup, preventing an old Run from settling a newer Run.

Interaction references, stable order/origin reconciliation and tool-batch invocation/commit/pending
IDs now belong to Rust. Status and pending projection change atomically. TS retains the execution
contract under the Rust-selected batch ID. Handlers ask Root to validate the first interaction and
its exact lease; positive Provider/deferred grants repeat that validation. The resolved transcript
is persisted before advancing the pending projection.

The final Rust owner passes 22 cases and scoped Clippy with warnings denied. The actual Rutis/Core
boundary suites pass 19 cases, with the expanded driver contract independently passing against
the final unified host. They verify batch identity/opaque contract retention, Root order and
first-item grants, duplicate advance, old-Run projection rejection and originating claim/drain
cleanup. Main process effects are covered by the complete checks below.

Input selection, claim/effect dispositions, active steer identity, restart/manual holds and wake
priority are now default-wired to Rust. Claimed-row writes require a prior Root grant and a
synchronous Store-summary recheck. User facts retain their SQL transaction, and manual pre-stream
consume uses a fixed preauthorized ticket. Applied/unknown outcomes cannot authorize release or
replay. Rust blocks Run/operation replacement during an unacknowledged user-fact or rollback;
originating negative cleanup remains valid after retirement. Promotion reserves its steer effect
before releasing the preparation claim, closing the new cross-RPC claim window. A pending enqueue
receives an explicit Root wake decision, so an event recorded during generation cannot become an
error-state retry later.

Startup and database reopen await Root recovery. Current claim, steer and drain references reject
recovery without state mutation. Maintenance fences local tickets, drains background turns/effect
acknowledgements before switching the database, and awaits the imported holds before reopening
business ingress. Session destruction fences all originating local input handles and forgets
Session control only with its last scope nonce. A retired or subsequently replaced scope cannot
clear the successor's inputs, parking or acceptance lane. The generic drain acquisition/release
wire and Instance methods are removed; input selection is the sole grant path.

The unified normal application build passes, including Node/web typechecks, Rust host, Main,
renderer and CLI. Normal Provider/ACP registry refreshes are retained. The final affected group
passes 24 files and 903 cases without unhandled errors; a separate real-Rust promotion ACK gate
passes the release/reservation concurrency regression. The other Main run excludes those exact
24 paths. It passed 689 files and 9363 cases; two
remaining effect-only fixtures needed the new readiness method. After that localized correction,
the two files pass all 56 cases. Combined unique Main coverage is 715 passing files and 10312
passing cases, with two unchanged skipped files/four skipped cases. The failed original run is
retained in `control-remaining-main-tests.log`, and the correction is verified by
`control-remaining-fixture-tests.log`; the unchanged 903 cases are not repeated. These final
results are retained in `control-final-affected-tests.log`,
`control-final-affected-files.json`, `control-promotion-ack-gate-tests.log` and
`control-application-build.log` under the local G7 acceptance directory.

Existing effect suites use independent real Rutis hosts, with one shared bridge build per suite.
The old Admission fake-owner suite is removed; its four unique effect-failure protections are
retained in the real Harness suite, and existing Harness/Pump contracts cover the overlapping
public input behavior. The ownership guard tracks `beginInput`/`endInput` instead of removed drain
methods. Its thin-facade size allowance is 360 lines to include the required readiness, drain and
recovery forwarding ports; no control implementation moves into that facade.

The selected full control application workload covers ordered question responses, one continuation
per resolved batch, visible Steer with explicit cancellation, exactly-once input facts, and
held queues across graceful restart/manual resume. It uses the same local model/server gates and
public routes against immutable G6 source `bd64c2d53` and the candidate. Existing launch, streaming
and delegation scenarios retain their verified baseline evidence. Functional delivery, behavior
compatibility, recovery and required correctness/platform checks take priority. Additional resource
sampling is not selected and does not gate this structural migration; existing observations remain
available without a performance claim.

Both new public control cases pass against the candidate without resource observation. The
baseline passes ordered questions but changes one of two queued items to `blocked` during
graceful shutdown; the candidate preserves both as `pending` and completes manual restart
recovery. The baseline failure also reproduces without the observer. This is a characterized
baseline defect, and the candidate retains the strict queue-preservation assertion. The reports
and trace are retained without additional performance sampling. Each baseline comparison restores
and verifies all 2183 candidate artifact hashes before removing its temporary baseline copy.

The candidate additionally passes all 12 existing startup, streaming, delegation, database
maintenance, credential and shutdown application cases, with zero retries. These validate actual
public wiring and database reopen after the new input-effect drain. Reports are
`control-candidate-functional.json` and `control-candidate-regressions.json`; baseline findings
are in `control-baseline-functional.json` and `control-baseline-functional-swap-receipt.json`.

Whole-change review confirms one Rust control authority with local TS effect handles, no added
runtime/dependency/fallback, and removal of the replaced control paths. The group is committed and
pushed at `f1b425e4be3b28f496b446c5987fdf59363ae84e` on the same Draft PR. Its exact-source
[PR Check](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41572645470) and required aggregate
pass. [Package Check](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/41572645550) and its
required aggregate pass. Every macOS/Windows/Linux x64/arm64 target actually executes and passes
packaged DuckDB VSS, Memory runtime, Core application, OpenDAL, offline OCR and installer-size
verification; none of those critical checks is skipped. The compact actual-step audit is
`control-six-platform-audit.json`. This completes G7 on source `f1b425e4b`; the G8 selection
no-go is recorded below. No merge or release is performed.

## G8. Select measured Rust batch work

- [x] Inspect Tape/context projection, tool-output processing and Memory computation through their
      actual consumers, data owners and native bindings.
- [x] Decide whether a useful bounded Rust batch is justified before adding another protocol,
      implementation or dependency. The current selection is **no-go**.
- [x] Preserve the single existing implementation and actual consumer wiring for each rejected
      candidate. No alternate path, experimental flag or disposable benchmark is retained.
- [x] Review the decision against the functional priority and validate the documentation-only
      change. Runtime behavior and package inputs remain the accepted G7 source.

### Selection outcome

No CPU-oriented Rust batch is selected. This is a selection no-go, not a claim that the current
code is fast or that Rust cannot improve it. No measured CPU/allocation bottleneck establishes a
reason to add the boundary, and functional delivery takes priority over speculative profiling.
The audited mechanisms are concrete:

| Candidate | Current consumer and ownership evidence | Decision |
| --- | --- | --- |
| Tape effective view and replay/context projection | `TapeFactService.getMessageRecords` and `TapeRecallService.getEffectiveMessageSourceSpan` synchronously fold rows from the current Store. Replay consumes the same effective rows and canonical identities/hashes. | Retain the owner-local fold. Moving only computation to the separate Rust host requires transferring rows and projected output while keeping the Store/TS consumer. There is no selected bounded data-local operation or independent lifetime to justify that new boundary. |
| Tool-output processing | `ToolOutputGuard.fitToolBatchOutputs` already accepts a batch. Its fit policy consumes conversation messages, tool definitions and configured limits; fallback uses the existing Node filesystem artifact/cancellation path. | Retain the existing batch and offload path. Moving only scanning does not remove the caller, filesystem owner or TS runtime, and introduces context/output transfer plus duplicate policy/estimation semantics without demonstrated benefit. |
| Memory computation | Retrieval already batches embeddings and vector queries. Distance/order/limit execute inside native DuckDB. The remaining TS retrieval/refill policy caps candidates at 800 and applies current temporal, scope, lineage and ranking policy. | Keep native vector work and the bounded owner-local policy. A Rust wrapper does not change DuckDB's algorithm, and no significant residual scoring cost is established. |

The normative source-backed decision and links are in the RFC. Reconsider only after a concrete
stage bottleneck is observed or a compatible Store/data-owner move makes a bounded operation
local to Rust. No measurements, production changes, test additions or package rebuild are selected
for this no-go. Existing G7 functional and six-platform evidence remains applicable because only
the RFC and this tracker change. G9 is the next functional capability selection after publication.

Validation: all 39 local documentation links resolve. Repository format, i18n, lint and Node/web
typechecks pass; lint retains its existing unrelated Remote warning. The complete change from
accepted `f1b425e4b` is limited to this plan and the RFC. Application source, tests, dependencies,
resources and build/packaging inputs are unchanged; `electron-builder.yml` excludes documentation.
The accepted G7 real-app, required-CI and six-native-package evidence is therefore reused without
another build, benchmark or runtime-test batch.

Completion: the explicit evidence-backed selection no-go above. No Rust performance improvement
is claimed and no partial migration is left connected.

## G9. Extract peripheral services with independent useful lifetimes

- [x] Select one actual ownership group: process jobs/scheduler/watchers, documents/OCR/search,
      Knowledge/RAG, MCP/ACP connections, Skills/hooks or remote channels. Do not create all proposed plugins
      merely to match the capability map.
- [x] Reuse current native helpers and supervisors, preserve tool/route/registration permissions,
      and connect actual consumers through one generation-bound lifecycle owner.
- [x] Compare the module's real workload, unload/lost-reply/restart/revoke cases and resource
      envelope; account for idle Node processes removed or added.
- [x] Review, validate and remove the replaced manual wiring. Repeat only for another selected
      module with a concrete lifecycle or measured resource benefit.
- [ ] Publish this coherent source to the same Draft PR and pass required CI plus all six actual
      native package targets before starting G10/G11.

Selected: product Hooks, as defined in the RFC. The Rutis attachment owns actual HookService
construction and permanent retirement in the same Core worker; maintenance retains temporary
pause/drain/resume. This removes manual terminal lifecycle wiring and fences stale service
references, including partial Kernel construction. No extra worker, transport or supervisor.
The accepted `f1b425e4b` application build is hash-verified before the existing Hooks application
comparison; baseline evidence is under `.deepchat/rutis-g9-hooks-acceptance/`. No new performance
sampling is selected.

The default cutover is implemented. Rust loads `core-hooks` into the existing Core worker;
Core/Kernel pass its local capability to runtime composition, which no longer constructs
HookService. Kernel terminal cleanup delegates to the plugin's memoized retirement; Core cleanup
also retires an attachment left by partial construction. The existing observer/configuration/test
routes share that one service. Maintenance still uses temporary stop/start; retired service
references reject restart and Store configuration reads/writes. No compatibility switch, extra
worker, generic transport or alternate implementation remains. Idle Node process delta is zero;
the same-process SDK group keeps synchronous callback ports local. Transport loss remains covered
by the accepted Core generation retirement contracts; no Hooks-specific RPC was introduced.

Local verification:

- All 2,183 accepted application files match their manifest before baseline execution.
- The existing Hooks real-app workload passes both cases on baseline and candidate: configuration
  save/test/persistence across restart; real Session hook payload and shutdown waiting for native
  child stdio closure, followed by restart without replay.
- Candidate also passes the five existing database-maintenance/shutdown cases, seven actual-app
  cases total, zero retries. Import/overwrite/repair, encryption exclusion, delayed Native
  credentials and shutdown drains preserve temporary service recovery and Store ownership.
- Relevant Main tests pass: 17 files, 181 cases. One durable SDK unload case is added to the
  existing HookService suite: pending enrichment and child closure must drain; old references and
  configuration access stay fenced; a new plugin generation can open a fresh attachment. The
  suite passes all 40 cases after its final stale-read assertion. No parallel fake owner is added.
- Normal application/CLI build, Node/web types, Rust 22 cases, Cargo fmt, all-target Clippy with
  warnings denied, repository format, i18n and lint pass. The existing unrelated Remote lint
  warning remains. Normal generated Provider refreshes are retained.
- Independent ownership review finds no blocking issue. Application/native checks remain the
  authority for actual default assembly; no hot-reload or resource improvement is claimed.

The source includes `dev` at `145e51763`, retaining beta.8, dependency updates, Wally, Bowmark and
all sponsors. Lockfile integration keeps the upstream resolved dependency graph and adds the
existing Rutis/Provider patches. The HTTP shutdown fix is applied to the actual resolved
`undici@8.12.3`: retain child dispatchers until graceful closure so forced shutdown can still abort
held requests. Patch applicability and a real held-request self-check pass against the
integrity-verified official release. The new Bowmark/Wally fixtures use the required owner-local
Store/Provider environment ports. Frozen installation passes. Integration verification includes
the changed MCP/HTTP dependencies and file-search/Nowledge boundaries, without new test files.
The integrated build passes Node/web typechecks and the normal application/CLI build. Across
disjoint relevant selections, 44 Main files/658 cases pass; the new Wally environment fixture is
corrected and its 63-case file passes without repeating the 429 already-passing dependency cases.
All 11 integrated actual-app cases pass with zero retries: the two matching baseline Hooks cases,
five maintenance/shutdown cases, MCP stdio ownership/child cleanup, MCP App sandbox/consent/reopen
and two Native Provider authorization/HTTP shutdown cases. Format, i18n, lint and diff checks pass;
the existing Remote warning remains. Integration evidence uses `hooks-integrated-*` logs/reports
and `integrated-candidate-manifest.json`; the exact-source CI/native package gate remains open.

Evidence is under `.deepchat/rutis-g9-hooks-acceptance/`: `baseline-manifest.json`,
`hooks-{baseline,candidate}-functional.{log,json}`, `hooks-application-build.log`,
`hooks-affected-tests.log`, `hooks-final-service-tests.log`, Rust/static logs and the publication
receipt. Ended owned media/profiles are removed after compact receipts are retained.

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
