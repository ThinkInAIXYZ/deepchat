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

- [ ] T05 - Validate CI and publish for review
  - Commit and push the feature branch.
  - Dispatch Linux build CI and confirm the ARM64 job packages successfully.
  - Open a Draft PR against `dev`.

## Done Definition

- Build and release workflows define working Linux x64 and ARM64 jobs.
- Linux ARM64 application artifacts exclude CUA by contract and by CI execution.
- The branch is pushed, Linux ARM64 build CI succeeds, and a Draft PR is open.
