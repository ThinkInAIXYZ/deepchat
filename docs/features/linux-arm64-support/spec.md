# Linux ARM64 Support Spec

## Status

Implemented and validated in
[Build Application run 29933595490](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/29933595490).

## Background

DeepChat already contains most Linux ARM64 packaging primitives, including an Electron Builder
script, ARM64 native dependency mappings, and runtime installers. The build and release workflows
still schedule only Linux x64, use x64-specific unpacked paths, and always bundle the CUA plugin.

CUA is intentionally unsupported on Linux ARM64 because the pinned upstream driver release has no
matching runtime asset. DeepChat already gates official plugin visibility by platform and
architecture and rejects direct CUA packaging for `linux/arm64`. Linux ARM64 application support
must preserve that contract rather than exposing a non-functional plugin.

## Goal

Produce Linux ARM64 application artifacts in both build and release CI while keeping CUA hidden,
unbundled, and unverified for that target.

## Scope

- Add native Linux ARM64 jobs to `.github/workflows/build.yml` and
  `.github/workflows/release.yml`.
- Install the existing target-specific runtimes before packaging each Linux architecture.
- Parameterize unpacked output paths for Linux x64 and ARM64.
- Bundle and verify CUA only for Linux x64.
- Bundle and verify Feishu for both Linux architectures.
- Collect Linux ARM64 artifacts and architecture-specific update metadata in the release job.
- Preserve the existing manifest-based CUA visibility gate and unsupported-target packaging error.

## Non-Goals

- Do not add a Linux ARM64 CUA runtime or claim Linux ARM64 CUA support.
- Do not change CUA behavior on any supported target.
- Do not redesign the plugin discovery or packaging systems.
- Do not run the release workflow as part of this change.

## Target Matrix

| Target | Runner | Application package | CUA | Feishu |
| --- | --- | --- | --- | --- |
| `linux/x64` | `ubuntu-22.04` | Required | Bundle and verify | Bundle and verify |
| `linux/arm64` | `ubuntu-22.04-arm` | Required | Skip | Bundle and verify |

## Acceptance Criteria

- Build CI emits Linux x64 and Linux ARM64 artifacts from native GitHub-hosted runners.
- Release CI emits both Linux architectures and preserves `latest-linux-arm64.yml` separately
  from x64 update metadata.
- Linux jobs use the correct `linux-unpacked` or `linux-arm64-unpacked` output directory.
- Linux ARM64 jobs never invoke CUA bundling or verification.
- A packaged Linux ARM64 app does not contain a CUA `.dcplugin` artifact.
- CUA remains unavailable in business logic on a Linux ARM64 runtime.
- Direct CUA packaging for `linux/arm64` continues to fail with an unsupported-target error.
- Focused tests and the repository formatting, i18n, and lint checks pass.
- A manually dispatched build workflow succeeds for the branch's Linux ARM64 matrix job.
