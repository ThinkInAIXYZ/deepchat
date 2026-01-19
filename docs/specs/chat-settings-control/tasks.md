# Tasks: Control Settings via Chat

## Step 0 - Skill-First Design (Context Control)

1. Draft built-in skill: `resources/skills/deepchat-settings/SKILL.md`.
2. Ensure pre-metadata `description` explicitly restricts activation to only DeepChat setting changes.
3. Ensure skill body lists allowlisted settings + safe handling + self-deactivation guidance.

## Step 1 - Safe Settings Application API (Main Process)

1. Add shared types for settings application request/result.
2. Implement validated application entry point (Zod-style `unknown` parsing).
3. Implement allowlist mapping to existing `ConfigPresenter` methods:
   - `soundEnabled`
   - `copyWithCotEnabled`
   - `language`
   - `theme`
   - `fontSizeLevel`
4. Implement tool injection control: only include `deepchat_settings_toggle`/`deepchat_settings_set_language`/`deepchat_settings_set_theme`/`deepchat_settings_set_font_size`/`deepchat_settings_open` in tool definitions when `deepchat-settings` is active AND allowed.
5. Add defense-in-depth control: reject application if `deepchat-settings`` skill is not active for conversation.
6. Add "open settings" helper/tool for unsupported settings (MCP/prompts, etc.), including best-eff-mn navigation.
7. Add main process tests:
   - Validation and mapping
   - Tool definitions only exist when skill active
   - Skill control enforces rejection when inactive

## Step 2 - UX Behavior (LLM + Skill)

1. Verify skill metadata prompt list clearly enough lists `deepchat-settings` for model to select it.
2. Ensure skill instructs: activate only when user asks; deactivate after completion.
3. Add examples of Chinese/English user phrasing in SKILL.md.
