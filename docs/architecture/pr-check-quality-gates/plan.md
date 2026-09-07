# PR Check Quality Gates — Implementation Plan

> Requirements and acceptance criteria are defined in [spec.md](./spec.md), and execution progress is
> recorded in [tasks.md](./tasks.md).

## 1. Implementation Strategy

The change is split into three independently reviewable implementation layers after this architecture
record:

1. Repair the Light OCR compatibility regression discovered while auditing the current full suite.
2. Repair local one-shot test entrypoints and protect them with a static contract test.
3. Replace the monolithic PR workflow with parallel quality gates and protect its topology with a
   parsed-YAML contract test.

The OCR correction is behaviorally separate from CI, but it must land before the full main suite
becomes a required gate so the new gate reflects the intended compatibility contract.

## 2. Light OCR Compatibility Prerequisite

`AttachmentCapabilityRouter` must apply the eight-image resource bound only after attachments are
classified as OCR candidates. Images routed directly to a vision-capable model remain image
representations regardless of their position in the turn.

Focused tests cover:

- more than eight images routed directly to vision;
- a mixed vision/OCR turn in which only the ninth OCR candidate is rejected;
- the existing explicit and automatic OCR batch cap.

The retained Light OCR feature specification and follow-up hardening record are updated to distinguish
the OCR resource limit from general vision input behavior.

## 3. Test Entrypoints

Package scripts use explicit `vitest run` commands for default, main, renderer, and coverage suites.
`test:watch` stays interactive. The stale local Native SQLite script is removed rather than repaired
because the maintained Memory architecture assigns Node ABI rebuilding to CI.

A main-process static contract test reads `package.json` and the Windows ARM64 workflow. It asserts the
exact one-shot/watch command semantics, rejects the obsolete Native script, and verifies the maintained
Native Memory test path exists and is referenced.

## 4. Workflow Topology

The workflow keeps `main-release-guard` and introduces five always-on quality gates:

1. `static`
2. `test-main`
3. `test-renderer`
4. `test-native-memory`
5. `build`

All jobs use the repository-pinned setup actions, Node version, pnpm version, and Ubuntu image. Each job
installs an independent dependency tree to prevent ABI mutation or generated state from leaking between
responsibilities.

### 4.1 Static

The static job runs lint, format checking, localization parity, renderer architecture baseline, icon
generation verification, and type checking. It does not build artifacts or run test suites.

### 4.2 Test Suites

The main and renderer jobs invoke only their authoritative package scripts. Their names expose the
failing boundary directly in the GitHub Actions UI.

### 4.3 Native Memory

The Native Memory job retains this strict order:

1. Install dependencies.
2. Install and smoke-test DuckDB VSS.
3. Run portable Memory tests, including the internal scope guard.
4. Rebuild SQLite for the Node ABI.
5. Run the encrypted SQLite smoke check.
6. Run the encrypted OCR artifact suite.
7. Run required-Native Memory tests.
8. Run deterministic retrieval evaluation.
9. Run Memory performance checks.
10. Upload the retrieval report even after prior failure.

No separate scope step precedes `test:memory`, avoiding duplicate work without weakening ownership
validation.

### 4.4 Build

The build job runs the canonical `pnpm run build`. Prebuild registry refresh and repeated type checking
remain deliberate parts of that contract.

## 5. Aggregate Check

`pr-required` has no checkout or dependency installation. With `if: always()`, it receives the explicit
result of every dependency and fails unless:

- every always-on quality gate is `success`; and
- `main-release-guard` is `success` for a `main` target or `skipped` for a `dev` target.

This avoids treating an unexpected skipped job as an implicit success and provides one stable branch
protection target.

## 6. Workflow Contract Test

The contract test parses `.github/workflows/prcheck.yml` with the repository's YAML dependency and
asserts:

- permissions, concurrency, runner images, timeouts, and pinned action references;
- the exact job graph and aggregate dependencies;
- required static, test, Native, and build commands;
- Native command ordering and environment requirements;
- active fail-closed aggregate result checks;
- absence of the single-element matrix, `install:sharp`, redundant Agent evaluation, and duplicated
  Memory scope invocation.

Behavioral CI execution remains the source of truth; the static test prevents structural drift before a
workflow is pushed.

## 7. Validation and Rollout

Validation proceeds from focused tests to full local gates:

- Light OCR routing tests;
- entrypoint and workflow contract tests;
- full default, main, and renderer suites;
- portable Memory tests;
- format, localization, lint, architecture, icon, and type checks;
- canonical build.

Local validation must not rebuild SQLite for the Node ABI. The first pushed workflow run remains
responsible for Native Memory and Windows ARM64 evidence. After a successful run, repository
administrators may configure only `PR Check / pr-required` as the branch-protection requirement.

If the canonical build refreshes tracked provider or ACP registries, those generated changes are
reviewed and committed separately so CI architecture changes remain auditable.

## 8. Rollback

Each implementation layer is independently revertible. Reverting the workflow restores the previous
job names and coverage but removes complete main/renderer requirements and the aggregate failure
contract. Reverting entrypoint changes restores ambiguous interactive behavior and stale Native script
surface. Neither rollback changes application data or public APIs.
