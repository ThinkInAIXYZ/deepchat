# Windows ARM64 Support Spec

Status: implemented in current CI and release workflows as of 2026-06-13.

## User Story

DeepChat maintainers need a reliable way to validate Windows ARM64 builds without owning Windows ARM64 hardware, so the project can ship a Windows ARM64 package only after it passes smoke coverage on a real ARM64 Windows runner.

## Acceptance Criteria

- A manual GitHub Actions workflow runs on `windows-11-arm` and builds the Windows ARM64 app.
- The workflow runs E2E smoke tests that do not require configured provider credentials.
- The E2E run uses the runner's default profile and validates launch, routing, and settings window behavior.
- Packaged-app validation starts the unpacked Windows ARM64 executable and verifies it stays alive long enough for a process-level smoke check.
- The manual build workflow can produce both Windows x64 and Windows ARM64 artifacts.
- Windows ARM64 bundles verified native runtimes that are available in the runtime installer.
  Current `installRuntime:win:arm64` installs `uv` and `node`.
- `rtk` is not bundled on Windows ARM64 until upstream provides a Windows ARM64 binary.
- Code/file search uses FFF-native search in the app tool layer, so Windows ARM64 does not require a
  bundled `ripgrep` runtime for agent search.
- Existing Windows x64, macOS, and Linux runtime install scripts remain strict.
- The Windows ARM64 E2E workflow uploads only diagnostics, not packaged build outputs.

## Non-Goals

- Rework release asset publishing beyond the current `win-arm64` release matrix.
- Not every optional runtime is bundled on Windows ARM64.
- Provider-backed chat requests must not run in this CI workflow.

## Constraints

- Keep CI smoke coverage provider-independent; provider-backed specs remain local/manual only.
- Keep local `pnpm run e2e:smoke` behavior compatible with existing manual smoke tests.
- Keep runtime fallback behavior aligned with existing `RuntimeHelper`, RTK, and skill runtime logic.
