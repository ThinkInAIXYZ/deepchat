# Telegram Remote Control

## Summary

Add Telegram private-chat remote control to the `dev` branch without changing DeepChat's main architecture. The bot runtime lives in Electron main, remote messages reuse the existing DeepChat session/message/stream pipeline, and the settings UI moves Telegram-related controls into a new `Remote` page.

This increment simplifies the Remote settings UX, removes the user-facing stream mode switch, adds a selectable default DeepChat agent for new remote sessions, and keeps remote session/model control intentionally lightweight for v1.

## User Stories

- As a DeepChat desktop user, I can pair my Telegram account and send a DM to my bot to continue a DeepChat conversation remotely.
- As a paired user, my first Telegram DM can create a detached DeepChat session even when no chat window is focused.
- As a paired user, I can stop an active generation with `/stop`, list recent sessions with `/sessions`, and rebind to one with `/use`.
- As a user configuring integrations, I can manage Telegram remote control and Telegram hook notifications from a single `Remote` settings page.
- As a user configuring Telegram pairing, I only see a simple “Pair” entry point in the first layer and complete the flow from a small modal.
- As a user using multiple DeepChat agents, I can choose which enabled DeepChat agent new Telegram sessions should use by default.
- As a paired user, I can change the current bound session's provider/model through a two-step Telegram inline keyboard opened from `/model`.

## Acceptance Criteria

- An authorized Telegram private-chat user can DM the bot and receive a DeepChat assistant reply.
- The first DM can create a detached DeepChat session without a focused window or existing `webContents` binding.
- Subsequent DMs continue the currently bound DeepChat session for that Telegram endpoint.
- `/stop` cancels the active generation for that remote endpoint through the existing stop path.
- `/sessions` lists recent sessions for the currently bound session's agent; if no valid binding exists, it falls back to the configured default DeepChat agent.
- `/use <index>` binds the endpoint to the corresponding session from the latest `/sessions` list.
- `/model` opens a Telegram inline keyboard, first for enabled providers and then for enabled models, and only changes the current bound session.
- Remote-triggered conversations do not bypass the existing permission flow for tools, files, or settings.
- Telegram settings appear under a new `Remote` settings page, and the old Telegram section is removed from `Hooks`.
- The Remote settings page hides the remote-control detail area when remote control is disabled, and hides the Telegram hook detail area when hooks are disabled.
- The first-layer Telegram remote UI shows allowed user IDs, a default DeepChat agent selector, a pairing button, and a binding-management button; pair code display moves into a modal.
- Telegram remote no longer exposes a stream mode selector, and `/status` no longer reports stream mode details.
- Telegram remote conversation delivery uses one temporary status message plus one streamed answer message per assistant turn; the status message is deleted when the turn completes.
- Telegram runtime registers its default command list when it starts.
- Only plain-text conversation messages get a temporary bot reaction; slash commands and inline-button callbacks do not, and the reaction is cleared after the reply finishes or fails.
- New Telegram sessions use the selected default DeepChat agent, inheriting that agent's default model/project/permission defaults; existing bound sessions remain bound even if the default agent later changes.
- Existing local desktop chat behavior remains unchanged.

## Constraints

- Telegram only for v1.
- No generic channel registry or plugin system.
- Bot runtime lives in Electron main, not renderer or preload.
- SQLite remains the source of truth for sessions and messages.
- Config/state uses the existing Electron Store path; no new SQLite migration is introduced.
- v1 is private-chat only. No group support, no media upload, no remote permission approvals.

## Non-Goals

- Group chats, forum moderation, or multi-platform messaging channels.
- Telegram media uploads, arbitrary bot button workflows outside `/model`, or Markdown/HTML rich formatting.
- Remote approval of tool/file/settings permission requests.
- A standalone helper daemon or public remote-control SDK.

## Compatibility

- Existing Telegram hook settings remain valid and are reused by the new `Remote` page.
- New remote-specific state lives under `remoteControl.telegram` in Electron Store.
- `remoteControl.telegram.defaultAgentId` stores the default DeepChat agent for new Telegram sessions.
- Legacy `remoteControl.telegram.streamMode` data may still exist for compatibility, but remote delivery no longer changes behavior based on it.
- Disabling remote control or clearing the bot token cleanly stops polling without affecting local chats or persisted SQLite data.
