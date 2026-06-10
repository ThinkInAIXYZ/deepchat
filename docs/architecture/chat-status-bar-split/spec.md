# ChatStatusBar Split — Spec

## Problem

`src/renderer/src/components/chat/ChatStatusBar.vue` is 3230 lines (980-line template,
2250-line script) covering ACP agent config, model selection, generation settings
(temperature/topP/context/maxTokens/timeout/thinking budget), reasoning options, system
prompts, permission mode, subagent toggle, and image/video generation settings. Any change
requires navigating the whole file; none of the logic is unit-testable in isolation.

## Approach: staged extraction, template untouched first

**Phase 1 (this change)** — extract script logic into composables/pure modules without touching
the template. Extracted symbols are re-exposed under the same names via destructuring, so the
template and the remaining script are unchanged:

1. `composables/chatStatusBarReasoningOptions.ts` — pure functions (no Vue/store deps):
   reasoning effort/verbosity/visibility option derivation and normalization.
2. `composables/useGenerationNumericInputs.ts` — the numeric-input state machine
   (draft/error/active-field state and accessors) used by all generation numeric fields.
   Component-specific persistence (revision counter) is injected via an `onDraftChange`
   callback.
3. Precedent: `useChatStatusBarAcpConfig.ts` already follows this pattern.

**Phase 2 (follow-up, not in this change)** — template split into child components:
model settings panel (the largest template block), ACP inline options, system prompt menu.
Phase 1 lowers the risk of phase 2 by giving each future child component a ready composable.

## Non-goals (phase 1)

- No template changes, no behavior changes, no store refactors.
- The `deep: true` watch on `modelStore.chatSelectableModelGroups` is kept as-is: its
  callback is cheap and early-returns with an active session; changing watch semantics
  without renderer tests for this component is not worth the risk in this phase.

## Verification

`typecheck:web`, `test:renderer`, `lint`, `format`, `i18n` all clean / at baseline.
