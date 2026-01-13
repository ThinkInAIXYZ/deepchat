# ACP Mode Defaults and Session Settings - Plan

## Architecture Changes

- Main process
  - Track ACP session models in `AcpProcessHandle` and `AcpSessionRecord`.
  - Extend ACP provider + session manager to read/write session model and expose session models over IPC.
  - Emit a new renderer event when ACP session models are ready.
- Renderer
  - Update mode selector to show Agent + ACP agents only.
  - Add ACP session settings UI (model + permission mode) for Claude Code and Codex.
  - Add composable to load ACP session models and apply selections.
- Shared types
  - Extend presenter interfaces to include ACP session model APIs.
  - Add types for ACP session model descriptors.

## Event Flow

1. ACP session created (or warmup session probed).
2. Main process extracts `models.availableModels` + `models.currentModelId`.
3. Main process sends `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` with:
   - conversationId (if bound), agentId, workdir, current, available.
4. Renderer composable updates the ACP session model selector.

## Data Model Updates

- `AcpProcessHandle`
  - `availableModels?: Array<{ id; name; description? }>`
  - `currentModelId?: string`
- `AcpSessionRecord`
  - `availableModels?: Array<{ id; name; description? }>`
  - `currentModelId?: string`

## UI/UX Plan

- Mode switcher:
  - Show Agent row.
  - Show ACP Agent list (each ACP agent entry is selectable).
  - Selecting an ACP agent sets mode to `acp agent` and model to that agent.
- Chat settings popover (ChatConfig):
  - When providerId is `acp` and modelId is `claude-code-acp` or `codex-acp`,
    render ACP session settings section.
  - Session Model: select from ACP session models.
  - Permission Mode: select from ACP session modes.

## Compatibility & Migration

- Default MCP enabled for new installs only; existing stored setting is respected.
- Stored chatMode `chat` is migrated to `agent` during mode load.

## Test Strategy

- Manual:
  - Fresh install: MCP enabled, default mode Agent.
  - Mode switcher shows Agent + ACP agents only.
  - Selecting ACP agent switches model without using model selector.
  - Claude Code/Codex: session model + permission mode selectors populate after session starts.
  - Selecting session model/mode updates ACP session.

