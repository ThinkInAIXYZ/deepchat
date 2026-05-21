# Windows ARM64 Support Spec

## User Story

DeepChat maintainers need a reliable way to validate Windows ARM64 builds without owning Windows ARM64 hardware, so the project can ship a Windows ARM64 package only after it passes smoke coverage on a real ARM64 Windows runner.

## Acceptance Criteria

- A manual GitHub Actions workflow runs on `windows-11-arm` and builds the Windows ARM64 app.
- The workflow runs E2E smoke tests that do not require configured provider credentials.
- The E2E run uses the runner's default profile and validates launch, routing, and settings window behavior.
- Windows ARM64 bundled runtimes are best-effort: missing `uv`, `node`, `ripgrep`, or `rtk` artifacts are recorded and skipped without failing the build.
- Existing Windows x64, macOS, and Linux runtime install scripts remain strict.
- The Windows ARM64 workflow uploads build artifacts and E2E diagnostics.

## Non-Goals

- Enable Windows ARM64 in the production build/release matrix only after the manual Windows ARM64 E2E workflow has passed.
- Not every optional runtime is guaranteed to be bundled on Windows ARM64.
- Provider-backed chat requests must not run in this CI workflow.

## Constraints

- Keep CI smoke coverage provider-independent; provider-backed specs remain local/manual only.
- Keep local `pnpm run e2e:smoke` behavior compatible with existing manual smoke tests.
- Keep runtime fallback behavior aligned with existing `RuntimeHelper`, RTK, and skill runtime logic.
