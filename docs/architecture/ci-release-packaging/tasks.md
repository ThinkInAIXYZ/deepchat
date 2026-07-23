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
- [x] Add the initial fail-closed PR impact classification.
- [x] Validate the initial conditional six-target PR gate before decoupling it.

## Pull-Request Gate Decoupling

- [x] Record the decision to keep complete per-target verification instead of adding an updater-only
  artifact mode.
- [ ] Remove package classification and native regression from `prcheck.yml`.
- [ ] Add an always-started `package-check.yml` with the stable `package-required` aggregate.
- [ ] Classify Windows, Linux, and macOS impact independently with base-owned rules and evidence.
- [ ] Ignore release-only tooling, unrelated workflows, generated registries, ordinary source, and
  documentation changes.
- [ ] Protect fast and package aggregates with parsed-YAML and classifier contract tests.
- [ ] Add installed electron-updater architecture-selection compatibility tests.

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
- [x] Verify all six native verification packages on GitHub-hosted runners.
- [ ] Verify real macOS distribution signing and draft release publication.

### Validation Evidence

- Focused package/workflow contracts: 7 files and 60 tests passed.
- Main suite: 407 files passed, 19 skipped; 4,657 tests passed, 233 skipped.
- Renderer suite: 197 files and 1,561 tests passed.
- Full type checking and the canonical production build passed.
- `actionlint` 1.7.12 accepted every workflow.
- Format, localization, lint, and final format checks passed.
- The canonical build left provider metadata unchanged and refreshed the ACP registry from DimCode
  `0.2.35` to `0.2.36`; the generated diff was reviewed and retained.

GitHub Actions run `30013052661` passed the fast PR checks and all six unsigned verification targets
on their native runners. Real Apple distribution signing/notarization and draft-release publication
remain unverified because they require a release or manual distribution Build run.
