# Tape Contract Lineage Tasks

## SDD

- [x] Record the two-level contract decision and three-field ExecutionContract model.
- [x] Define authority, transaction, inheritance, compatibility, and strictness boundaries.
- [x] Define P0/P1 scope and keep repair, retry, override, and deterministic replay out of V1.
- [x] Review and commit the SDD slice.

## P0: Contract Domains And Prompt Provenance

- [x] Add canonical contract schemas, builders, hash versions, and domain tests.
- [x] Return structured prompt sections without changing provider-visible prompt text.
- [x] Record AGENTS.md freshness/degradation and pinned-skill/tooling omissions.
- [x] Thread prompt provenance through turn and loop assembly.
- [x] Review and commit the prompt-provenance slice.
- [x] Review and commit the canonical ExecutionContract domain slice.

## P0: ViewManifest V5 And Enforcement

- [x] Embed ExecutionContract in contract-bearing child ViewManifest schema 5 and preserve v1-v4
      reads plus ordinary-chat and ACP schema-v4 writes.
- [x] Keep ordinary interactive manifest persistence fail-open and require contract-bearing DeepChat
      child manifests.
- [x] Carry the exact View contract to tool dispatch without Session-global mutable state.
- [x] Enforce stable tool target, effect, exact View workdir binding, and nesting ceilings with
      current authority.
- [x] Cover retries, tool rounds, revocation, expansion, and contract mismatch.
- [x] Review and commit the View/enforcement slice.

## P1: Strict Contract Persistence

- [x] Reserve `contract/*` and add a transaction-aware strict Tape capability.
- [x] Add complete Tape identity and canonical conflict validation.
- [x] Add nullable live-delegation contract/evaluation projection columns and migration coverage.
- [x] Atomically freeze parent TaskContract with initial and follow-up turn creation.
- [x] Re-anchor hash-verified runtime projections after parent Tape reset.
- [x] Review and commit the parent-freeze/storage foundation slice.

## P1: Child Inheritance

- [x] Strictly append the inherited TaskContract to child Tape before Handoff dispatch.
- [x] Persist child-local reference and expose active contract context through a narrow port.
- [x] Re-inherit the contract after child Tape reset before the next provider request.
- [x] Reconcile legacy active turns with an explicit compatibility contract.
- [x] Cover restart, repeated inheritance, reset/incarnation conflict, and missing child Tape.
- [x] Review and commit the child-inheritance slice.

## P1: Evaluation And Parent Visibility

- [x] Implement bounded required-section Handoff format evaluation.
- [x] Commit evaluation fact, projection, terminal state, and mailbox event atomically.
- [x] Ensure every contract-bearing terminal path produces evaluation or remains recoverable.
- [x] Surface evaluation through inspect, wait, read_result, and the untrusted result envelope.
- [x] Keep execution status independent from Handoff format status without asserting task success.
- [x] Cover no answer, missing/empty sections, cancellation, interruption, and settlement
      retry/recovery.
- [x] Review and commit the evaluation/settlement slice.

## Documentation And Final Validation

- [x] Update retained Tape and proactive multi-Agent architecture references.
- [x] Run format, i18n, lint, Node/web typecheck, focused tests, and relevant main suites.
- [x] Review the complete merge-base-to-HEAD diff and fix findings by severity.
- [x] Confirm every task and acceptance criterion is represented in code or documented as deferred.
- [x] Keep the PR branch free of unrelated baseline test repairs.

## Validation Record

Completed on 2026-08-09:

| Gate | Result |
| --- | --- |
| `pnpm run format:check` | Passed across 2,713 files |
| `pnpm run i18n` | Passed with no missing or invalid translations |
| `pnpm run lint` | Passed with no warnings or errors |
| `pnpm run typecheck` | Node and web typechecks passed |
| Full DeepChat Agent harness | 297 tests passed |
| Focused contract, View, ToolService, Tape, and orchestration suites | 226 tests passed |
| `pnpm run test:main` | Eleven unrelated failures reproduced from the `dev` baseline files |

The reproduced baseline consists of eight stale MainDatabase API fixtures, one provider-config
snapshot in `schedulerService.test.ts`, and two missing-table fixtures in
`sessionDataMigrations.sqlite.test.ts`. This branch does not change their owner paths; the unrelated
repairs were removed from this PR. The final severity-ordered review found no unresolved merge
blockers in the completed focused suites.
