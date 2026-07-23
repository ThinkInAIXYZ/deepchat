# CI and Release Packaging Contract — Tasks

> Requirements are defined in [spec.md](./spec.md), and the implementation design is described in
> [plan.md](./plan.md).

## Architecture Record

- [x] Define the reusable OS package boundary and immutable caller interface.
- [x] Define macOS distribution signing and unsigned verification boundaries.
- [x] Define the six-target manifest and nineteen-asset release contract.
- [x] Define committed installer baseline and PR package-regression behavior.
- [x] Record excluded Windows signing, OAuth, caching, Forge, universal package, and ARM64 E2E work.
- [x] Record the decision not to create or synchronize a GitHub issue.

## Package Tooling

- [x] Add the shared target and file-role contract.
- [x] Add target manifest staging and validation.
- [x] Add installer baseline import and size comparison.
- [x] Add strict updater metadata and release assembly.
- [x] Add release preflight and package-impact classification.
- [x] Add focused fail-closed unit tests.

## Reusable Packaging

- [x] Add Windows x64/ARM64 reusable packaging.
- [x] Add Linux x64/ARM64 reusable packaging.
- [x] Add macOS x64/ARM64 reusable packaging with distribution verification.
- [x] Rewire manual Build to distribution-mode reusable workflows.
- [x] Protect workflow interfaces and runner mappings with parsed-YAML tests.

## Package Regression

- [x] Add reusable, manual, and scheduled six-target package regression.
- [x] Remove historical baseline rebuilds from package jobs.
- [x] Add fail-closed PR impact classification.
- [x] Integrate conditional regression state into `pr-required`.

## Release

- [x] Move tag, ancestry, version, and CHANGELOG checks before native package jobs.
- [x] Rewire Release to distribution-mode reusable workflows.
- [x] Assemble only complete, digest-verified target manifests.
- [x] Generate canonical updater metadata and `release-index.json`.
- [x] Restrict write permission to draft release publication.
- [x] Remove tolerant copy and Ruby/YAML merge logic.

## Maintained Documentation

- [x] Update Light OCR package-size ownership.
- [x] Update Linux ARM64 metadata ownership.
- [x] Update release flow and plugin packaging guidance.

## Validation

- [x] Run focused package and workflow contract tests.
- [x] Run complete main and renderer suites.
- [x] Run type checking and the canonical build.
- [x] Run format, localization, lint, and final format checks.
- [x] Review generated provider and ACP registry refreshes.
- [ ] Verify all six native packages and real macOS signing after a future authorized push.

### Local Validation Evidence

- Focused package/workflow contracts: 7 files and 60 tests passed.
- Main suite: 407 files passed, 19 skipped; 4,657 tests passed, 233 skipped.
- Renderer suite: 197 files and 1,561 tests passed.
- Full type checking and the canonical production build passed.
- `actionlint` 1.7.12 accepted every workflow.
- Format, localization, lint, and final format checks passed.
- The canonical build left provider metadata unchanged and refreshed the ACP registry from DimCode
  `0.2.35` to `0.2.36`; the generated diff was reviewed and retained.

GitHub-hosted native packaging, Apple signing/notarization, and draft-release publication were not
run because this branch must not be pushed. They remain the only incomplete acceptance evidence.
