# Remote Multi-Channel

## Summary

Extend the existing Remote settings and runtime from Telegram-only to a fixed two-channel model: Telegram and Feishu. Telegram keeps hook notifications, while Feishu adds remote control only. Both channels continue to bind one remote endpoint to one DeepChat session and reuse the existing detached-session flow in Electron main.

This iteration also fixes the Telegram "deleted message" draft issue by preventing draft streaming from using reasoning-only, tool-call-only, or permission/question-request blocks as visible text.

## User Stories

- As a desktop user, I can configure Telegram and Feishu remote control from one Remote page without mixing their credentials and rules together.
- As a Telegram user, I can continue using the existing private-chat pairing flow and hook notifications.
- As a Feishu user, I can pair in a bot DM, then continue the same DeepChat session from DM, group chat, or topic thread.
- As an admin of the desktop app, I can see per-channel runtime health and binding counts from a shared overview area.
- As a paired Feishu user, I can trigger a remote session in group/topic only when I explicitly `@bot`.
- As a Telegram user, I no longer see bot replies visually attached to a deleted draft/reference while the assistant is only reasoning or issuing tool calls.

## Acceptance Criteria

- The Remote page renders a shared overview plus separate Telegram and Feishu tabs.
- Telegram settings continue to support bot token, remote pairing, allowlist, default agent, hook settings, and hook test actions.
- Feishu settings support app credentials, pairing, paired user management, default agent selection, and binding management.
- Feishu runtime runs in Electron main via WebSocket event subscription and does not require a renderer window.
- Feishu endpoints are keyed by `chatId + optional threadId`, with topic/thread replies isolated from the group root conversation.
- Feishu authorization requires DM pairing first; in groups/topics, only paired users who `@bot` may send commands or plain text to the bound session.
- `/pair`, `/new`, `/sessions`, `/use`, `/stop`, `/status`, `/open`, and `/model` work for Feishu remote control.
- Telegram `/model` continues to use inline keyboard menus; Feishu `/model` uses text commands only.
- Telegram draft streaming only uses stable visible content blocks. Reasoning-only, tool-call-only, and pending action-only assistant states never call `sendMessageDraft`.
- Existing local desktop chat behavior remains unchanged.

## Constraints

- Keep a fixed two-channel architecture. Do not introduce a generic plugin registry for remote channels.
- Telegram hook notifications remain under the shared Remote page; Feishu hook notifications are out of scope.
- Remote sessions continue to use the existing `RemoteConversationRunner` and detached session creation path.
- Feishu v1 supports DM, group, and topic/thread input; media upload, cards, approvals, and user-OAuth automation remain out of scope.

## Non-Goals

- A general remote channel SDK or third-party channel plugin system.
- Feishu user-OAuth flows, approval cards, or hook notifications.
- Rich Feishu card-based model switching.
- Telegram group chat support.

## Compatibility

- Existing `remoteControl.telegram` store data stays valid and is normalized into the new dual-channel config.
- Existing Telegram hook settings remain valid and continue to be saved through the Remote page.
- New Feishu-specific state is additive under `remoteControl.feishu`.
