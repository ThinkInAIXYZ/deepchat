# Tasks: Chat-Driven Settings Control

## Step 0 - Skill-first design (context control)

1. Draft built-in skill: `resources/skills/deepchat-settings/SKILL.md`.
2. Ensure frontmatter `description` explicitly limits activation to DeepChat settings changes only.
3. Ensure skill body lists allowlisted settings + safe handling + self-deactivation guidance.

## Step 1 - Safe Settings Apply API (main)

1. Add shared types for settings apply requests/results.
2. Implement a validated apply entrypoint (Zod-style parsing of `unknown`).
3. Implement allowlist mapping to existing `ConfigPresenter` methods:
   - `soundEnabled`
   - `copyWithCotEnabled`
   - `language`
   - `theme`
   - `fontSizeLevel`
   - `chatMode` (pending clarification)
4. Implement tool-injection gating: only include `deepchat_settings_apply`/`deepchat_settings_open` in tool definitions when `deepchat-settings` is active and allows them.
5. Add defense-in-depth gate: refuse apply if `deepchat-settings` skill is not active for the conversation.
6. Add "open Settings" helper/tool for unsupported settings (MCP/prompt/etc) including best-effort navigation.
7. Add main-process tests:
   - validation and mapping
   - tool defs present only when skill active
   - skill gate refuses apply when inactive

## Step 2 - UX behavior (LLM + Skill)

1. Verify Skills metadata prompt lists `deepchat-settings` clearly enough for the model to choose it.
2. Ensure the skill instructs: activate only when user asks; deactivate after completion.
3. Add examples in SKILL.md for Chinese/English user phrasing.
