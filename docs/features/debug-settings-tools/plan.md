# Development Debug Settings Tools Plan

## Settings Surface

Add `settings-debug` to the shared settings navigation metadata as a `developmentOnly` item.
Settings renderer callers explicitly opt in with `import.meta.env.DEV`, so production builds neither
register the route nor display a sidebar link.

Move the existing About-page mock controls into `DebugSettings.vue`. The page reuses the established
clients and upgrade store:

```text
Debug settings -> WindowClient -> typed window route -> DEV_EVENTS
Debug settings -> DebugClient -> typed app route -> mock chat session
Debug settings -> UpgradeClient -> typed upgrade routes -> mock update state
```

## Security

Renderer hiding is not an authorization boundary. The main process rejects guided onboarding and
mock-update calls unless it is an unpackaged development runtime. The existing mock-chat route
already applies the same gate.

## Validation

- Verify the settings navigation filters development-only entries by default and when opted in.
- Verify the three mock route handlers return disabled results outside development.
- Run format, i18n validation, lint, and focused test/type checks.
