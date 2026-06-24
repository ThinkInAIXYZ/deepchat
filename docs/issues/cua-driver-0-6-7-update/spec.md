# CUA Driver 0.6.7 Update

## User Need

Packaged DeepChat still ships `cua-driver-rs v0.5.5`, and the bundled CUA runtime reports that
`v0.6.7` is available. This creates repeated MCP stderr noise and makes the managed helper look stale
even though users cannot fix the bundled runtime by running `cua-driver update` on their own PATH.

## Goals

- Update the pinned CUA upstream release metadata from `cua-driver-rs-v0.5.5` to
  `cua-driver-rs-v0.6.7`.
- Keep all existing supported DeepChat targets unchanged:
  - `darwin/arm64`
  - `darwin/x64`
  - `win32/x64`
  - `win32/arm64`
  - `linux/x64`
- Preserve managed-helper staging and sidecar-only MCP mode.
- Update tests and docs that intentionally pin the upstream CUA release version.

## Non-Goals

- Do not run the upstream installer.
- Do not add user-facing self-update inside DeepChat.
- Do not add Linux arm64 support in this change, even though upstream now publishes a Linux arm64
  artifact.
- Do not commit generated runtime binaries or local bundle outputs.

## Acceptance Criteria

- `plugins/cua/vendor/cua-driver/upstream.json` points to `cua-driver-rs-v0.6.7` with current asset
  names and release metadata.
- `plugins/cua/plugin.json` advertises `minVersion` `0.6.7`.
- CUA metadata tests assert the new tag, version, and asset names.
- `pnpm run plugin:bundle -- --name cua --platform darwin --arch x64` downloads/stages the new
  release and packages the CUA plugin successfully.
- Required repository checks pass.

## Open Questions

None.
