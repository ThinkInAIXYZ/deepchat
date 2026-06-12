# CUA Driver v0.2.0 Sync

## Problem

The bundled DeepChat Computer Use helper is based on upstream
`cua-driver-v0.1.5`. Upstream Swift CUA driver `cua-driver-v0.2.0` contains
macOS reliability fixes for focus suppression, screenshot capture fallback,
hidden app handling, side-effect detection, and MCP daemon proxying.

## User Story

As a DeepChat user using the bundled CUA plugin, I need the macOS helper to
include current upstream Swift driver fixes while continuing to use DeepChat's
helper app, TCC permissions, MCP registration, and plugin packaging.

## Acceptance Criteria

- Vendored upstream metadata records `cua-driver-v0.2.0` and commit
  `d3f3b9325f49aa5302c15fb03f6b66bd1e688e27`.
- The local fork includes the upstream Swift driver runtime improvements from
  `v0.1.5` through `v0.2.0`.
- DeepChat-specific behavior remains intact: `DeepChat Computer Use.app`,
  bundle id `com.wefonk.deepchat.computeruse`, `deepchat-permission-probe`,
  DeepChat-managed updates, and MCP-first plugin skills.
- The Rust `cua-driver-rs` runtime is not introduced in this sync.
- Validation covers Swift build, formatting, i18n, lint, diff checks, CUA
  runtime build, and plugin validation where practical.

## Non-goals

- No migration to `cua-driver-rs`.
- No changes to the CUA plugin manifest, settings UI, MCP server id, or tool
  policy.
- No adoption of upstream standalone installer behavior for DeepChat updates.

## Constraints

- Preserve DeepChat's local helper app identity for TCC attribution.
- Keep packaged `plugins/cua/skills/cua-driver` guidance MCP-first.
- Treat upstream standalone scripts as reference material unless required by
  the bundled helper build.
