# CI and Release Packaging Contract — Specification

> Status: **in progress**
>
> Classification: **architecture**
>
> GitHub issue: **not requested**

This document defines the maintained native packaging, regression, and release-assembly contracts.
The implementation design is described in [plan.md](./plan.md), and execution progress is tracked in
[tasks.md](./tasks.md).

## 1. Purpose

The Build and Release workflows currently duplicate six native package paths, rebuild a historical
baseline once per target for installer-size checks, and collect release files through permissive
globs. A missing target or updater payload can therefore be hidden by tolerant copy commands, while
routine packaging changes require parallel edits in multiple workflow files.

The new architecture makes three operating-system reusable workflows the sole owners of native
packaging. Every distributable is described by a machine-verifiable target manifest, and release
assembly fails closed against an explicit six-target contract.

## 2. Goals

- Keep electron-builder and electron-updater as the packaging and update implementation.
- Build x64 and ARM64 packages on the repository's existing native GitHub-hosted runners.
- Reuse one Windows, one Linux, and one macOS packaging workflow from Build, Release, and package
  regression callers.
- Require every macOS Build and Release artifact to be signed, notarized, stapled, and verified.
- Keep Windows signing outside this change and never claim that Windows artifacts are signed.
- Keep pull-request and scheduled package regression unable to access Apple signing secrets.
- Replace permissive release collection with exact manifests, digests, updater metadata validation,
  and a public release index.
- Replace historical baseline rebuilds with a committed installer-size baseline and policy.
- Preserve the existing parallel PR quality gates and add package regression only for relevant
  packaging or runtime changes.

## 3. Acceptance Criteria

### AC-1 — Reusable Native Packaging

- `_package-windows.yml`, `_package-linux.yml`, and `_package-macos.yml` are the sole owners of their
  operating system's runner mapping, native runtime installation, packaging, packaged smoke tests,
  and target artifact staging.
- Each reusable workflow accepts an immutable source SHA, an `x64` or `arm64` architecture, an
  `artifact-purpose` of `distribution` or `verification`, and an installer-size gate switch.
- Build and Release use `distribution`; package regression uses `verification`.
- Secrets are passed explicitly at every reusable-workflow boundary. `secrets: inherit` is absent.
- Called workflows declare their own required environment because caller workflow-level environment
  values are not inherited.

### AC-2 — Signing Boundary

- Every macOS package produced by `build.yml` or `release.yml` requires the signing certificate and
  Apple notarization credentials before expensive work starts.
- Distribution packaging verifies the signed and stapled application bundle and final DMG with
  `codesign`, `stapler`, `spctl`, and DMG integrity checks.
- Verification packaging explicitly disables certificate auto-discovery, receives no Apple signing
  secrets, and never uploads a complete unsigned installer.
- Windows and Linux manifests contain no macOS distribution fields and no generic `signed` claim.
- Windows signing and certificate acquisition remain outside this goal.

### AC-3 — Target Manifest

- Each target manifest binds the package to one platform, architecture, source commit, application
  version, artifact purpose, toolchain version, check result, and exact file list.
- Manifest files include byte size and SHA-256 for every staged file.
- Only regular files inside the target staging root are accepted. Absolute paths, traversal,
  symlinks, duplicate basenames, duplicate roles, and unknown public files are rejected.
- A distribution manifest is generated only after package smoke and requested size gates pass.
- macOS distribution status is derived from actual verification commands, not caller-supplied
  booleans.

### AC-4 — Fail-Closed Release

- Release preflight resolves an existing lightweight or annotated tag to a commit and never falls
  back to the workflow context SHA.
- The tagged commit must be reachable from `origin/main`, match `package.json` version, and have a
  non-empty matching CHANGELOG section before any native package job starts.
- Assembly requires exactly the six supported targets: Windows, Linux, and macOS on x64 and ARM64.
- Every manifest must use the release source commit, version, and `distribution` purpose.
- Missing files, duplicate public names, unexpected targets, digest mismatches, incomplete macOS
  distribution evidence, or invalid updater metadata fail the release.
- Only the final draft-release job receives `contents: write`.

### AC-5 — Updater Compatibility

- Windows publishes `latest.yml` with x64 and ARM64 NSIS entries plus both EXE blockmaps.
- macOS publishes `latest-mac.yml` with x64 and ARM64 ZIP entries plus both ZIP blockmaps.
- DMG remains a manual installer and is excluded from updater metadata and blockmap generation.
- Linux publishes separate `latest-linux.yml` and `latest-linux-arm64.yml` files that reference the
  corresponding AppImage.
- Every metadata URL resolves to a staged release file, and its SHA-512 and byte size match that file.
- Windows and macOS entries are ordered x64 before ARM64, with legacy `path` and `sha512` fields
  pointing to x64.
- The workflow uploads exactly nineteen assets under the current package target configuration,
  including `release-index.json`.

### AC-6 — Package Regression

- Component budgets for OCR assets, Node, and other packaged runtimes remain part of every packaged
  Light OCR smoke test.
- Installer comparison reads committed baseline facts instead of rebuilding the historical commit.
- The initial baseline records successful run `29978292769` and source commit
  `dfb4ba0f34c008c27cfb6bd98a08fdbd36f7b343`.
- Windows EXE, Linux AppImage and tarball, and macOS ZIP and DMG enforce upper and lower delta bounds.
- `package-regression.yml` supports reusable, manual, and scheduled execution, always covers all six
  targets, and uploads reports rather than complete unsigned installers.
- A packaging-impact classifier runs on every PR. Relevant changes require package regression;
  unrelated changes require it to be skipped; classification failure fails the aggregate check.

## 4. Constraints

- Do not migrate to Electron Forge or universal macOS packages.
- Do not add dependency caching.
- Do not modify Windows signing, OAuth build-time credential behavior, or
  `windows-arm64-e2e.yml`.
- Preserve frozen pnpm installs and the second install required after `install:sharp`.
- Preserve current native runtime, Light OCR, DuckDB VSS, OpenDAL, CUA, and Feishu verification.
- Keep Actions pinned to immutable commit SHAs and checkout credentials disabled.
- Do not create or synchronize a GitHub issue.
- Do not push from this implementation branch.

## 5. Non-Goals

- Changing application runtime behavior or public application APIs.
- Publishing unsigned macOS verification artifacts.
- Replacing GitHub Releases or electron-updater.
- Introducing Windows certificates, package signing, or signing assertions.
- Refactoring the standalone Windows ARM64 E2E workflow.
- Changing branch-protection settings.

## 6. Compatibility and Risks

- The final metadata intentionally follows electron-builder 26 and electron-updater 6 selection
  semantics. Dependency upgrades must rerun the metadata contract tests before release.
- The exact nineteen-asset allowlist intentionally rejects new package formats until the contract,
  tests, and release index are updated together.
- Verification-mode macOS package sizes can differ slightly from signed distribution sizes. The
  initial 90 MiB delta bounds tolerate signing overhead while still catching material omissions.
- Native GitHub runner behavior and real Apple notarization cannot be proven locally. Local tests
  cover structure and deterministic scripts; a future pushed run remains required for remote
  evidence.
- The package-impact classifier deliberately trades runner cost for safety: any packaging-related
  change runs all six native targets.

## 7. Open Questions

None. Tooling choice, signing boundary, target set, public asset set, regression trigger behavior, and
deferred work are fixed for this implementation.
