# PR Check Quality Gates — Specification

> Status: **implemented — external workflow validation pending**
>
> Classification: **architecture**
>
> GitHub issue: **not requested**

This document defines the maintained pull-request quality gates and their local test-entrypoint
contracts. The implementation design is described in [plan.md](./plan.md), and execution progress is
tracked in [tasks.md](./tasks.md).

## 1. Purpose

The existing PR workflow combines unrelated checks in one generic build job, omits the complete main
and renderer test suites, and contains stale or ineffective commands. This makes failures harder to
diagnose and allows changes to merge without exercising the repository's primary test boundaries.

The new architecture separates independent evidence into named jobs, retains the specialized Native
Memory sequence, and exposes one fail-closed aggregate check for branch protection.

## 2. Goals

- Make the default and scoped Vitest commands explicitly one-shot in non-interactive and interactive
  environments.
- Keep local test commands aligned with maintained test locations and Native SQLite ownership.
- Run static analysis, main tests, renderer tests, Native Memory validation, and the production
  prebuild/build contract as independent PR jobs.
- Preserve required Native Memory ordering across portable tests, Node ABI rebuild, smoke validation,
  Native suites, evaluation, performance checks, and report upload.
- Make one lightweight aggregate job fail when any required quality gate fails, is cancelled, or is
  unexpectedly skipped.
- Keep workflow behavior statically testable so job topology and critical commands cannot silently
  drift.

## 3. Acceptance Criteria

### AC-1 — One-Shot Test Entrypoints

- `test`, `test:main`, `test:renderer`, and `test:coverage` use `vitest run`.
- `test:watch` retains explicit watch behavior.
- The obsolete `test:main:native-sqlite` script is absent.
- Native SQLite invocation remains workflow-owned because rebuilding for the Node ABI can replace the
  Electron-compatible binding in a developer dependency tree.
- The Windows ARM64 workflow references the maintained Native Memory test path.
- A static contract test covers these script and workflow-path requirements.

### AC-2 — Parallel PR Gates

- The workflow always schedules `static`, `test-main`, `test-renderer`, `test-native-memory`, and
  `build` for pull requests targeting `main` or `dev`.
- `static` runs lint, formatting, localization parity, renderer architecture baseline, icon
  generation, and type checking.
- `test-main` and `test-renderer` run their complete one-shot suites.
- `build` runs the canonical `pnpm run build`, including its prebuild data refresh and full local
  build contract.
- No single-element matrix, path filter, renderer sharding, packages job, dependency-cache policy
  change, or `install:sharp` step is introduced.

### AC-3 — Native Memory Gate

- `test-native-memory` runs the portable Memory command before rebuilding SQLite for the Node ABI.
- The workflow verifies DuckDB VSS before portable Memory tests.
- The rebuilt SQLite binding passes the encrypted smoke test before any required-Native suite.
- Encrypted OCR artifact, Native Memory, retrieval evaluation, and performance suites remain covered.
- The workflow does not run `test:memory:scope` separately because `test:memory` owns that guard.
- The retrieval report is uploaded with `if: always()`.

### AC-4 — Fail-Closed Aggregation

- `pr-required` declares every quality gate and `main-release-guard` in `needs`.
- `pr-required` uses `if: always()` and actively validates each dependency result.
- `main-release-guard` must be `success` for pull requests targeting `main` and may be `skipped` only
  for pull requests targeting `dev`.
- A failed, cancelled, or unexpectedly skipped required quality gate makes `pr-required` fail.
- Branch protection can use `PR Check / pr-required` without depending on individual job names.

### AC-5 — Workflow Safety and Maintainability

- Workflow permissions are explicitly read-only for repository contents.
- Pull-request concurrency cancels obsolete runs for the same pull request.
- Every job has a timeout.
- Actions remain pinned to full commit SHAs and jobs remain on `ubuntu-24.04`.
- Checkout does not persist credentials.
- A parsed-YAML contract test covers topology, commands, Native ordering, permissions, concurrency,
  aggregation, and prohibited legacy steps.

## 4. Constraints

- Do not modify application public APIs, stored data, or runtime behavior as part of the CI
  architecture.
- Do not add a packages job when the repository has no packages test boundary.
- Do not add path-based job skipping or test sharding before the always-on baseline is established.
- Do not enable pnpm caching or change lockfile policy while `pnpm-lock.yaml` is not tracked.
- Do not rebuild the Native SQLite dependency during local validation.
- Do not change remote branch-protection rules in this change.
- Do not create or sync a GitHub issue for this architecture record.

## 5. Non-Goals

- Reducing runner-minute usage through selective execution.
- Splitting renderer tests into shards.
- Changing dependency installation or generated-registry policies.
- Replacing the existing test framework or build pipeline.
- Proving Windows ARM64 or Node-ABI Native behavior outside their owning workflows.

## 6. Compatibility and Risks

- The one-shot script change intentionally removes implicit watch behavior from developer-facing test
  commands; `test:watch` remains the explicit interactive entrypoint.
- Parallel jobs repeat dependency installation and increase aggregate runner minutes. They reduce
  wall-clock latency and isolate failures, but optimization is deferred until a reliable baseline
  exists.
- `build` intentionally repeats type checking already performed by `static` because the canonical
  build command is itself a maintained release contract.
- Native workflow behavior remains ABI-sensitive and must be verified after a push; local validation
  covers only portable Memory behavior and static workflow contracts.

## 7. Open Questions

None. The job topology, command ownership, failure semantics, and deferred optimizations are fixed for
this increment.
