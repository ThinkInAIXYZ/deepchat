# CUA Sidecar-Only Runtime

## Problem

DeepChat's CUA plugin starts the bundled `cua-driver mcp` sidecar, but upstream `cua-driver` can
auto-relaunch a long-running daemon from MCP mode. That leaves a background process outside the
normal plugin-owned MCP server lifecycle and makes runtime cleanup harder to reason about.

## Goal

Run CUA through the DeepChat-managed plugin sidecar only. The CUA MCP process should stay
application-owned and must not auto-relaunch the upstream daemon.

## Acceptance Criteria

- The official CUA plugin starts `cua-driver mcp` with upstream daemon relaunch disabled.
- The no-relaunch behavior is declared both as an MCP argument and an environment variable, so the
  intent survives platform-specific argument parsing.
- Plugin packaging validation rejects CUA manifests that omit the no-relaunch argument or
  environment variable.
- Existing bundled runtime detection and platform target support stay unchanged.

## Constraints

- Do not modify upstream `trycua/cua` binaries.
- Do not replace the plugin-owned MCP transport.
- Do not change user-facing MCP settings behavior.

## Non-Goals

- Disable all child processes. The CUA sidecar itself is still a child process owned by DeepChat.
- Add UI settings for daemon behavior.
- Manage existing user-created autostart registrations outside this plugin configuration.

## Open Questions

None.
