# CUA Driver v0.1.5 Sync

## Problem

The vendored DeepChat CUA driver snapshot is based on upstream `cua-driver-v0.1.4`.
Upstream `cua-driver-v0.1.5` fixes window enumeration for system overlay or
non-layer-0 windows when callers filter by pid.

## User Story

As a DeepChat user using the bundled Computer Use plugin, I need `list_windows`
and `get_window_state` to surface relevant overlay windows for a target pid so
agent workflows can inspect and act on the correct UI.

## Acceptance Criteria

- The vendored driver records upstream `cua-driver-v0.1.5` metadata.
- The upstream overlay-window fix is applied without replacing DeepChat's local
  fork changes.
- Packaged plugin skills remain MCP-first. If upstream skills change in this
  sync, start from upstream skill content and preserve DeepChat's MCP-first
  guidance in the packaged skill.
- Validation covers formatting, i18n generation, lint, and CUA plugin package
  validation where practical.

## Non-goals

- No rewrite of the CUA plugin manifest, settings UI, or MCP policy.
- No wholesale replacement of the DeepChat-owned driver fork.
- No behavior changes outside the CUA driver vendored source and plugin skills.

## Constraints

- Preserve local DeepChat fork behavior and packaging paths.
- Keep user-facing CUA skill guidance aligned with MCP tools, not CLI-first
  workflows.
