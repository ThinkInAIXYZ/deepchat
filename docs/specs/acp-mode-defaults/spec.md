# ACP Mode Defaults and Session Settings - Specification

> Version: 1.0
> Date: 2025-03-01
> Status: Draft

## Overview

Improve the default chat experience by enabling MCP by default, simplifying mode selection to Agent and ACP Agent, and adding ACP session settings for Claude Code and Codex.

## Goals

- Enable MCP by default for new installs.
- Default chat mode to Agent and only expose Agent + ACP Agent in the UI.
- When switching to ACP Agent, let users pick an ACP agent directly (no extra model selector step).
- In ACP Agent mode for Claude Code and Codex, expose session-level settings (model and permission mode).

## User Stories

- As a user, MCP should be on by default so I can use tools immediately.
- As a user, I should only see Agent and ACP Agent modes and default to Agent.
- As a user, switching to ACP Agent should immediately select an ACP agent without opening the model selector.
- As a user, when using Claude Code or Codex in ACP Agent mode, I can choose the session model and permission mode.

## Acceptance Criteria

- MCP is enabled by default for new installs.
- The mode switcher lists only Agent and ACP Agent entries; chat mode is not selectable.
- ACP Agent mode selection provides a direct list of available ACP agents; selecting one sets both mode and model.
- If a saved chat mode is `chat`, it is migrated to `agent` on load.
- For ACP Agent sessions using `claude-code-acp` or `codex-acp`, the settings panel shows:
  - Session model selector (from ACP session models).
  - Permission mode selector (from ACP session modes).
- Session model/mode selections apply to the active ACP session and update when the agent reports new options.

## Non-Goals

- Adding new ACP agent types or changing ACP agent definitions.
- Persisting ACP session model selections across app restarts.
- Redesigning the model selector beyond ACP Agent selection flow.

## Assumptions

- ACP agents expose session modes and session models through ACP `newSession`.
- Claude Code and Codex provide meaningful session modes for permission presets.

