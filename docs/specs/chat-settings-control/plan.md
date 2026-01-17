# Plan: Chat-Driven Settings Control

## Key Decision: Skill-gated context

This capability must be described and delivered as a DeepChat Skill so the additional instructions/context are only injected when the user is actually asking to change DeepChat settings.

- Skill name (proposed): `deepchat-settings`
- Activation: via `skill_control` **only when** user request is about DeepChat settings/preferences.
- Deactivation: call `skill_control` after completing the setting change(s), to keep context small.

## Tool injection gating (no skill, no tools)

The config-related tools must NOT appear in the LLM tool list (and must NOT be mentioned in system prompt) unless the `deepchat-settings` skill is active.

Implementation intent:

- Define two dedicated tools (MCP-format function defs):
  - `deepchat_settings_apply`
  - `deepchat_settings_open`
- Do **not** expose them via MCP servers/tool list UI (avoid being auto-enabled into `enabledMcpTools`).
- Inject these tool definitions only when:
  - the current conversation has `deepchat-settings` active, and
  - the skill’s frontmatter `allowedTools` includes the tool name(s).

This requires conversation-scoped tool-definition building:

- Extend tool definition building context to include `conversationId`.
- Fetch `skillsAllowedTools` for that conversation (via `SkillPresenter.getActiveSkillsAllowedTools`).
- Conditionally append `deepchat_settings_*` tool definitions only when allowed.

## Step 1: Safe Settings Apply API (main)

### Entry point

Implement a narrow, validated apply surface in the main process (presenter method or agent tool handler) that:

- Accepts `unknown` input and validates it (Zod-style, similar to `AgentFileSystemHandler`).
- Uses an allowlist of setting IDs.
- Applies changes by calling existing `ConfigPresenter` methods so existing event broadcasts remain correct.
- Returns structured results for rendering a confirmation/error message.

### Allowlisted settings and mappings

Toggle settings:

- `soundEnabled` -> `ConfigPresenter.setSoundEnabled(boolean)` (broadcast: `CONFIG_EVENTS.SOUND_ENABLED_CHANGED`)
- `copyWithCotEnabled` -> `ConfigPresenter.setCopyWithCotEnabled(boolean)` (broadcast: `CONFIG_EVENTS.COPY_WITH_COT_CHANGED`)
- `chatMode` (meaning TBD)
  - If this means input mode: `ConfigPresenter.setSetting('input_chatMode', 'chat'|'agent'|'acp agent')`.
  - If this means network proxy: treat as **not directly settable** for now; open Settings instead.

Enum settings:

- `language` -> `ConfigPresenter.setLanguage(locale)` (broadcast: `CONFIG_EVENTS.LANGUAGE_CHANGED`)
- `theme` -> `ConfigPresenter.setTheme('dark' | 'light' | 'system')` (broadcast: `CONFIG_EVENTS.THEME_CHANGED`)
- `fontSizeLevel` -> `ConfigPresenter.setSetting('fontSizeLevel', level)` (broadcast: `CONFIG_EVENTS.FONT_SIZE_CHANGED` via special-case)

### Validation rules

- Strict allowlist; reject unknown IDs.
- No implicit coercion in Step 1.
- Per-setting validation:
  - booleans: must be boolean
  - enums: must match allowed set
  - `fontSizeLevel`: must be integer within supported range (source of truth TBD; likely align with `uiSettingsStore` constants)
  - `language`: must be one of supported locales (reuse the supported list from config)

### Defense-in-depth: require Skill active

Even with gated tool injection, keep a runtime check:

- If the conversation does **not** have `deepchat-settings` active, refuse to apply and return an error telling the model/user to activate it.
- This ensures settings cannot be changed accidentally by unrelated agent behavior.

## Step 2: Skill definition (natural language behavior)

### Built-in Skill artifact

Add `resources/skills/deepchat-settings/SKILL.md`:

- Frontmatter `description` must clearly state:
  - This is for changing DeepChat app settings only.
  - Activate only when user requests settings changes (设置/偏好/主题/语言/字体/音效/复制COT/聊天模式/代理模式).
  - Do not activate for OS settings or programming/code settings.
- Body must define:
  - Supported settings (allowlist) and canonical values.
  - How to ask clarifying questions when ambiguous.
  - When to refuse and instead open Settings.
  - Always deactivate after completing the settings task.

### Disallowed settings -> open Settings

For requests involving MCP config, prompts, providers, API keys, etc:

- Do not apply via tool.
- Provide precise instructions where to change it.
- Open Settings window and navigate as close as possible.

Implementation options for opening/navigating Settings:

- Use `presenter.windowPresenter.createSettingsWindow()`.
- Optionally `executeJavaScript` to set a localStorage navigation hint that settings UI can read.
- Or add a dedicated IPC channel from main -> settings renderer to navigate to tab/section.

## Data model

Introduce shared request/response types (for Step 1 entrypoint + tool):

- `ChatSettingId` (union of allowlisted IDs)
- `ApplyChatSettingRequest` (discriminated union `{ id, value }`)
- `ApplyChatSettingResult`
  - `{ ok: true; id; value; previousValue?; appliedAt }`
  - `{ ok: false; errorCode; message; details? }`

## Test Strategy

- Main (Vitest):
  - allowlist + validation (reject invalid values, no writes)
  - each supported setting maps to correct `ConfigPresenter` method
  - Skill-required gate works (tool refuses when skill inactive)
- Renderer/UI (if any navigation hints are added):
  - Settings page navigation handler tests (optional)
