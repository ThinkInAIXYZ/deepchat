# Plan: Control Settings via Chat

## Key Decision: Skill-Based Context Control

This feature MUST be described and delivered as a DeepChat skill so that additional instructions/context are only injected when the user actually requests to change DeepChat settings.

- Skill Name (suggested): `deepchat-settings`
- Activation: Activated via `skill_control` **ONLY** when the user request involves DeepChat settings/preferences.
- Deactivation: Call `skill_control` after completing the setting change to keep context lean.

## Tool Injection Control (No Skill, No Tools)

Configuration-related tools MUST NOT appear in the LLM tool list (and MUST NOT be mentioned in the system prompt) unless the `deepchat-settings` skill is active.

Implementation intent:

- Define dedicated tools (MCP-format function definitions):
  - `deepchat_settings_toggle`
  - `deepchat_settings_set_language`
  - `deepchat_settings_set_theme`
  - `deepchat_settings_set_font_size`
  - `deepchat_settings_open`
- **DO NOT** expose them through MCP server/tool list UI (avoid being auto-enabled into `enabledMcpTools`).
- Only inject these tool definitions when:
  - `deepchat-settings` is enabled for the current conversation, AND
  - The skill's pre-metadata `allowedTools` includes the tool name.

This requires conversation-scoped tool definition construction:

- Extend tool definition construction context to include `conversationId`.
- Retrieve `skillsAllowedTools` for that conversation (via `SkillPresenter.getActiveSkillsAllowedTools`).
- Only conditionally append `deepchat_settings_*` tool definitions when allowed.

## Step 1: Safe Settings Application API (Main Process)

### Entry Point

Implement a narrow, validated application surface in the main process (presenter method or agent tool handler) for:

- Accepting `unknown` input and validating it (Zod-style, similar to `AgentFileSystemHandler`).
- Using an allowlist of setting IDs.
- Applying changes by calling existing `ConfigPresenter` methods so existing event broadcasts remain correct.
- Returning structured results to render confirmation/error messages.

### Allowlisted Settings and Mapping

Toggle settings:

- `soundEnabled` -> `ConfigPresenter.setSoundEnabled(boolean)` (broadcasts: `CONFIG_EVENTS.SOUND_ENABLED_CHANGED`)
- `copyWithCotEnabled` -> `ConfigPresenter.setCopyWithCotEnabled(boolean)` (broadcasts: `CONFIG_EVENTS.COPY_WITH_COT_CHANGED`)

Enum settings:

- `language` -> `ConfigPresenter.setLanguage(locale)` (broadcasts: `CONFIG_EVENTS.LANGUAGE_CHANGED`)
- `theme` -> `ConfigPresenter.setTheme('dark' | 'light' | 'system')` (broadcasts: `CONFIG_EVENTS.THEME_CHANGED`)
- `fontSizeLevel` -> `ConfigPresenter.setSetting('fontSizeLevel', level)` (broadcasts `CONFIG_EVENTS.FONT_SIZE_CHANGED` via special case)

### Validation Rules

- Strict allowlist; reject unknown IDs.
- No implicit type conversion in Step 1.
- Validation per setting:
  - Booleans: must be boolean type
  - Enum values: must match allowed set
  - `fontSizeLevel`: must be integer within supported range (source of truth TBD; may align with `uiSettingsStore` constants)
  - `language`: must be one of supported locales (reuse support list from config)

### Defense in Depth: Require Skill Activity

Even with controlled tool injection, maintain runtime checks:

- If `deepchat-settings` is **NOT** enabled for the conversation, reject application and return error telling the model/user to activate it.
- This ensures settings don't accidentally change due to unrelated agent behavior.

## Step 2: Skill Definition (Natural Language Behavior)

### Built-in Skill Artifact

Add `resources/skills/deepchat-settings/SKILL.md`:

- Pre-metadata `description` MUST explicitly state:
  - This is ONLY for changing DeepChat application settings.
  - Activate ONLY when user requests setting changes (settings/preferences/theme/language/font/sound/copy COT).
  - Do NOT activate for OS settings or programming/code settings.
- Body MUST define:
  - Supported settings (allowlist) and canonical values.
  - How to ask clarifying questions when ambiguous.
  - When to refuse and instead open settings.
  - Always deactivate after completing setting tasks.

### Disallowed Settings -> Open Settings

For requests involving MCP configuration, prompts, providers, API keys, etc.:

- Do NOT apply via tools.
- Provide precise instructions telling user where to change them.
- Open settings window and navigate to relevant section if possible.

Implementation options for opening/navigating settings:

- Use `presenter.windowPresenter.createSettingsWindow()`.
- Optionally `executeJavaScript` to set localStorage navigation hint that UI can read.
- Or add dedicated IPC channel from main process -> settings renderer to navigate to tab/section.

## Data Model

Introduce shared request/response types (for Step 1 entry point + tools):

- `ChatSettingId` (union of allowlisted IDs)
- `ApplyChatSettingRequest` (discriminated union `{ id, value }`)
- `ApplyChatSettingResult`
  - `{ ok: true; id; value; previousValue?; appliedAt }`
  - `{ ok: false; errorCode; message; details? }`

## Testing Strategy

- Main process (Vitest):
  - Allowlist + validation (reject invalid values, no writes)
  - Each supported setting maps to correct `ConfigPresenter` method
  - Skill requirement enforcement works (tool rejects when skill inactive)
- Renderer/UI (if any navigation hints added):
  - Settings page navigation handler tests (optional)
