# CUA Windows Launch Timeout And Permission Diagnostics

## Problem

Packaged CUA on Windows can connect and expose tools, but `launch_app` may hang until the MCP SDK
request timeout when the model supplies an app identifier that the Windows driver cannot resolve.
The CUA plugin settings page also presents macOS permission labels on Windows and turns Windows
permission diagnostics into a generic failure message.

## User Stories

- As a Windows user, I want invalid or platform-mismatched `launch_app` arguments to fail quickly
  with actionable guidance instead of waiting for `MCP error -32001: Request timed out`.
- As a Windows or Linux user, I want the CUA settings page to show platform-relevant diagnostics
  instead of macOS Accessibility and Screen Recording checks.
- As a macOS user, I want the existing helper permission flow to keep working unchanged.

## Acceptance Criteria

- Windows CUA `launch_app` calls are preflighted before dispatching to the MCP driver when the
  request uses a free-form `name` or non-AUMID `bundle_id`.
- Windows desktop app paths carried in `bundle_id` are normalized to the Windows `path` argument
  before calling the driver.
- Windows unresolved app names or macOS-style bundle ids return an immediate tool error that tells
  the agent to call `list_apps` and use `name`, `path`, `launch_path`, or `aumid`.
- CUA permission checks return platform-specific fields for Windows and Linux without marking a
  successful Windows JSON check as a failure.
- The settings page renders platform-specific permission/diagnostic labels and messages.
- Tests cover Windows launch preflight and permission parsing behavior.

## Non-Goals

- Modify upstream `trycua/cua` binaries.
- Replace the plugin-owned MCP transport with a non-MCP tool host.
- Add new CUA-supported platforms beyond the current support matrix.

## Constraints

- Keep changes scoped to the CUA integration and generic MCP wrapper behavior needed by CUA.
- Do not expose plugin-owned CUA MCP servers in the normal MCP settings UI.
- Preserve macOS permission probe behavior.

