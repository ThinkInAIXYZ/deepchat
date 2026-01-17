---
name: deepchat-settings
description: DeepChat app settings modification (DeepChat 设置/偏好) skill. Activate ONLY when the user explicitly asks to change DeepChat's own settings/preferences (e.g., 主题/theme, 语言/language, 字体/font size, 音效/sound, 复制COT/copy COT, 聊天/代理模式 chat/agent mode). Do NOT activate for OS/system settings, network admin tasks, code/editor settings, or other apps.
allowedTools:
  - deepchat_settings_apply
  - deepchat_settings_open
---

# DeepChat Settings Modification Skill

Use this skill to safely change DeepChat *application* settings during a conversation.

## Core rules

- Only change settings when the user is asking to change **DeepChat** settings.
- Use the dedicated settings tools; never attempt arbitrary key/value writes.
- These tools are intended to be available only when this skill is active; if they are missing, activate this skill via `skill_control`.
- If the request is ambiguous, ask a clarifying question before applying.
- For unsupported or high-risk settings (MCP, prompts, providers, API keys, paths): do **not** apply changes; instead explain where to change it and open Settings.
- After completing the settings task, deactivate this skill via `skill_control` to keep context small.

## Supported settings (initial allowlist)

Toggles:

- `soundEnabled`: enable/disable sound effects.
- `copyWithCotEnabled`: enable/disable copying COT details.
- `chatMode`: [NEEDS CLARIFICATION] if this refers to chat input mode, set to `chat | agent | acp agent`.

Enums:

- `language`: one of DeepChat supported locales (e.g., `en-US`, `zh-CN`).
- `theme`: `dark | light | system`.
- `fontSizeLevel`: integer level within supported range.

## Workflow

1. Confirm the user is requesting a DeepChat settings change.
2. Determine the target setting and the intended value.
3. If the setting is supported, call `deepchat_settings_apply` with the canonical `{ id, value }`.
4. Confirm back to the user what changed (include the final value).
5. If the setting is unsupported, call `deepchat_settings_open` and provide a short pointer to the correct Settings section.
6. Deactivate this skill via `skill_control`.

## Examples (activate this skill)

- "把主题改成深色"
- "Turn off sound effects"
- "语言改成英文"
- "复制时不要带 COT"

## Examples (do NOT activate this skill)

- "把 Windows 的系统代理改成..."
- "帮我改 VS Code 的字体"
- "把电脑的声音关掉"
