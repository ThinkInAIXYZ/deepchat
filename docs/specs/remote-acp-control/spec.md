# Remote ACP Control

## Summary

Extend remote control so Telegram and Feishu can create and continue ACP-backed sessions for coding-style tasks. Each channel keeps a single configured default agent. When that default agent is ACP, remote session creation must resolve a workdir before creating the detached session.

This increment builds on [telegram-remote-control](../telegram-remote-control/spec.md) and [remote-tool-interactions](../remote-tool-interactions/spec.md) without replacing their scope.

## User Stories

- As a remote-control user, I can set an ACP agent as the default remote agent for Telegram or Feishu.
- As a remote-control user, I can configure a per-channel default workdir for ACP sessions.
- As a paired remote user, my first `/new` or plain-text conversation turn can create an ACP session that already knows which workdir to use.
- As a paired remote user, I can inspect the current and default workdir from `/status`.
- As a paired remote user on an ACP-backed session, I get a clear response that `/model` cannot change the session model remotely.

## Acceptance Criteria

- The remote settings UI lists all enabled agents in the default-agent selector, including ACP agents.
- ACP agents are visually labeled in the selector so they are distinguishable from DeepChat agents.
- Telegram and Feishu remote settings both persist a `defaultWorkdir` string in Electron Store.
- New remote sessions still use the configured default agent for the channel.
- When the default agent is DeepChat, remote session creation behavior remains unchanged.
- When the default agent is ACP, remote session creation passes `providerId: 'acp'`, `modelId: <agentId>`, and `projectDir: <resolvedWorkdir>` to detached session creation.
- ACP workdir resolution follows `channel.defaultWorkdir -> global default project path -> explicit error`.
- If neither the channel default workdir nor the global default project path is configured, ACP remote session creation is rejected with an actionable error message.
- `/status` for Telegram and Feishu includes both the default workdir and the current session workdir when available.
- `/model` on an ACP-backed bound session returns a locked-model message instead of opening provider/model selection.
- Existing bound sessions remain bound after changing the channel default agent or default workdir.
- Existing DeepChat remote flows, including `/sessions`, `/use`, `/open`, and remote tool interactions, continue to work.

## Constraints

- Each remote channel keeps one configured default agent; this feature does not add per-message agent switching.
- ACP remote session creation requires a workdir.
- Remote bot text remains English.
- Config changes stay in Electron Store; no SQLite migration is introduced.

## Non-Goals

- No `/agent` remote command.
- No `/workdir` remote command.
- No multi-workspace picker or per-session workspace selection flow.
- No remote provider/model switching for ACP sessions.

## Compatibility

- Existing remote bindings remain valid.
- Existing remote settings load even when `defaultWorkdir` is absent and normalize to an empty string.
- DeepChat remains a valid fallback default agent when an invalid configured agent is encountered.
