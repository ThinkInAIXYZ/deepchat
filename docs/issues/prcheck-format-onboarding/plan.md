# Plan

## Diagnosis

The local PR Check reproduction fails at `pnpm run format:check` for `src/main/routes/onboarding/onboardingRouteSupport.ts`.

## Approach

Run the repository formatter on the reported file, inspect the resulting diff, then rerun PR Check steps to confirm the failure is resolved.

## Test Strategy

- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- Continue to `pnpm run build` if earlier checks pass.
