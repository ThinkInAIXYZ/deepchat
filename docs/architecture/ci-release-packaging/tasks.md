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

- [ ] Add the shared target and file-role contract.
- [ ] Add target manifest staging and validation.
- [ ] Add installer baseline import and size comparison.
- [ ] Add strict updater metadata and release assembly.
- [ ] Add release preflight and package-impact classification.
- [ ] Add focused fail-closed unit tests.

## Reusable Packaging

- [ ] Add Windows x64/ARM64 reusable packaging.
- [ ] Add Linux x64/ARM64 reusable packaging.
- [ ] Add macOS x64/ARM64 reusable packaging with distribution verification.
- [ ] Rewire manual Build to distribution-mode reusable workflows.
- [ ] Protect workflow interfaces and runner mappings with parsed-YAML tests.

## Package Regression

- [ ] Add reusable, manual, and scheduled six-target package regression.
- [ ] Remove historical baseline rebuilds from package jobs.
- [ ] Add fail-closed PR impact classification.
- [ ] Integrate conditional regression state into `pr-required`.

## Release

- [ ] Move tag, ancestry, version, and CHANGELOG checks before native package jobs.
- [ ] Rewire Release to distribution-mode reusable workflows.
- [ ] Assemble only complete, digest-verified target manifests.
- [ ] Generate canonical updater metadata and `release-index.json`.
- [ ] Restrict write permission to draft release publication.
- [ ] Remove tolerant copy and Ruby/YAML merge logic.

## Maintained Documentation

- [ ] Update Light OCR package-size ownership.
- [ ] Update Linux ARM64 metadata ownership.
- [ ] Update release flow and plugin packaging guidance.

## Validation

- [ ] Run focused package and workflow contract tests.
- [ ] Run complete main and renderer suites.
- [ ] Run type checking and the canonical build.
- [ ] Run format, localization, lint, and final format checks.
- [ ] Review generated provider and ACP registry refreshes.
- [ ] Verify all six native packages and real macOS signing after a future authorized push.
