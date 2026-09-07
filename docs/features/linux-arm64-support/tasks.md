# Linux ARM64 Support Tasks

## Task List

- [x] T01 - Add Linux ARM64 to build CI
  - Add a native ARM64 runner matrix entry.
  - Install target runtimes and parameterize unpacked paths.
  - Skip CUA bundling and verification on ARM64.

- [x] T02 - Add Linux ARM64 to release CI
  - Mirror the build matrix and CUA skip.
  - Upload architecture-specific build artifacts.
  - Collect ARM64 packages and update metadata for the release.

- [x] T03 - Add regression coverage
  - Validate both workflow matrices and output directories.
  - Validate the workflow-level CUA skip.
  - Preserve business visibility and direct packaging rejection coverage.

- [x] T04 - Run local validation
  - Run focused tests.
  - Run formatting, i18n, and lint checks.

- [x] T05 - Validate CI and publish for review
  - Commit and push the feature branch.
  - Dispatch Linux build CI and confirm the ARM64 job packages successfully.
  - Open a Draft PR against `dev`.

- [x] T06 - Move Linux packaging ownership into one reusable workflow
  - Keep the native runner and unpacked-directory mapping in `_package-linux.yml`.
  - Reuse it from Build, Release, and package regression.
  - Generate exact architecture-specific package manifests and separate Linux update metadata.
  - Cover callers, CUA exclusion, artifact names, and release assembly with contract tests.

- [ ] T07 - Validate the reusable workflow remotely
  - Push only after maintainer authorization.
  - Run both Linux targets through distribution and verification modes.
  - Confirm `latest-linux-arm64.yml` references only the ARM64 AppImage.

## Validation Evidence

- Linux ARM64 packaging, native dependency checks, plugin verification, and artifact upload passed
  in [Build Application run 29933595490](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/29933595490).
- CUA bundling and verification were skipped in the Linux ARM64 job as intended.
- Draft PR: [#2006](https://github.com/ThinkInAIXYZ/deepchat/pull/2006).

## Done Definition

- Build and release workflows define working Linux x64 and ARM64 jobs.
- Linux ARM64 application artifacts exclude CUA by contract and by CI execution.
- Build, Release, and package regression share one Linux packaging implementation.
- The original Linux ARM64 build CI and Draft PR evidence remain valid; the reusable-workflow
  migration awaits a maintainer-authorized remote run.
