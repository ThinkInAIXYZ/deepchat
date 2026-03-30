# Remote ACP Control Plan

## Summary

Implement ACP-aware remote control inside the existing Electron main remote-control flow. The change stays within the current presenter and runner architecture: `RemoteControlPresenter` handles config normalization and sanitization, `RemoteConversationRunner` handles ACP session creation and workdir resolution, command routers expose ACP-specific behavior, and `RemoteSettings.vue` exposes the new configuration surface.

## Goals

- Allow Telegram and Feishu to use any enabled agent as the default remote agent.
- Require and resolve a workdir when that default agent is ACP.
- Preserve current DeepChat remote behavior.
- Keep the change additive and compatible with existing bindings and settings.

## Readiness

- No open clarification markers remain.
- Scope is intentionally limited to channel-level defaults and ACP-aware session creation.

## Implementation Decisions

### 1. Default Agent Sanitization

- Extend remote default-agent sanitization from “enabled DeepChat only” to “any enabled agent”.
- Fallback order stays deterministic:
  - configured candidate
  - `deepchat`
  - first enabled agent
  - literal `deepchat`

### 2. Workdir Storage And Resolution

- Add `defaultWorkdir` to both Telegram and Feishu remote settings/runtime config.
- Normalize missing or blank values to `''`.
- Resolve ACP workdir with this chain:
  - channel `defaultWorkdir`
  - global `configPresenter.getDefaultProjectPath()`
  - explicit runtime error

### 3. ACP Session Creation Path

- `RemoteConversationRunner.createNewSession(...)` checks the resolved default agent type.
- DeepChat path remains unchanged.
- ACP path calls `createDetachedSession(...)` with:
  - `agentId`
  - `providerId: 'acp'`
  - `modelId: agentId`
  - `projectDir: resolvedWorkdir`
- If no workdir is available, the runner throws:
  - `ACP agent requires a workdir. Set a Remote default directory or global default directory first.`

### 4. Router Behavior

- `/new` continues to create a session through the runner and therefore inherits ACP-aware behavior.
- `/sessions` still scopes to the current bound session agent when present, else the channel default agent.
- `/model` checks whether the current session model is locked by ACP. If locked, it returns:
  - `ACP sessions lock the model. Change the channel default agent instead.`
- `/status` includes:
  - `Default workdir`
  - `Current workdir`

### 5. Settings UI

- The default-agent selector shows all enabled agents.
- ACP agents display with a ` (ACP)` suffix.
- Telegram and Feishu settings each expose a `Default directory` input.
- Helper text explains that the field is used only for ACP and falls back to the global default project path.

## Dependencies

- `RemoteControlPresenter`
- `RemoteConversationRunner`
- `RemoteCommandRouter`
- `FeishuCommandRouter`
- `RemoteSettings.vue`
- Shared remote-control presenter types

## Migration And Compatibility

- No database migration is required.
- Electron Store config is additive and normalized on read/write.
- Existing bindings are not rebound when the default agent or workdir changes.
- Existing remote tool-interaction handling remains attached to the bound session flow.

## Risks And Mitigations

- Missing ACP workdir causes remote session creation failure
  - Mitigation: explicit error message and `/status` visibility for default/current workdir
- Invalid configured default agent
  - Mitigation: sanitize through enabled-agent fallback order
- UI confusion between DeepChat and ACP agents
  - Mitigation: ACP label suffix in selector and helper text for default directory

## Test Strategy

- Main-process tests
  - remote default-agent sanitization accepts enabled ACP agents
  - ACP session creation passes provider/model/projectDir
  - global default project path is used as fallback
  - missing workdir throws the documented error
  - ACP `/model` path returns the locked-model message
  - `/status` includes default/current workdir
- Renderer tests
  - enabled ACP agents appear in the selector
  - default workdir persists from the settings form
- Regression tests
  - DeepChat remote flows continue to pass unchanged
