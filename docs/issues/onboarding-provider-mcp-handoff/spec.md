# Onboarding Provider → MCP Handoff

## Problem

In packaged builds, after the user finishes the `provider-model` guided step the
settings window does not automatically advance to the `settings-mcp` route, so
the MCP coachmark never appears in the expected sequence. Reopening the
settings window and clicking the MCP tab afterwards does surface the MCP
overlay, but in this fallback path the overlay renders as a full-window dim
without a visible popover, blocking subsequent interaction.

Locally (dev) the same flow is continuous. The divergence is timing- and
device-sensitive — the user could not reproduce on their own machine but
observed it on another machine.

## User Story

As a first-time user completing the provider step in the packaged app, I want
the guide to continue into the MCP step without me having to navigate manually,
and when the MCP overlay does appear I want to be able to read it and click
through it.

## Acceptance Criteria

- After `provider-model` completes, the settings window advances to
  `settings-mcp` even when the per-step state returned from the backend is
  stale or missing, as long as the backend has actually progressed.
- When the guided onboarding overlay is asked to render but the spotlight
  target element is not yet sized, the dim layer does not cover the window —
  no interaction is blocked while the target is still being laid out.
- Existing behavior is preserved: when the target element is sized the dim and
  cutout render as before and the user-facing copy/keys do not change.

## Non-goals

- No change to the backend step ordering or migration logic in
  `onboardingRouteSupport.ts`.
- No redesign of the onboarding panel layout or copy.
- No change to the welcome page / main-window flow.
