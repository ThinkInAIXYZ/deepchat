# Memory Configuration ABA Execution Fence — Tasks

Status: Completed

Artifacts: [Specification](./spec.md) · [Implementation plan](./plan.md)

## 1. Execution State and Identity

- [x] Generalize the per-Agent generation into the execution epoch.
- [x] Seed first effective-config observation without invalidation.
- [x] Preserve the advanced generation across Agent cleanup.
- [x] Add one canonical execution-token type.
- [x] Centralize embedding normalization and fingerprint encoding.
- [x] Keep operation-fence capture on the O(1) runtime-state path.
- [x] Synchronize runtime and vector identities through Presenter admission.

## 2. Configuration Propagation

- [x] Synchronize custom Agent updates independently from maintenance scheduling.
- [x] Add batch resolved DeepChat Agent configuration enumeration.
- [x] Include disabled and previously observed Agents in builtin propagation.
- [x] Skip managed-Agent fan-out when the builtin execution identity is unchanged.
- [x] Isolate builtin enumeration and per-Agent synchronization failures.
- [x] Preserve maintenance scheduling when execution synchronization fails.

## 3. Runtime Admission and Reads

- [x] Bind extraction admission to the current Agent identity and execution token.
- [x] Retain the original token and expected session epoch across continuations.
- [x] Drop queued work after execution-identity or session-Agent changes.
- [x] Prevent stale work from advancing the cursor, writing a Tape anchor, or rescheduling itself.
- [x] Fence injection prompt assembly, accounting, and Tape side effects.
- [x] Fence recall and search results plus access accounting.
- [x] Preserve real retrieval errors while discarding only classified stale cancellation.
- [x] Remove redundant same-tick fence checks while retaining post-await validation.
- [x] Bind ordinary queue work to the session epoch captured at admission.
- [x] Drain old-Agent extraction persistence before publishing a reassigned Agent identity.

## 4. Review Hardening

- [x] Reuse one builtin config snapshot during managed-Agent fan-out.
- [x] Avoid full scans for assistant/default-model-only builtin notifications.
- [x] Validate search eligibility before observing execution state.
- [x] Replace repeated builtin Agent literals with the shared constant and resolver.
- [x] Remove the obsolete architecture-guard method name.
- [x] Reset the installed Memory test port between test cases.
- [x] Reuse the shared deferred-test helper.
- [x] Make execution embedding identity collision-free without changing persisted fingerprints.
- [x] Separate provider cancellation, deadline, and capacity classifications.
- [x] Dispose the builtin-maintenance presenter fixture on assertion failures.

## 5. Tests and Documentation

- [x] Cover enabled and embedding ABA transitions in runtime-context tests.
- [x] Cover deferred extraction returning no rows or events after ABA.
- [x] Cover queued work, continuations, fresh admission, and Agent identity changes.
- [x] Cover admission-time session epochs and reassignment persistence draining.
- [x] Cover inherited builtin changes, explicit overrides, first observation, and full enumeration.
- [x] Cover stale recall, search, injection, error propagation, and lifecycle disposal.
- [x] Cover separator-containing identities and stale capacity-error propagation.
- [x] Update the maintained Agent Memory architecture contract.
- [x] Split the issue SDD into `spec.md`, `plan.md`, and `tasks.md` as requested.

## Validation Record

Baseline before implementation:

```text
3 focused test files passed; 74 tests passed.
```

Validation before review hardening:

```text
Focused Memory regressions: 5 test files passed; 150 tests passed.
Related runtime/presenter regressions: 2 test files passed; 228 tests passed.
pnpm run format: passed.
pnpm run i18n: passed.
pnpm run lint: passed, including the Memory architecture guard.
pnpm run typecheck: passed for node and web.

pnpm test: 529 test files passed, 15 skipped, 1 unrelated renderer file failed;
5438 tests passed, 196 skipped, 3 failed.
```

Final review-hardening validation:

```text
Related Memory/runtime regressions: 9 test files passed; 401 tests passed.
Lifecycle and retrieval regression rerun: 2 test files passed; 68 tests passed.
pnpm run format: passed.
pnpm run i18n: passed.
pnpm run lint: passed, including the Memory architecture guard.
pnpm run typecheck: passed for node and web.

pnpm test: 529 test files passed, 15 skipped, 1 unrelated renderer file failed;
5446 tests passed, 196 skipped, 3 failed.
git diff --check: passed.
```

CodeRabbit follow-up validation:

```text
Focused review regressions: 7 test files passed; 388 tests passed.
pnpm run test:main -- --run: 363 test files passed, 15 skipped;
4183 tests passed, 196 skipped.
pnpm run format: passed.
pnpm run i18n: passed.
pnpm run lint: passed, including the Memory architecture guard.
pnpm run typecheck: passed for node and web.
git diff --check: passed.
```

The earlier full repository run's three failures are confined to the unchanged
`test/renderer/components/SpotlightOverlay.test.ts`, which mounts the component without an active
Pinia. No Memory test failed in the final repository run.
