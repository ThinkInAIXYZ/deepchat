# DeepChat Harness and Capability Migration Plan

## Objective and completion rule

Extract a reusable Harness, Memory and peripheral capabilities through Rutis, then move selected
owners/computations to Rust where correctness, deployment or measured resource savings justify it.
Work on `dimagent/rutis-harness-bootstrap`, one complete module at a time. Replace actual app wiring,
run matching end-to-end baseline and migrated workloads, and remove the old path after parity.
There is no retained implementation switch or local fallback.

Current scope: research and documentation only. Admission is committed as `ffcd98770`
(`feat(harness): route admission through rutis`). The current deliverable is G1; G2 and later are
planned execution goals, not implementation started or authorized by this documentation task.

Use this file as the only tracker. [The RFC](spec.md) defines capability ownership, Memory
dependencies, Rust hypotheses, process placement and Everywhere contracts. Keep status and evidence
here as slices land; do not create a second task ledger. No GitHub issue or PR sync is requested.

## Live goals and dependencies

| Goal | State | Dependencies | Completion condition |
| --- | --- | --- | --- |
| G0 Admission | Complete, `ffcd98770` | Existing branch baseline | Default Rutis wiring, matching real-app E2E and old path removed |
| G1 Whole-capability roadmap | Complete; documentation only | G0 and source research | Capability map, Memory boundary, Rust ranking, ordered goals and honest evidence |
| G2 Baselines and first service contract | Planned; next execution gate | G1 | Reproducible resource baselines and frozen operation/ownership budgets |
| G3 Memory vector resources | Planned; first extraction candidate | G2 | Actual vector operations through Rutis, preserved native lifecycle and old factory wiring removed |
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

## G1. Source-backed roadmap: current deliverable

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

- [ ] Preserve immutable pre-admission and `ffcd98770` artifacts, runtime versions and isolated
      fixtures. Reproduce baseline workloads before using an old build as performance evidence.
- [ ] Profile idle/startup, streaming and delegation, large context/Tape, native Memory recall and
      background maintenance. Use at least five paired runs and fixed local Provider fixtures.
- [ ] Attribute CPU, allocations/GC, native time, provider wait, IPC bytes and per-process/aggregate
      memory. Identify the first actual bottleneck and an acceptable process/resource envelope.
- [ ] Freeze numeric target and allowed regressions before judging the selected implementation;
      record hardware, variability, workload sizes and whole-app measurement method here.
- [ ] Freeze the selected service's versioned schemas, bounded batches/results, caller identity,
      generation/operation IDs, cancellation, unknown outcomes, readiness and shutdown contract.
      Keep the admission gateway allowlist unchanged until a deliberate service protocol exists.

Completion: one concrete module and its placement have a measurable purpose and an executable
end-to-end comparison. Missing measurements do not justify a claimed Rust speedup or extra process.

## G3. Extract Memory vector resources through Rutis

- [ ] Retain DuckDB v2 in TS; move native handles and file-owner lifetime into one Rutis service.
      Keep existing lease/embedding policy coherent; adapt synchronous health/quarantine and
      object-returning factories through generation-bound resources and acknowledged operations.
- [ ] Connect actual Memory recall, embedding writes, deletion, rebuild and maintenance callers.
      Keep dense vectors near their resource owner and bound transfer without enlarging the
      admission JSON protocol indiscriminately. Use the existing TS runtime unless isolation
      evidence justifies another process.
- [ ] Compare real app recall/FTS degradation, model/dimension changes, more-than-eight-Agent
      resource convergence, clear/delete, native quarantine and shutdown against baseline.
      Preserve migration/WAL and new-process recovery rules; shared-runtime native death also
      loses its other plugins and must be accounted for.
- [ ] Review and validate the whole slice, including real native operations and relevant Memory
      performance/quality checks. Remove old native factory/lifecycle wiring after parity.

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
      MCP/ACP connections, Skills/hooks or remote channels. Do not create all proposed plugins
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
- All results are local macOS arm64. Signed release packages, Windows/Linux execution and paired
  responsiveness/RSS benchmarks remain unexecuted; no performance improvement is claimed.

G1 validation: only this RFC and plan changed after the admission commit. All 28 local document
references resolve; diff whitespace checks and repository format, i18n, lint and Node/web typechecks
pass. No new source, dependency, build configuration or test changes were made. G0 tests/E2E were
not rerun for this documentation-only goal; no profiling, Rust comparison or Memory native benchmark
was executed. G2 and later remain unstarted.
