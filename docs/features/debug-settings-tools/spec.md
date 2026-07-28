# Development Debug Settings Tools

## User Need

Development-only mock controls are currently embedded in the About settings page. Developers need a
clear, dedicated surface for exercising onboarding, mock chat, and update states without exposing
those controls in release builds.

## Goals

- Add a development-only `Debug` settings route and sidebar entry.
- Move the existing onboarding, mock-chat, and mock-update actions from About into that page.
- Reject onboarding and mock-update route invocations outside development or in packaged apps.
- Keep the existing mock-chat main-process gate intact.

## Acceptance Criteria

- Debug tools appear only in renderer development builds.
- The About page no longer exposes development mock controls.
- The Debug page can start guided onboarding, create a mock chat, and add or clear a mock update.
- Main-process onboarding and update mock routes return safe disabled results in production-like
  environments.
- User-facing copy is present in every supported locale.

## Constraints

- Do not add startup splash preview functionality; it is a separate change.
- Do not expose credentials, passwords, or other secret values.
- Keep existing typed route, renderer client, Vue Composition API, shadcn-vue, and i18n conventions.

## Non-Goals

- Persisting debug preferences.
- Adding production diagnostics tools.
- Changing real onboarding, session, or update behavior.
