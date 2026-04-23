# DeepChat E2E Smoke

This suite runs manual smoke regression against the real local desktop environment.

It does not use mock providers, alternate `userData` directories, or E2E-only bootstrap state.
The tests run against the same local profile that the app normally uses.

## Scope

- Launch the Electron app
- Select an agent and start a real conversation
- Send messages with the configured provider and model
- Verify session persistence after restart
- Open the Settings window and check core tabs
- Optionally verify provider connectivity from the Settings window

## Defaults

The smoke suite currently targets the following real provider setup:

- Provider: `minimax`
- Model: `MiniMax-M2.7`

If you want to use a different provider or model, edit [testData.ts](./helpers/testData.ts).

## Prerequisites

Before running the suite:

1. Complete the app onboarding flow.
2. Configure the target provider in your normal local profile.
3. Make sure the target model is enabled and selectable.
4. Build the app.

## Commands

```bash
pnpm run build
pnpm run e2e:smoke
```

Set `RUN_PROVIDER_INTEGRATION=true` before running `pnpm run e2e:smoke` if you also want the
live provider connectivity check in `05-settings-provider.smoke.spec.ts`.

## Artifacts

- `test-results/e2e`
- `playwright-report`

The suite also attaches renderer console output and page errors to each test run.

## Notes

- The suite creates real chat sessions in the current profile.
- Tests are additive only and avoid deleting existing user data.
- Settings checks use the real Settings window and the real provider configuration.
- The provider connectivity check is opt-in because it requires live credentials and network access.
