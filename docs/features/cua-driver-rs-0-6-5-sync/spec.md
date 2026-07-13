# CUA Driver Rs 0.6.5 Sync Spec

## User Need

DeepChat's official CUA plugin should pin the current upstream `cua-driver-rs` release asset set
used by the bundled cross-platform runtime.

## Goal

Sync the bundled CUA runtime metadata from `cua-driver-rs-v0.5.5` to `cua-driver-rs-v0.6.5` and
keep DeepChat's reviewed tool policy aligned with the released MCP surface.

## Acceptance Criteria

- `plugins/cua/vendor/cua-driver/upstream.json` points at `cua-driver-rs-v0.6.5`.
- Supported DeepChat targets stay unchanged.
- The plugin runtime minimum version matches the pinned driver version.
- Newly reviewed diagnostic tools are allowed explicitly.
- Existing CUA metadata and policy tests pass.

## Constraints

- Do not switch to the older non-Rust `cua-driver-v*` release line; it is macOS-only and would
  break the current cross-platform plugin contract.
- Upstream marks `cua-driver-rs-v*` releases as GitHub prereleases. Treat the pinned release asset
  as a build input, not a claim that Linux is officially stable upstream.
- Keep Linux arm64 unsupported in DeepChat.

## Non-Goals

- No runtime downloader redesign.
- No new bundled platforms.
- No policy broadening for unreviewed action tools.
