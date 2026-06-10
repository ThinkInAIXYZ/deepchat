# ChatStatusBar Split — Tasks

- [x] T1: pure reasoning options module (`chatStatusBarReasoningOptions.ts`)
- [x] T2: numeric inputs composable (`useGenerationNumericInputs.ts`)
- [x] T3: rewire component + cleanup imports
- [x] T4: verification suite

## Outcome (Phase 1)

- `ChatStatusBar.vue`: 3230 → 3004 lines; template untouched; all extracted symbols re-exposed
  under identical names.
- Two new unit-testable modules under `src/renderer/src/components/chat/composables/`.
- `typecheck:web`, `lint`, `format`, `i18n` clean; `test:renderer` identical to dev baseline
  (7 pre-existing failing files, same tests).
- Phase 2 (template split into child components) is sketched in [plan.md](plan.md) and remains
  open as a separate goal.
