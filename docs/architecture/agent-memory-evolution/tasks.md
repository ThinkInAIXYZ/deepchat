# Agent Memory Evolution — Tasks

## 0. Specification and baseline

- [x] Record the non-versioned architecture goal and invariants.
- [x] Define temporal, directive, lineage, forgetting, projection, and scope contracts.
- [x] Add deterministic four-axis behavioral fixtures and a CI test harness.
- [x] Add a domain clock without coupling scheduler/performance time to business time.

## 1. Temporal claims

- [x] Add temporal domain types and normalization helpers.
- [x] Add additive SQLite columns, migration, repair, and fresh-schema constraints.
- [x] Extend insert/read/management/route DTO contracts.
- [x] Extend extraction prompt/parser with clock context and legacy response compatibility.
- [x] Preserve temporal metadata across update, supersede, conflict, merge, and manual-edit paths.
- [x] Apply temporal eligibility, ranking, annotations, and trace data before access accounting.
- [x] Cover atemporal, current, expired, future, uncertain, plan, event, and recurring cases.

## 2. Exact forgetting

- [x] Add hash-only tombstone persistence and indexes.
- [x] Tombstone and delete selectively in one transaction.
- [x] Tombstone claims during clear and preserve tombstones until Agent retirement.
- [x] Suppress exact provenance/content recreation inside the insert transaction.
- [x] Keep clear/Agent retirement semantics explicit.
- [x] Cover replay, concurrent mutation, privacy, and independent-source behavior.

## 3. Durable lineage and dirty consolidation

- [x] Add durable derivation relations and idempotent inserts.
- [x] Write merge/reflection/supersede/manual-edit edges transactionally.
- [x] Add the persistent bounded dirty-work queue.
- [x] Mark dirty work on committed claim mutations.
- [x] Consolidate bounded dirty clusters and settle only successful seeds.
- [x] Remove dependence on operational audit retention for lineage.
- [x] Cover retries, stale IDs, budget exhaustion, and audit pruning.

## 4. Directive plane

- [x] Add directive types, persistence, state transitions, and owner indexes.
- [x] Add explicit/manual creation and derived draft suggestions.
- [x] Add approve/reject/delete management routes and typed client methods.
- [x] Gate retrieval with active suppression directives before access accounting.
- [x] Render a separate bounded user-role directive contribution.
- [x] Reuse the inbox approval interaction without mixing directives into persona state.
- [x] Cover trust transitions, prompt separation, injection safety, and suppression false positives.

## 5. Projection and budget

- [x] Build deterministic structured working projections from claims.
- [x] Annotate state/event/plan/recurring claims without changing claim content.
- [x] Add one total-budget allocator with floors, ceilings, reservation, and borrowing.
- [x] Extend manifests/diagnostics with allocation decisions.
- [x] Cover determinism, starvation, truncation, CJK density, and hard ceilings.

## 6. Scope applicability

- [x] Add scope fields and backfill `user_scope`.
- [x] Keep the `user_scope` compatibility shadow synchronized.
- [x] Extend write and query contexts with typed scopes.
- [x] Apply identical owner-and-scope predicates to FTS and vector results.
- [x] Surface scope metadata through additive DTO fields.
- [x] Cover missing, mismatched, and matching user/project/session contexts.

## 7. Documentation and validation

- [x] Update `docs/architecture/memory-system.md` as the maintained contract.
- [x] Run formatting and i18n maintenance.
- [x] Run lint and full typecheck.
- [x] Run focused Memory suites and maintained behavior/retrieval gates.
- [x] Run broader main-process tests and classify unrelated baseline failures.
- [x] Complete a final severity-ordered review and resolve every actionable finding.

## Validation record

Completed on 2026-07-26:

| Gate | Result |
| --- | --- |
| `pnpm run format` and `pnpm run format:check` | Passed |
| `pnpm run i18n` | Passed with no missing or invalid translations |
| `pnpm run lint` | Passed |
| `pnpm run typecheck` | Node and renderer passed |
| Focused Memory, route, coordinator, and tool suites | 59 files passed; 978 tests passed, 2 skipped |
| Full suite excluding three reproduced baseline-failure files | 661 files passed; 6,944 tests passed, 2 skipped |

The first default full-suite run found 13 failures. Two were scoped route fixtures introduced by this
branch; they were corrected and the dispatcher suite then passed 59/59. The remaining 11 failures
reproduce when their files run alone and are already present at the `dev` merge base:

- `test/main/scheduler/schedulerService.test.ts`: 1 provider-config snapshot expectation;
- `test/main/app/startupMigrations/sessionDataMigrations.sqlite.test.ts`: 2 legacy bootstrap
  expectations for `new_session_active_skills`;
- `test/main/data/mainDatabase.test.ts`: 8 stale table/API and per-table-version expectations.

The missing APIs and legacy migration behavior targeted by those assertions are unchanged by this
architecture goal and already disagree with the tests at the `dev` merge base. This branch only adds
Memory-owned entries to the shared schema catalog.

## 8. Post-implementation hardening

- [x] Classify all Memory tests and run native directive persistence tests in CI.
- [x] Enforce temporal invariants on upgraded databases and repair invalid legacy rows.
- [x] Skip malformed temporal/scope import rows without rolling back valid data.
- [x] Retire the superseded recall index without rebuilding it at startup.
- [x] Preserve one-sided temporal metadata across all rewrite paths.
- [x] Reject malformed extracted temporal candidates independently.
- [x] Allow explicit relearning to atomically supersede exact tombstones.
- [x] Strip invisible directive controls and return typed capacity failures.
- [x] Preserve indexed ordering for multi-scope FTS importance candidates.
- [x] Keep suppressed claims visible to management search.
- [x] Remove and prevent persistent lineage self-edges.
- [x] Shed directive contributions as the final optional context-pressure fallback.
- [x] Add working/reflection scope, migration, temporal boundary, idempotency, and precision tests.
- [x] Localize new Memory strings for maintained Chinese variants.
- [x] Resolve system timezone dynamically and bound explicit-clear row materialization.
- [x] Run final formatting, i18n, lint, typecheck, focused gates, native gates, and broader tests.
- [x] Complete a final severity-ordered review and resolve every actionable finding.

