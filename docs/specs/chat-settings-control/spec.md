# Chat-Driven Settings Control

## Summary

Enable users to update a small, safe subset of DeepChat settings from within a conversation using natural language. Changes must be validated, persisted, and take effect immediately. For complex/high-risk settings (e.g. MCP configuration, prompts), the assistant must not apply changes directly; instead it should explain where to edit them and automatically open Settings (ideally deep-linked to the relevant section).

This spec is intentionally split into two increments:

- **Step 1**: Provide a safe, validated settings-apply API (main process) that can be called from controlled entrypoints (renderer UI and/or agent tools) to mutate settings and trigger real-time updates.
- **Step 2**: Deliver the natural-language behavior as a **DeepChat Skill** so the extra context is only injected when relevant.

## Goals

- Allow in-chat updates for:
  - Toggle settings: agent/chat mode (see Open Questions), sound effects, copy COT details.
  - Enum settings: language, theme, font size.
- Apply changes immediately (current window + other windows where relevant).
- Persist changes to the existing config storage.
- Keep the surface area safe: do not expose arbitrary config keys.
- Use Skills to control context:
  - The settings-modification guidance must **only** be injected when user is actually asking to change DeepChat settings.

## Non-goals

- Do not allow users to directly set arbitrary `ConfigPresenter.setSetting(key, value)` keys via chat.
- Do not allow setting sensitive values via chat (API keys, tokens, env vars, file paths, command args).
- Do not implement editing of MCP servers, prompts, providers, or other complex nested config via natural language.
- Do not change how settings are stored on disk (no migrations in this feature).

## User Stories

- As a user, I can say "turn on sound effects" and it immediately enables sound effects.
- As a user, I can say "copy COT details when copying" and it enables/disables that toggle.
- As a user, I can say "switch to agent mode" and the chat input mode updates immediately and is remembered.
- As a user, I can say "set language to English" and the UI language switches immediately.
- As a user, I can say "use dark theme" or "follow system theme" and the theme updates immediately.
- As a user, I can say "make text larger" and the font size changes immediately.
- As a user, if I ask "add an MCP server" or "edit prompts", the assistant tells me where in Settings to do it and opens Settings at that location.

## Acceptance Criteria

### Step 1: Safe Settings Apply API (no NLP)

- A main-process API exists that accepts a constrained, validated request to change one supported setting.
- Only the allowlisted settings in this spec can be changed through this API.
- When the `deepchat-settings` skill is NOT active, the settings tools are NOT injected into the LLM tool list.
- On success:
  - The setting value is persisted (existing underlying storage).
  - The change takes effect immediately in the current renderer.
  - Cross-window/tab updates occur where existing event flows support them (e.g. theme/language/font size/sound).
- On failure:
  - Invalid input is rejected with a structured, user-presentable error (no partial writes).
- The API is safe to call with untrusted input (strict validation + allowlist).

### Step 2: Natural Language via Skill (context-controlled)

- A built-in skill exists (proposed: `deepchat-settings`) describing this capability.
- The skill is **not** meant to stay active by default:
  - It should be activated only when the user is asking to change DeepChat’s own settings.
  - It should be deactivated after the setting change(s) are completed.
- When active, the assistant:
  - Interprets user intent, normalizes to canonical values, and calls the Step 1 API.
  - For disallowed/complex settings (MCP, prompts, etc), it provides guidance and opens Settings to the best matching location.

## Open Questions [NEEDS CLARIFICATION]

1. **"代理模式" meaning**
   - Is "代理模式" the chat input mode (`chat`/`agent`/`acp agent`) or network proxy settings (`proxyMode`/`customProxyUrl`)?
2. **Mode availability for Skills**
   - Skills prompt injection currently appears tied to `chatMode === 'agent'`. Do we want this feature to work in:
     - agent mode only (recommended first increment), or
     - also chat/acp agent modes (requires additional work)?
3. **Agent/chat mode scope**
   - Should switching mode update only the default (`input_chatMode`) or also mutate the current conversation’s mode/config immediately?
4. **Font size representation**
   - Should chat use semantic labels ("small/medium/large") mapped to `fontSizeLevel`, or accept explicit numeric levels?
5. **Settings deep-link targets**
   - What are the canonical Settings tabs/sections IDs we want to support for deep-linking (e.g. `mcp`, `prompts`, `appearance`, `language`)?
6. **UX: confirmation vs. silent apply**
   - Should the assistant always confirm before applying a change, or apply immediately with an "undo" affordance?

## Security & Privacy Notes

- The Step 1 API must:
  - Use an allowlist of setting IDs.
  - Validate input types and enum ranges.
  - Avoid any generic "set arbitrary key" capability.
- Defense-in-depth (recommended): the settings tool/entrypoint should verify the relevant Skill is active for the conversation before applying.
- Step 2 must not allow indirect privilege escalation:
  - No changes to filesystem paths, command args, environment variables, or secret-bearing settings via natural language.
