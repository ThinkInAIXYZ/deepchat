# CUA macOS Helper Bundle Identity

## Problem

DeepChat consumes upstream CUA release binaries directly. On macOS, the staged helper app currently
keeps upstream-facing identity details such as `CuaDriver.app`, `com.trycua.driver`, and
`cua-driver`. Packaged DeepChat builds can therefore collide with a user-installed upstream CUA app,
confuse TCC permission attribution, and make process/runtime ownership harder to diagnose.

Changing only the visible file name is not enough. macOS identity is driven by the app bundle,
`Info.plist`, the main executable, and the code signature that signs those final bytes.

## Goal

Keep using verified upstream CUA release artifacts without vendoring or syncing the full upstream
source tree, while staging a DeepChat-owned macOS helper bundle for packaged builds.

## Recommended Direction

Post-process the upstream macOS release artifact during `scripts/build-cua-plugin-runtime.mjs`:

- Verify upstream checksum first.
- Copy the upstream `.app` bundle as an input artifact.
- Rename/rebundle it to a DeepChat-owned helper layout.
- Rewrite `Info.plist` to a stable DeepChat bundle identity.
- Rename the macOS helper executable if compatibility checks pass.
- Sign the mutated bundle with DeepChat signing material.
- Validate the final bundle identity, executable path, architecture, signature, and smoke command.

This keeps the supply-chain model release-based instead of source-sync-based.

## Target macOS Runtime Layout

```text
plugins/cua/runtime/darwin/<arch>/
  DeepChat Computer Use.app/
    Contents/
      Info.plist
      MacOS/
        deepchat-cua-driver
```

Recommended identity values:

- `CFBundleIdentifier`: `com.deepchat.computeruse.helper`
- `CFBundleName`: `DeepChat Computer Use`
- `CFBundleDisplayName`: `DeepChat Computer Use`
- `CFBundleExecutable`: `deepchat-cua-driver`

The bundle identifier must be stable across versions and architectures. Do not include version,
channel, platform, or architecture in the identifier.

## Acceptance Criteria

- Packaged macOS CUA runtime does not stage `CuaDriver.app` as the primary helper bundle.
- Packaged macOS CUA runtime does not use `com.trycua.driver` as the helper bundle identifier.
- DeepChat plugin runtime detection resolves only the DeepChat-owned macOS helper path for packaged
  CUA.
- The runtime permission guide action on macOS opens the detected DeepChat-owned helper app first,
  so TCC prompts are attributed to `DeepChat Computer Use.app` instead of a generic upstream guide.
- If the macOS helper path is unavailable, the permission guide action falls back to the declared
  runtime guide URL.
- Release staging still verifies upstream checksums before mutation.
- All bundle mutations happen before signing.
- The final staged helper passes architecture validation, code-signature validation, and a low-risk
  smoke command such as `--version`.
- Packaging validation rejects macOS CUA manifests or staged bundles that still point at the
  upstream app name, upstream bundle identifier, or missing DeepChat-owned executable path.
- Existing Windows and Linux runtime layout remains unchanged.

## Constraints

- Do not sync the full upstream `trycua/cua` source tree into DeepChat.
- Do not rely on a user-installed `/Applications/CuaDriver.app` for packaged DeepChat CUA.
- Do not mutate upstream release archives before checksum verification.
- Do not change the CUA tool surface or approval policy as part of this work.

## Compatibility Notes

- Existing macOS users who already granted Accessibility or Screen Recording to the upstream bundle
  id will need to grant permissions once for the DeepChat-owned helper identity.
- Upstream CUA source contains several user-facing references to `DeepChat Computer Use.app`, so
  that app name is safer than inventing a different visible name.
- Some upstream diagnostics and legacy cleanup paths mention `com.trycua.*`; those should be treated
  as upstream diagnostics unless they affect packaged DeepChat runtime behavior.
- Permission checks may continue to use the existing probe/fallback CLI path, but any user-initiated
  permission guide must launch the currently detected DeepChat helper bundle when available.

## Non-Goals

- Fork or rebuild CUA from source.
- Install the helper into `/Applications`.
- Add a user-facing setting for helper identity.
- Migrate existing TCC grants automatically.
- Manage upstream CUA autostart or updater registrations outside the DeepChat-packaged helper.

## Open Questions

None.
