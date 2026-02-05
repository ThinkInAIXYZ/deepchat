# Model Selector Config Popover

**Status**: Draft  
**Created**: 2026-01-23  
**Owner**: TBD

## Overview
Chat config controls (system prompt / temperature / reasoning, etc.) were previously exposed via `ChatConfig.vue` and a dedicated config button. They are currently commented out in `ChatInput.vue`, leaving only model selection. This spec restores those controls by integrating them into the `ModelSelector.vue` popover (two-column layout), and improves model capability visibility in settings (`ModelConfigItem.vue`).

## Goals
- Extend model capability indicators in `ModelConfigItem.vue` to clearly show: `vision`, `thinking`, `function call`, `reference`.
- Extend `ModelSelector.vue` popover to include a config panel (system prompt selection + per-model config fields) alongside the model list.
- Replace free-form system prompt editing in chat config with **ID-based selection** from prompts configured in `PromptSetting.vue`.
- Replace sliders (temperature / context length / max tokens) with direct numeric inputs; enforce the same ranges and show range hints.
- Preserve current behavior: config fields are shown/hidden based on model capabilities/defaults (as before the controls were commented out).

## Non-Goals
- Reintroduce the old standalone config button UI (it may be removed later, but not required here).
- Redesign prompt settings screens (`PromptSetting.vue`) beyond what is necessary to support selection and previews.
- Change the underlying model capability detection logic unless required for `thinking/reference`.

## User Stories
- As a user, I can pick a model and adjust its available runtime parameters in one place.
- As a user, I can choose a system prompt from a controlled list (including “no prompt”), and edit prompt contents only in Settings.
- As a user, I can quickly distinguish prompts in the dropdown via a short content preview.
- As a user, I only see controls supported by the selected model/provider.

## UX Notes
- Entry point: `ChatInput.vue` → `ModelSelector.vue` button.
- Popover layout: left = model list/search (existing `ModelChooser.vue`), right = config panel.
- Prompt selector:
  - Single-select dropdown.
  - Items render `name` on the first line and a short `content` preview on the second line (trim + ellipsis).
  - Includes a “No prompt” option.
  - Does not allow editing content here; add an affordance to open Settings → PromptSetting (optional).
- Numeric fields:
  - Replace sliders with inputs (integer/float).
  - Range validation stays consistent with prior slider ranges.
  - Hint text shows the allowed range (e.g. “Range: 0–2”).
- i18n: all new user-facing strings must be keys under `src/renderer/src/i18n/**`.

## Acceptance Criteria
- [ ] `ModelConfigItem.vue` displays four capability icons: vision, thinking, function call, reference (with i18n tooltips).
- [ ] `ModelSelector.vue` popover shows a two-column UI: model chooser (left) + config panel (right).
- [ ] System prompt in chat config is selected by prompt ID from `PromptSetting.vue`’s system prompts list; no free-form editing in the popover.
- [ ] Prompt dropdown items include a second-line preview snippet.
- [ ] Temperature/context length/max tokens use numeric inputs (no sliders) and enforce the same ranges as before.
- [ ] Config fields continue to show/hide based on selected model/provider capabilities/default config.
- [ ] Conversation-level config persists as it does today (per-thread settings), including selected prompt ID.

## Open Questions [NEEDS CLARIFICATION]
1. What exactly should “reference” represent?
   - Web search capability (`enableSearch`)?
   - Citations/sources in responses (even without web search)?
   - Something else (e.g. “grounding”)?
2. What exactly should “thinking” represent?
   - Existing `reasoning` capability?
   - A separate capability (e.g. “thinking budget” supported)?
3. Prompt IDs:
   - Are existing timestamp-based IDs acceptable (UI displays `name`)?
   - Or should Settings allow user-defined IDs (e.g. `systemPrompt1`)?
4. Popover width and responsiveness:
   - Target width for the two-column layout?
   - Should small windows stack vertically?

## Security & Privacy Notes
- Prompt content may contain sensitive data; do not log prompt content in renderer/main logs.
- Keep renderer unprivileged; fetch prompts via existing `configPresenter` IPC calls.

## Compatibility & Migration
- If chat config moves from `systemPrompt: string` to `systemPromptId: string`, provide backwards compatibility:
  - Migrate existing conversations by mapping non-empty `systemPrompt` to a new custom system prompt (optional), or fall back to “no prompt”.
  - Alternatively keep both fields temporarily and resolve precedence (e.g. `systemPromptId` > `systemPrompt`).

