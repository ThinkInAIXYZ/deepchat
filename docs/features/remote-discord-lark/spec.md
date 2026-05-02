# Remote Discord + Feishu/Lark

## Summary

Extend the existing remote-control system with a built-in `discord` channel and add `lark` brand compatibility to the existing `feishu` channel. This is an incremental extension of the current remote multi-channel design, not a redesign of the remote-control framework.

## User Stories

- As a DeepChat desktop user, I want to control DeepChat from Discord with a bot token, so I can use DMs, channel mentions, and slash commands instead of webhooks.
- As a DeepChat desktop user, I want Discord remote control settings to stay self-contained under remote-control config, so remote changes do not depend on Hooks state.
- As a DeepChat desktop user, I want to use either Feishu or Lark from the same remote-control tab, so I do not need a duplicate channel implementation.
- As a DeepChat desktop user, I want Discord, Feishu/Lark, QQBot, Telegram, and Weixin iLink to appear consistently in the remote settings UI and sidebar status aggregation.

## Acceptance Criteria

- `discord` is available as a built-in remote channel across shared types, presenter APIs, runtime config, renderer settings, and sidebar status.
- `remoteControl.discord` stores Discord bot token, enabled flag, default agent, default workdir, paired channel ids, bindings, pairing state, and fatal error state.
- Discord remote control only reads and writes `remoteControl.discord`.
- Discord remote control supports `/start`, `/help`, `/pair`, `/new`, `/sessions`, `/use`, `/stop`, `/open`, `/pending`, `/model`, and `/status` through both slash commands and text commands.
- Discord authorization follows the existing DeepChat pairing model:
  - DMs and guild channels pair by `/pair <code>`
  - unpaired channels can only use `/start`, `/help`, and `/pair`
  - non-mentioned guild text messages do not enter the conversation flow
- The renderer shows a dedicated Discord tab in remote settings, and that tab does not expose Hooks configuration fields.
- The Feishu tab supports a `brand` selection of `feishu | lark` without adding a separate `lark` channel.
- Feishu/Lark bindings, pairing identifiers, endpoint keys, and status channel ids remain under `feishu`.
- Existing configs without Feishu `brand` default to `feishu`.
- Existing configs without Discord state normalize safely to disabled defaults.

## Non-goals

- No standalone `lark` remote channel entity.
- No custom Lark domain input.
- No Hooks migration for Discord remote control.
- No redesign of the remote binding or session-runner architecture.

## Constraints

- Reuse the current presenter/binding-store/runtime abstractions.
- Prefer compatibility with existing saved settings and bindings.
- Keep user-facing strings in i18n.
