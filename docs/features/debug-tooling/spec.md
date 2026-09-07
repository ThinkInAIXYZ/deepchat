# Development Debug Tooling

## User Need

Developers need a single, discoverable place to trigger development-only mock scenarios without exposing these controls in a production build or mixing them into the About page.

## Goals

- Add a Debug entry to Settings only in development builds.
- Move existing mock update, guided onboarding, and mock chat-session actions into the Debug page.
- Enforce development-only access in main-process routes as well as the renderer navigation.

## Acceptance Criteria

- Production settings navigation has no Debug entry or route.
- The Debug page is visible in development and offers the three existing mock actions.
- About no longer shows mock controls.
- Guided-onboarding and mock-update routes safely report no action outside development or in packaged builds.

## Constraints

- Reuse typed routes and renderer clients.
- Do not expose credentials, database data, or mock controls in production.
- Preserve the behavior of existing debug actions during development.

## Non-Goals

- Splash-state previews and splash presentation changes.
- Persisting debug preferences.
