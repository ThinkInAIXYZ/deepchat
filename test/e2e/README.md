# MioWork E2E Smoke

The suite launches the built Electron application. By default, each fixture creates a temporary
`userData` profile, seeds completed onboarding and diagnostic logging, and removes the profile
after closing the app. It does not use your normal desktop profile by default.

## Coverage

The default suite covers startup, Settings navigation, typed IPC boundaries, workspace watchers,
provider configuration, agent and plugin management, composer drafts, and local streaming.
The plugin and streaming specs use loopback HTTP/MCP fixtures through the real application routes.
They require no external provider credentials.

Five specs require `RUN_PROVIDER_INTEGRATION=true`: basic chat, session persistence, provider
connectivity, chat scrollbar ownership, and composer width. Their default provider/model is
`minimax` / `MiniMax-M2.7`; override these with `DEEPCHAT_E2E_PROVIDER_ID` and
`DEEPCHAT_E2E_MODEL_ID`. The target model must be configured and enabled in the selected profile.

The CI subset runs only launch and Settings navigation, using the same profile isolation.

## Commands

Use Node >=20.19 and pnpm >=10.11. Build before running:

```bash
pnpm run build
pnpm run e2e:smoke
```

Run the smaller CI subset:

```bash
pnpm run e2e:smoke:ci
```

Run a specific deterministic workflow:

```bash
pnpm exec playwright test -c test/e2e/playwright.config.ts 36-chat-streaming
```

For live provider checks, select a dedicated configured test profile:

```bash
DEEPCHAT_E2E_USER_DATA_DIR=/absolute/path/to/test-profile \
RUN_PROVIDER_INTEGRATION=true \
pnpm run e2e:smoke
```

`DEEPCHAT_E2E_USER_DATA_DIR` disables fixture ownership and automatic profile removal. Tests can
create sessions and change application state in that directory. The fixture seeds settings only
when `app-settings.json` does not already exist.

For a packaged executable, set `DEEPCHAT_E2E_APP_MODE=packaged` and
`DEEPCHAT_E2E_EXECUTABLE_PATH` to its absolute path. Windows defaults to the matching unpacked
architecture under `dist` when no executable override is supplied.

## Artifacts and state contracts

Results are written to `test-results/e2e` and `playwright-report`. Each test attaches renderer
console output, page errors, and available main-process logs; failures retain screenshots,
video, and traces.

`chat-page-shell` owns `data-generating`. `chat-page` is the message scroll viewport.
The generation helper observes the shell's generating-to-idle transition. The local streaming
spec holds its response open while checking composer input, then releases it and verifies both
completion and preservation of the draft.
