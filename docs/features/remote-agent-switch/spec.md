# Remote `/agent` Command

## User Need

Remote control users (Telegram / Feishu / QQBot / Discord / Weixin iLink) can already switch the model via `/model`, but they cannot switch agents — they're stuck on whatever default agent the desktop user configured. This is especially painful when wanting to try different ACP agents (Claude Code, Codex) from the bot.

## Goal

Add a `/agent` slash command on every remote channel:

- No args: list (or button menu, on Telegram) every enabled agent so the remote user can see what's available.
- With args: `/agent <agent-id>` switches the channel default agent and starts a fresh session bound to that endpoint.
- Switching to an ACP agent fails fast with an actionable message when the channel has no default workdir.

## Acceptance Criteria

1. `/agent` (no args) shows enabled agents from `configPresenter.listAgents()`.
   - Telegram: inline keyboard menu, mirroring `/model`'s shape (one button per agent + Cancel).
   - Feishu/QQBot/Discord/Weixin iLink: text overview with usage hint and `<id>`/name/type/source.
2. `/agent <id>` (text channels) and a button click (Telegram) switch the channel's `defaultAgentId` and create a new bound session whose `agentId` matches.
3. Agent identifier is `Agent.id` (with `resolveAcpAgentAlias` fallback for legacy ACP aliases).
4. The reply explicitly tells the user a new session was created.
5. Switching to an ACP agent (`Agent.type === 'acp'`) when the channel has no default workdir fails with `Cannot switch to ACP agent: this channel has no default workdir set. Configure the channel default workdir in DeepChat first.`
6. Disabled agents (`enabled === false`) are not listed and cannot be switched to.
7. `/help` includes `/agent` automatically through the per-channel command registry.

## Constraints

- Reuse the existing presenter boundaries: routing happens in the channel-specific command routers, business logic in `RemoteConversationRunner`, persistence in `RemoteBindingStore` via `setChannelDefaultAgentId`.
- Reuse `resolveAcpAgentAlias` to keep parity with `sanitizeDefaultAgentId`.
- Reuse `createNewSession`, which already calls `resolveDefaultAgentId` and rebinds the endpoint.
- `/agent` does NOT modify an existing session's `agentId` (that's not a supported operation in DeepChat); switching always rolls a new session.

## Non-goals

- No mid-session agent swap. Switching ends the current session and starts a new one.
- No new agent install/registration flow. Only enabled agents already known to ConfigPresenter are switchable.
- No per-user-in-channel agent override. Switching is per-channel default, same scope as `defaultAgentId`.
