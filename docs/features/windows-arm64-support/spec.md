# Windows ARM64 Support Spec

## User Story

DeepChat maintainers need a reliable way to validate Windows ARM64 builds without owning Windows ARM64 hardware, so the project can ship a Windows ARM64 package only after it passes smoke coverage on a real ARM64 Windows runner.

## Acceptance Criteria

- A manual GitHub Actions workflow runs on `windows-11-arm` and builds the Windows ARM64 app.
- The workflow runs E2E smoke tests against a local OpenAI-compatible mock provider with no real secrets.
- The E2E run uses the runner's default profile and injects a local mock provider through existing typed routes.
- Windows ARM64 bundled runtimes are best-effort: missing `uv`, `node`, `ripgrep`, or `rtk` artifacts are recorded and skipped without failing the build.
- Existing Windows x64, macOS, and Linux runtime install scripts remain strict.
- The Windows ARM64 workflow uploads build artifacts and E2E diagnostics.

## Non-Goals

- Enable Windows ARM64 in the production build/release matrix only after the manual Windows ARM64 E2E workflow has passed.
- Not every optional runtime is guaranteed to be bundled on Windows ARM64.
- Real provider API keys must not be used in CI.

## Constraints

- Use existing typed routes for E2E provider/model bootstrap.
- Keep local `pnpm run e2e:smoke` behavior compatible with existing manual smoke tests.
- Keep runtime fallback behavior aligned with existing `RuntimeHelper`, RTK, and skill runtime logic.
