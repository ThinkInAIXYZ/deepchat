# DeepChat Rutis Admission Migration Plan

## Objective and completion rule

Migrate one complete module at a time on `dimagent/rutis-harness-bootstrap`. Replace the selected
module's actual app wiring, run matching end-to-end baseline and migrated workloads, and remove
the old path after parity is established. The first module is invocation admission as a TS Rutis
plugin owned by the Rust host. There is no retained implementation switch or local fallback.

Use this file as the only tracker. The long-term Harness/Rust and Everywhere boundaries are in
[the RFC](spec.md). No GitHub issue or PR synchronization is requested.

## 1. Establish the baseline and contract

- [x] Inspect all admission callers, leases, diagnostics, startup/shutdown, packaging and E2E fixtures.
- [x] Run existing admission and delegation tests on the original app wiring: 82 tests passed.
- [x] Build and run the original application with isolated profiles and a local model fixture.
      Preserve baseline build artifacts outside the source tree for the same migration E2E workload.
- [x] Define ordering, cancellation/late-grant cleanup, per-owner limits, correlation, disconnect,
      bounded framing, observation and shutdown requirements in the RFC.

## 2. Replace the module and its application wiring

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

## 3. Compare actual execution and remove old wiring

- [x] Run the same real-app E2E delegation workload against baseline and migrated builds: child
      execution, admission queueing, cancellation/interrupt, completion, diagnostics and shutdown.
- [x] Verify process loss rejects pending work and cannot silently create another admission owner.
- [x] Add only durable lifecycle/contract regression coverage after implementation; reuse the
      existing owner and delegation suites, avoiding mock implementations of Rutis.
- [x] Remove old composition wiring, obsolete probe code, unused dependencies and temporary
      comparison artifacts from the deliverable. Retain no fallback or implementation toggle.

## 4. Whole-change review and validation

- [x] Review ownership, public compatibility, queue fairness, lease races, diagnostics gates,
      transport validation, resource limits, failure behavior, deployment and shutdown.
- [x] Update directly affected maintained architecture and logging contracts.
- [x] Run format, i18n, lint, typecheck, relevant Vitest suites, Cargo checks and the actual E2E
      comparison. Record measured results and unexecuted targets without claiming performance gains.

## Validation evidence

Baseline: Node 24.22.1, pinned pnpm 10.34.5, macOS arm64. The existing admission and
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
