# Control Settings via Chat

## Overview

Allow users to update a small, safe subset of DeepChat settings via natural language within conversations. Changes MUST be validated, persisted, and take effect immediately. For complex/high-risk settings (e.g., MCP configuration, prompts), the assistant MUST NOT apply changes directly; instead, it should explain where to edit them and automatically open settings (ideally deep-linked to the relevant section).

This specification is intentionally split into two increments:

- **Step 1**: Provide a safe, validated settings application API (main process) that can be called from controlled entry points (renderer UI and/or agent tools) to change settings and trigger live updates.
- **Step 2**: Deliver natural language behavior as a **DeepChat skill** so that additional context is injected only when relevant.

## Goals

- Allow in-conversation updates to:
  - Toggle settings: Sound, Copy COT details.
  - Enum settings: Language, Theme, Font size.
- Apply changes immediately (current window + relevant other windows).
- Persist changes to existing configuration store.
- Keep surface area safe: do not expose arbitrary configuration keys.
- Use skills to control context:
  - Settings modification guidance MUST be injected ONLY when user actually requests to change DeepChat settings.

## Non-Goals

- Do NOT allow users to set arbitrary `ConfigPresenter.setSetting(key, value)` keys via chat.
- Do NOT allow setting sensitive values via chat (API keys, tokens, environment variables, file paths, command arguments).
- Do NOT implement editing of MCP servers, prompts, providers, or other complex nested config via natural language.
- Do NOT change how settings are stored on disk (no migrations in this feature).

## User Stories

- As a user, I can say "turn on sound" and it enables sound immediately.
- As a user, I can say "copy COT details when copying" and it enables/disables the toggle.
- As a user, I can say "set language to English" and UI language switches immediately.
- As a user, I can say "use dark theme" or "follow system theme" and theme updates immediately.
- As a user, I can say "make text larger" and font size changes immediately.
- As a user, if I ask "add MCP server" or "edit prompts", the assistant tells me where in settings and opens settings there.

## Acceptance Criteria

### Step 1: Safe Settings Application API (No NLP)

- A main process API exists that accepts restricted, validated requests to change one supported setting.
- Only allowlisted settings from this specification can be changed via this API.
- Setting tools are NOT injected into LLM tool list when `deepchat-settings` skill is **NOT** active.
- On success:
  - Setting value is persisted (existing underlying storage).
  - Changes take effect immediately in current renderer.
  - Cross-window/tab updates happen where existing event flow supports (e.g., theme/language/font size/sound).
- On failure:
  - Invalid inputs are rejected with structured, user-presentable errors (no partial writes).
- API is safe to call with untrusted input (strict validation + allowlist).

### Step 2: Natural Language via Skill (Context Control)

- A built-in skill exists (suggested: `deepchat-settings`) describing this functionality.
- This skill is NOT intended to remain active by default:
  - It should activate only when user requests to change DeepChat's own settings.
  - It should deactivate after setting change is complete.
- When active, assistant:
  - Explains user intent, normalizes to canonical values, and calls Step 1 API.
  - For disallowed/complex settings (MCP, prompts, etc.), provides guidance and opens settings to best-match section.

## Open Questions [NEEDS CLARIFICATION]

1. Skill Mode Availability
   - Skill prompt injection currently seems tied to `chatMode === 'agent'`. Do we want this feature to work in:
     - Agent mode only (suggested first increment), OR
     - Also in chat/ACP agent modes (requires additional work)?
2. Font Size Representation
   - Should chat use semantic labels (`small/medium/large`) mapping to `fontSizeLevel`, or accept explicit numeric levels?
3. Settings Deep Link Targets
   - What are the canonical settings tab/section IDs we want to support deep-linking to (e.g., `mcp`, `prompts`, `appearance`, `language`)?
4. UX: Confirm vs Silent Apply
   - Should assistant always confirm before applying changes, or apply immediately with "undo" capability?

## Security & Privacy Notes

- Step 1 API MUST:
  - Use an allowlist of setting IDs.
  - Validate input types and enum ranges.
  - Avoid any generic "set arbitrary key" functionality.
- Defense in depth (recommended): Setting tools/entry points should verify the relevant skill is active for the conversation before applying.
- Step 2 MUST NOT allow indirect privilege escalation:
  - MUST NOT change file system paths, command arguments, environment variables, or settings that hold secrets via natural language.
