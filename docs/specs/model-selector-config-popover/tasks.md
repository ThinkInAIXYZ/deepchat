# Tasks: Model Selector Config Popover

## 0) Spec & plan quality gate
1. Resolve all `[NEEDS CLARIFICATION]` items in `docs/specs/model-selector-config-popover/spec.md`.
2. Confirm the meaning of “thinking” and “reference” and how they map to existing capability flags.
3. Confirm prompt ID expectations (timestamp IDs vs user-defined IDs).

## 1) Types & migration
1. Add `systemPromptId?: string` to `CONVERSATION_SETTINGS` in `src/shared/**`.
2. Define precedence and fallback between `systemPromptId` and legacy `systemPrompt`.
3. Add minimal migration behavior (if required) when loading/saving conversation settings.

## 2) Main prompt resolution
1. Resolve `systemPromptId` to prompt content before calling `preparePromptContent` (or inside it).
2. Add main Vitest coverage for resolution + fallback.

## 3) Renderer: capability icons
1. Update `src/renderer/src/components/settings/ModelConfigItem.vue` to render the requested capability icons with i18n tooltips.
2. Add/adjust i18n keys.

## 4) Renderer: ModelSelector popover + config panel
1. Implement two-column popover layout in `src/renderer/src/components/chat-input/ModelSelector.vue`.
2. Add a config panel component that:
   - loads system prompts via `useSystemPromptStore` / `configPresenter`
   - persists `systemPromptId` in conversation settings
   - renders numeric inputs for temperature/context length/max tokens with range validation + hints
   - shows/hides fields based on model/provider defaults and capabilities
3. Add renderer tests for prompt dropdown and numeric input validation.

## 5) Quality gates
1. Run `pnpm run format`.
2. Run `pnpm run lint`.
3. Run `pnpm run typecheck`.
4. Run `pnpm test` (or targeted suites).

