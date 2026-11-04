# PR Check Quality Gates

## Workflow Ownership

`.github/workflows/prcheck.yml` runs for every pull request targeting `dev`. Independent jobs
produce static, main, renderer, Native Memory, and source-build evidence. The lightweight
`pr-required` job is the stable fail-closed aggregate. Native packaging is owned separately by
[CI and release packaging](../ci-release-packaging/spec.md).

Local `test`, `test:main`, `test:renderer`, and `test:coverage` commands use `vitest run`.
`test:watch` is the explicit interactive command. Required-Native orchestration belongs to its
workflow rather than a local command that rebuilds a developer's native dependencies.

## Required Jobs

| Job | Required behavior |
| --- | --- |
| `static` | Lint, formatting, i18n parity, renderer architecture baseline, icon generation, and type checking |
| `test-main` | Complete main suite, then `test:harness:node` against the production dependency closure |
| `test-renderer` | Complete renderer suite with the committed worker and heap settings |
| `test-native-memory` | DuckDB/VSS preparation, portable Memory, encrypted SQLite smoke, Native Tape/OCR/Memory, retrieval evaluation, performance bounds, and report upload |
| `build` | Canonical `pnpm run build`, including its prebuild refresh and local build checks |
| `pr-required` | Depend on all five jobs and require every result to be `success` |

The standalone Node gate rejects Electron loading and verifies real persistence/recovery outside
Vitest setup. Its accepted host contract is defined in
[Main and Harness boundaries](../main-harness-portability/spec.md).

## Native Memory Sequence

The job installs an independent dependency tree with the shipped SQLite N-API prebuild. It does
not rebuild that binding for a Node ABI. Portable Memory runs before the native smoke; required
storage/evaluation suites use `DEEPCHAT_REQUIRE_NATIVE_SQLITE=1`, with required DuckDB VSS admission
where applicable. Missing native capabilities or unexpected skips fail rather than producing
portable-only success.

The retrieval evaluator writes `test-results/memory/retrieval-v1.json` before threshold assertions.
Upload uses `if: always()` and `if-no-files-found: error`. Runtime metrics and fixture semantics
remain in [Memory quality gates](../memory-quality-gates-and-observability/spec.md).

The separately dispatched Windows ARM64 workflow owns its target's Native Memory vector path,
package, and launch evidence. Linux PR success cannot establish that target's behavior; remaining
validation is tracked in [plan.md](./plan.md).

## Failure and Supply-Chain Contract

- Every repository-root dependency install uses `pnpm install --frozen-lockfile`.
- Required PR jobs run on `ubuntu-24.04`, have timeouts, and use the pinned Node/pnpm toolchain.
- Actions use full commit SHAs. Checkout does not persist credentials; repository contents
  permission is read-only.
- PR concurrency cancels obsolete runs for the same pull request.
- `pr-required` uses `if: always()` and explicitly inspects every dependency result. Failure,
  cancellation, or unexpected skip must produce failure.
- No path-based skipping or test sharding weakens the always-on suite boundary.
- Parsed workflow and entrypoint contract tests protect topology, Native ordering, aggregate
  semantics, critical commands, and prohibited legacy steps.

Branch protection can require `PR Check / pr-required`; changing remote protection remains a
repository-administration action. Release-to-main policy is owned by the release process.
