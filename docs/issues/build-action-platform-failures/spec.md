# Build Action Platform Failures Spec

## Status

In progress.

## Goal

Restore the manual Build Application workflow for the current CUA cross-platform branch so the
Windows arm64 and Linux x64 jobs can produce packaged artifacts for maintainer verification.

## Background

GitHub Actions run `27634409921` failed on two jobs:

- `build-windows(arm64)` crashed during `scripts/fetch-acp-registry.mjs` before `pnpm run build`
  produced `out/main/index.js`; the PowerShell multi-line step then continued into packaging and
  reported a secondary missing-entry asar error.
- `build-linux (x64)` staged the CUA runtime but failed the executable smoke check because the
  upstream Linux binary requires `GLIBC_2.39`, while the Ubuntu 22.04 runner provides an older
  loader.
- The follow-up run `27636722380` passed Windows x64, Windows arm64, and Linux x64, then failed
  `build-mac (arm64)` during `vue-tsgo` because `vuedraggable` module typing was not resolved on
  that runner.
- The CUA helper identity branch run `28011329887` passed CUA macOS runtime staging and signing, but
  failed the manual Build Application macOS arm64 job during app notarization. `notarytool` returned
  HTTP 403 because the Apple Developer account had a missing or expired required agreement. This is
  an external release-account state, not a CUA packaging failure, but it should not block
  non-release branch artifact builds.

## Acceptance Criteria

- Windows arm64 build steps stop at the first failing command and surface the real failure.
- `scripts/fetch-acp-registry.mjs` avoids the Windows arm64 registry-fetch crash path while still
  refreshing the registry and cached icons.
- Linux x64 CUA runtime staging still validates checksum, archive layout, executable presence, and
  permissions.
- Linux x64 CUA runtime smoke checks run when the host loader can execute the binary and skip only
  for a detected glibc loader-version mismatch.
- macOS arm64 typecheck resolves `vuedraggable` for the existing draggable list components.
- Manual Build Application macOS jobs do not invoke Apple notarization. Release workflow macOS jobs
  continue to notarize release artifacts.
- The Build Application workflow can be pushed again for maintainer validation.

## Non-Goals

- Change the pinned CUA upstream release.
- Change the packaged Linux runner baseline.
- Redesign ACP registry runtime loading.
- Disable notarization in the release workflow.
