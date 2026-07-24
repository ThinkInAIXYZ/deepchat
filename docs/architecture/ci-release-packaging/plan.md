# CI and Release Packaging Contract — Implementation Plan

> Requirements and acceptance criteria are defined in [spec.md](./spec.md), and execution progress is
> recorded in [tasks.md](./tasks.md).

## 1. Architecture

Build, Release, package regression, and the pull-request package gate are thin callers. They invoke
three operating-system reusable workflows with an immutable source SHA and architecture matrix. The
reusable workflows own native preparation and package verification, while deterministic Node
scripts own file discovery, manifests, updater metadata, size policy, impact classification, and
release assembly.

The package layer has two artifact purposes:

- `distribution` creates an exact downloadable target artifact. On macOS it requires and verifies
  signing and notarization.
- `verification` creates a package only inside the current runner, enforces smoke and size policies,
  and uploads diagnostics without distributing the unsigned installer.

Build and Release always request distribution artifacts. Pull-request package checks and scheduled
or manually dispatched package regression always request verification.

Verification deliberately retains the complete target set configured for an operating system. The
CLI can select individual electron-builder targets, but adding an updater-only PR mode would create
a second manifest and size-policy contract. Latency is reduced by classifying fewer changes and
running fewer operating systems, not by weakening an affected target's package coverage.

## 2. Shared Package Contract

`scripts/ci/package-contract.mjs` defines the six target IDs, allowed architectures, artifact roles,
raw updater metadata names, and required public release files. Other scripts import this contract
instead of maintaining extension globs independently.

`scripts/ci/package-manifest.mjs` locates exactly one file for every required role, rejects unknown or
unsafe entries, hashes files, validates raw electron-builder metadata, and stages a self-contained
target artifact. It derives check results from completed workflow evidence. For macOS distribution it
also invokes the existing application and DMG verification helpers before recording distribution
status.

The internal artifact layout is:

```text
package-output/
  manifest.json
  files/
  metadata/
  reports/
```

Only distribution-mode `package-output` directories include distributable files. Verification mode
retains reports and a manifest locally and uploads only diagnostic content.

## 3. Installer Size Policy

The Light OCR budget file retains only component budgets. Installer facts and policy move to:

- `resources/package-size-baseline.json`
- `resources/package-size-policy.json`

The baseline records bytes and SHA-256 for the selected package roles from run `29978292769`. A
baseline-import command validates that all six target directories contain exactly one expected
candidate for every measured role before writing reviewable JSON.

The comparison command matches by target and role rather than versioned filename. Initial growth and
shrink limits are both 90 MiB. It always writes a report, including on policy failure.

## 4. Reusable Workflows

Each OS reusable workflow validates its inputs before dependency installation, re-declares CI and
JavaScript-action runtime environment, uses a bounded timeout, and keeps repository permissions
read-only.

Common behavior includes frozen installation, Sharp target configuration followed by a second frozen
installation, runtime setup, source build, target package creation, packaged smoke tests, manifest
generation, and optional size comparison.

Operating-system differences remain explicit:

- Windows uses PowerShell network isolation for Light OCR and verifies both supported plugins.
- Linux uses network namespaces, verifies OpenDAL, and omits CUA for ARM64.
- macOS uses sandbox network isolation, verifies the application and DMG distribution chain, and
  receives signing secrets only for distribution.

Distribution outputs use unique `deepchat-package-<platform>-<arch>` artifact names, error on missing
files, and disable redundant artifact compression.

## 5. Callers

`build.yml` retains the platform dispatch selector and invokes the appropriate OS matrices with
`distribution`. macOS secrets are passed only to the macOS caller.

`package-regression.yml` supports `workflow_call`, `workflow_dispatch`, and a daily 18:37 UTC
schedule. It invokes all six targets with `verification`, enforces installer size, and passes only the
runtime token and existing non-signing build configuration. It is the full nightly/manual regression
suite and is not nested inside the fast PR workflow.

`prcheck.yml` keeps only static, main, renderer, Native Memory, source-build, and aggregate jobs for
PRs targeting `dev`. `pr-required` therefore reports as soon as fast code-quality checks complete.

`package-check.yml` is a separate, always-started workflow for PRs targeting `dev`:

