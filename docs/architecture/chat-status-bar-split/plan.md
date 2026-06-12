# ChatStatusBar Split — Plan

## Phase 1 steps

1. Create `chatStatusBarReasoningOptions.ts` with the pure option helpers
   (`getReasoningEffortOptions`, `getVerbosityOptions`, `getReasoningVisibilityOptions`,
   `supportsReasoningEffort`, `supportsVerbosity`, `hasThinkingBudgetSupport`,
   `normalizeReasoningEffort`, `normalizeVerbosity`, `normalizeReasoningVisibility`) and the
   `DEFAULT_VERBOSITY_OPTIONS` constant they own.
2. Create `useGenerationNumericInputs.ts` owning `activeNumericInput`, `numericInputDrafts`,
   `numericInputErrors` and their accessor functions; deps injected:
   `localSettings`, `t`, `onDraftChange`.
3. Rewire `ChatStatusBar.vue`: delete moved code, import/destructure under identical names.
4. Remove imports/types that became unused (`ReasoningEffortValue`/`VerbosityValue` local
   aliases move with the helpers).
5. Verify (typecheck:web, test:renderer baseline, lint, format, i18n).

## Phase 2 sketch (separate goal)

- `ChatStatusBarModelPanel.vue` (model list + search + settings expansion)
- `ChatStatusBarAcpOptions.vue` (ACP badge + inline/overflow options)
- Generation settings fields grouped into `GenerationSettingsFields.vue`
- Re-evaluate the `deep: true` model-groups watch once the panel is isolated

# Tasks

- [ ] T1: pure reasoning options module
- [ ] T2: numeric inputs composable
- [ ] T3: rewire component + cleanup imports
- [ ] T4: verification suite
