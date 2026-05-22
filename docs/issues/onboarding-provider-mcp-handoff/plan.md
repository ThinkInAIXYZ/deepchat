# Implementation Plan

## Cause

There are two independent fragility points on the renderer side. Both surface
in packaged builds because timing in production is less forgiving than in dev.

1. `useGuidedOnboardingStep.setStepStatus` returns the previous (possibly
   `null`) value of its internal `onboardingState` ref when the backend IPC
   throws. `continueGuidedOnboardingFromSettings` then resolves a `null` step
   id, hits the fallback branch, and calls `windowPresenter.focusMainWindow()`
   instead of `router.push({ name: 'settings-mcp' })`. The backend state is
   already correct — the renderer just doesn't see it on the relevant tick.

2. `GuidedOnboardingOverlay` always renders the dim `<path>` from
   `OnBoardingSpotlight`, even when `useOnBoarding` has not produced a
   spotlight rect yet (target element not yet sized). With no cutout the path
   covers the entire viewport with `pointer-events: auto`, producing the
   "full-window dim, no popover, can't click" symptom while the layout
   stabilizes.

## Change

- **Renderer composable resilience.** In `useGuidedOnboardingStep`, when an
  onboarding IPC call fails, fall back to fetching fresh state via
  `onboardingClient.getState()` before returning to the caller. Apply to
  `setStepStatus`, `activateStep`, and `forceComplete` paths.
- **Navigation helper resilience.** `continueGuidedOnboardingFromSettings`
  refreshes its `state` from `onboardingClient.getState()` when the caller
  passes a `null`/stale value, so that a transient renderer hiccup cannot
  force the helper into the "focus main window" branch.
- **Overlay defensive rendering.** `OnBoardingSpotlight` only renders its
  dim `<path>` when a cutout is present. With no cutout the parent overlay
  still allows the panel to render at its fallback coordinates, but the
  blocking dim no longer covers the window.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