## Post-implementation hardening validation record

Completed on 2026-07-27:

| Gate | Result |
| --- | --- |
| `pnpm run format` | Passed on 2,334 files |
| `pnpm run i18n` | Passed with no missing or invalid translations |
| `pnpm run lint` | Passed; Agent cleanup baseline remains zero |
| `pnpm run typecheck` | Node and renderer passed |
| `pnpm run test:memory` | Classification passed with 74 classified and 3 exempt files; 54 behavior files and 856 tests passed |
| Memory native gate | 14 files passed; 283 tests passed and 2 conditional tests skipped |
| `pnpm run test:memory:eval` | 7 tests passed; hybrid Recall@5 1.0, MRR@10 0.95, nDCG@10 0.9631 |
| `pnpm run test:main -- --silent` | 461 files and 5,420 tests passed; 2 tests skipped; the same 3 files and 11 assertions documented above remain failing at the `dev` merge base |
| Electron native ABI restoration | Rebuilt for Electron 40.10.5 and verified with an in-memory SQLite query |

The final severity-ordered review found no unresolved actionable high, medium, or low findings.
One additional low-severity localization gap in the Traditional Chinese Memory diagnostics was
corrected before this record was closed.

## 9. Pull-request review hardening

- [x] Preserve legacy agent-scope tombstones while isolating narrower-scope content identities.
- [x] Derive provenance identity and persisted scope from one normalized insert contract.
- [x] Keep transient embedding-readiness work in the generation-aware dirty queue.
- [x] Enforce persistence-equivalent temporal and directive-kind invariants on response DTOs.
- [x] Preserve extraction audit coverage when cancellation interrupts directive suggestions.
- [x] Reject single-character CJK suppression topics and ignore equivalent persisted values.
- [x] Adaptively refill filtered recall candidates within a diagnosed hard budget.
- [x] Remove verified projection and retrieval hot-path overhead without changing output.
- [x] Localize the new directive and contribution-budget UI across maintained locales.
- [x] Run final formatting, i18n, lint, typecheck, focused, native, and maintained Memory gates.
- [x] Complete the final severity-ordered review and resolve every actionable finding.

## Pull-request review hardening validation record

Completed on 2026-07-27:

| Gate | Result |
| --- | --- |
| `pnpm run format` | Passed on 2,334 files |
| `pnpm run i18n` | Passed with no missing or invalid translations |
| `pnpm run lint` | Passed; Agent cleanup baseline remains zero |
| `pnpm run typecheck` | Node and renderer passed |
| `pnpm run test:memory` | Classification and type gates passed; 54 behavior files and 863 tests passed |
| `pnpm run test:memory:eval` | 6 tests passed and 1 conditional test skipped |
| Focused renderer gate | 3 files and 49 tests passed |
| Electron native migration gate | 2 files and 121 tests passed |

The final review found no unresolved actionable high-, medium-, or low-severity findings. Two
suggested broad renderer/context-builder extractions were intentionally not applied: their similar
surface mechanics conceal different state and fallback contracts, so sharing them would increase
coupling without improving correctness.

## 10. Resumable clear and capability boundaries

- [x] Persist Agent clear progress and fence claim access before the first deletion batch.
- [x] Tombstone and delete claims in bounded transactions with event-loop yields.
- [x] Resume interrupted claim/vector phases after database reopen and runtime startup.
- [x] Reject synchronous writes and Agent ownership changes while a clear job exists.
- [x] Preserve independent directive reads and management during claim clear.
- [x] Cover concurrent clear calls, restart recovery, storage guards, and post-clear writes.
- [x] Document directive recency ordering without inventing priority semantics.
- [x] Document Agent/Session/User/Project end-to-end capability limits.
- [x] Run final format, i18n, lint, typecheck, focused Memory, native, and performance gates;
      classify unavailable toolchain checks explicitly.
- [x] Complete the final severity-ordered review and resolve every actionable finding.

## Resumable clear validation record

Completed on 2026-07-27:

| Gate | Result |
| --- | --- |
| `pnpm run format` / `format:check` | Passed on 2,337 files |
| `pnpm run i18n` | Passed with no missing or invalid translations |
| `pnpm run lint` | Passed; Agent cleanup baseline remains zero |
| Node fallback typecheck | `pnpm exec tsc --noEmit -p tsconfig.node.json --composite false` passed |
| `pnpm run typecheck` | Environment-blocked because the declared `tsgo` / `vue-tsgo` binaries are absent from the current install; no renderer source changed in this slice |
| `pnpm run test:memory` | Scope/type gates passed with 75 classified and 3 exempt files; 54 behavior files and 872 tests passed |
| Memory native gate | 14 files passed; 287 tests passed and 2 conditional tests skipped |
| `pnpm run test:main:memory-perf` | 6 files and 10 tests passed; 10k clear used 40 batches and the observed maximum SQLite batch was 5.42 ms |

The final review found no unresolved correctness, compatibility, performance, security, or
maintenance defect in the resumable-clear implementation. Rollback with a pending clear job is
explicitly prohibited because an older runtime cannot honor its read fence. Directive
priority/pinning remains a separately specified product capability rather than inferred behavior.