1. Check out full history and validate the exact base/head commit pair.
2. Load the classifier only from the base revision. If it does not exist during the one-time
   contract bootstrap, validate both `package.json` snapshots and conservatively select all targets
   without executing candidate classifier code.
3. Classify changed paths into Windows, Linux, and macOS decisions with rule evidence.
4. Invoke both architectures for each affected operating system using complete `verification`
   packaging and the installer-size gate.
5. Run `package-required` with `always()` and require each OS job to be successful when selected or
   skipped when not selected.

The workflow intentionally has no `paths` or `paths-ignore` trigger. GitHub can leave a skipped
workflow's required status pending, whereas an always-present aggregate can represent both selected
and intentionally skipped native jobs safely.

Classifier rules are explicit and ordered:

- shared builder config, native dependency manifests, runtime installers, plugins, package smoke,
  and manifest/size tooling select all operating systems;
- package manifest comparison selects only production dependency, Electron toolchain, package
  metadata, lifecycle, build, runtime, plugin, and package-smoke changes, while the lockfile remains
  conservatively shared;
- `_package-<os>.yml`, platform signing/installer files, and platform icons select one operating
  system;
- release preflight/assembly, unrelated workflows, generated provider/ACP registries, ordinary
  application code, and documentation select none.

The classifier's own path selects all operating systems under the base version, preventing a
classifier-only candidate change from weakening its own gate. A missing base classifier also
selects all targets, so bootstrap cannot turn missing policy into a skip. Workflow orchestration
remains candidate-controlled and therefore relies on parsed contract tests and review policy.
Output keys remain backward compatible; a breaking schema change requires two PRs.

## 6. Release

A preflight job resolves and checks the tag, main ancestry, package version, CHANGELOG section, and
release notes before invoking any package matrix.

After all six distribution artifacts are downloaded, `scripts/ci/assemble-release.mjs`:

1. Validates target completeness, source identity, purpose, checks, paths, sizes, and SHA-256.
2. Recomputes and validates raw updater metadata SHA-512 and sizes.
3. Copies only the current public contract into a clean staging directory.
4. Merges Windows and macOS metadata using electron-updater architecture-selection semantics.
5. Preserves separate Linux architecture metadata.
6. Writes `release-index.json` with target evidence and SHA-256 for the other eighteen assets.
7. Verifies the final staging directory contains exactly nineteen allowed assets.

The draft release action runs only after assembly succeeds and is the only job with write
permission. Before upload, `scripts/ci/verify-release-assets.mjs` revalidates the local index and all
nineteen files. An existing draft may contain only known contract names; after upload the verifier
requires exactly nineteen GitHub assets whose API-reported sizes and SHA-256 digests match the local
contract.

Package manifests bind both workflow run ID and run attempt. A partial rerun that mixes successful
artifacts from different attempts fails closed; maintainers rerun all jobs for a release retry.

## 7. Tests and Validation

Vitest fixtures cover success and every fail-closed boundary: missing targets or roles, unsafe paths,
duplicates, digest changes, invalid updater references, wrong architecture metadata, verification
manifests in Release, missing macOS distribution evidence, and package-size limits.

Parsed-YAML workflow tests cover reusable inputs, runner mappings, permissions, explicit secret
passing, pinned actions, environment declarations, distribution versus verification behavior,
artifact upload safety, independent PR aggregates, package-impact success/skip combinations, and
release preflight ordering.

Classifier tests cover shared, platform-specific, and ignored paths, malformed input, NUL-delimited
CLI input, evidence output, and base-owned execution. Updater compatibility tests exercise the
installed electron-updater architecture selectors so dependency upgrades cannot silently invalidate
the assembled Windows, macOS, or Linux metadata conventions.

Validation proceeds through focused tests, complete main and renderer suites, type checking, the
canonical build, format, localization, lint, and a final format check. Verification-mode packaging
has passed on all six GitHub-hosted native runners. Distribution-mode Apple signing/notarization and
draft release publication remain pending until a release or manual Build run.

## 8. Rollback

The implementation is divided into documentation, deterministic tooling, reusable package workflows,
PR gate integration, and release assembly commits. The PR gate is independently reversible:
removing `package-check.yml` and restoring the previous classifier call in `prcheck.yml` does not
change Build or Release behavior. The baseline and tooling commits do not change application runtime
behavior and can remain inert during a workflow rollback.
